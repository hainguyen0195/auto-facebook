import { defineConfig, devices } from "@playwright/test";
import { testDatabaseUrl } from "./tests/database";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  globalSetup: "./tests/e2e/setup.ts",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3100",
    ...devices["Desktop Chrome"],
    storageState: ".data/e2e/owner.json",
    trace: "retain-on-failure",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node node_modules/tsx/dist/cli.mjs tests/e2e/server.ts",
    url: "http://localhost:3100/api/v1/health",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: testDatabaseUrl("e2e"),
      BETTER_AUTH_URL: "http://localhost:3100",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
      MEDIA_DIR: ".data/e2e-media",
      PORT: "3100",
    },
  },
});
