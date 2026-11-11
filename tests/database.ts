import "dotenv/config";
import { Client } from "pg";
import { spawnSync } from "node:child_process";
import path from "node:path";

export function testDatabaseUrl(suite: "integration" | "e2e" = "integration") {
  if (!process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL)
    throw new Error("Initialize local PostgreSQL or set TEST_DATABASE_URL.");
  const url = new URL(
    process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!,
  );
  if (!process.env.TEST_DATABASE_URL) url.pathname = `/nhipdang_${suite}_test`;
  if (!url.pathname.endsWith("_test"))
    throw new Error(
      "Tests only run against a database whose name ends in _test.",
    );
  return url.toString();
}
export async function prepareTestDatabase(
  suite: "integration" | "e2e" = "integration",
) {
  const url = new URL(testDatabaseUrl(suite));
  const database = url.pathname.slice(1);
  url.pathname = "/postgres";
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    if (
      !(
        await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
          database,
        ])
      ).rowCount
    )
      await client.query(
        `CREATE DATABASE ${client.escapeIdentifier(database)}`,
      );
  } finally {
    await client.end();
  }
  const result = spawnSync(
    process.execPath,
    [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
    {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl(suite) },
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
