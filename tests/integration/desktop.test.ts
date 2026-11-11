import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AUTOMATIC_ATTEMPT_MS } from "../../src/lib/automatic-policy";
import { NextRequest } from "next/server";
import { db } from "../../src/lib/db";
import { createAuth } from "../../src/lib/auth";
import { GET, POST, PATCH } from "../../src/app/api/v1/[...path]/route";
import { POST as desktopPost } from "../../src/app/api/desktop/[...path]/route";
import * as desktop from "../../src/lib/desktop";
import { interactionTarget } from "../../src/lib/interactions";

const run = randomUUID();
const identityHash = createHash("sha256")
  .update("fixture-facebook-id")
  .digest("hex");
const instanceId = randomUUID();
const origin = "http://localhost:3000";
let wid = "",
  otherWid = "",
  ownerId = "",
  otherId = "",
  cookie = "",
  otherCookie = "";
let paired: { token: string; deviceId: string; workspaceId: string };
let accounts: { id: string; url: string }[] = [];
let postId = "";
async function app(
  method: "GET" | "POST" | "PATCH",
  route: string,
  body?: unknown,
  auth = cookie,
) {
  const request = new NextRequest(`${origin}/api/v1/${route}`, {
    method,
    headers: {
      cookie: auth,
      origin,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { GET, POST, PATCH }[method](request, {
    params: Promise.resolve({ path: route.split("?")[0].split("/") }),
  });
}
async function api<T>(
  method: "GET" | "POST" | "PATCH",
  route: string,
  body?: unknown,
) {
  const response = await app(method, route, body);
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBeLessThan(300);
  return data as T;
}
async function ready(index = 0) {
  await db.facebookConnection.upsert({
    where: { accountId: accounts[index].id },
    create: {
      workspaceId: wid,
      deviceId: paired.deviceId,
      accountId: accounts[index].id,
      state: "READY",
      identityHash,
      confirmedIdentityHash: identityHash,
      automationEnabled: true,
      checkedAt: new Date(),
    },
    update: {
      state: "READY",
      identityHash,
      confirmedIdentityHash: identityHash,
      automationEnabled: true,
      checkedAt: new Date(),
    },
  });
  await desktop.heartbeat(paired.deviceId, wid, instanceId);
}
async function schedule(index = 0, mode = "AUTOMATIC") {
  const created = await api<{ id: string }>("POST", "schedules", {
    executionMode: mode,
    postId,
    scheduledAt: new Date().toISOString(),
    targets: [{ accountId: accounts[index].id, groupId: null }],
    idempotencyKey: randomUUID(),
    acknowledgeWarnings: true,
  });
  return db.task.findFirstOrThrow({
    where: { workspaceId: wid, campaignId: created.id },
  });
}
beforeAll(async () => {
  const auth = createAuth(true);
  for (const which of ["owner", "other"]) {
    const email = `desktop-${which}-${run}@tests.nhipdang.local`;
    const result = await auth.api.signUpEmail({
      body: { email, name: which, password: "Desktop-test-password-2026!" },
    });
    const response = await auth.api.signInEmail({
      body: { email, password: "Desktop-test-password-2026!" },
      asResponse: true,
    });
    const cookies = response.headers
      .getSetCookie()
      .map((raw) => raw.split(";")[0])
      .join("; ");
    const workspace = await db.workspace.findUniqueOrThrow({
      where: { ownerId: result.user.id },
    });
    if (which === "owner") {
      wid = workspace.id;
      ownerId = result.user.id;
      cookie = cookies;
    } else {
      otherWid = workspace.id;
      otherId = result.user.id;
      otherCookie = cookies;
    }
  }
  for (let i = 0; i < 5; i++)
    accounts.push(
      await api("POST", "accounts", {
        name: `Facebook ${i + 1}`,
        profileName: `Shop ${i + 1}`,
        url: `facebook.com/desktop.${run}.${i}`,
        quietStart: 0,
        quietEnd: 0,
        dailyLimit: 50,
        postIntervalMinutes: 0,
      }),
    );
  postId = (
    await api<{ id: string }>("POST", "posts", {
      title: "Desktop fixture",
      content: "Nội dung được chủ tài khoản lên lịch.",
      tags: [],
      assetIds: [],
    })
  ).id;
});
afterAll(async () => {
  await db.task.deleteMany({ where: { workspaceId: { in: [wid, otherWid] } } });
  await db.postAsset.deleteMany({
    where: { post: { workspaceId: { in: [wid, otherWid] } } },
  });
  await db.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await db.$disconnect();
});

describe("paired desktop and five-account publishing", () => {
  it("uses a short-lived, one-time pairing code and stores only token hashes", async () => {
    const pairing = await api<{ code: string }>("POST", "desktop/pairing", {});
    const results = await Promise.allSettled([
      desktop.pairDesktop(pairing.code, "Test PC"),
      desktop.pairDesktop(pairing.code, "Duplicate PC"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    paired = (
      results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<
        typeof paired
      >
    ).value;
    const stored = await db.desktopDevice.findUniqueOrThrow({
      where: { id: paired.deviceId },
    });
    expect(stored.tokenHash).not.toBe(paired.token);
    expect(stored.tokenHash).toHaveLength(64);
    const expired = await desktop.createPairing(wid);
    await db.desktopPairing.updateMany({
      where: { workspaceId: wid },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      desktop.pairDesktop(expired.code, "Expired PC"),
    ).rejects.toThrow();
  });
  it("rejects missing bearer tokens and keeps devices and commands within their workspace", async () => {
    const response = await desktopPost(
      new NextRequest(`${origin}/api/desktop/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instanceId }),
      }),
      { params: Promise.resolve({ path: ["claim"] }) },
    );
    expect(response.status).toBe(401);
    expect(
      (await (await app("GET", "desktop", undefined, otherCookie)).json())
        .devices,
    ).toEqual([]);
    expect(
      (
        await app(
          "PATCH",
          `desktop/devices/${paired.deviceId}`,
          { action: "pause" },
          otherCookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app(
          "POST",
          "desktop/commands",
          {
            accountId: accounts[0].id,
            deviceId: paired.deviceId,
            kind: "LOGIN",
          },
          otherCookie,
        )
      ).status,
    ).toBe(404);
  });
  it("detects concurrent runners and permits only the active desktop instance", async () => {
    await desktop.heartbeat(paired.deviceId, wid, instanceId);
    await expect(
      desktop.heartbeat(paired.deviceId, wid, randomUUID()),
    ).rejects.toThrow();
    await expect(
      desktop.claimDesktopWork(paired.deviceId, wid, randomUUID()),
    ).rejects.toThrow();
  });
  it("requires checking and explicitly confirming Facebook identity before enabling automatic posting", async () => {
    const command = await desktop.queueDesktopCommand(
      wid,
      accounts[0].id,
      paired.deviceId,
      "LOGIN",
    );
    const work = await desktop.claimDesktopWork(
      paired.deviceId,
      wid,
      instanceId,
    );
    expect(work?.id).toBe(command.id);
    await desktop.finishDesktopCommand(paired.deviceId, wid, command.id, {
      runId: work!.runId,
      state: "READY",
      identityHash,
      message: "Fixture session",
    });
    expect(
      (
        await db.facebookConnection.findUniqueOrThrow({
          where: { accountId: accounts[0].id },
        })
      ).state,
    ).toBe("UNCONFIRMED");
    await expect(
      desktop.updateConnection(wid, accounts[0].id, "enable"),
    ).rejects.toThrow();
    await desktop.updateConnection(wid, accounts[0].id, "confirm");
    await desktop.updateConnection(wid, accounts[0].id, "enable");
    expect(
      (
        await api<{ connections: { automationEnabled: boolean }[] }>(
          "GET",
          "desktop",
        )
      ).connections[0].automationEnabled,
    ).toBe(true);
    expect(await api("GET", "desktop")).not.toHaveProperty("tokenHash");
  });
  it("does not allow automatic scheduling for an unconnected Facebook account", async () => {
    const response = await app("POST", "schedules", {
      executionMode: "AUTOMATIC",
      postId,
      scheduledAt: new Date().toISOString(),
      targets: [{ accountId: accounts[4].id, groupId: null }],
      idempotencyKey: randomUUID(),
      acknowledgeWarnings: true,
    });
    expect(response.status).toBe(409);
  });
  it("detects login completion automatically and ignores observations after confirmation", async () => {
    const account = await api<{ id: string }>("POST", "accounts", {
      name: "Automatic login observation",
      profileName: "Login test",
      url: `facebook.com/login.${run}`,
    });
    const command = await desktop.queueDesktopCommand(
      wid,
      account.id,
      paired.deviceId,
      "LOGIN",
    );
    const work = await desktop.claimDesktopWork(
      paired.deviceId,
      wid,
      instanceId,
    );
    await desktop.finishDesktopCommand(paired.deviceId, wid, command.id, {
      runId: work!.runId,
      state: "LOGIN_REQUIRED",
      message: "Waiting for Facebook login",
    });
    const input = {
      instanceId,
      state: "READY" as const,
      identityHash,
      message: "Login detected",
    };
    await expect(
      desktop.reportDesktopSession(paired.deviceId, wid, account.id, {
        ...input,
        instanceId: randomUUID(),
      }),
    ).rejects.toThrow();
    await expect(
      desktop.reportDesktopSession(
        paired.deviceId,
        otherWid,
        account.id,
        input,
      ),
    ).rejects.toThrow();
    expect(
      desktop.sessionResultSchema.safeParse({
        ...input,
        identityHash: undefined,
      }).success,
    ).toBe(false);
    await desktop.reportDesktopSession(paired.deviceId, wid, account.id, {
      instanceId,
      state: "CHALLENGE",
      message: "Complete Facebook verification",
    });
    expect(
      (
        await db.facebookConnection.findUniqueOrThrow({
          where: { accountId: account.id },
        })
      ).state,
    ).toBe("CHALLENGE");
    await desktop.reportDesktopSession(paired.deviceId, wid, account.id, input);
    expect(
      await db.facebookConnection.findUniqueOrThrow({
        where: { accountId: account.id },
      }),
    ).toMatchObject({ state: "UNCONFIRMED", automationEnabled: false });
    await desktop.updateConnection(wid, account.id, "confirm");
    await desktop.updateConnection(wid, account.id, "enable");
    expect(
      await desktop.reportDesktopSession(paired.deviceId, wid, account.id, {
        instanceId,
        state: "LOGIN_REQUIRED",
        message: "Stale observation",
      }),
    ).toEqual({ ok: true, stale: true });
    expect(
      await db.facebookConnection.findUniqueOrThrow({
        where: { accountId: account.id },
      }),
    ).toMatchObject({
      state: "READY",
      automationEnabled: true,
      confirmedIdentityHash: identityHash,
    });
  });
  it("claims a due task exactly once and requires final authorization before publishing", async () => {
    await ready();
    const task = await schedule();
    const claims = await Promise.all([
      desktop.claimDesktopWork(paired.deviceId, wid, instanceId),
      desktop.claimDesktopWork(paired.deviceId, wid, instanceId),
    ]);
    const work = claims.find(Boolean)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(work.id).toBe(task.id);
    await expect(
      desktop.finishDesktopPost(paired.deviceId, wid, task.id, {
        runId: work.runId,
        outcome: "PUBLISHED",
        message: "Not yet armed",
      }),
    ).rejects.toThrow();
    await desktop.updateDevice(wid, paired.deviceId, "pause");
    await expect(
      desktop.armDesktopPost(
        paired.deviceId,
        wid,
        task.id,
        work.runId,
        accounts[0].url,
      ),
    ).rejects.toThrow();
    await desktop.updateDevice(wid, paired.deviceId, "resume");
    await desktop.armDesktopPost(
      paired.deviceId,
      wid,
      task.id,
      work.runId,
      accounts[0].url,
    );
    const current = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(
      (
        await app("POST", "tasks/bulk-cancel", {
          tasks: [{ id: task.id, version: current.version }],
          operationId: randomUUID(),
        })
      ).status,
    ).toBe(409);
    await desktop.finishDesktopPost(paired.deviceId, wid, task.id, {
      runId: work.runId,
      outcome: "PUBLISHED",
      message: "Fixture confirmed",
      resultUrl: "https://www.facebook.com/shop/posts/123",
    });
    await desktop.finishDesktopPost(paired.deviceId, wid, task.id, {
      runId: work.runId,
      outcome: "PUBLISHED",
      message: "Replay",
    });
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: task.id } }))
        .resultSource,
    ).toBe("DESKTOP");
    expect(
      await db.taskEvent.count({
        where: { taskId: task.id, toStatus: "PUBLISHED" },
      }),
    ).toBe(1);
    expect(
      await db.facebookConnection.findUniqueOrThrow({
        where: { accountId: accounts[0].id },
      }),
    ).toMatchObject({
      state: "READY",
      automationEnabled: true,
      confirmedIdentityHash: identityHash,
      message: "Fixture confirmed",
    });
  });
  it("blocks uncertain outcomes and never reclaims them automatically", async () => {
    await ready();
    const task = await schedule();
    const work = await desktop.claimDesktopWork(
      paired.deviceId,
      wid,
      instanceId,
    );
    await desktop.armDesktopPost(
      paired.deviceId,
      wid,
      task.id,
      work!.runId,
      accounts[0].url,
    );
    await desktop.finishDesktopPost(paired.deviceId, wid, task.id, {
      runId: work!.runId,
      outcome: "UNCERTAIN",
      message: "No conclusive result",
    });
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: task.id } })).blockReason,
    ).toBe("AUTO_UNCERTAIN");
    expect(
      (
        await db.facebookConnection.findUniqueOrThrow({
          where: { accountId: accounts[0].id },
        })
      ).automationEnabled,
    ).toBe(true);
    const next = await schedule();
    expect(
      (await desktop.desktopStatus(wid)).connections.find(
        (connection) => connection.accountId === accounts[0].id,
      )?.reviewRequired,
    ).toBe(1);
    expect(
      await desktop.claimDesktopWork(paired.deviceId, wid, instanceId),
    ).toBeNull();
    const current = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(
      (
        await app("PATCH", `tasks/${task.id}`, {
          action: "record",
          status: "PUBLISHED",
          version: current.version,
          operationId: randomUUID(),
          note: "User verified",
        })
      ).status,
    ).toBe(200);
    expect(
      await db.task.findUniqueOrThrow({ where: { id: task.id } }),
    ).toMatchObject({ automaticPhase: "DONE", blockReason: null });
    const resumed = await desktop.claimDesktopWork(
      paired.deviceId,
      wid,
      instanceId,
    );
    expect(resumed?.id).toBe(next.id);
    await desktop.armDesktopPost(
      paired.deviceId,
      wid,
      next.id,
      resumed!.runId,
      accounts[0].url,
    );
    await desktop.finishDesktopPost(paired.deviceId, wid, next.id, {
      runId: resumed!.runId,
      outcome: "PUBLISHED",
      message: "Confirmed after review",
    });
  });
  it("recovers an interrupted task as needing review without repeating a submission", async () => {
    await ready();
    const task = await schedule();
    const work = await desktop.claimDesktopWork(
      paired.deviceId,
      wid,
      instanceId,
    );
    await desktop.armDesktopPost(
      paired.deviceId,
      wid,
      task.id,
      work!.runId,
      accounts[0].url,
    );
    await db.task.update({
      where: { id: task.id },
      data: {
        desktopLeaseAt: new Date(
          Date.now() - desktop.AUTOMATIC_LEASE_MS - 1000,
        ),
      },
    });
    expect(await desktop.recoverDesktopWork()).toBe(1);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: task.id } })).blockReason,
    ).toBe("AUTO_INTERRUPTED");
    expect(
      await db.facebookConnection.findUniqueOrThrow({
        where: { accountId: accounts[0].id },
      }),
    ).toMatchObject({ automationEnabled: true });
    await ready();
    expect(
      await desktop.claimDesktopWork(paired.deviceId, wid, instanceId),
    ).toBeNull();
  });
  it("shows the group wait in minutes and releases it when an unfinished attempt is skipped", async () => {
    await ready(3);
    const group = await api<{ id: string }>("POST", "groups", {
      name: "Minute interval fixture",
      url: `https://facebook.com/groups/minutes.${run}`,
      accountIds: [accounts[3].id],
      minIntervalMinutes: 5,
    });
    const make = async (executionMode: string) => {
      const campaign = await api<{ id: string }>("POST", "schedules", {
        executionMode,
        postId,
        scheduledAt: new Date().toISOString(),
        targets: [{ accountId: accounts[3].id, groupId: group.id }],
        idempotencyKey: randomUUID(),
        acknowledgeWarnings: true,
      });
      return db.task.findFirstOrThrow({
        where: { campaignId: campaign.id, workspaceId: wid },
      });
    };
    const earlier = await make("MANUAL");
    const startedAt = new Date();
    await db.task.update({
      where: { id: earlier.id },
      data: { status: "IN_PROGRESS", startedAt },
    });
    const task = await make("AUTOMATIC");
    const detail = await api<{
      automaticWait: { reason: string; minutes: number; until: string };
    }>("GET", `tasks/${task.id}`);
    expect(detail.automaticWait).toEqual({
      reason: "GROUP_INTERVAL",
      minutes: 5,
      until: new Date(startedAt.getTime() + 5 * 60_000).toISOString(),
    });
    const list = await api<{ items: { id: string; automaticWait: unknown }[] }>(
      "GET",
      "tasks",
    );
    expect(
      list.items.find((item) => item.id === task.id)?.automaticWait,
    ).toEqual(detail.automaticWait);
    expect(
      (await app("GET", `tasks/${task.id}`, undefined, otherCookie)).status,
    ).toBe(404);
    expect(
      await desktop.claimDesktopWork(paired.deviceId, wid, instanceId),
    ).toBeNull();
    await api("PATCH", `tasks/${earlier.id}`, {
      action: "record",
      status: "SKIPPED",
      version: earlier.version,
      operationId: randomUUID(),
    });
    expect(
      (await api<{ automaticWait: unknown }>("GET", `tasks/${task.id}`))
        .automaticWait,
    ).toBeNull();
    const work = await desktop.claimDesktopWork(
      paired.deviceId,
      wid,
      instanceId,
    );
    expect(work?.id).toBe(task.id);
    await desktop.finishDesktopPost(paired.deviceId, wid, task.id, {
      runId: work!.runId,
      outcome: "FAILED",
      message: "Fixture stopped before submitting",
    });
  });
  it("enforces an account interval in minutes across destinations and checks changed settings before submission", async () => {
    await ready(2);
    await db.facebookAccount.update({
      where: { id: accounts[2].id },
      data: { postIntervalMinutes: 3 },
    });
    const earlier = await schedule(2, "MANUAL");
    await db.task.update({
      where: { id: earlier.id },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    });
    const task = await schedule(2);
    expect(
      (
        await api<{ automaticWait: { reason: string; minutes: number } }>(
          "GET",
          `tasks/${task.id}`,
        )
      ).automaticWait,
    ).toMatchObject({ reason: "ACCOUNT_INTERVAL", minutes: 3 });
    expect(
      await desktop.claimDesktopWork(paired.deviceId, wid, instanceId),
    ).toBeNull();
    await db.task.update({
      where: { id: earlier.id },
      data: { startedAt: new Date(Date.now() - 4 * 60_000) },
    });
    const work = await desktop.claimDesktopWork(
      paired.deviceId,
      wid,
      instanceId,
    );
    expect(work?.id).toBe(task.id);
    await db.facebookAccount.update({
      where: { id: accounts[2].id },
      data: { postIntervalMinutes: 5 },
    });
    await expect(
      desktop.armDesktopPost(
        paired.deviceId,
        wid,
        task.id,
        work!.runId,
        accounts[2].url,
      ),
    ).rejects.toThrow("khoảng cách");
    await desktop.finishDesktopPost(paired.deviceId, wid, task.id, {
      runId: work!.runId,
      outcome: "FAILED",
      message: "Fixture stopped before submitting",
    });
  });
  it.each(["FAILED", "LOGIN_REQUIRED", "CHALLENGE"] as const)(
    "preserves posting consent after %s while blocking work that needs review",
    async (outcome) => {
      const index = accounts.length;
      accounts.push(
        await api("POST", "accounts", {
          name: `Outcome ${outcome}`,
          profileName: "Result fixture",
          url: `facebook.com/outcome.${run}.${index}`,
          quietStart: 0,
          quietEnd: 0,
          dailyLimit: 50,
          postIntervalMinutes: 0,
        }),
      );
      await ready(index);
      const task = await schedule(index);
      const work = await desktop.claimDesktopWork(
        paired.deviceId,
        wid,
        instanceId,
      );
      expect(work?.id).toBe(task.id);
      await schedule(index);
      await desktop.finishDesktopPost(paired.deviceId, wid, task.id, {
        runId: work!.runId,
        outcome,
        message: "Fixture stopped before clicking",
      });
      expect(
        await db.facebookConnection.findUniqueOrThrow({
          where: { accountId: accounts[index].id },
        }),
      ).toMatchObject({
        automationEnabled: outcome === "FAILED",
        state: outcome === "FAILED" ? "READY" : outcome,
      });
      expect(
        await desktop.claimDesktopWork(paired.deviceId, wid, instanceId),
      ).toBeNull();
    },
  );
  it("honors quiet hours, task cancellation and revoked device tokens", async () => {
    await ready(1);
    const task = await schedule(1);
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date()),
    );
    await db.facebookAccount.update({
      where: { id: accounts[1].id },
      data: {
        quietHoursEnabled: true,
        quietStart: hour,
        quietEnd: (hour + 1) % 24,
      },
    });
    expect(
      await desktop.claimDesktopWork(paired.deviceId, wid, instanceId),
    ).toBeNull();
    expect(
      (
        await app("PATCH", `tasks/${task.id}`, {
          action: "cancel",
          version: task.version,
          operationId: randomUUID(),
        })
      ).status,
    ).toBe(200);
    await desktop.updateDevice(wid, paired.deviceId, "revoke");
    await expect(
      desktop.desktopFor(
        new Request(origin, {
          headers: { Authorization: `Bearer ${paired.token}` },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("reviewed interactions across five accounts", () => {
  it("canonicalizes post links and prevents assigning the same post to another account", async () => {
    expect(
      interactionTarget(
        "https://m.facebook.com/groups/example/posts/123/?utm_source=x",
      ).postKey,
    ).toBe(
      interactionTarget(
        "https://www.facebook.com/permalink.php?story_fbid=123&id=888",
      ).postKey,
    );
    expect(() =>
      interactionTarget("https://facebook.com/share/p/short"),
    ).toThrow();
    const body = {
      accountId: accounts[0].id,
      postUrl: "https://facebook.com/groups/example/posts/123",
      kind: "COMMENT",
      content: "Thông tin shop có thể hỗ trợ",
      scheduledAt: new Date().toISOString(),
    };
    const item = await api<{ id: string }>("POST", "interactions", body);
    expect(
      (
        await app("POST", "interactions", {
          ...body,
          accountId: accounts[2].id,
          postUrl: "https://m.facebook.com/groups/example/permalink/123/?ref=x",
        })
      ).status,
    ).toBe(409);
    expect(
      (await app("PATCH", `interactions/${item.id}`, { action: "complete" }))
        .status,
    ).toBe(409);
    expect(
      (
        await app(
          "PATCH",
          `interactions/${item.id}`,
          { action: "approve" },
          otherCookie,
        )
      ).status,
    ).toBe(404);
    await api("PATCH", `interactions/${item.id}`, { action: "approve" });
    await api("PATCH", `interactions/${item.id}`, { action: "complete" });
    expect(
      (await db.interaction.findUniqueOrThrow({ where: { id: item.id } }))
        .status,
    ).toBe("COMPLETED");
    expect(
      (await (await app("GET", "interactions", undefined, otherCookie)).json())
        .total,
    ).toBe(0);
  });
});

describe("durable retries before submission", () => {
  let index: number;
  const failure = {
    stage: "composer",
    submitAttempted: false,
    code: "TIMEOUT" as const,
  };
  beforeAll(async () => {
    index = accounts.length;
    accounts.push(
      await api("POST", "accounts", {
        name: "Retry fixture",
        profileName: "Retry fixture",
        url: `facebook.com/retry.${run}`,
        quietStart: 0,
        quietEnd: 0,
        dailyLimit: 100,
        postIntervalMinutes: 0,
      }),
    );
    const pair = await desktop.createPairing(wid);
    paired = await desktop.pairDesktop(pair.code, "Retry PC");
  });
  beforeEach(async () => {
    await db.task.deleteMany({
      where: { workspaceId: wid, accountId: accounts[index].id },
    });
    await ready(index);
  });
  const claim = () =>
    desktop.claimDesktopWork(paired.deviceId, wid, instanceId);
  const current = (id: string) => db.task.findUniqueOrThrow({ where: { id } });
  async function fail(id: string, runId: string) {
    await desktop.finishDesktopPost(paired.deviceId, wid, id, {
      runId,
      outcome: "FAILED",
      message: "Composer timeout",
      failure,
    });
    return current(id);
  }

  it("backs off 1 and 3 minutes, lets later jobs run, and exhausts after three attempts", async () => {
    const task = await schedule(index);
    await db.task.update({
      where: { id: task.id },
      data: { scheduledAt: new Date(Date.now() - 60 * 60_000) },
    });
    const first = (await claim())!;
    expect(first).toHaveProperty("attemptDeadlineAt");
    let state = await fail(task.id, first.runId);
    expect(state).toMatchObject({
      status: "READY",
      automaticPhase: "RETRY_WAIT",
      automaticAttempts: 1,
    });
    expect(state.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(55_000);
    const originalSchedule = state.scheduledAt;
    const version = state.version;
    await fail(task.id, first.runId);
    expect((await current(task.id)).version).toBe(version);
    const detail = await api<{ automaticWait: { reason: string } }>(
      "GET",
      `tasks/${task.id}`,
    );
    expect(detail.automaticWait.reason).toBe("RETRY_BACKOFF");

    const later = await schedule(index);
    const next = (await claim())!;
    expect(next.id).toBe(later.id);
    await desktop.armDesktopPost(
      paired.deviceId,
      wid,
      later.id,
      next.runId,
      accounts[index].url,
    );
    await desktop.finishDesktopPost(paired.deviceId, wid, later.id, {
      runId: next.runId,
      outcome: "PUBLISHED",
      message: "Later post completed",
    });
    expect(await claim()).toBeNull();
    await db.task.update({
      where: { id: task.id },
      data: { nextAttemptAt: new Date(0) },
    });
    const claims = await Promise.all([claim(), claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const second = claims.find(Boolean)!;
    expect(second.runId).not.toBe(first.runId);
    await fail(task.id, first.runId);
    expect((await current(task.id)).status).toBe("IN_PROGRESS");
    await expect(
      desktop.armDesktopPost(
        paired.deviceId,
        wid,
        task.id,
        first.runId,
        accounts[index].url,
      ),
    ).rejects.toThrow();
    state = await fail(task.id, second.runId);
    expect(state.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(
      175_000,
    );
    expect(state.automaticAttempts).toBe(2);
    await db.task.update({
      where: { id: task.id },
      data: { nextAttemptAt: new Date(0) },
    });
    state = await fail(task.id, (await claim())!.runId);
    expect(state).toMatchObject({
      status: "BLOCKED",
      automaticPhase: "SAFE_FAILED",
      automaticAttempts: 3,
      nextAttemptAt: null,
      scheduledAt: originalSchedule,
    });
    expect(await claim()).toBeNull();
    const afterExhaustion = await schedule(index);
    expect((await claim())?.id).toBe(afterExhaustion.id);
    const action = {
      action: "retry",
      operationId: randomUUID(),
      version: state.version,
    };
    await api("PATCH", `tasks/${task.id}`, action);
    await api("PATCH", `tasks/${task.id}`, action);
    expect(await current(task.id)).toMatchObject({
      status: "READY",
      automaticAttempts: 0,
      automaticPhase: "NONE",
    });
  });

  it("does not retry a failure after authorization, and explains the account hold", async () => {
    const task = await schedule(index);
    const work = (await claim())!;
    await desktop.armDesktopPost(
      paired.deviceId,
      wid,
      task.id,
      work.runId,
      accounts[index].url,
    );
    const state = await fail(task.id, work.runId);
    expect(state).toMatchObject({
      status: "BLOCKED",
      automaticPhase: "NEEDS_REVIEW",
      nextAttemptAt: null,
    });
    const later = await schedule(index);
    expect(await claim()).toBeNull();
    expect(
      (await api<{ automaticHold: string }>("GET", `tasks/${later.id}`))
        .automaticHold,
    ).toContain("kiểm tra kết quả");
    expect(
      (
        await app("PATCH", `tasks/${task.id}`, {
          action: "retry",
          version: state.version,
          operationId: randomUUID(),
        })
      ).status,
    ).toBe(409);
    const secondIndex = accounts.length;
    accounts.push(
      await api("POST", "accounts", {
        name: "Independent retry account",
        profileName: "Independent fixture",
        url: `facebook.com/independent.${run}`,
        quietStart: 0,
        quietEnd: 0,
        postIntervalMinutes: 0,
      }),
    );
    await ready(secondIndex);
    const independent = await schedule(secondIndex);
    const otherWork = (await claim())!;
    expect(otherWork.id).toBe(independent.id);
    await desktop.finishDesktopPost(paired.deviceId, wid, independent.id, {
      runId: otherWork.runId,
      outcome: "FAILED",
      message: "Independent account completed its attempt",
      failure: { ...failure, code: "OTHER" },
    });
  });

  it("recovers PREPARING after restart and fences the expired run", async () => {
    const task = await schedule(index);
    const first = (await claim())!;
    await db.task.update({
      where: { id: task.id },
      data: {
        desktopLeaseAt: new Date(
          Date.now() - desktop.AUTOMATIC_LEASE_MS - 1000,
        ),
      },
    });
    await expect(
      desktop.armDesktopPost(
        paired.deviceId,
        wid,
        task.id,
        first.runId,
        accounts[index].url,
      ),
    ).rejects.toThrow();
    await desktop.recoverDesktopWork();
    expect(await current(task.id)).toMatchObject({
      status: "READY",
      automaticPhase: "RETRY_WAIT",
      automaticAttempts: 1,
    });
    await desktop.recoverDesktopWork();
    expect((await current(task.id)).automaticAttempts).toBe(1);
    await db.task.update({
      where: { id: task.id },
      data: { nextAttemptAt: new Date(0) },
    });
    const second = (await claim())!;
    expect(second.runId).not.toBe(first.runId);
    await db.task.update({
      where: { id: task.id },
      data: { startedAt: new Date(Date.now() - AUTOMATIC_ATTEMPT_MS - 1000) },
    });
    await expect(
      desktop.armDesktopPost(
        paired.deviceId,
        wid,
        task.id,
        second.runId,
        accounts[index].url,
      ),
    ).rejects.toThrow();
  });

  it("does not let fifty deferred retries hide an eligible job", async () => {
    const task = await schedule(index);
    const rows = Array.from({ length: 51 }, (_, i) => ({
      workspaceId: wid,
      campaignId: task.campaignId,
      postId,
      accountId: accounts[index].id,
      destinationKey: `retry-${i}`,
      titleSnapshot: "Deferred retry",
      contentSnapshot: "fixture",
      contentHash: task.contentHash,
      scheduledAt: new Date(Date.now() - 60_000),
      status: "READY" as const,
      executionMode: "AUTOMATIC",
      nextAttemptAt: new Date(Date.now() + 180_000),
      automaticPhase: "RETRY_WAIT",
      automaticAttempts: 1,
    }));
    await db.task.createMany({ data: rows });
    expect((await claim())?.id).toBe(task.id);
  });

  it("keeps legacy failures conservative and treats definite permanent failures as safe", async () => {
    const task = await schedule(index);
    const work = (await claim())!;
    await desktop.finishDesktopPost(paired.deviceId, wid, task.id, {
      runId: work.runId,
      outcome: "FAILED",
      message: "Old runner without structured evidence",
    });
    expect((await current(task.id)).automaticPhase).toBe("NEEDS_REVIEW");
    await db.task.delete({ where: { id: task.id } });
    const permanent = await schedule(index);
    const next = (await claim())!;
    await desktop.finishDesktopPost(paired.deviceId, wid, permanent.id, {
      runId: next.runId,
      outcome: "FAILED",
      message: "Destination unavailable",
      failure: { ...failure, code: "OTHER" },
    });
    expect(await current(permanent.id)).toMatchObject({
      automaticPhase: "SAFE_FAILED",
      nextAttemptAt: null,
    });
  });

  it("rechecks daily caps, intervals and quiet hours when a retry becomes due", async () => {
    const task = await schedule(index);
    await fail(task.id, (await claim())!.runId);
    await db.task.update({
      where: { id: task.id },
      data: { nextAttemptAt: new Date(0) },
    });
    const other = await schedule(index, "MANUAL");
    await db.task.update({
      where: { id: other.id },
      data: { status: "PUBLISHED", startedAt: new Date() },
    });
    await db.facebookAccount.update({
      where: { id: accounts[index].id },
      data: { dailyLimit: 1 },
    });
    expect(await claim()).toBeNull();
    await db.facebookAccount.update({
      where: { id: accounts[index].id },
      data: { dailyLimit: 100, postIntervalMinutes: 5 },
    });
    expect(await claim()).toBeNull();
    await db.task.update({
      where: { id: other.id },
      data: { startedAt: new Date(Date.now() - 6 * 60_000) },
    });
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date()),
    );
    await db.facebookAccount.update({
      where: { id: accounts[index].id },
      data: {
        quietHoursEnabled: true,
        quietStart: hour,
        quietEnd: (hour + 1) % 24,
      },
    });
    expect(await claim()).toBeNull();
    await db.facebookAccount.update({
      where: { id: accounts[index].id },
      data: {
        quietStart: 0,
        quietEnd: 0,
        postIntervalMinutes: 0,
        dailyLimit: 1,
      },
    });
    await db.task.delete({ where: { id: other.id } });
    // The earlier attempt of this same job must not consume a second daily slot.
    const retry = (await claim())!;
    expect(retry.id).toBe(task.id);
    await desktop.armDesktopPost(
      paired.deviceId,
      wid,
      task.id,
      retry.runId,
      accounts[index].url,
    );
  });

  it("rechecks the quiet-hour toggle at claim and immediately before posting", async () => {
    const task = await schedule(index);
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date()),
    );
    await db.facebookAccount.update({
      where: { id: accounts[index].id },
      data: {
        quietHoursEnabled: true,
        quietStart: hour,
        quietEnd: (hour + 1) % 24,
        dailyLimit: 100,
        postIntervalMinutes: 0,
      },
    });
    expect(await claim()).toBeNull();
    const toggle = (enabled: boolean) =>
      api("PATCH", `accounts/${accounts[index].id}/quiet-hours`, { enabled });
    await toggle(false);
    const work = (await claim())!;
    expect(work.id).toBe(task.id);
    await toggle(true);
    await expect(
      desktop.armDesktopPost(
        paired.deviceId,
        wid,
        work.id,
        work.runId,
        accounts[index].url,
      ),
    ).rejects.toThrow("giờ nghỉ");
    await toggle(false);
    await desktop.armDesktopPost(
      paired.deviceId,
      wid,
      work.id,
      work.runId,
      accounts[index].url,
    );
    expect(await current(task.id)).toMatchObject({
      automaticPhase: "SUBMITTING",
    });
    await db.facebookAccount.update({
      where: { id: accounts[index].id },
      data: { quietStart: 0, quietEnd: 0 },
    });
  });
  it("shows intervals caused by another pending retry in list results", async () => {
    const first = await schedule(index);
    await fail(first.id, (await claim())!.runId);
    await db.facebookAccount.update({
      where: { id: accounts[index].id },
      data: { postIntervalMinutes: 5 },
    });
    const later = await schedule(index);
    const list = await api<{
      items: { id: string; automaticWait: { reason: string } | null }[];
    }>("GET", `tasks?accountId=${accounts[index].id}`);
    expect(
      list.items.find((t) => t.id === later.id)?.automaticWait?.reason,
    ).toBe("ACCOUNT_INTERVAL");
    expect(
      list.items.find((t) => t.id === first.id)?.automaticWait?.reason,
    ).toBe("RETRY_BACKOFF");
    expect(await claim()).toBeNull();
    await db.facebookAccount.update({
      where: { id: accounts[index].id },
      data: { postIntervalMinutes: 0, dailyLimit: 100 },
    });
  });
});
