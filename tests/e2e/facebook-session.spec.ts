import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

test("restores a Facebook profile and its cookies after restarting the desktop", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      path.resolve("node_modules/tsx/dist/cli.mjs"),
      path.resolve("tests/fixtures/facebook-session-runtime.ts"),
    ],
    { windowsHide: true, timeout: 45000 },
  );
  expect(JSON.parse(stdout)).toEqual({
    restored: true,
    sessionCookieRestored: true,
    challengeDetected: true,
    logoutDetected: true,
  });
});
