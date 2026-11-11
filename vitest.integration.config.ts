import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./tests/database";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    globalSetup: ["./tests/integration/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: testDatabaseUrl(),
      BETTER_AUTH_URL: "http://localhost:3000",
      MEDIA_DIR: ".data/test-media",
    },
  },
});
