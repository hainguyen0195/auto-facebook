import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

export async function ensureBackupTools() {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const configured = process.env.PG_BIN;
  const destination = path.resolve(configured || ".data/pg-tools");
  const dump = path.join(destination, `pg_dump${suffix}`);
  const restore = path.join(destination, `pg_restore${suffix}`);
  const works = (file: string) => {
    const result = spawnSync(file, ["--version"], {
      windowsHide: true,
      encoding: "utf8",
    });
    const major = Number(result.stdout?.match(/PostgreSQL\) (\d+)/)?.[1]);
    return result.status === 0 && major >= 18;
  };
  if ([dump, restore].every(works)) return { dump, restore };
  if (configured)
    throw new Error(
      "PG_BIN must contain PostgreSQL 18+ pg_dump and pg_restore.",
    );
  if (process.platform !== "win32") {
    if (!["pg_dump", "pg_restore"].every(works))
      throw new Error(
        "Install PostgreSQL 18 client tools or set PG_BIN before backing up.",
      );
    return { dump: "pg_dump", restore: "pg_restore" };
  }
  const { ZipReader, HttpReader, Uint8ArrayWriter } =
    await import("@zip.js/zip.js");
  const source =
    "https://get.enterprisedb.com/postgresql/postgresql-18.6-1-windows-x64-binaries.zip";
  console.log(
    "Preparing PostgreSQL backup tools from the official EDB archive (range download).",
  );
  const reader = new ZipReader(
    new HttpReader(source, {
      useRangeHeader: true,
      forceRangeRequests: true,
      headers: [["Cache-Control", "no-cache"]],
    }),
    { useWebWorkers: false },
  );
  await mkdir(destination, { recursive: true });
  try {
    const entries = await reader.getEntries();
    for (const name of ["pg_dump.exe", "pg_restore.exe"]) {
      const entry = entries.find(
        (e) =>
          e.filename.replaceAll("\\", "/") === `pgsql/bin/${name}` &&
          !e.directory,
      );
      if (!entry || !("getData" in entry))
        throw new Error(`Official archive is missing ${name}.`);
      const bytes = await entry.getData!(new Uint8ArrayWriter(), {
        checkSignature: true,
      });
      await writeFile(path.join(destination, name), bytes);
    }
  } finally {
    await reader.close();
  }
  const require = createRequire(import.meta.url);
  const moduleUrl = pathToFileURL(
    path.join(path.dirname(require.resolve("embedded-postgres")), "binary.js"),
  ).href;
  const binaries = await (await import(moduleUrl)).default();
  const bin = path.dirname(binaries.pg_ctl);
  for (const filename of await readdir(bin))
    if (filename.endsWith(".dll"))
      await copyFile(
        path.join(bin, filename),
        path.join(destination, filename),
      );
  await writeFile(
    path.join(destination, "SOURCE.txt"),
    `PostgreSQL 18.6 backup client tools\n${source}\nShared libraries supplied by @embedded-postgres/windows-x64.\n`,
  );
  if (![dump, restore].every(works))
    throw new Error(
      "Backup tools could not start. Check PG_BIN or install PostgreSQL 18 client tools.",
    );
  return { dump, restore };
}
