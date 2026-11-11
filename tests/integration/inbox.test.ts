import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db } from "../../src/lib/db";
import { createAuth } from "../../src/lib/auth";
import { GET, POST } from "../../src/app/api/v1/[...path]/route";
import { POST as runnerPost } from "../../src/app/api/desktop/[...path]/route";
import * as desktop from "../../src/lib/desktop";
import {
  desktopInboxTargets,
  inboxForWorkspace,
  inboxReportSchema,
  reportDesktopInbox,
  pruneInboxSnapshots,
} from "../../src/lib/inbox";
import {
  interactionSettingsSchema,
  updateInteractionSettings,
} from "../../src/lib/interaction-work";
import type { TrialState } from "../../src/inbox-trial/state";
import { createSchedule } from "../../src/lib/service";
import { scheduleSchema } from "../../src/lib/schemas";

const identity = "a".repeat(64);
const instanceId = randomUUID();
const origin = "http://localhost:3000";
let wid: string, otherWid: string, cookie: string, otherCookie: string;
let pc: Awaited<ReturnType<typeof desktop.pairDesktop>>;
let mac: typeof pc;
let accountId: string, secondId: string;
const owners: string[] = [];

async function app(
  path: string,
  auth = cookie,
  body?: unknown,
  requestOrigin = origin,
) {
  const method = body === undefined ? "GET" : "POST";
  return (method === "GET" ? GET : POST)(
    new NextRequest(`${origin}/api/v1/${path}`, {
      method,
      headers: {
        cookie: auth,
        origin: requestOrigin,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ path: path.split("?")[0].split("/") }) },
  );
}
const observation = (generation = 0, status = "ONLINE", hash = identity) =>
  inboxReportSchema.parse({
    instanceId,
    generation,
    status,
    identityHash: hash,
    conversations: [
      {
        id: "thread",
        name: "Private customer",
        preview: "Private preview",
        unread: true,
        lastMessageAt: new Date().toISOString(),
      },
    ],
  });
async function finishLogin(
  device: typeof pc,
  generation: number,
  hash = identity,
) {
  const work = await desktop.claimDesktopWork(device.deviceId, wid, instanceId);
  expect(work?.type).toBe("COMMAND");
  if (!work || work.type !== "COMMAND") throw new Error("Missing login work");
  await desktop.finishDesktopCommand(device.deviceId, wid, work.id, {
    runId: work.runId,
    generation,
    state: "READY",
    identityHash: hash,
    message: "Checked",
  });
}
beforeAll(async () => {
  for (const name of ["A", "B"]) {
    const auth = createAuth(true);
    const email = `${randomUUID()}@desktop-inbox.tests.local`;
    const password = "Inbox-test-password-2026!";
    const user = await auth.api.signUpEmail({
      body: { email, password, name },
    });
    owners.push(user.user.id);
    const response = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    const cookies = response.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
    const workspace = await db.workspace.findUniqueOrThrow({
      where: { ownerId: user.user.id },
    });
    if (name === "A") {
      wid = workspace.id;
      cookie = cookies;
    } else {
      otherWid = workspace.id;
      otherCookie = cookies;
    }
  }
  pc = await desktop.pairDesktop(
    (await desktop.createPairing(wid)).code,
    "Company Windows",
  );
  mac = await desktop.pairDesktop(
    (await desktop.createPairing(wid)).code,
    "Home MacBook",
  );
  for (const name of ["Minh Phan", "Second account"]) {
    const account = await db.facebookAccount.create({
      data: {
        workspaceId: wid,
        name,
        url: `https://facebook.com/${randomUUID()}`,
        profileName: name,
      },
    });
    if (name === "Minh Phan") accountId = account.id;
    else secondId = account.id;
  }
});
beforeEach(async () => {
  await db.desktopCommand.deleteMany({ where: { workspaceId: wid } });
  await db.facebookDeviceSession.deleteMany({
    where: { accountId: { in: [accountId, secondId] } },
  });
  await db.facebookInboxSnapshot.deleteMany({
    where: { accountId: { in: [accountId, secondId] } },
  });
  for (const device of [pc, mac]) {
    await db.desktopDevice.update({
      where: { id: device.deviceId },
      data: { paused: false },
    });
    await desktop.heartbeat(device.deviceId, wid, instanceId, true);
  }
  await db.facebookAccount.updateMany({
    where: { workspaceId: wid },
    data: { status: "ACTIVE" },
  });
  for (const id of [accountId, secondId]) {
    const data = {
      deviceId: pc.deviceId,
      generation: 0,
      state: "READY",
      identityHash: identity,
      confirmedIdentityHash: identity,
      expectedIdentityHash: identity,
      automationEnabled: true,
      interactionEnabled: true,
      inboxPaused: false,
      checkedAt: new Date(),
    };
    await db.facebookConnection.upsert({
      where: { accountId: id },
      create: { workspaceId: wid, accountId: id, ...data },
      update: data,
    });
  }
});
afterAll(async () => {
  await db.task.deleteMany({ where: { workspaceId: wid } });
  await db.interaction.deleteMany({ where: { workspaceId: wid } });
  await db.user.deleteMany({ where: { id: { in: owners } } });
  await db.$disconnect();
});

it("provides account-scoped unread IDs for read reconciliation and removes confirmed read IDs", async () => {
  await reportDesktopInbox(pc.deviceId, wid, accountId, observation());
  let targets = await desktopInboxTargets(pc.deviceId, wid, instanceId);
  expect(
    targets.find((row) => row.accountId === accountId)?.previouslyUnread,
  ).toEqual(["thread"]);
  expect(
    targets.find((row) => row.accountId === secondId)?.previouslyUnread,
  ).toEqual([]);
  const read = observation();
  read.conversations[0].unread = false;
  await reportDesktopInbox(pc.deviceId, wid, accountId, read);
  targets = await desktopInboxTargets(pc.deviceId, wid, instanceId);
  expect(
    targets.find((row) => row.accountId === accountId)?.previouslyUnread,
  ).toEqual([]);
});

it("blocks switching during posting and preserves unresolved work across a switch", async () => {
  const post = await db.post.create({
    data: { workspaceId: wid, title: "Switch test", content: "Fixture only" },
  });
  const campaign = await createSchedule(
    wid,
    scheduleSchema.parse({
      executionMode: "AUTOMATIC",
      postId: post.id,
      scheduledAt: new Date().toISOString(),
      targets: [{ accountId, groupId: null }],
      acknowledgeWarnings: true,
      idempotencyKey: randomUUID(),
    }),
  );
  const task = await db.task.findFirstOrThrow({
    where: { campaignId: campaign.id },
  });
  try {
    await db.task.update({
      where: { id: task.id },
      data: {
        status: "IN_PROGRESS",
        automaticPhase: "SUBMITTING",
        desktopDeviceId: pc.deviceId,
        desktopRunId: randomUUID(),
        desktopLeaseAt: new Date(),
        startedAt: new Date(),
      },
    });
    await expect(
      desktop.switchDesktop(wid, accountId, mac.deviceId),
    ).rejects.toThrow(/bài đăng/);
    await db.task.update({
      where: { id: task.id },
      data: { status: "BLOCKED", automaticPhase: "NEEDS_REVIEW" },
    });
    await desktop.switchDesktop(wid, accountId, mac.deviceId);
    expect(await db.task.findUnique({ where: { id: task.id } })).toMatchObject({
      status: "BLOCKED",
      automaticPhase: "NEEDS_REVIEW",
    });
    await finishLogin(mac, 1);
    await desktop.updateConnection(wid, accountId, "confirm");
    await desktop.updateConnection(wid, accountId, "enable");
    expect(
      await desktop.claimDesktopWork(mac.deviceId, wid, instanceId),
    ).toBeNull();
  } finally {
    await db.task.delete({ where: { id: task.id } });
    await db.campaign.delete({ where: { id: campaign.id } });
    await db.post.delete({ where: { id: post.id } });
  }
});

it("stops inbox polling and rejects late observations while a device or account is paused", async () => {
  await reportDesktopInbox(pc.deviceId, wid, accountId, observation());
  await desktop.updateDevice(wid, pc.deviceId, "pause");
  expect(await desktopInboxTargets(pc.deviceId, wid, instanceId)).toEqual([]);
  expect(
    await reportDesktopInbox(
      pc.deviceId,
      wid,
      accountId,
      observation(0, "CHALLENGE"),
    ),
  ).toMatchObject({ stale: true });
  expect((await inboxForWorkspace(wid, accountId)).status).toBe("STOPPED");
  await desktop.updateDevice(wid, pc.deviceId, "resume");
  expect(await desktopInboxTargets(pc.deviceId, wid, instanceId)).toHaveLength(
    2,
  );
  await db.facebookAccount.update({
    where: { id: accountId },
    data: { status: "PAUSED" },
  });
  expect(
    (await desktopInboxTargets(pc.deviceId, wid, instanceId)).map(
      (t) => t.accountId,
    ),
  ).toEqual([secondId]);
  expect(
    await reportDesktopInbox(pc.deviceId, wid, accountId, observation()),
  ).toMatchObject({ stale: true });
  expect((await inboxForWorkspace(wid, accountId)).status).toBe("STOPPED");
  expect(
    await db.facebookConnection.findUnique({ where: { accountId } }),
  ).toMatchObject({ state: "READY" });
});

it("keeps a closed window out of inbox polling until an explicit reopen succeeds", async () => {
  await desktop.queueDesktopCommand(wid, accountId, pc.deviceId, "CLOSE");
  const close = await desktop.claimDesktopWork(pc.deviceId, wid, instanceId);
  if (!close || close.type !== "COMMAND")
    throw new Error("Expected close command");
  await desktop.finishDesktopCommand(pc.deviceId, wid, close.id, {
    runId: close.runId,
    generation: 0,
    state: "CLOSED",
    message: "Closed",
  });
  expect(
    (await desktopInboxTargets(pc.deviceId, wid, instanceId)).map(
      (t) => t.accountId,
    ),
  ).toEqual([secondId]);
  expect(
    await reportDesktopInbox(pc.deviceId, wid, accountId, observation()),
  ).toMatchObject({ stale: true });
  expect((await inboxForWorkspace(wid, accountId)).status).toBe("STOPPED");
  await desktop.heartbeat(pc.deviceId, wid, instanceId, true);
  expect(
    await db.facebookConnection.findUnique({ where: { accountId } }),
  ).toMatchObject({
    state: "READY",
    inboxPaused: true,
    confirmedIdentityHash: identity,
    automationEnabled: true,
    interactionEnabled: true,
  });
  await desktop.queueDesktopCommand(wid, accountId, pc.deviceId, "OPEN");
  const open = await desktop.claimDesktopWork(pc.deviceId, wid, instanceId);
  if (!open || open.type !== "COMMAND")
    throw new Error("Expected open command");
  await desktop.finishDesktopCommand(pc.deviceId, wid, open.id, {
    runId: open.runId,
    generation: 0,
    state: "READY",
    identityHash: identity,
    message: "Opened",
  });
  expect(await desktopInboxTargets(pc.deviceId, wid, instanceId)).toHaveLength(
    2,
  );
});

it("serves all account choices and private uncached observations without credentials", async () => {
  await reportDesktopInbox(pc.deviceId, wid, accountId, observation());
  const response = await app(`inbox?accountId=${accountId}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("Vary")).toBe("Cookie");
  const data = await response.json();
  expect(data).toMatchObject({
    status: "ONLINE",
    fresh: true,
    source: { name: "Company Windows" },
  });
  expect(data.accounts).toHaveLength(2);
  expect(data.conversations[0].preview).toBe("Private preview");
  expect(JSON.stringify(data)).not.toContain(identity);
  expect(JSON.stringify(data)).not.toContain(pc.token);
  expect((await app(`inbox?accountId=${secondId}`)).status).toBe(200);
});

it("enforces web login, workspace ownership, Origin and runner bearer authentication", async () => {
  expect((await app("inbox", "")).status).toBe(401);
  const other = await (await app("inbox", otherCookie)).json();
  expect(other.accounts).toEqual([]);
  expect((await app(`inbox?accountId=${accountId}`, otherCookie)).status).toBe(
    404,
  );
  expect(
    (
      await app(
        `desktop/connections/${accountId}/switch`,
        cookie,
        { deviceId: mac.deviceId },
        "https://evil.invalid",
      )
    ).status,
  ).toBe(403);
  await expect(
    desktop.switchDesktop(otherWid, accountId, pc.deviceId),
  ).rejects.toThrow();
  const missing = await runnerPost(
    new NextRequest(`${origin}/api/desktop/inbox/targets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId }),
    }),
    { params: Promise.resolve({ path: ["inbox", "targets"] }) },
  );
  expect(missing.status).toBe(401);
  const valid = await runnerPost(
    new NextRequest(`${origin}/api/desktop/inbox/targets`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${pc.token}`,
      },
      body: JSON.stringify({ instanceId }),
    }),
    { params: Promise.resolve({ path: ["inbox", "targets"] }) },
  );
  expect(valid.status).toBe(200);
  expect(await valid.json()).toHaveLength(2);
});

it("switches Windows to Mac and back, restoring only confirmed machine consent", async () => {
  const response = await app(
    `desktop/connections/${accountId}/switch`,
    cookie,
    { deviceId: mac.deviceId },
  );
  expect(response.status).toBe(200);
  expect((await response.json()).generation).toBe(1);
  expect(
    await db.facebookConnection.findUnique({ where: { accountId } }),
  ).toMatchObject({
    deviceId: mac.deviceId,
    state: "CHECKING",
    automationEnabled: false,
  });
  await finishLogin(mac, 1);
  expect(
    await db.facebookConnection.findUnique({ where: { accountId } }),
  ).toMatchObject({ state: "UNCONFIRMED", automationEnabled: false });
  await desktop.updateConnection(wid, accountId, "confirm");
  await desktop.updateConnection(wid, accountId, "enable");
  await updateInteractionSettings(
    wid,
    accountId,
    interactionSettingsSchema.parse({
      enabled: true,
      dailyLimit: 7,
      intervalMinutes: 11,
    }),
  );
  await desktop.switchDesktop(wid, accountId, pc.deviceId);
  expect(
    await db.facebookConnection.findUnique({ where: { accountId } }),
  ).toMatchObject({ state: "CHECKING", generation: 2, identityHash: null });
  await finishLogin(pc, 2);
  expect(
    await db.facebookConnection.findUnique({ where: { accountId } }),
  ).toMatchObject({
    state: "READY",
    automationEnabled: true,
    interactionEnabled: true,
  });
  await desktop.switchDesktop(wid, accountId, mac.deviceId);
  await finishLogin(mac, 3);
  expect(
    await db.facebookConnection.findUnique({ where: { accountId } }),
  ).toMatchObject({
    state: "READY",
    automationEnabled: true,
    interactionEnabled: true,
    interactionDailyLimit: 7,
    interactionIntervalMinutes: 11,
  });
  expect(
    (await desktopInboxTargets(pc.deviceId, wid, instanceId)).map(
      (t) => t.accountId,
    ),
  ).toEqual([secondId]);
});

it("rejects late command, login and inbox reports even after switching back to the same PC", async () => {
  const old = await desktop.queueDesktopCommand(
    wid,
    accountId,
    pc.deviceId,
    "CHECK",
  );
  const work = await desktop.claimDesktopWork(pc.deviceId, wid, instanceId);
  if (!work || work.type !== "COMMAND") throw new Error("Missing check");
  await db.desktopCommand.update({
    where: { id: old.id },
    data: { startedAt: new Date(0) },
  });
  await desktop.switchDesktop(wid, accountId, mac.deviceId);
  await finishLogin(mac, 1);
  await desktop.switchDesktop(wid, accountId, pc.deviceId);
  await finishLogin(pc, 2);
  expect(
    await desktop.reportDesktopSession(pc.deviceId, wid, accountId, {
      instanceId,
      generation: 0,
      state: "CHALLENGE",
      message: "Old report",
    }),
  ).toMatchObject({ stale: true });
  expect(
    await desktop.finishDesktopCommand(pc.deviceId, wid, old.id, {
      runId: work.runId,
      generation: 0,
      state: "CHALLENGE",
      message: "Old command",
    }),
  ).toMatchObject({ ok: true });
  expect(
    await reportDesktopInbox(pc.deviceId, wid, accountId, observation(0)),
  ).toMatchObject({ stale: true });
  expect(
    await db.facebookConnection.findUnique({ where: { accountId } }),
  ).toMatchObject({ state: "READY", generation: 2 });
  expect(await db.facebookInboxSnapshot.count({ where: { accountId } })).toBe(
    0,
  );
});

it("rejects switches while a command or interaction is in progress and serializes simultaneous switches", async () => {
  const command = await desktop.queueDesktopCommand(
    wid,
    accountId,
    pc.deviceId,
    "CHECK",
  );
  await expect(
    desktop.switchDesktop(wid, accountId, mac.deviceId),
  ).rejects.toThrow();
  expect(
    (await desktopInboxTargets(pc.deviceId, wid, instanceId)).find(
      (t) => t.accountId === accountId,
    )?.busy,
  ).toBe(true);
  expect(
    await reportDesktopInbox(pc.deviceId, wid, accountId, observation()),
  ).toMatchObject({ stale: true });
  await db.desktopCommand.delete({ where: { id: command.id } });
  const interaction = await db.interaction.create({
    data: {
      workspaceId: wid,
      accountId,
      executionMode: "AUTOMATIC",
      postUrl: "https://www.facebook.com/test/posts/123",
      postKey: randomUUID(),
      kind: "REACTION",
      scheduledAt: new Date(),
      status: "IN_PROGRESS",
    },
  });
  await expect(
    desktop.switchDesktop(wid, accountId, mac.deviceId),
  ).rejects.toThrow(/tương tác/);
  expect((await inboxForWorkspace(wid, accountId)).status).toBe("BUSY");
  await db.interaction.delete({ where: { id: interaction.id } });
  const results = await Promise.allSettled([
    desktop.switchDesktop(wid, accountId, mac.deviceId),
    desktop.switchDesktop(wid, accountId, pc.deviceId),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});

it("does not confirm a different identity on a new machine", async () => {
  await desktop.switchDesktop(wid, accountId, mac.deviceId);
  await finishLogin(mac, 1, "b".repeat(64));
  expect(
    await db.facebookConnection.findUnique({ where: { accountId } }),
  ).toMatchObject({
    state: "WRONG_IDENTITY",
    automationEnabled: false,
    interactionEnabled: false,
  });
  await expect(
    desktop.updateConnection(wid, accountId, "confirm"),
  ).rejects.toThrow();
});

it("distinguishes offline, unsupported, PIN and old runner states while preserving observations", async () => {
  await reportDesktopInbox(pc.deviceId, wid, accountId, observation());
  for (const status of ["UNSUPPORTED", "PIN_REQUIRED", "OFFLINE"]) {
    await reportDesktopInbox(
      pc.deviceId,
      wid,
      accountId,
      observation(0, status),
    );
    const data = await inboxForWorkspace(wid, accountId);
    expect(data.status).toBe(status);
    expect(data.fresh).toBe(false);
    expect(data.conversations).toHaveLength(1);
  }
  await desktop.heartbeat(pc.deviceId, wid, instanceId);
  expect((await inboxForWorkspace(wid, accountId)).status).toBe(
    "UPDATE_REQUIRED",
  );
  await expect(
    desktop.switchDesktop(wid, accountId, pc.deviceId),
  ).rejects.toThrow(/Cập nhật/);
  await db.desktopDevice.update({
    where: { id: pc.deviceId },
    data: { lastSeenAt: new Date(0) },
  });
  expect((await inboxForWorkspace(wid, accountId)).status).toBe("OFFLINE");
});

it("expires old observations on read and purges their stored previews", async () => {
  await reportDesktopInbox(pc.deviceId, wid, accountId, observation());
  const snapshot = await db.facebookInboxSnapshot.findUniqueOrThrow({
    where: { accountId },
  });
  const state = snapshot.state as unknown as TrialState;
  const expired = new Date(Date.now() - 86_400_100).toISOString();
  state.conversations.forEach((c) => {
    c.observedAt = expired;
    c.previewObservedAt = expired;
    c.unreadObservedAt = expired;
  });
  state.lastSuccessAt = expired;
  await db.facebookInboxSnapshot.update({
    where: { accountId },
    data: { state: JSON.parse(JSON.stringify(state)) },
  });
  const data = await inboxForWorkspace(wid, accountId);
  expect(data.fresh).toBe(false);
  expect(data.conversations).toEqual([]);
  await pruneInboxSnapshots();
  expect(
    JSON.stringify(
      (
        await db.facebookInboxSnapshot.findUniqueOrThrow({
          where: { accountId },
        })
      ).state,
    ),
  ).not.toContain("Private preview");
});

it("rejects a wrong identity report and disables automatic work on session loss", async () => {
  await expect(
    reportDesktopInbox(
      pc.deviceId,
      wid,
      accountId,
      observation(0, "ONLINE", "b".repeat(64)),
    ),
  ).rejects.toThrow(/không khớp/);
  await reportDesktopInbox(
    pc.deviceId,
    wid,
    accountId,
    observation(0, "LOGIN_REQUIRED"),
  );
  expect(
    await db.facebookConnection.findUnique({ where: { accountId } }),
  ).toMatchObject({
    state: "LOGIN_REQUIRED",
    automationEnabled: false,
    interactionEnabled: false,
    confirmedIdentityHash: null,
  });
});
