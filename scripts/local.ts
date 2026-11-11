import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";
import { config } from "dotenv";

const root = process.cwd();
const dataRoot = path.join(root, ".data");
const configFile = path.join(dataRoot, "local-postgres.json");
const command = process.argv[2] || "start";
const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );
await mkdir(dataRoot, { recursive: true });
if (!(await exists(configFile))) {
  if (command !== "init") throw new Error("Run npm run local:init first.");
  await writeFile(
    configFile,
    JSON.stringify({
      port: 55432,
      user: "nhipdang",
      password: randomBytes(24).toString("hex"),
    }),
    { flag: "wx" },
  );
}
const settings = JSON.parse(await readFile(configFile, "utf8")) as {
  port: number;
  user: string;
  password: string;
};
const clusterDir = path.resolve(dataRoot, "postgres");
if (!clusterDir.startsWith(path.resolve(root) + path.sep))
  throw new Error("Invalid local cluster directory.");
const connectionString = `postgresql://${settings.user}:${settings.password}@127.0.0.1:${settings.port}/nhipdang`;
if (!(await exists(path.join(root, ".env")))) {
  await writeFile(
    path.join(root, ".env"),
    `DATABASE_URL=${connectionString}\nBETTER_AUTH_SECRET=${randomBytes(48).toString("hex")}\nBETTER_AUTH_URL=http://localhost:3000\nMEDIA_DIR=.data/media\n`,
    { flag: "wx" },
  );
}
config({ quiet: true });
if (process.env.DATABASE_URL !== connectionString)
  throw new Error(
    ".env points to another database. Use your existing PostgreSQL and npm run db:migrate, or review .env before using local:init.",
  );
const require = createRequire(import.meta.url);
const binariesModule = pathToFileURL(
  path.join(path.dirname(require.resolve("embedded-postgres")), "binary.js"),
).href;
const getBinaries = (await import(binariesModule)).default as () => Promise<{
  pg_ctl: string;
}>;
const { pg_ctl } = await getBinaries();
function pgctl(args: string[], quiet = false) {
  const result = spawnSync(pg_ctl, ["-D", clusterDir, ...args], {
    windowsHide: true,
    encoding: "utf8",
    stdio: args.includes("start") ? "ignore" : "pipe",
  });
  if (!quiet && result.stdout) process.stdout.write(result.stdout);
  if (!quiet && result.stderr) process.stderr.write(result.stderr);
  return result.status;
}
if (command === "stop") {
  const status = pgctl(["status"], true);
  if (status === 0 && pgctl(["stop", "-m", "fast", "-w"]) !== 0)
    throw new Error("Could not stop local PostgreSQL.");
  console.log("Local PostgreSQL stopped. Data is preserved.");
} else {
  if (!(await exists(path.join(clusterDir, "PG_VERSION")))) {
    if (command !== "init") throw new Error("Run npm run local:init first.");
    const embedded = new EmbeddedPostgres({
      databaseDir: clusterDir,
      ...settings,
      persistent: true,
      authMethod: "scram-sha-256",
      autoRehydrateSymlinks: true,
      initdbFlags: ["--encoding=UTF8"],
      onLog: () => {},
      onError: (e) => console.error(e),
    });
    await embedded.initialise();
    console.log(
      "Initialized an isolated PostgreSQL cluster in .data/postgres.",
    );
  }
  if (
    pgctl(["status"], true) !== 0 &&
    pgctl([
      "-l",
      path.join(dataRoot, "postgres.log"),
      "-o",
      `-p ${settings.port} -h 127.0.0.1`,
      "-w",
      "start",
    ]) !== 0
  )
    throw new Error("Local PostgreSQL did not start. See .data/postgres.log.");
  const client = new Client({
    connectionString: connectionString.replace(/\/nhipdang$/, "/postgres"),
  });
  await client.connect();
  try {
    if (
      !(
        await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
          "nhipdang",
        ])
      ).rowCount
    )
      await client.query('CREATE DATABASE "nhipdang"');
  } finally {
    await client.end();
  }
  if (command === "init") {
    const prisma = path.join(root, "node_modules/prisma/build/index.js");
    const result = spawnSync(process.execPath, [prisma, "migrate", "deploy"], {
      stdio: "inherit",
      windowsHide: true,
      env: process.env,
    });
    if (result.status !== 0) throw new Error("Database migration failed.");
  }
  console.log(`Local PostgreSQL is listening on 127.0.0.1:${settings.port}.`);
  console.log(
    "Next: npm run user:create, then npm run dev and npm run worker in separate terminals.",
  );
}
