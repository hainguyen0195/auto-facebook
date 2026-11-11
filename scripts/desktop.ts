import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { FacebookDesktop, type PublishResult } from "../src/desktop/facebook";
import { abortable, attemptSignal, failureCode } from "../src/desktop/attempt";
import {
  flushPendingLink,
  flushResult,
  persistPendingLink,
  persistResult,
} from "../src/desktop/result-outbox";
import { interactOnFacebook } from "../src/desktop/facebook-interactions";
import { FacebookInboxReader } from "../src/desktop/inbox";
import { browserCommandFailure } from "../src/desktop/command-errors";
import {
  desktopDataRoot,
  facebookBrowserProfilePath,
  localDesktopRoot,
} from "../src/desktop/profiles";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dataRoot = desktopDataRoot();
const localWorkspace = option("local-workspace");
const root = localWorkspace
  ? localDesktopRoot(dataRoot, localWorkspace)
  : dataRoot;
const configPath = path.join(root, "connection.json");
type Config = {
  server: string;
  token: string;
  deviceId: string;
  workspaceId: string;
  browserChannel?: "chrome" | "msedge";
};
const instanceId = randomUUID();
let config: Config;
let stopping = false;
await mkdir(root, { recursive: true });
const lockPath = path.join(root, "runner.lock");
try {
  const previous = Number(await readFile(lockPath, "utf8"));
  let active = false;
  try {
    process.kill(previous, 0);
    active = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") active = true;
  }
  if (active) throw new Error("Máy đăng đang chạy trong tiến trình khác.");
  await unlink(lockPath);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const lock = await open(lockPath, "wx", 0o600);
await lock.writeFile(String(process.pid));
await lock.close();
let facebook: FacebookDesktop | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;
let cleanupPromise: Promise<void> | undefined;
class DesktopAuthError extends Error {}
async function request<T>(
  endpoint: string,
  body?: unknown,
  authenticated = true,
): Promise<T> {
  const response = await fetch(`${config.server}/api/desktop/${endpoint}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(authenticated ? { Authorization: `Bearer ${config.token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25_000),
  });
  const result = await response.json();
  if (authenticated && response.status === 401)
    throw new DesktopAuthError(
      "Máy đăng đã ngắt kết nối. Cài lại ứng dụng nền từ website để kết nối lại.",
    );
  if (!response.ok)
    throw new Error(result.error || `Máy đăng: HTTP ${response.status}`);
  return result as T;
}
function cleanup() {
  if (!cleanupPromise) {
    stopping = true;
    cleanupPromise = (async () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      try {
        await facebook?.close();
      } finally {
        await unlink(lockPath).catch(() => {});
      }
    })();
  }
  return cleanupPromise;
}
process.on("SIGINT", () => {
  void cleanup().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void cleanup().then(() => process.exit(0));
});
process.on("message", (message) => {
  if (message === "stop") void cleanup().then(() => process.exit(0));
});
try {
  const code = option("code");
  if (code) {
    const server = new URL(option("server") || "http://localhost:3000");
    if (
      server.username ||
      server.password ||
      (server.protocol !== "https:" &&
        !(
          server.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(server.hostname)
        ))
    )
      throw new Error(
        "Dùng HTTPS cho máy chủ, hoặc HTTP localhost khi chạy local.",
      );
    config = { server: server.origin } as Config;
    const paired = await request<Omit<Config, "server">>(
      "pair",
      { code, name: option("name") || hostname() },
      false,
    );
    const saved: Config | null = await readFile(configPath, "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => null);
    config = {
      ...paired,
      server: server.origin,
      ...(saved?.server === server.origin &&
      saved.workspaceId === paired.workspaceId &&
      ["chrome", "msedge"].includes(saved.browserChannel || "")
        ? { browserChannel: saved.browserChannel }
        : {}),
    };
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    console.log("Đã kết nối máy đăng. Mở mục Máy đăng để đăng nhập Facebook.");
  } else {
    try {
      config = JSON.parse(await readFile(configPath, "utf8"));
    } catch {
      throw new Error(
        "Chưa kết nối. Trong webapp, mở Máy đăng → Kết nối máy mới và chạy lệnh được hiển thị.",
      );
    }
  }
  if (localWorkspace && localWorkspace !== config.workspaceId)
    throw new Error("Cấu hình máy đăng không thuộc workspace này.");
  if (args.includes("--pair-only")) {
    await cleanup();
    process.exit(0);
  }
  if (
    !process.env.NHIPDANG_BROWSER_CHANNEL &&
    ["chrome", "msedge"].includes(config.browserChannel || "")
  )
    process.env.NHIPDANG_BROWSER_CHANNEL = config.browserChannel;
  facebook = new FacebookDesktop((accountId) =>
    facebookBrowserProfilePath(dataRoot, config.workspaceId, accountId),
  );
  const inbox = new FacebookInboxReader(facebook);
  const inboxAttempts = new Map<string, number>();
  let paused = false;
  let inboxAbort: AbortController | undefined;
  const updateHeartbeat = async () => {
    const state = await request<{ paused?: boolean }>("heartbeat", {
      instanceId,
      supportsInbox: true,
    });
    paused = state.paused === true;
    if (paused) {
      inboxAbort?.abort();
      await inbox.releaseExcept(new Set());
    }
  };
  await updateHeartbeat();
  let healthy = true;
  heartbeatTimer = setInterval(() => {
    void updateHeartbeat().then(
      () => {
        healthy = true;
      },
      () => {
        healthy = false;
      },
    );
  }, 10_000);
  type Work = {
    type: "COMMAND" | "POST" | "INTERACTION";
    id: string;
    runId: string;
    generation: number;
    attemptDeadlineAt?: string;
    kind?: string;
    account: { id: string; name: string };
    targetUrl: string;
    group: boolean;
    content: string;
    identityHash: string;
    interactionKind: "COMMENT" | "BUMP" | "REACTION";
    reaction?: string | null;
    assets: { id: string; mime: string }[];
  };
  console.log(
    "Máy đăng đang trực tuyến. Giữ cửa sổ này và máy tính hoạt động. Ctrl+C để dừng.",
  );
  const logins = new Map<
    string,
    { expiresAt: number; signature: string; generation: number }
  >();
  while (!stopping) {
    let observedInbox = false;
    try {
      if (!healthy) {
        await updateHeartbeat();
        healthy = true;
      }
      // A result must be acknowledged before another claim can replace its run.
      await flushResult(root, request);
      await flushPendingLink(
        root,
        (accountId) => facebook!.capturePublishedLinkResult(accountId),
        request,
      );
      for (const [accountId, login] of logins) {
        const session = await facebook.observeLogin(accountId);
        if (!session || Date.now() > login.expiresAt) {
          logins.delete(accountId);
          continue;
        }
        const signature = JSON.stringify(session);
        if (signature !== login.signature) {
          await request(`sessions/${accountId}`, {
            instanceId,
            generation: login.generation,
            ...session,
          });
          login.signature = signature;
        }
        if (session.state === "READY") logins.delete(accountId);
      }
      const work = await request<Work | null>("claim", {
        instanceId,
        supportsInteractions: true,
      });
      if (work?.type === "COMMAND") {
        let result: { state: string; identityHash?: string; message: string };
        try {
          if (work.kind === "LOGIN" || work.kind === "OPEN") {
            if (work.kind === "OPEN")
              result = await facebook.show(work.account.id);
            else {
              await facebook.login(work.account.id);
              result = await facebook.check(work.account.id, false);
            }
            if (result.state !== "READY")
              logins.set(work.account.id, {
                expiresAt: Date.now() + 10 * 60_000,
                signature: JSON.stringify(result),
                generation: work.generation,
              });
          } else if (work.kind === "OPEN_POST") {
            await facebook.openTarget(work.account.id, work.targetUrl);
            result = {
              state: "OPENED",
              message:
                "Đã mở bài viết trong đúng profile. Tự đăng và tự tương tác đã tắt cho tài khoản này để bạn thao tác thủ công.",
            };
          } else if (work.kind === "CLOSE") {
            logins.delete(work.account.id);
            await facebook.close(work.account.id);
            result = {
              state: "CLOSED",
              message:
                "Đã đóng cửa sổ và dừng kiểm tra tin nhắn; phiên được giữ trên máy này. Lịch tự đăng vẫn có thể mở cửa sổ khi đến hạn nếu chưa tạm dừng máy.",
            };
          } else result = await facebook.check(work.account.id);
        } catch (error) {
          console.error(
            `Desktop ${work.kind}:`,
            error instanceof Error ? error.message : "Unknown browser error",
          );
          result = {
            state: "FAILED",
            message: browserCommandFailure(work.kind || "CHECK", error),
          };
        }
        await request(`commands/${work.id}`, {
          runId: work.runId,
          generation: work.generation,
          ...result,
        });
      } else if (work?.type === "INTERACTION") {
        const signal = attemptSignal(work.attemptDeadlineAt);
        const result = await interactOnFacebook(
          facebook,
          {
            accountId: work.account.id,
            identityHash: work.identityHash,
            targetUrl: work.targetUrl,
            kind: work.interactionKind,
            content: work.content,
            reaction: work.reaction,
          },
          async () => {
            signal.throwIfAborted();
            if (stopping || !healthy)
              throw new Error("Máy đang dừng hoặc mất kết nối.");
            await request(`interactions/${work.id}/arm`, {
              runId: work.runId,
              targetUrl: work.targetUrl,
            });
          },
          signal,
        );
        await persistResult(root, {
          endpoint: `interactions/${work.id}/result`,
          body: { runId: work.runId, ...result },
        });
        await flushResult(root, request);
        console.log(
          JSON.stringify({
            event: "desktop.interaction.finished",
            id: work.id,
            outcome: result.outcome,
          }),
        );
      } else if (work?.type === "POST") {
        let result: PublishResult;
        const signal = attemptSignal(work.attemptDeadlineAt);
        try {
          const files = await abortable(signal, async () => {
            const files = [];
            for (const asset of work.assets) {
              const response = await fetch(
                `${config.server}/api/desktop/assets/${asset.id}`,
                {
                  headers: { Authorization: `Bearer ${config.token}` },
                  signal: AbortSignal.any([
                    signal,
                    AbortSignal.timeout(30_000),
                  ]),
                },
              );
              if (!response.ok) {
                const error = new Error(
                  `Không tải được ảnh công việc (HTTP ${response.status}).`,
                );
                if (
                  response.status === 408 ||
                  response.status === 429 ||
                  response.status >= 500
                )
                  error.name = "TimeoutError";
                throw error;
              }
              const buffer = Buffer.from(await response.arrayBuffer());
              if (buffer.length > 10 * 1024 * 1024)
                throw new Error("Ảnh vượt giới hạn.");
              files.push({
                name: `${asset.id}.${asset.mime === "image/png" ? "png" : "jpg"}`,
                mimeType: asset.mime,
                buffer,
              });
            }
            return files;
          });
          signal.throwIfAborted();
          result = await facebook!.publish(
            {
              accountId: work.account.id,
              identityHash: work.identityHash,
              targetUrl: work.targetUrl,
              group: work.group,
              content: work.content,
              files,
            },
            async () => {
              signal.throwIfAborted();
              if (stopping || !healthy)
                throw new Error("Máy đăng đang dừng hoặc mất kết nối.");
              await request(`tasks/${work.id}/arm`, {
                runId: work.runId,
                targetUrl: work.targetUrl,
              });
            },
            signal,
          );
        } catch (error) {
          result = {
            outcome: "FAILED",
            failure: {
              stage: "tải ảnh và chuẩn bị lượt đăng",
              submitAttempted: false,
              code: failureCode(error, signal),
            },
            message:
              "Chưa gửi bài vì không tải đủ ảnh hoặc không kết nối được máy chủ.",
          };
        }
        const pending = {
          endpoint: `tasks/${work.id}/result`,
          body: { runId: work.runId, ...result },
        };
        // Persist only the result, never browser cookies, so a lost acknowledgement can be replayed.
        await persistResult(root, pending);
        if (result.outcome === "PUBLISHED")
          await persistPendingLink(root, {
            taskId: work.id,
            runId: work.runId,
            accountId: work.account.id,
          });
        await flushResult(root, request);
        if (result.outcome === "PUBLISHED") {
          await flushPendingLink(
            root,
            (accountId) => facebook!.capturePublishedLinkResult(accountId),
            request,
          );
        }
        console.log(
          JSON.stringify({
            event: "desktop.task.finished",
            taskId: work.id,
            outcome: result.outcome,
          }),
        );
      } else {
        const targets = paused
          ? []
          : await request<
              {
                accountId: string;
                generation: number;
                identityHash: string;
                busy: boolean;
                previouslyUnread?: string[];
              }[]
            >("inbox/targets", { instanceId });
        await inbox.releaseExcept(new Set(targets.map((t) => t.accountId)));
        // Observe at most one account before asking for posting work again.
        const target = targets
          .filter(
            (t) =>
              !t.busy &&
              Date.now() -
                (inboxAttempts.get(`${t.accountId}:${t.generation}`) ?? 0) >=
                30_000,
          )
          .sort(
            (a, b) =>
              (inboxAttempts.get(`${a.accountId}:${a.generation}`) ?? 0) -
              (inboxAttempts.get(`${b.accountId}:${b.generation}`) ?? 0),
          )[0];
        if (target && !paused) {
          inboxAttempts.set(
            `${target.accountId}:${target.generation}`,
            Date.now(),
          );
          inboxAbort = new AbortController();
          const observation = await inbox.read(
            target.accountId,
            target.identityHash,
            inboxAbort.signal,
            target.previouslyUnread,
          );
          inboxAbort = undefined;
          await request(`inbox/${target.accountId}`, {
            instanceId,
            generation: target.generation,
            ...observation,
          });
          observedInbox = true;
        }
      }
    } catch (error) {
      if (error instanceof DesktopAuthError) throw error;
      console.error(
        error instanceof Error
          ? error.message
          : "Máy đăng đang chờ kết nối lại.",
      );
    }
    if (!stopping && !observedInbox)
      await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
} catch (error) {
  if (error instanceof DesktopAuthError) {
    console.error(error.message);
    process.exitCode = 78;
  } else throw error;
} finally {
  await cleanup();
  // Let the supervisor observe a revoked runner's exit instead of keeping IPC alive.
  if (process.connected) process.disconnect();
}
