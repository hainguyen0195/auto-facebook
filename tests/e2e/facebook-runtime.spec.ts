import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

test("desktop publishing works in the actual tsx runner with image uploads", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      path.resolve("node_modules/tsx/dist/cli.mjs"),
      path.resolve("tests/fixtures/facebook-runtime.ts"),
    ],
    { windowsHide: true, timeout: 45000 },
  );
  expect(JSON.parse(stdout)).toEqual([
    { scenario: "published", outcome: "PUBLISHED", clicks: 1, arms: 1 },
    { scenario: "pending", outcome: "PUBLISHED", clicks: 1, arms: 1 },
    {
      scenario: "no-browser-evaluation",
      outcome: "PUBLISHED",
      clicks: 1,
      arms: 1,
    },
    { scenario: "arm-error", outcome: "FAILED", clicks: 0, arms: 1 },
    { scenario: "click-error", outcome: "UNCERTAIN", clicks: 0, arms: 1 },
    { scenario: "no-confirmation", outcome: "PUBLISHED", clicks: 1, arms: 1 },
    {
      scenario: "editor-without-role",
      outcome: "PUBLISHED",
      clicks: 1,
      arms: 1,
    },
    { scenario: "plaintext-editor", outcome: "PUBLISHED", clicks: 1, arms: 1 },
    { scenario: "hidden-dialog", outcome: "PUBLISHED", clicks: 1, arms: 1 },
    { scenario: "web-redirect", outcome: "PUBLISHED", clicks: 1, arms: 1 },
    { scenario: "wrong-group-redirect", outcome: "FAILED", clicks: 0, arms: 0 },
    {
      scenario: "slow-domcontentloaded",
      outcome: "PUBLISHED",
      clicks: 1,
      arms: 1,
    },
    { scenario: "existing-group", outcome: "PUBLISHED", clicks: 1, arms: 1 },
    { scenario: "destination-change", outcome: "FAILED", clicks: 0, arms: 1 },
  ]);
});
