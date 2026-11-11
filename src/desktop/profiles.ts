import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import path from "node:path";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function desktopDataRoot(
  projectRoot = process.env.NHIPDANG_PROJECT_DIR || process.cwd(),
) {
  return path.resolve(
    projectRoot,
    process.env.NHIPDANG_DESKTOP_DIR || ".data/desktop",
  );
}

export function localDesktopRoot(root: string, workspaceId: string) {
  return path.join(root, `local-${hash(workspaceId)}`);
}

export function facebookProfilePath(
  root: string,
  workspaceId: string,
  accountId: string,
) {
  const account = hash(accountId);
  const local = path.join(
    localDesktopRoot(root, workspaceId),
    "profiles",
    workspaceId,
    account,
  );
  // Reuse existing profiles in place; never copy a live browser's cookie database.
  if (existsSync(local)) return local;
  return path.join(root, "profiles", workspaceId, account);
}

export function facebookBrowserChannel() {
  if (process.env.NHIPDANG_BROWSER_CHANNEL)
    return process.env.NHIPDANG_BROWSER_CHANNEL;
  const candidates = [
    [
      "msedge",
      process.env["ProgramFiles(x86)"],
      "Microsoft/Edge/Application/msedge.exe",
    ],
    [
      "msedge",
      process.env.ProgramFiles,
      "Microsoft/Edge/Application/msedge.exe",
    ],
    [
      "chrome",
      process.env.ProgramFiles,
      "Google/Chrome/Application/chrome.exe",
    ],
    [
      "chrome",
      process.env.LOCALAPPDATA,
      "Google/Chrome/Application/chrome.exe",
    ],
  ];
  return candidates.find(
    ([, base, file]) => base && file && existsSync(path.join(base, file)),
  )?.[0];
}

export function facebookBrowserProfilePath(
  root: string,
  workspaceId: string,
  accountId: string,
) {
  const profile = facebookProfilePath(root, workspaceId, accountId);
  if (process.platform !== "win32" || profile.length <= 160) return profile;
  // Chromium's Windows caches and network storage still hit MAX_PATH in legacy profiles.
  const link = path.join(
    root,
    "browser-profiles",
    hash(JSON.stringify([workspaceId, accountId])),
  );
  mkdirSync(profile, { recursive: true });
  mkdirSync(path.dirname(link), { recursive: true });
  try {
    symlinkSync(profile, link, "junction");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (realpathSync(link).toLowerCase() !== realpathSync(profile).toLowerCase())
    throw new Error(
      "Profile Facebook đã thay đổi vị trí. Kiểm tra liên kết profile trên máy đăng.",
    );
  return link;
}
