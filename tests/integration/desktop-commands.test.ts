import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createAuth } from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import * as desktop from "../../src/lib/desktop";

let ownerId = "";
let wid = "";
let deviceId = "";
let accountId = "";
const instanceId = randomUUID();
const expired = () => new Date(Date.now() - 3 * 60_000);
beforeAll(async () => {
  const result = await createAuth(true).api.signUpEmail({
    body: {
      email: `commands-${randomUUID()}@tests.nhipdang.local`,
      name: "Commands test",
      password: "Commands-test-password-2026!",
    },
  });
  ownerId = result.user.id;
  wid = (await db.workspace.findUniqueOrThrow({ where: { ownerId } })).id;
  const pairing = await desktop.createPairing(wid);
  deviceId = (await desktop.pairDesktop(pairing.code, "Commands PC")).deviceId;
  accountId = (
    await db.facebookAccount.create({
      data: {
        workspaceId: wid,
        name: "Commands account",
        url: "https://facebook.com/commands",
        profileName: "Commands",
      },
    })
  ).id;
  await db.facebookConnection.create({
    data: { workspaceId: wid, accountId, deviceId },
  });
});
beforeEach(async () => {
  await db.desktopCommand.deleteMany({ where: { workspaceId: wid } });
  await db.desktopDevice.update({
    where: { id: deviceId },
    data: { lastSeenAt: new Date(), instanceId },
  });
  await db.facebookConnection.update({
    where: { accountId },
    data: {
      deviceId,
      state: "LOGIN_REQUIRED",
      identityHash: null,
      confirmedIdentityHash: null,
      expectedIdentityHash: null,
      generation: 0,
      automationEnabled: false,
    },
  });
});
afterAll(async () => {
  if (ownerId) await db.user.delete({ where: { id: ownerId } });
  await db.$disconnect();
});

it("ends an unreceived close request when the runner goes offline, and permits reconnecting", async () => {
  const command = await desktop.queueDesktopCommand(
    wid,
    accountId,
    deviceId,
    "CLOSE",
  );
  await db.desktopDevice.update({
    where: { id: deviceId },
    data: { lastSeenAt: new Date(Date.now() - 60_000) },
  });
  const status = await desktop.desktopStatus(wid);
  expect(status.devices[0].online).toBe(false);
  expect(status.commands.find((c) => c.id === command.id)).toMatchObject({
    state: "FAILED",
    message: expect.stringContaining("kết nối lại"),
  });
  await desktop.heartbeat(deviceId, wid, instanceId);
  expect(await desktop.claimDesktopWork(deviceId, wid, instanceId)).toBeNull();
  const retry = await desktop.queueDesktopCommand(
    wid,
    accountId,
    deviceId,
    "LOGIN",
  );
  expect(retry.id).not.toBe(command.id);
  expect((await desktop.claimDesktopWork(deviceId, wid, instanceId))?.id).toBe(
    retry.id,
  );
});

it("keeps a recent queued or running request while the runner is online", async () => {
  const command = await desktop.queueDesktopCommand(
    wid,
    accountId,
    deviceId,
    "CLOSE",
  );
  expect((await desktop.desktopStatus(wid)).commands[0].state).toBe("QUEUED");
  const work = await desktop.claimDesktopWork(deviceId, wid, instanceId);
  expect(work?.id).toBe(command.id);
  expect((await desktop.desktopStatus(wid)).commands[0].state).toBe("RUNNING");
  await desktop.finishDesktopCommand(deviceId, wid, command.id, {
    runId: work!.runId,
    state: "CLOSED",
    message: "Đã đóng cửa sổ; phiên được giữ trên máy này.",
  });
  expect((await desktop.desktopStatus(wid)).commands[0].state).toBe(
    "SUCCEEDED",
  );
});

it("expires old queued commands before a returning runner can claim them", async () => {
  const command = await desktop.queueDesktopCommand(
    wid,
    accountId,
    deviceId,
    "LOGIN",
  );
  await db.desktopCommand.update({
    where: { id: command.id },
    data: { createdAt: expired() },
  });
  expect(await desktop.claimDesktopWork(deviceId, wid, instanceId)).toBeNull();
  expect(
    (await db.desktopCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .state,
  ).toBe("FAILED");
});

it("expires a pending command on heartbeat even when no web page is open", async () => {
  const command = await desktop.queueDesktopCommand(
    wid,
    accountId,
    deviceId,
    "CLOSE",
  );
  await db.desktopCommand.update({
    where: { id: command.id },
    data: { createdAt: expired() },
  });
  await desktop.heartbeat(deviceId, wid, instanceId);
  expect(
    (await db.desktopCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .state,
  ).toBe("FAILED");
});

it("allows a new command after a stalled request without a separate status poll", async () => {
  const command = await desktop.queueDesktopCommand(
    wid,
    accountId,
    deviceId,
    "LOGIN",
  );
  const work = await desktop.claimDesktopWork(deviceId, wid, instanceId);
  await db.desktopCommand.update({
    where: { id: command.id },
    data: { startedAt: expired() },
  });
  const retry = await desktop.queueDesktopCommand(
    wid,
    accountId,
    deviceId,
    "CLOSE",
  );
  expect(retry.id).not.toBe(command.id);
  await desktop.finishDesktopCommand(deviceId, wid, command.id, {
    runId: work!.runId,
    state: "READY",
    identityHash: "a".repeat(64),
    message: "Late result",
  });
  expect(
    (await db.facebookConnection.findUniqueOrThrow({ where: { accountId } }))
      .state,
  ).toBe("LOGIN_REQUIRED");
  expect(
    (await db.desktopCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .state,
  ).toBe("FAILED");
});

it("does not expire another workspace's pending commands", async () => {
  const command = await desktop.queueDesktopCommand(
    wid,
    accountId,
    deviceId,
    "CLOSE",
  );
  await db.desktopCommand.update({
    where: { id: command.id },
    data: { createdAt: expired() },
  });
  await desktop.desktopStatus(`unrelated-${randomUUID()}`);
  expect(
    (await db.desktopCommand.findUniqueOrThrow({ where: { id: command.id } }))
      .state,
  ).toBe("QUEUED");
});

it("opens a confirmed Facebook profile without resetting confirmation or automation", async () => {
  const identityHash = "b".repeat(64);
  await db.facebookConnection.update({
    where: { accountId },
    data: {
      state: "READY",
      identityHash,
      confirmedIdentityHash: identityHash,
      automationEnabled: true,
    },
  });
  const command = await desktop.queueDesktopCommand(
    wid,
    accountId,
    deviceId,
    "OPEN",
  );
  const work = await desktop.claimDesktopWork(deviceId, wid, instanceId);
  expect(work).toMatchObject({ id: command.id, kind: "OPEN" });
  await desktop.finishDesktopCommand(deviceId, wid, command.id, {
    runId: work!.runId,
    state: "READY",
    identityHash,
    message: "Đã mở cửa sổ Facebook trên máy đăng.",
  });
  expect(
    await db.facebookConnection.findUniqueOrThrow({ where: { accountId } }),
  ).toMatchObject({
    state: "READY",
    confirmedIdentityHash: identityHash,
    automationEnabled: true,
  });
});

it.each([true, false])(
  "reconnects the same device after restart and preserves automation=%s",
  async (automationEnabled) => {
    const identityHash = "b".repeat(64);
    await db.facebookConnection.update({
      where: { accountId },
      data: {
        state: "READY",
        identityHash,
        confirmedIdentityHash: identityHash,
        automationEnabled,
      },
    });
    await db.desktopDevice.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date(0) },
    });
    const restartedInstance = randomUUID();
    await desktop.heartbeat(deviceId, wid, restartedInstance);
    const [command, duplicate] = await Promise.all([
      desktop.queueDesktopCommand(wid, accountId, deviceId, "LOGIN"),
      desktop.queueDesktopCommand(wid, accountId, deviceId, "LOGIN"),
    ]);
    expect(duplicate.id).toBe(command.id);
    expect(
      await db.facebookConnection.findUniqueOrThrow({ where: { accountId } }),
    ).toMatchObject({
      state: "READY",
      confirmedIdentityHash: identityHash,
      automationEnabled,
    });
    const work = await desktop.claimDesktopWork(
      deviceId,
      wid,
      restartedInstance,
    );
    await desktop.finishDesktopCommand(deviceId, wid, command.id, {
      runId: work!.runId,
      state: "READY",
      identityHash,
      message: "Restored session",
    });
    expect(
      await db.facebookConnection.findUniqueOrThrow({ where: { accountId } }),
    ).toMatchObject({
      state: "READY",
      confirmedIdentityHash: identityHash,
      automationEnabled,
      message: expect.stringContaining("khôi phục"),
    });
  },
);

it.each(["LOGIN_REQUIRED", "CHALLENGE", "READY"] as const)(
  "clears confirmation and stops automation when reconnect returns %s with a changed or missing identity",
  async (state) => {
    const identityHash = "b".repeat(64);
    await db.facebookConnection.update({
      where: { accountId },
      data: {
        state: "READY",
        identityHash,
        confirmedIdentityHash: identityHash,
        automationEnabled: true,
      },
    });
    const command = await desktop.queueDesktopCommand(
      wid,
      accountId,
      deviceId,
      "LOGIN",
    );
    const work = await desktop.claimDesktopWork(deviceId, wid, instanceId);
    await desktop.finishDesktopCommand(deviceId, wid, command.id, {
      runId: work!.runId,
      state,
      ...(state === "READY" ? { identityHash: "c".repeat(64) } : {}),
      message: "Session changed",
    });
    expect(
      await db.facebookConnection.findUniqueOrThrow({ where: { accountId } }),
    ).toMatchObject({
      state: state === "READY" ? "UNCONFIRMED" : state,
      confirmedIdentityHash: null,
      automationEnabled: false,
    });
  },
);

it("requires a new confirmation when connecting on another device, even for the same Facebook identity", async () => {
  const identityHash = "b".repeat(64);
  await db.facebookConnection.update({
    where: { accountId },
    data: {
      state: "READY",
      identityHash,
      confirmedIdentityHash: identityHash,
      automationEnabled: true,
    },
  });
  const pairing = await desktop.createPairing(wid);
  const another = await desktop.pairDesktop(pairing.code, "Another PC");
  const anotherInstance = randomUUID();
  await desktop.heartbeat(another.deviceId, wid, anotherInstance, true);
  const command = await desktop.queueDesktopCommand(
    wid,
    accountId,
    another.deviceId,
    "LOGIN",
  );
  expect(
    await db.facebookConnection.findUniqueOrThrow({ where: { accountId } }),
  ).toMatchObject({
    confirmedIdentityHash: null,
    automationEnabled: false,
  });
  const work = await desktop.claimDesktopWork(
    another.deviceId,
    wid,
    anotherInstance,
  );
  await desktop.finishDesktopCommand(another.deviceId, wid, command.id, {
    runId: work!.runId,
    generation: command.generation,
    state: "READY",
    identityHash,
    message: "Same account on another PC",
  });
  expect(
    await db.facebookConnection.findUniqueOrThrow({ where: { accountId } }),
  ).toMatchObject({
    deviceId: another.deviceId,
    state: "UNCONFIRMED",
    automationEnabled: false,
  });
});
