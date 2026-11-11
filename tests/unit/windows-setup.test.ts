import { expect, it } from "vitest";
import { existsSync, createReadStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  access,
  rm,
} from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  desktopRelease,
  desktopReleasePath,
  renderWindowsInstaller,
} from "../../src/lib/windows-installer";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => Promise<boolean>) {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > 15_000)
      throw new Error("Windows setup smoke test timed out");
    await wait(100);
  }
}
async function run(command: string, args: string[], env = process.env) {
  const child = spawn(command, args, { env, windowsHide: true, stdio: "pipe" });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  child.stdin.end("\r\n");
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0)
    throw new Error(`Windows setup command failed (${code}): ${output}`);
  return output;
}

it.skipIf(process.platform !== "win32" || !existsSync(desktopReleasePath()))(
  "installs the real release, launches from Startup, and uninstalls in an isolated Windows directory",
  async () => {
    const manifest = await desktopRelease();
    const root = await mkdtemp(path.resolve(".data/windows-setup-test-"));
    const localAppData = path.join(root, "Tai khoan người dùng");
    const startup = path.join(root, "Startup");
    const programs = path.join(root, "Programs");
    const fakePrograms = path.join(root, "FakePrograms");
    const appRoot = path.join(localAppData, "NhipDang");
    const dataRoot = path.join(appRoot, "data");
    const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
    await mkdir(startup, { recursive: true });
    await mkdir(programs, { recursive: true });
    await mkdir(path.join(fakePrograms, "Microsoft/Edge/Application"), {
      recursive: true,
    });
    await writeFile(
      path.join(fakePrograms, "Microsoft/Edge/Application/msedge.exe"),
      "fixture",
    );
    let paired = 0;
    let claims = 0;
    let revoked = false;
    const server = createServer((request, response) => {
      if (request.url === `/downloads/${manifest.bundle}`) {
        createReadStream(
          path.resolve("public/downloads", manifest.bundle),
        ).pipe(response);
        return;
      }
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/api/desktop/pair") {
        paired++;
        revoked = false;
        response.end(
          JSON.stringify({
            token: "a".repeat(43),
            workspaceId: "smoke-test",
            deviceId: "smoke-device",
          }),
        );
      } else if (revoked) {
        response.statusCode = 401;
        response.end('{"error":"Revoked"}');
      } else if (request.url === "/api/desktop/claim") {
        claims++;
        response.end("null");
      } else
        response.end(
          request.url === "/api/desktop/inbox/targets" ? "[]" : "{}",
        );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    const sandboxFolders = (script: string) =>
      script
        .replaceAll("[Environment]::GetFolderPath('Startup')", quote(startup))
        .replaceAll(
          "[Environment]::GetFolderPath('Programs')",
          quote(programs),
        );
    try {
      let script = sandboxFolders(
        renderWindowsInstaller({
          ...manifest,
          server: `http://127.0.0.1:${port}`,
          workspaceId: "smoke-test",
          code: "a".repeat(43),
        }),
      );
      // Redirect OS integration for the smoke test; downloads, extraction, pairing and launch files stay real.
      script = script.replace(
        /  \$protocol = 'HKCU:[\s\S]*?(?=  \$menu =)/,
        "",
      );
      script = script.replace(
        "$ErrorActionPreference = 'Stop'",
        "$ErrorActionPreference = 'Stop'\r\nfunction Start-Process { param($FilePath, $ArgumentList, $WindowStyle) }",
      );
      const installer = path.join(root, "Cai-Nhip-Dang.cmd");
      await writeFile(installer, script, "utf8");
      await run("cmd.exe", ["/d", "/c", installer], {
        ...process.env,
        LOCALAPPDATA: localAppData,
        ProgramFiles: fakePrograms,
        "ProgramFiles(x86)": fakePrograms,
      });
      expect(paired).toBe(1);
      const config = JSON.parse(
        await readFile(path.join(dataRoot, "connection.json"), "utf8"),
      );
      expect(config.workspaceId).toBe("smoke-test");
      await writeFile(
        path.join(dataRoot, "connection.json"),
        JSON.stringify({ ...config, browserChannel: "chrome" }),
      );
      await writeFile(path.join(dataRoot, "keep-profile.txt"), "keep");
      await run("cscript.exe", [
        "//nologo",
        path.join(startup, "NhipDang.vbs"),
      ]);
      await until(async () => claims > 0);
      // Starting a revoked install cannot renew its key; a fresh installer must pair again.
      revoked = true;
      await until(() =>
        access(path.join(dataRoot, "background.lock")).then(
          () => false,
          () => true,
        ),
      );
      await run("cmd.exe", ["/d", "/c", installer], {
        ...process.env,
        LOCALAPPDATA: localAppData,
        ProgramFiles: fakePrograms,
        "ProgramFiles(x86)": fakePrograms,
      });
      expect(paired).toBe(2);
      expect(
        JSON.parse(
          await readFile(path.join(dataRoot, "connection.json"), "utf8"),
        ).browserChannel,
      ).toBe("chrome");
      expect(
        await readFile(path.join(dataRoot, "keep-profile.txt"), "utf8"),
      ).toBe("keep");
      const previousClaims = claims;
      await run("cscript.exe", [
        "//nologo",
        path.join(startup, "NhipDang.vbs"),
      ]);
      await until(async () => claims > previousClaims);
      const release = path.join(appRoot, manifest.sha256.slice(0, 16));
      let uninstall = sandboxFolders(
        await readFile(path.join(release, "uninstall.ps1"), "utf8"),
      );
      uninstall = uninstall.replace(
        "HKCU:\\Software\\Classes\\nhipdang",
        "HKCU:\\Software\\NhipDangIsolatedTest-" + path.basename(root),
      );
      uninstall = "function Read-Host { param($Prompt) }\r\n" + uninstall;
      const uninstallPath = path.join(release, "uninstall-smoke.ps1");
      await writeFile(uninstallPath, uninstall);
      await run("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        uninstallPath,
      ]);
      await until(() =>
        access(path.join(dataRoot, "background.lock")).then(
          () => false,
          () => true,
        ),
      );
      expect(
        await readFile(path.join(dataRoot, "keep-profile.txt"), "utf8"),
      ).toBe("keep");
      expect(existsSync(path.join(startup, "NhipDang.vbs"))).toBe(false);
      expect(existsSync(path.join(programs, "Nhip Dang/Go cai dat.lnk"))).toBe(
        false,
      );
    } catch (error) {
      const log = await readFile(
        path.join(dataRoot, "desktop.log"),
        "utf8",
      ).catch(() => "No runner log");
      throw new Error(
        `${error instanceof Error ? error.message : error}\n${log}`,
        { cause: error },
      );
    } finally {
      if (existsSync(dataRoot)) {
        await writeFile(path.join(dataRoot, "background.stop"), "stop");
        await until(() =>
          access(path.join(dataRoot, "background.lock")).then(
            () => false,
            () => true,
          ),
        );
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (root.startsWith(path.resolve(".data") + path.sep))
        await rm(root, { recursive: true, force: true });
    }
  },
  90_000,
);
