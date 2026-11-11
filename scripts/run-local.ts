import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import "dotenv/config";
import { createServer } from "node:net";

// Never rebuild files used by an already running local production server.
const port = Number(process.env.PORT || 3000);
const available = await new Promise<boolean>((resolve, reject) => {
  const probe = createServer();
  probe.once("error", (error: NodeJS.ErrnoException) =>
    error.code === "EADDRINUSE" ? resolve(false) : reject(error),
  );
  probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
});
if (!available) {
  console.error(
    `Cổng ${port} đang được dùng. Dừng bản đang chạy trước khi cập nhật hoặc mở ứng dụng hiện tại.`,
  );
  process.exit(1);
}

const tsx = path.resolve("node_modules/tsx/dist/cli.mjs");
const initialized = spawnSync(
  process.execPath,
  [tsx, "scripts/local.ts", "init"],
  { stdio: "inherit", windowsHide: true },
);
if (initialized.status !== 0) process.exit(initialized.status || 1);
const development = process.argv.includes("--dev");
if (!development) {
  console.log(
    "Chuẩn bị bản chạy ổn định; trang không tự tải lại khi file thay đổi.",
  );
  for (const args of [
    [path.resolve("node_modules/prisma/build/index.js"), "generate"],
    [path.resolve("node_modules/next/dist/bin/next"), "build"],
    [tsx, "scripts/finalize-build.ts"],
  ]) {
    const built = spawnSync(process.execPath, args, {
      stdio: "inherit",
      windowsHide: true,
    });
    if (built.status !== 0) process.exit(built.status || 1);
  }
}
const children: ChildProcess[] = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500).unref();
}
children.push(
  spawn(
    process.execPath,
    development
      ? [
          path.resolve("node_modules/next/dist/bin/next"),
          "dev",
          "--hostname",
          "127.0.0.1",
        ]
      : [tsx, "scripts/start.ts"],
    { stdio: "inherit", windowsHide: true },
  ),
);
children.push(
  spawn(process.execPath, [tsx, "src/worker.ts"], {
    stdio: "inherit",
    windowsHide: true,
  }),
);
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code || 0);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
console.log(
  "Nhịp Đăng: http://localhost:3000. Stop with Ctrl+C. PostgreSQL data is preserved.",
);
