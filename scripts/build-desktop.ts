import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";

const root = process.cwd();
const stage = path.resolve(".data/desktop-release/stage");
const output = path.resolve("public/downloads");
await mkdir(stage, { recursive: true });
await mkdir(output, { recursive: true });
const nodeVersion = "v24.21.0";
const nodeUrl = `https://nodejs.org/dist/${nodeVersion}/`;
async function download(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const checksums = (await download(nodeUrl + "SHASUMS256.txt")).toString();
const expected = checksums
  .split(/\r?\n/)
  .find((line) => line.endsWith("  win-x64/node.exe"))
  ?.split(/\s+/)[0];
if (!expected) throw new Error("Missing Windows Node.js checksum");
const nodePath = path.resolve(".data/desktop-release/node.exe");
let nodeBinary = await readFile(nodePath).catch(() => Buffer.alloc(0));
const digest = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
if (digest(nodeBinary) !== expected) {
  console.log(`Downloading verified Windows Node.js ${nodeVersion}...`);
  nodeBinary = await download(nodeUrl + "win-x64/node.exe");
  if (digest(nodeBinary) !== expected)
    throw new Error("Node.js checksum mismatch");
  await writeFile(nodePath, nodeBinary);
}
await writeFile(path.join(stage, "node.exe"), nodeBinary);
await writeFile(
  path.join(stage, "NODE-LICENSE.txt"),
  await download(
    `https://raw.githubusercontent.com/nodejs/node/${nodeVersion}/LICENSE`,
  ),
);
await build({
  entryPoints: {
    desktop: "scripts/desktop.ts",
    background: "scripts/desktop-background.ts",
    "macos-setup": "scripts/macos/setup.ts",
  },
  outdir: stage,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  external: ["playwright"],
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
for (const name of ["playwright", "playwright-core"]) {
  await cp(
    path.join(root, "node_modules", name),
    path.join(stage, "node_modules", name),
    { recursive: true },
  );
}
await writeFile(
  path.join(stage, "package.json"),
  JSON.stringify({ private: true, type: "module" }),
);
await cp("scripts/windows/uninstall.ps1", path.join(stage, "uninstall.ps1"));
const writer = new ZipWriter(new Uint8ArrayWriter(), {
  useWebWorkers: false,
  level: 6,
});
// Only these artifacts enter the release; never include .env, profiles, or connection keys.
async function add(directory: string, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory())
      await add(path.join(directory, entry.name), name + "/");
    else if (entry.isFile())
      await writer.add(
        name,
        new Uint8ArrayReader(await readFile(path.join(directory, entry.name))),
      );
  }
}
for (const name of [
  "desktop.mjs",
  "background.mjs",
  "node.exe",
  "package.json",
  "uninstall.ps1",
  "NODE-LICENSE.txt",
]) {
  await writer.add(
    name,
    new Uint8ArrayReader(await readFile(path.join(stage, name))),
  );
}
await add(path.join(stage, "node_modules"), "node_modules/");
const zip = await writer.close();
const sha256 = digest(zip);
const bundle = `desktop-windows-${sha256.slice(0, 16)}.zip`;
await writeFile(path.join(output, bundle), zip);
await writeFile(
  path.join(output, "desktop-windows.json"),
  JSON.stringify({ bundle, sha256, nodeVersion }),
);
console.log(
  `Windows desktop release: ${bundle} (${Math.round(zip.byteLength / 1024 / 1024)} MiB)`,
);

const macReleases: Record<string, { bundle: string; sha256: string }> = {};
for (const arch of ["arm64", "x64"]) {
  const archiveName = `node-${nodeVersion}-darwin-${arch}.tar.gz`;
  const expectedHash = checksums
    .split(/\r?\n/)
    .find((line) => line.endsWith("  " + archiveName))
    ?.split(/\s+/)[0];
  if (!expectedHash) throw new Error(`Missing macOS ${arch} Node.js checksum`);
  const archivePath = path.resolve(".data/desktop-release", archiveName);
  let archive = await readFile(archivePath).catch(() => Buffer.alloc(0));
  if (digest(archive) !== expectedHash) {
    console.log(`Downloading verified macOS ${arch} Node.js ${nodeVersion}...`);
    archive = await download(nodeUrl + archiveName);
    if (digest(archive) !== expectedHash)
      throw new Error("macOS Node.js checksum mismatch");
    await writeFile(archivePath, archive);
  }
  const macWriter = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    level: 6,
  });
  const binary = execFileSync(
    "tar",
    ["-xOf", archivePath, `node-${nodeVersion}-darwin-${arch}/bin/node`],
    { maxBuffer: 150 * 1024 * 1024 },
  );
  await macWriter.add("node", new Uint8ArrayReader(binary), {
    unixMode: 0o100755,
  });
  for (const name of [
    "desktop.mjs",
    "background.mjs",
    "macos-setup.mjs",
    "package.json",
    "NODE-LICENSE.txt",
  ]) {
    await macWriter.add(
      name,
      new Uint8ArrayReader(await readFile(path.join(stage, name))),
      { unixMode: 0o100644 },
    );
  }
  async function addMac(directory: string, prefix: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory())
        await addMac(
          path.join(directory, entry.name),
          prefix + entry.name + "/",
        );
      else if (entry.isFile())
        await macWriter.add(
          prefix + entry.name,
          new Uint8ArrayReader(
            await readFile(path.join(directory, entry.name)),
          ),
          { unixMode: 0o100644 },
        );
    }
  }
  await addMac(path.join(stage, "node_modules"), "node_modules/");
  const macZip = await macWriter.close();
  const macHash = digest(macZip);
  const macBundle = `desktop-macos-${arch}-${macHash.slice(0, 16)}.zip`;
  await writeFile(path.join(output, macBundle), macZip);
  macReleases[arch] = { bundle: macBundle, sha256: macHash };
  console.log(
    `macOS ${arch} desktop release: ${macBundle} (${Math.round(macZip.byteLength / 1024 / 1024)} MiB)`,
  );
}
await writeFile(
  path.join(output, "desktop-macos.json"),
  JSON.stringify({ ...macReleases, nodeVersion }),
);
