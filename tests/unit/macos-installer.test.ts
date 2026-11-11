import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  ZipReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  TextWriter,
} from "@zip.js/zip.js";
import {
  macInstallerArchive,
  renderMacInstaller,
  macosRelease,
} from "../../src/lib/macos-installer";
import {
  macAgentLabel,
  macLaunchAgent,
  macStartCommand,
  macUninstallCommand,
  shellQuote,
} from "../../src/desktop/macos-installation";

const input = {
  server: "https://example.com",
  workspaceId: "workspace",
  code: "a".repeat(43),
  release: {
    arm64: {
      bundle: "desktop-macos-arm64-bbbbbbbbbbbbbbbb.zip",
      sha256: "b".repeat(64),
    },
    x64: {
      bundle: "desktop-macos-x64-cccccccccccccccc.zip",
      sha256: "c".repeat(64),
    },
  },
};
const bash =
  process.platform === "win32"
    ? "C:/Program Files/Git/bin/bash.exe"
    : "/bin/bash";

describe("MacBook installer", () => {
  it("rejects unsafe servers, shell injection and release paths", () => {
    for (const server of [
      "http://example.com",
      "file:///tmp/app",
      "https://user:secret@example.com",
    ])
      expect(() => renderMacInstaller({ ...input, server })).toThrow();
    for (const value of ["'; touch /tmp/injected; '", "$(id)", "bad\nvalue"]) {
      expect(() => renderMacInstaller({ ...input, code: value })).toThrow();
      expect(() =>
        renderMacInstaller({ ...input, workspaceId: value }),
      ).toThrow();
    }
    expect(() =>
      renderMacInstaller({
        ...input,
        release: {
          ...input.release,
          arm64: { ...input.release.arm64, bundle: "../../secrets.zip" },
        },
      }),
    ).toThrow();
    expect(() =>
      renderMacInstaller({
        ...input,
        release: {
          ...input.release,
          x64: { ...input.release.x64, sha256: "bad" },
        },
      }),
    ).toThrow();
  });

  it("ships a private ZIP with an executable LF command and a readable guide", async () => {
    const reader = new ZipReader(
      new Uint8ArrayReader(await macInstallerArchive(input)),
      { useWebWorkers: false },
    );
    try {
      const entries = await reader.getEntries();
      expect(entries.map((e) => e.filename)).toEqual([
        "Cai-Nhip-Dang.command",
        "HUONG-DAN.txt",
      ]);
      const command = entries[0];
      if (command.directory) throw new Error("Installer must be a file");
      expect(command.unixMode! & 0o777).toBe(0o755);
      const script = await command.getData!(new TextWriter());
      expect(script).toBe(renderMacInstaller(input));
      expect(script).not.toContain("\r");
      expect(script.match(/^code='(.*)'$/m)?.[1]).toBe(input.code);
      expect(entries[1].unixMode! & 0o777).toBe(0o644);
    } finally {
      await reader.close();
    }
  });

  it.skipIf(!existsSync(bash))(
    "parses all generated Bash and preserves quoted paths without evaluating them",
    () => {
      const tricky = "/Users/O'Brien & $(touch SHOULD-NOT-EXIST)/Nhip Dang";
      for (const script of [
        renderMacInstaller(input),
        macStartCommand(tricky + "/agent.plist"),
        macUninstallCommand(tricky),
      ]) {
        expect(
          execFileSync(bash, ["-n"], {
            input: script,
            encoding: "utf8",
            windowsHide: true,
          }),
        ).toBe("");
      }
      expect(
        execFileSync(bash, ["-c", `printf '%s' ${shellQuote(tricky)}`], {
          encoding: "utf8",
          windowsHide: true,
        }),
      ).toBe(tricky);
    },
  );

  it.skipIf(process.platform !== "win32")(
    "produces valid launchd XML with exact executable paths and login startup settings",
    () => {
      const appRoot =
        "/Users/O'Brien & <family>/Library/Application Support/NhipDang";
      const release = appRoot + "/abcdef0123456789";
      const parsed = JSON.parse(
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            "$xml=[xml][Console]::In.ReadToEnd(); $d=$xml.plist.dict; $r=@{}; for($i=0;$i -lt $d.ChildNodes.Count;$i+=2){$k=$d.ChildNodes[$i].InnerText;$v=$d.ChildNodes[$i+1]; if($v.Name -eq 'array'){$r[$k]=@($v.ChildNodes | ForEach-Object {$_.InnerText})}elseif($v.Name -eq 'dict'){$r[$k]=@{$v.ChildNodes[0].InnerText=$v.ChildNodes[1].Name}}else{$r[$k]=if($v.Name -eq 'true' -or $v.Name -eq 'false'){$v.Name}else{$v.InnerText}}}; $r | ConvertTo-Json -Compress",
          ],
          {
            input: macLaunchAgent(appRoot, release),
            encoding: "utf8",
            windowsHide: true,
          },
        ),
      );
      expect(parsed.Label).toBe(macAgentLabel);
      expect(parsed.ProgramArguments).toEqual([
        release + "/node",
        release + "/background.mjs",
      ]);
      expect(parsed.WorkingDirectory).toBe(appRoot);
      expect(parsed.RunAtLoad).toBe("true");
      expect(parsed.KeepAlive).toEqual({ SuccessfulExit: "false" });
      expect(parsed.LimitLoadToSessionType).toBe("Aqua");
    },
  );

  it.skipIf(!existsSync(bash))(
    "selects native Apple Silicon under Rosetta, supports Intel, and blocks corrupt downloads before execution",
    async () => {
      await mkdir(".data", { recursive: true });
      const root = await mkdtemp(path.resolve(".data/mac-bootstrap-test-"));
      const posix = (value: string) =>
        value
          .replaceAll("\\", "/")
          .replace(
            /^([A-Za-z]):/,
            (_, drive: string) => "/" + drive.toLowerCase(),
          );
      try {
        for (const [nativeArm, valid] of [
          [true, true],
          [false, true],
          [true, false],
        ]) {
          const arch = nativeArm ? "arm64" : "x64";
          const expected = input.release[arch].sha256;
          const appRoot = path.join(root, arch + (valid ? "-ok" : "-bad"));
          const marker = path.join(appRoot, "executed.txt");
          // Replace only the installation directory; mock native OS/download tools.
          const script = renderMacInstaller(input).replace(
            'app_root="$HOME/Library/Application Support/NhipDang"',
            `app_root=${shellQuote(posix(appRoot))}`,
          );
          const fixture = `
uname() { if [ "$1" = '-s' ]; then echo Darwin; else echo x86_64; fi; }
sw_vers() { echo 14.4; }
sysctl() { echo ${nativeArm ? "1" : "0"}; }
curl() { printf '%s' "$*" > ${shellQuote(posix(path.join(appRoot, "download.txt")))}; }
shasum() { echo '${valid ? expected : "0".repeat(64)}  release.zip'; }
ditto() {
  mkdir -p "$4"
  printf '%s\\n' '#!/bin/bash' 'printf "%s\\n" "$@" > ${posix(marker)}' > "$4/node"
}
`;
          if (valid) {
            execFileSync(bash, ["-c", fixture + script], {
              encoding: "utf8",
              windowsHide: true,
            });
            const args = (await readFile(marker, "utf8")).trim().split("\n");
            expect(args.slice(1)).toEqual([
              "--server",
              input.server,
              "--code",
              input.code,
              "--workspace",
              input.workspaceId,
            ]);
            expect(
              await readFile(path.join(appRoot, "download.txt"), "utf8"),
            ).toContain(`/downloads/${input.release[arch].bundle}`);
          } else {
            expect(() =>
              execFileSync(bash, ["-c", fixture + script], {
                encoding: "utf8",
                stdio: "pipe",
                windowsHide: true,
              }),
            ).toThrow();
            expect(existsSync(marker)).toBe(false);
          }
          expect(
            (await readdir(appRoot)).some((name) =>
              name.startsWith(".install."),
            ),
          ).toBe(false);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!existsSync("public/downloads/desktop-macos.json"))(
    "verifies both public release archives, native architectures and executable permissions",
    async () => {
      const manifest = await macosRelease();
      for (const arch of ["arm64", "x64"] as const) {
        const bytes = await readFile(
          path.join("public/downloads", manifest[arch].bundle),
        );
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          manifest[arch].sha256,
        );
        const reader = new ZipReader(new Uint8ArrayReader(bytes), {
          useWebWorkers: false,
        });
        try {
          const entries = await reader.getEntries();
          expect(
            entries.some((e) =>
              /(^|\/)(\.env|connection\.json|profiles)(\/|$)/.test(e.filename),
            ),
          ).toBe(false);
          const node = entries.find((e) => e.filename === "node")!;
          if (node.directory) throw new Error("Runtime must be a file");
          expect(node.unixMode! & 0o777).toBe(0o755);
          const binary = Buffer.from(
            await node.getData!(new Uint8ArrayWriter()),
          );
          expect(binary.readUInt32LE(0)).toBe(0xfeedfacf);
          expect(binary.readUInt32LE(4)).toBe(
            arch === "arm64" ? 0x0100000c : 0x01000007,
          );
          for (const name of [
            "desktop.mjs",
            "background.mjs",
            "macos-setup.mjs",
            "node_modules/playwright/cli.js",
            "node_modules/playwright-core/package.json",
          ])
            expect(entries.some((e) => e.filename === name)).toBe(true);
        } finally {
          await reader.close();
        }
      }
    },
    30_000,
  );
});
