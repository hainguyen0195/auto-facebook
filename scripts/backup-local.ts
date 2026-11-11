import "dotenv/config";
import { Client } from "pg";
import { spawnSync } from "node:child_process";
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ensureBackupTools } from "./pg-tools";

export async function postgresTools() {
  return ensureBackupTools();
}
export function pgArguments(url: URL) {
  return [
    "-h",
    url.hostname,
    "-p",
    url.port || "5432",
    "-U",
    decodeURIComponent(url.username),
    "-d",
    url.pathname.slice(1),
  ];
}
export async function backupLocal(base = ".data/backups") {
  const url = new URL(process.env.DATABASE_URL!);
  const tools = await postgresTools();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.resolve(base, stamp);
  const media = path.resolve(process.env.MEDIA_DIR || ".data/media");
  await mkdir(destination, { recursive: true });
  await mkdir(media, { recursive: true });
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    // Hold asset mutations while the exported database snapshot and its files are copied.
    await client.query('LOCK TABLE "Asset" IN SHARE MODE');
    const snapshot = (
      await client.query("SELECT pg_export_snapshot() AS snapshot")
    ).rows[0].snapshot as string;
    const assets = (await client.query('SELECT "storageKey" FROM "Asset"'))
      .rows as { storageKey: string }[];
    for (const asset of assets)
      await access(path.join(media, asset.storageKey));
    const dump = spawnSync(
      tools.dump,
      [
        ...pgArguments(url),
        "-Fc",
        `--snapshot=${snapshot}`,
        "-f",
        path.join(destination, "database.dump.partial"),
      ],
      {
        env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
        windowsHide: true,
        encoding: "utf8",
      },
    );
    if (dump.status !== 0)
      throw new Error(
        dump.error?.message || dump.stderr || "Database backup failed.",
      );
    const tar = spawnSync(
      "tar",
      [
        "-C",
        media,
        "-czf",
        path.join(destination, "media.tar.gz.partial"),
        ".",
      ],
      { windowsHide: true, encoding: "utf8" },
    );
    if (tar.status !== 0) throw new Error(tar.stderr || "Media backup failed.");
    await client.query("COMMIT");
    await rename(
      path.join(destination, "database.dump.partial"),
      path.join(destination, "database.dump"),
    );
    await rename(
      path.join(destination, "media.tar.gz.partial"),
      path.join(destination, "media.tar.gz"),
    );
    await writeFile(
      path.join(destination, "manifest.txt"),
      `nhipdang-backup-v1\n${stamp}\n`,
    );
    return destination;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const destination = await backupLocal(process.argv[2]);
  console.log(`Database and media backup complete: ${destination}`);
  console.log(
    "Keep this directory private. Transfer it securely and store a copy outside this machine.",
  );
}
