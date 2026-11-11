import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { renderWindowsInstaller } from "../../src/lib/windows-installer";

const input = {
  server: "https://example.com",
  workspaceId: "workspace",
  code: "a".repeat(43),
  sha256: "b".repeat(64),
  bundle: "desktop-windows-bbbbbbbbbbbbbbbb.zip",
};

describe("Windows installer", () => {
  it("rejects unsafe download servers and malformed pairing/release data", () => {
    for (const server of [
      "http://example.com",
      "https://user:secret@example.com",
      "file:///tmp/app",
    ]) {
      expect(() => renderWindowsInstaller({ ...input, server })).toThrow();
    }
    expect(() =>
      renderWindowsInstaller({ ...input, code: "'; Start-Process calc; '" }),
    ).toThrow();
    expect(() =>
      renderWindowsInstaller({ ...input, bundle: "../../secret.zip" }),
    ).toThrow();
    expect(() =>
      renderWindowsInstaller({ ...input, sha256: "wrong" }),
    ).toThrow();
  });

  it.skipIf(process.platform !== "win32")(
    "extracts a valid PowerShell installer with the CMD wrapper's own regex",
    () => {
      const script = renderWindowsInstaller({
        ...input,
        workspaceId: "workspace'quoted",
      });
      const regex = script.match(/-split '([^']+)'/)!;
      const parts = script.split(new RegExp(regex[1].replace("(?m)", ""), "m"));
      expect(parts).toHaveLength(2);
      expect(parts[1]).toContain("$workspace = 'workspace''quoted'");
      const result = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "$body=[Console]::In.ReadToEnd(); $tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseInput($body,[ref]$tokens,[ref]$errors); if($errors.Count) { $errors | ForEach-Object { Write-Output $_.Message }; exit 1 }",
        ],
        { input: parts[1], encoding: "utf8", windowsHide: true },
      );
      expect(result.trim()).toBe("");
    },
  );
});
