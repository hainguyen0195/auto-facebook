import "dotenv/config";
import { spawn } from "node:child_process";
import path from "node:path";

const child = spawn(
  process.execPath,
  [path.resolve(".next/standalone/server.js")],
  {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: "production",
      NHIPDANG_PROJECT_DIR: process.cwd(),
      HOSTNAME: "127.0.0.1",
      PORT: process.env.PORT || "3000",
      MEDIA_DIR: path.resolve(process.env.MEDIA_DIR || ".data/media"),
    },
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code || 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
