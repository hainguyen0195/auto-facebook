import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

test("automatic interactions and reliable post links work in the actual TSX runner", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      path.resolve("node_modules/tsx/dist/cli.mjs"),
      path.resolve("tests/fixtures/facebook-interactions-runtime.ts"),
    ],
    { windowsHide: true, timeout: 55000 },
  );
  const results = JSON.parse(stdout);
  expect(results).toHaveLength(22);
  expect(
    results.find((r: { scenario: string }) => r.scenario === "comment"),
  ).toMatchObject({ outcome: "COMPLETED", clicks: 1 });
  expect(
    results.find((r: { scenario: string }) => r.scenario === "click-error"),
  ).toMatchObject({ outcome: "UNCERTAIN", clicks: 0 });
});
