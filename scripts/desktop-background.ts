import { spawn } from "node:child_process";
import {
  mkdir,
  open,
  readFile,
  stat,
  lstat,
  unlink,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createServer, createConnection } from "node:net";

// Keep the browser in the user's interactive session so its windows stay usable.
const release = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.dirname(release);
const dataRoot = path.join(appRoot, "data");
if (process.platform !== "win32") process.umask(0o077);
await mkdir(dataRoot, { recursive: true });
const lockPath = path.join(dataRoot, "background.lock");
const pipe =
  process.platform === "win32"
    ? "\\\\.\\pipe\\nhipdang-" +
      createHash("sha256")
        .update(appRoot.toLowerCase())
        .digest("hex")
        .slice(0, 32)
    : `/tmp/nhipdang-${process.getuid?.()}-${createHash("sha256").update(appRoot).digest("hex").slice(0, 24)}.sock`;
const singleton = createServer((socket) => socket.end());
async function listen() {
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => {
      singleton.off("listening", ready);
      reject(error);
    };
    const ready = () => {
      singleton.off("error", failed);
      resolve();
    };
    singleton.once("error", failed);
    singleton.once("listening", ready);
    singleton.listen(pipe);
  });
}
try {
  await listen();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
  if (process.platform === "win32") process.exit(0);
  // A Unix socket survives an unclean shutdown; only remove our own dead socket.
  const live = await new Promise<boolean>((resolve, reject) => {
    const probe = createConnection(pipe);
    probe.setTimeout(2_000);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("timeout", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", (e: NodeJS.ErrnoException) => {
      probe.destroy();
      if (["ECONNREFUSED", "ENOENT"].includes(e.code || "")) resolve(false);
      else reject(e);
    });
  });
  if (live || (await running(lockPath))) process.exit(0);
  const previous = await lstat(pipe).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
    return null;
  });
  if (previous) {
    if (!previous.isSocket() || previous.uid !== process.getuid?.())
      throw new Error("Unexpected background socket owner.");
    await unlink(pipe).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
  try {
    await listen();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") process.exit(0);
    throw e;
  }
}
async function running(file: string) {
  try {
    const pid = Number(await readFile(file, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
const lock = await open(lockPath, "w");
await lock.writeFile(String(process.pid));
await lock.close();
let stopping = false;
let child: ReturnType<typeof spawn> | undefined;
let wake: (() => void) | undefined;
const stop = () => {
  stopping = true;
  if (child?.connected) child.send("stop");
  wake?.();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const stopFile = path.join(dataRoot, "background.stop");
const stopTimer = setInterval(() => {
  void stat(stopFile).then(stop, () => {});
}, 1_000);
let failures = 0;
try {
  while (!stopping) {
    if (!(await running(path.join(dataRoot, "runner.lock")))) {
      const logPath = path.join(dataRoot, "desktop.log");
      const size = (await stat(logPath).catch(() => null))?.size ?? 0;
      if (size > 5 * 1024 * 1024) {
        await unlink(logPath + ".1").catch(() => {});
        await rename(logPath, logPath + ".1");
      }
      const log = await open(logPath, "a");
      if (stopping) {
        await log.close();
        break;
      }
      const started = Date.now();
      let exitCode: number | null;
      try {
        child = spawn(process.execPath, [path.join(release, "desktop.mjs")], {
          cwd: appRoot,
          windowsHide: true,
          stdio: ["ignore", log.fd, log.fd, "ipc"],
          env: {
            ...process.env,
            NHIPDANG_DESKTOP_DIR: dataRoot,
            PLAYWRIGHT_BROWSERS_PATH: path.join(appRoot, "browsers"),
            DOTENV_CONFIG_PATH: path.join(appRoot, "unused.env"),
          },
        });
        exitCode = await new Promise<number | null>((resolve, reject) => {
          child!.once("error", reject);
          child!.once("exit", resolve);
        });
      } finally {
        child = undefined;
        await log.close();
      }
      // A revoked device needs a fresh pairing instead of an endless restart loop.
      if (exitCode === 78) break;
      failures = Date.now() - started > 60_000 ? 0 : Math.min(failures + 1, 5);
    }
    if (!stopping)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          () => {
            wake = undefined;
            resolve();
          },
          Math.min(60_000, 2 ** failures * 2_000),
        );
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
  }
} finally {
  clearInterval(stopTimer);
  singleton.close();
  await unlink(lockPath).catch(() => {});
}
