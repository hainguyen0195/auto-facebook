import { prepareTestDatabase } from "../database";

// Playwright starts the web server before running globalSetup.
await prepareTestDatabase("e2e");
await import("../../scripts/start");
