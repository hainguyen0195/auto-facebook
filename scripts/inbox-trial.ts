import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  checkIdentity,
  openMessengerPanel,
  readInboxList,
} from "../src/inbox-trial/browser";
import { loadState, saveState } from "../src/inbox-trial/storage";
import {
  mergeSnapshot,
  pruneState,
  recordStatus,
  type TrialStatus,
} from "../src/inbox-trial/state";

const dataDir = process.env.INBOX_TRIAL_DIR || "/data";
const config = JSON.parse(
  await readFile(path.join(dataDir, "config.json"), "utf8"),
) as {
  workspaceId: string;
  accountId: string;
  accountName: string;
  expectedIdentityHash: string;
};
if (
  !/^[a-z0-9]+$/i.test(config.workspaceId) ||
  !/^[a-z0-9]+$/i.test(config.accountId) ||
  typeof config.accountName !== "string" ||
  !/^[a-f0-9]{64}$/.test(config.expectedIdentityHash)
)
  throw new Error("Invalid inbox trial configuration");

const scope = `${config.workspaceId}:${config.accountId}:${config.expectedIdentityHash}`;
const file = path.join(dataDir, "state.json");
let state = await loadState(file, scope);
state = recordStatus(state, "STARTING", "Dang khoi dong trinh duyet VPS.");
await saveState(file, state);
const html = await readFile(
  new URL("../tools/inbox-trial/dashboard.html", import.meta.url),
);
const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  if (request.method !== "GET") {
    response.writeHead(405).end();
    return;
  }
  if (request.url === "/health") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ status: "ok", monitor: state.status }));
  } else if (request.url === "/status") {
    const current = pruneState(state);
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify({
        accountName: config.accountName,
        status: current.status,
        reason: current.reason,
        checkedAt: current.checkedAt,
        lastSuccessAt: current.lastSuccessAt,
        conversations: current.conversations,
        events: current.events,
      }),
    );
  } else if (request.url === "/dashboard.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    void readFile(new URL("../tools/inbox-trial/dashboard.js", import.meta.url))
      .then((script) => response.end(script))
      .catch(() => response.writeHead(500).end());
  } else if (request.url === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  } else response.writeHead(404).end();
});
await new Promise<void>((resolve) => server.listen(8787, "0.0.0.0", resolve));

let stopping = false;
let wake: (() => void) | undefined;
const stop = () => {
  stopping = true;
  wake?.();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
await mkdir(path.join(dataDir, "profile"), { recursive: true, mode: 0o700 });

const context = await chromium.launchPersistentContext(
  path.join(dataDir, "profile"),
  {
    executablePath: process.env.INBOX_CHROMIUM_PATH || "/usr/bin/chromium",
    headless: false,
    locale: "vi-VN",
    viewport: { width: 1280, height: 800 },
    args: ["--disable-dev-shm-usage", "--disable-session-crashed-bubble"],
    acceptDownloads: false,
  },
);
context.setDefaultTimeout(5_000);
const page = context.pages()[0] || (await context.newPage());
context.on("close", stop);
page.on("dialog", (dialog) => {
  void dialog.dismiss().catch(() => {});
});
page.setDefaultNavigationTimeout(30_000);
let started = false;
let lastStatus: TrialStatus | undefined;

async function inspect() {
  if (!started) {
    // Start on the home page. A messages/t URL can auto-mark a chat as read.
    await page.goto("https://www.facebook.com/", {
      waitUntil: "domcontentloaded",
    });
    started = true;
  }
  const identity = await checkIdentity(
    context,
    page,
    config.expectedIdentityHash,
  );
  if (identity) {
    state = recordStatus(
      state,
      identity,
      "Can xu ly truc tiep trong cua so Facebook VPS.",
    );
    return;
  }
  if (!(await page.evaluate(() => navigator.onLine)))
    throw new Error("Offline");
  const probe = await context.request.get(
    "https://www.facebook.com/robots.txt",
    {
      timeout: 10_000,
      maxRedirects: 0,
    },
  );
  const reachable = probe.ok();
  await probe.dispose();
  if (!reachable) throw new Error("Network probe failed");
  let snapshot = await readInboxList(page);
  if (snapshot.unsafe) {
    state = recordStatus(
      state,
      "UNSAFE_VIEW",
      "Dong hoi thoai dang mo. Bo thu khong tu mo hay dong tin nhan.",
    );
    return;
  }
  if (snapshot.pinRequired) {
    state = recordStatus(
      state,
      "PIN_REQUIRED",
      "Nhap PIN truc tiep neu Facebook yeu cau. Khong gui PIN qua chat.",
    );
    return;
  }
  if (!snapshot.recognized) {
    // Only one exact preview-panel control is permitted. Thread links are never clicked.
    if (await openMessengerPanel(page)) {
      await page.waitForTimeout(1500);
      snapshot = await readInboxList(page);
    }
  }
  const identityAfter = await checkIdentity(
    context,
    page,
    config.expectedIdentityHash,
  );
  if (identityAfter) {
    state = recordStatus(
      state,
      identityAfter,
      "Phien da thay doi; khong ghi nhan du lieu hoi thoai.",
    );
  } else if (snapshot.unsafe) {
    state = recordStatus(
      state,
      "UNSAFE_VIEW",
      "Facebook dang mo hoi thoai. Dung doc du lieu.",
    );
  } else if (snapshot.pinRequired) {
    state = recordStatus(
      state,
      "PIN_REQUIRED",
      "Can nhap PIN Messenger truc tiep tren VPS.",
    );
  } else if (!snapshot.recognized) {
    state = recordStatus(
      state,
      "UNSUPPORTED",
      "Chua nhan dien duoc danh sach Messenger; khong suy doan so tin chua doc.",
    );
  } else {
    state = mergeSnapshot(state, snapshot.rows);
  }
}

try {
  while (!stopping) {
    const tickStarted = Date.now();
    try {
      await inspect();
    } catch {
      state = recordStatus(
        state,
        "OFFLINE",
        "Khong kiem tra duoc ket noi/giao dien. Du lieu cu duoc giu kem thoi diem cap nhat.",
      );
    }
    await saveState(file, state);
    if (lastStatus !== state.status) {
      // Never log DOM, message text, cookies, URLs or raw browser exceptions.
      console.log(
        JSON.stringify({ at: state.checkedAt, status: state.status }),
      );
      lastStatus = state.status;
    }
    if (!stopping)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          () => {
            wake = undefined;
            resolve();
          },
          Math.max(1000, 30_000 - (Date.now() - tickStarted)),
        );
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
  }
} finally {
  await context.close().catch(() => {});
  state = recordStatus(state, "STOPPED", "Bo thu da dung.");
  await saveState(file, state);
  server.close();
}
