import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  access,
  rm,
} from "node:fs/promises";
import path from "node:path";

let root = "";
let release = "";
const env = () => ({
  ...process.env,
  NHIPDANG_DESKTOP_DIR: path.join(root, "data"),
  DOTENV_CONFIG_PATH: path.join(root, "unused.env"),
});
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => Promise<boolean>, timeout = 15_000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeout)
      throw new Error("Timed out waiting for background process");
    await delay(100);
  }
}
function launch(file: string) {
  const child = spawn(process.execPath, [path.join(release, file)], {
    env: env(),
    stdio: "ignore",
    windowsHide: true,
  });
  const done = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  return { child, done };
}
beforeAll(async () => {
  await mkdir(".data", { recursive: true });
  root = await mkdtemp(path.resolve(".data/desktop-background-test-"));
  release = path.join(root, "release");
  await mkdir(path.join(root, "data"));
  await build({
    entryPoints: {
      desktop: "scripts/desktop.ts",
      background: "scripts/desktop-background.ts",
    },
    outdir: release,
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
});
afterAll(async () => {
  if (root.startsWith(path.resolve(".data") + path.sep))
    await rm(root, { recursive: true, force: true });
});

it("retries an initial network failure, ignores duplicate launches, and stops cleanly", async () => {
  let heartbeats = 0;
  let claims = 0;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/desktop/heartbeat") {
      heartbeats++;
      response.statusCode = heartbeats === 1 ? 503 : 200;
      response.end(
        JSON.stringify(
          heartbeats === 1 ? { error: "Temporary network failure" } : {},
        ),
      );
    } else {
      if (request.url === "/api/desktop/claim") claims++;
      response.end(
        request.url === "/api/desktop/inbox/targets" ? "[]" : "null",
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await writeFile(
    path.join(root, "data/connection.json"),
    JSON.stringify({
      server: `http://127.0.0.1:${port}`,
      token: "a".repeat(43),
      workspaceId: "test",
      deviceId: "test",
    }),
  );
  const first = launch("background.mjs");
  let duplicate: ReturnType<typeof launch> | undefined;
  try {
    await until(async () => heartbeats === 1);
    duplicate = launch("background.mjs");
    expect(await duplicate.done).toBe(0);
    await until(async () => claims > 0);
    expect(heartbeats).toBe(2);
    await writeFile(path.join(root, "data/background.stop"), "stop");
    expect(await first.done).toBe(0);
    expect(
      await access(path.join(root, "data/runner.lock")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(
      await readFile(path.join(root, "data/connection.json"), "utf8"),
    ).toContain(`http://127.0.0.1:${port}`);
  } finally {
    await writeFile(path.join(root, "data/background.stop"), "stop");
    await Promise.race([
      first.done,
      delay(5_000).then(() => first.child.kill()),
    ]);
    duplicate?.child.kill();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}, 25_000);

it("exits with a repairable state when the server revokes the device", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end('{"error":"Revoked"}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await writeFile(
    path.join(root, "data/connection.json"),
    JSON.stringify({
      server: `http://127.0.0.1:${port}`,
      token: "a".repeat(43),
      workspaceId: "test",
      deviceId: "test",
    }),
  );
  try {
    const run = launch("desktop.mjs");
    expect(await run.done).toBe(78);
    expect(
      await access(path.join(root, "data/runner.lock")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
