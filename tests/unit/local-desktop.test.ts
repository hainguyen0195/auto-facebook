import { EventEmitter } from "node:events";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  available: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  spawn: vi.fn(),
  account: vi.fn(),
  device: vi.fn(),
  pairing: vi.fn(),
  pair: vi.fn(),
  command: vi.fn(),
}));
vi.mock("../../src/lib/desktop-host", () => ({
  desktopProjectRoot: () => process.cwd(),
  localDesktopAvailable: mocks.available,
}));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  mkdir: mocks.mkdir,
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../../src/lib/db", () => ({
  db: {
    facebookAccount: { findFirst: mocks.account },
    desktopDevice: { findFirst: mocks.device },
  },
}));
vi.mock("../../src/lib/desktop", () => ({
  createPairing: mocks.pairing,
  pairDesktop: mocks.pair,
  queueDesktopCommand: mocks.command,
}));
import { connectLocalFacebook } from "../../src/lib/local-desktop";

describe("local Facebook connection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.available.mockReturnValue(true);
    mocks.account.mockResolvedValue({ id: "account" });
    mocks.readFile.mockRejectedValue(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    mocks.pairing.mockResolvedValue({ code: "one-time-code" });
    mocks.pair.mockResolvedValue({
      token: "a".repeat(43),
      deviceId: "device",
      workspaceId: "workspace",
    });
    mocks.device.mockResolvedValue({ id: "device", lastSeenAt: new Date() });
    mocks.command.mockResolvedValue({ id: "command", kind: "LOGIN" });
    mocks.spawn.mockImplementation(() =>
      Object.assign(new EventEmitter(), { unref: vi.fn(), kill: vi.fn() }),
    );
  });

  it("starts one runner for simultaneous account connections and queues both logins", async () => {
    await Promise.all([
      connectLocalFacebook("workspace", "account-one"),
      connectLocalFacebook("workspace", "account-two"),
    ]);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.pair).toHaveBeenCalledTimes(1);
    expect(mocks.command).toHaveBeenCalledWith(
      "workspace",
      "account-one",
      "device",
      "LOGIN",
    );
    expect(mocks.command).toHaveBeenCalledWith(
      "workspace",
      "account-two",
      "device",
      "LOGIN",
    );
    const [executable, args, options] = mocks.spawn.mock.calls[0];
    expect(executable).toBe(process.execPath);
    expect(args.join(" ")).not.toContain("one-time-code");
    expect(options).toMatchObject({
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    });
    expect(options.env.NHIPDANG_DESKTOP_DIR).toBe(
      path.resolve(".data/desktop"),
    );
    expect(args.slice(-2)).toEqual(["--local-workspace", "workspace"]);
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"workspaceId":"workspace"'),
      { mode: 0o600 },
    );
  });

  it("reuses a running workspace device without starting another process", async () => {
    mocks.readFile.mockResolvedValue(
      JSON.stringify({
        server: new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000")
          .origin,
        token: "a".repeat(43),
        deviceId: "device",
        workspaceId: "workspace",
      }),
    );
    await connectLocalFacebook("workspace", "account");
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.pair).not.toHaveBeenCalled();
    expect(mocks.device).toHaveBeenCalledWith({
      where: expect.objectContaining({
        workspaceId: "workspace",
        revokedAt: null,
        tokenHash: expect.any(String),
      }),
    });
  });

  it("restarts an offline saved runner with its existing connection", async () => {
    mocks.readFile.mockResolvedValue(
      JSON.stringify({
        server: new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000")
          .origin,
        token: "a".repeat(43),
        deviceId: "device",
        workspaceId: "workspace",
      }),
    );
    mocks.device.mockResolvedValueOnce({
      id: "device",
      lastSeenAt: new Date(0),
    });
    await connectLocalFacebook("workspace", "account");
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.pair).not.toHaveBeenCalled();
    expect(mocks.command).toHaveBeenCalledWith(
      "workspace",
      "account",
      "device",
      "LOGIN",
    );
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("does not launch processes for a remote server or an account outside the workspace", async () => {
    mocks.available.mockReturnValue(false);
    await expect(connectLocalFacebook("workspace", "account")).rejects.toThrow(
      "Windows",
    );
    expect(mocks.account).not.toHaveBeenCalled();
    mocks.available.mockReturnValue(true);
    mocks.account.mockResolvedValue(null);
    await expect(
      connectLocalFacebook("workspace", "other-account"),
    ).rejects.toThrow();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.pairing).not.toHaveBeenCalled();
  });
});
