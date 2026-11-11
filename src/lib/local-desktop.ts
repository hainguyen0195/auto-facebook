import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { z } from "zod";
import { db } from "./db";
import { desktopProjectRoot, localDesktopAvailable } from "./desktop-host";
import { createPairing, pairDesktop, queueDesktopCommand } from "./desktop";
import { AppError, assertFound } from "./errors";
import {
  desktopDataRoot,
  facebookBrowserChannel,
  localDesktopRoot,
} from "../desktop/profiles";

const configSchema = z.object({
  server: z.string().url(),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  deviceId: z.string(),
  workspaceId: z.string(),
});
const starts = new Map<string, Promise<string>>();

async function startLocalDesktop(workspaceId: string) {
  const projectRoot = desktopProjectRoot();
  const server = new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000")
    .origin;
  const dataRoot = desktopDataRoot(projectRoot);
  const root = localDesktopRoot(dataRoot, workspaceId);
  const configPath = path.join(root, "connection.json");
  let config: z.infer<typeof configSchema> | undefined;
  try {
    config = configSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
  } catch (error) {
    if (
      !(error instanceof SyntaxError) &&
      !(error instanceof z.ZodError) &&
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    )
      throw error;
  }
  const saved =
    config && config.server === server && config.workspaceId === workspaceId
      ? await db.desktopDevice.findFirst({
          where: {
            id: config.deviceId,
            workspaceId,
            revokedAt: null,
            tokenHash: createHash("sha256").update(config.token).digest("hex"),
          },
        })
      : null;
  if (saved?.lastSeenAt && Date.now() - saved.lastSeenAt.getTime() < 45_000)
    return saved.id;

  const channel = facebookBrowserChannel();
  if (!channel) {
    const { chromium } = await import("playwright");
    if (!existsSync(chromium.executablePath()))
      throw new AppError(
        409,
        "Cài Microsoft Edge hoặc Google Chrome trên máy này rồi bấm Kết nối Facebook lại.",
      );
  }
  if (!saved) {
    const pairing = await createPairing(workspaceId);
    const paired = await pairDesktop(pairing.code, hostname());
    config = { ...paired, server };
    await mkdir(root, { recursive: true });
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  }
  const deviceId = config!.deviceId;
  const child = spawn(
    process.execPath,
    [
      path.join(projectRoot, "node_modules/tsx/dist/cli.mjs"),
      path.join(projectRoot, "scripts/desktop.ts"),
      "--local-workspace",
      workspaceId,
    ],
    {
      cwd: projectRoot,
      detached: true,
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        NHIPDANG_DESKTOP_DIR: dataRoot,
        ...(channel ? { NHIPDANG_BROWSER_CHANNEL: channel } : {}),
      },
    },
  );
  let stopped = false;
  child.once("error", () => {
    stopped = true;
  });
  child.once("exit", () => {
    stopped = true;
  });
  child.unref();
  for (let attempt = 0; attempt < 60; attempt++) {
    if (stopped) break;
    const device = await db.desktopDevice.findFirst({
      where: { id: deviceId, workspaceId, revokedAt: null },
    });
    if (device?.lastSeenAt && Date.now() - device.lastSeenAt.getTime() < 45_000)
      return deviceId;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new AppError(
    503,
    "Chưa bật được kết nối Facebook trên máy này. Hãy bấm Kết nối Facebook để thử lại.",
  );
}

export async function connectLocalFacebook(
  workspaceId: string,
  accountId: string,
) {
  if (!localDesktopAvailable())
    throw new AppError(
      409,
      "Kết nối trực tiếp chỉ dùng khi mở ứng dụng trên máy Windows đang chạy Nhịp Đăng. Với máy chủ từ xa, hãy kết nối máy đăng trước.",
    );
  assertFound(
    await db.facebookAccount.findFirst({
      where: { id: accountId, workspaceId, archivedAt: null },
    }),
  );
  let starting = starts.get(workspaceId);
  if (!starting) {
    starting = startLocalDesktop(workspaceId).finally(() =>
      starts.delete(workspaceId),
    );
    starts.set(workspaceId, starting);
  }
  const deviceId = await starting;
  return queueDesktopCommand(workspaceId, accountId, deviceId, "LOGIN");
}
