import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../../tests/inbox-trial",
  outputDir: "../../test-results/inbox-trial",
  workers: 1,
  reporter: "list",
  use: { browserName: "chromium", headless: true },
});
