import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  desktopDataRoot,
  facebookBrowserProfilePath,
  facebookBrowserChannel,
  facebookProfilePath,
  localDesktopRoot,
} from "../../src/desktop/profiles";

let root: string;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "nhipdang-profiles-"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("shared Facebook profile locations", () => {
  it("uses the common desktop directory for new profiles and isolates accounts and workspaces", () => {
    expect(facebookProfilePath(root, "workspace", "account")).toBe(
      path.join(root, "profiles", "workspace", hash("account")),
    );
    expect(facebookProfilePath(root, "workspace", "another")).not.toBe(
      facebookProfilePath(root, "workspace", "account"),
    );
    expect(facebookProfilePath(root, "another", "account")).not.toBe(
      facebookProfilePath(root, "workspace", "account"),
    );
  });

  it("reuses an existing desktop profile without moving it", () => {
    const profile = path.join(root, "profiles", "workspace", hash("account"));
    mkdirSync(profile, { recursive: true });
    expect(facebookProfilePath(root, "workspace", "account")).toBe(profile);
  });

  it("prefers an existing local account profile while keeping other accounts in the common directory", () => {
    const local = path.join(
      localDesktopRoot(root, "workspace"),
      "profiles",
      "workspace",
      hash("account"),
    );
    mkdirSync(local, { recursive: true });
    mkdirSync(path.join(root, "profiles", "workspace", hash("account")), {
      recursive: true,
    });
    expect(facebookProfilePath(root, "workspace", "account")).toBe(local);
    expect(facebookProfilePath(root, "workspace", "another")).toBe(
      path.join(root, "profiles", "workspace", hash("another")),
    );
  });

  it("resolves configured paths against the project directory", () => {
    vi.stubEnv("NHIPDANG_DESKTOP_DIR", "custom-desktop");
    expect(desktopDataRoot(root)).toBe(path.join(root, "custom-desktop"));
    vi.stubEnv("NHIPDANG_PROJECT_DIR", root);
    expect(desktopDataRoot()).toBe(desktopDataRoot(root));
  });

  it("keeps an explicitly configured browser for either launch method", () => {
    vi.stubEnv("NHIPDANG_BROWSER_CHANNEL", "chrome");
    expect(facebookBrowserChannel()).toBe("chrome");
  });

  it("opens a long legacy Windows profile through a stable short junction", () => {
    const local = path.join(
      localDesktopRoot(root, "workspace"),
      "profiles",
      "workspace",
      hash("account"),
    );
    mkdirSync(local, { recursive: true });
    const browserPath = facebookBrowserProfilePath(
      root,
      "workspace",
      "account",
    );
    expect(realpathSync(browserPath)).toBe(realpathSync(local));
    expect(facebookBrowserProfilePath(root, "workspace", "account")).toBe(
      browserPath,
    );
    if (process.platform === "win32")
      expect(browserPath.length).toBeLessThan(local.length);
    else expect(browserPath).toBe(local);
  });

  it("isolates browser paths for different workspaces and accounts", () => {
    const first = facebookBrowserProfilePath(root, "workspace", "account");
    expect(facebookBrowserProfilePath(root, "another", "account")).not.toBe(
      first,
    );
    expect(facebookBrowserProfilePath(root, "workspace", "another")).not.toBe(
      first,
    );
  });
});
