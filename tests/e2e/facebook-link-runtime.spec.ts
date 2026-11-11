import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
test("post links survive slow responses and lost toasts without guessing from feed data", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      path.resolve("node_modules/tsx/dist/cli.mjs"),
      path.resolve("tests/fixtures/facebook-link-runtime.ts"),
    ],
    { windowsHide: true, timeout: 45000 },
  );
  expect(JSON.parse(stdout)).toHaveLength(12);
});
