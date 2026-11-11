import { existsSync } from "node:fs";
import path from "node:path";

export const desktopProjectRoot = () =>
  path.resolve(
    /* turbopackIgnore: true */ process.env.NHIPDANG_PROJECT_DIR ||
      process.cwd(),
  );

export function localDesktopAvailable() {
  const server = new URL(
    process.env.BETTER_AUTH_URL || "http://localhost:3000",
  );
  return (
    process.platform === "win32" &&
    process.env.NHIPDANG_LOCAL_DESKTOP !== "0" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(server.hostname) &&
    existsSync(path.join(desktopProjectRoot(), "scripts/desktop.ts")) &&
    existsSync(path.join(desktopProjectRoot(), "node_modules/tsx/dist/cli.mjs"))
  );
}
