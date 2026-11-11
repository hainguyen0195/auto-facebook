import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as desktopApi } from "../../src/app/api/desktop/[...path]/route";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/lib/db";
import { createAuth } from "../../src/lib/auth";
import * as desktop from "../../src/lib/desktop";
import {
  createInteraction,
  interactionAction,
  interactionSchema,
  listInteractions,
} from "../../src/lib/interactions";
import {
  armInteraction,
  finishInteraction,
  recoverInteractions,
  updateInteractionSettings,
} from "../../src/lib/interaction-work";
import {
  publishedPosts,
  saveDesktopPostLink,
  savePostLink,
} from "../../src/lib/post-links";
import {
  workspaceTransaction,
  setAccountQuietHours,
} from "../../src/lib/service";

let wid: string, ownerId: string, postId: string;
let paired: Awaited<ReturnType<typeof desktop.pairDesktop>>;
let accountA: string, accountB: string;
const instanceId = randomUUID(),
  identityHash = "a".repeat(64);
const url = (id: string) => `https://www.facebook.com/groups/123/posts/${id}`;

async function source(
  id: string = randomUUID(),
  recordedAt = new Date(),
  status: "PUBLISHED" | "PENDING_REVIEW" = "PUBLISHED",
) {
  const campaign = await db.campaign.create({
    data: {
      workspaceId: wid,
      postId,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
    },
  });
  return db.task.create({
    data: {
      workspaceId: wid,
      postId,
      campaignId: campaign.id,
      accountId: accountA,
      destinationKey: "PROFILE",
      titleSnapshot: "Published fixture",
      contentSnapshot: "Text",
      contentHash: randomUUID(),
      scheduledAt: new Date("2026-01-01T00:00:00Z"),
      status,
      recordedAt,
      resultUrl: url(id),
    },
  });
}
async function job() {
  const task = await source();
  return createInteraction(
    wid,
    interactionSchema.parse({
      accountId: accountB,
      sourceTaskId: task.id,
      executionMode: "AUTOMATIC",
      postUrl: task.resultUrl,
      kind: "BUMP",
      scheduledAt: new Date(Date.now() - 10000).toISOString(),
    }),
  );
}
async function approved() {
  const row = await job();
  await updateInteractionSettings(wid, accountB, {
    enabled: true,
    dailyLimit: 10,
    intervalMinutes: 5,
  });
  return interactionAction(wid, row.id, { action: "approve", note: "" });
}
async function claim() {
  const work = await desktop.claimDesktopWork(
    paired.deviceId,
    wid,
    instanceId,
    true,
  );
  if (work?.type !== "INTERACTION")
    throw new Error(`Expected interaction, received ${JSON.stringify(work)}`);
  return work;
}
async function finish(
  work: Awaited<ReturnType<typeof claim>>,
  phase: "FAILED" | "UNCERTAIN" | "COMPLETED" = "FAILED",
  attempted = false,
) {
  return finishInteraction(paired.deviceId, wid, work.id, {
    runId: work.runId,
    outcome: phase,
    message: "fixture",
    failure: { stage: "fixture", code: "TIMEOUT", submitAttempted: attempted },
  });
}
async function elapsePacing(id: string, retryDue = false) {
  const past = new Date(Date.now() - 6 * 60_000);
  // Advance both shared/account pacing clocks when simulating elapsed backoff.
  await db.interaction.update({
    where: { id },
    data: {
      startedAt: past,
      leaseAt: past,
      ...(retryDue ? { nextAttemptAt: new Date(0) } : {}),
    },
  });
}
beforeAll(async () => {
  const auth = createAuth(true);
  const result = await auth.api.signUpEmail({
    body: {
      email: `auto-interaction-${randomUUID()}@tests.nhipdang.local`,
      name: "Interactions",
      password: "Tests-password-2026!",
    },
  });
  ownerId = result.user.id;
  wid = (await db.workspace.findUniqueOrThrow({ where: { ownerId } })).id;
  accountA = (
    await db.facebookAccount.create({
      data: {
        workspaceId: wid,
        name: "A",
        profileName: "A",
        url: "https://facebook.com/123",
        quietStart: 0,
        quietEnd: 0,
        postIntervalMinutes: 0,
      },
    })
  ).id;
  accountB = (
    await db.facebookAccount.create({
      data: {
        workspaceId: wid,
        name: "B",
        profileName: "B",
        url: "https://facebook.com/456",
        quietStart: 0,
        quietEnd: 0,
        postIntervalMinutes: 0,
      },
    })
  ).id;
  postId = (
    await db.post.create({
      data: { workspaceId: wid, title: "Fixture", content: "Text" },
    })
  ).id;
  const pairing = await desktop.createPairing(wid);
  paired = await desktop.pairDesktop(pairing.code, "Interaction fixture");
});
beforeEach(async () => {
  await db.interaction.deleteMany({ where: { workspaceId: wid } });
  await db.task.deleteMany({ where: { workspaceId: wid } });
  await db.campaign.deleteMany({ where: { workspaceId: wid } });
  await db.facebookAccount.updateMany({
    where: { workspaceId: wid },
    data: { quietHoursEnabled: true, quietStart: 0, quietEnd: 0 },
  });
  await db.desktopDevice.update({
    where: { id: paired.deviceId },
    data: { paused: false },
  });
  for (const accountId of [accountA, accountB])
    await db.facebookConnection.upsert({
      where: { accountId },
      create: {
        workspaceId: wid,
        accountId,
        deviceId: paired.deviceId,
        state: "READY",
        identityHash,
        confirmedIdentityHash: identityHash,
      },
      update: {
        state: "READY",
        identityHash,
        confirmedIdentityHash: identityHash,
        automationEnabled: false,
        interactionEnabled: false,
        interactionDailyLimit: 10,
        interactionIntervalMinutes: 5,
      },
    });
  await desktop.heartbeat(paired.deviceId, wid, instanceId);
});
afterAll(async () => {
  await db.interaction.deleteMany({ where: { workspaceId: wid } });
  await db.task.deleteMany({ where: { workspaceId: wid } });
  await db.user.delete({ where: { id: ownerId } });
  await db.$disconnect();
});

describe("post links and automatic interactions", () => {
  it("reports paused, offline and disabled service reasons", async () => {
    await approved();
    await db.desktopDevice.update({
      where: { id: paired.deviceId },
      data: { paused: true },
    });
    expect(
      (await listInteractions(wid, new URLSearchParams())).items[0].waitReason,
    ).toContain("tạm dừng");
    await db.desktopDevice.update({
      where: { id: paired.deviceId },
      data: { paused: false, lastSeenAt: new Date(0) },
    });
    expect(
      (await listInteractions(wid, new URLSearchParams())).items[0].waitReason,
    ).toContain("ngoại tuyến");
    const previous = process.env.NHIPDANG_AUTOMATIC_INTERACTIONS;
    try {
      process.env.NHIPDANG_AUTOMATIC_INTERACTIONS = "0";
      expect(
        (await listInteractions(wid, new URLSearchParams())).items[0]
          .waitReason,
      ).toContain("tắt trên máy chủ");
    } finally {
      if (previous === undefined)
        delete process.env.NHIPDANG_AUTOMATIC_INTERACTIONS;
      else process.env.NHIPDANG_AUTOMATIC_INTERACTIONS = previous;
    }
  });
  it("preserves both consents on same-identity reconnect and resets both on identity changes", async () => {
    await updateInteractionSettings(wid, accountB, {
      enabled: true,
      dailyLimit: 10,
      intervalMinutes: 5,
    });
    await db.facebookConnection.update({
      where: { accountId: accountB },
      data: { automationEnabled: true },
    });
    for (const hash of [identityHash, "b".repeat(64)]) {
      const command = await desktop.queueDesktopCommand(
        wid,
        accountB,
        paired.deviceId,
        "LOGIN",
      );
      const work = await desktop.claimDesktopWork(
        paired.deviceId,
        wid,
        instanceId,
      );
      if (work?.type !== "COMMAND") throw new Error("Expected login command");
      await desktop.finishDesktopCommand(paired.deviceId, wid, command.id, {
        runId: work.runId,
        state: "READY",
        identityHash: hash,
        message: "fixture",
      });
      const connection = await db.facebookConnection.findUniqueOrThrow({
        where: { accountId: accountB },
      });
      expect(connection.automationEnabled).toBe(hash === identityHash);
      expect(connection.interactionEnabled).toBe(hash === identityHash);
    }
  });
  it("saves a versioned link idempotently without changing publication or recorded date", async () => {
    const task = await source();
    const input = {
      resultUrl: url("new"),
      version: task.version,
      operationId: randomUUID(),
    };
    const updated = await savePostLink(wid, task.id, input);
    expect(updated.status).toBe("PUBLISHED");
    expect(updated.recordedAt).toEqual(task.recordedAt);
    expect(updated.version).toBe(task.version + 1);
    await savePostLink(wid, task.id, input);
    expect(await db.taskEvent.count({ where: { taskId: task.id } })).toBe(1);
    await expect(
      savePostLink(wid, task.id, { ...input, operationId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      savePostLink("other-workspace", task.id, input),
    ).rejects.toThrow();
    await expect(
      savePostLink(wid, task.id, {
        ...input,
        resultUrl: "https://evil.test/x",
      }),
    ).rejects.toThrow();
  });
  it("late desktop link results never overwrite user edits or change publication", async () => {
    const task = await source();
    const runId = randomUUID();
    await db.task.update({
      where: { id: task.id },
      data: {
        resultUrl: null,
        desktopDeviceId: paired.deviceId,
        desktopRunId: runId,
      },
    });
    await saveDesktopPostLink(paired.deviceId, wid, task.id, {
      runId,
      resultUrl: url("captured"),
    });
    let row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    await savePostLink(wid, task.id, {
      resultUrl: url("manual"),
      version: row.version,
      operationId: randomUUID(),
    });
    expect(
      await saveDesktopPostLink(paired.deviceId, wid, task.id, {
        runId,
        resultUrl: url("late"),
      }),
    ).toMatchObject({ stale: true });
    row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.resultUrl).toBe(url("manual"));
    expect(row.recordedAt).toEqual(task.recordedAt);
  });
  it("records missing-link diagnostics once without changing the publication or blocking later valid evidence", async () => {
    const task = await source();
    const runId = randomUUID();
    await db.task.update({
      where: { id: task.id },
      data: {
        resultUrl: null,
        desktopDeviceId: paired.deviceId,
        desktopRunId: runId,
      },
    });
    for (let i = 0; i < 2; i++)
      expect(
        (
          await desktopApi(
            new NextRequest(
              `http://localhost:3000/api/desktop/tasks/${task.id}/link`,
              {
                method: "POST",
                headers: {
                  authorization: `Bearer ${paired.token}`,
                  "content-type": "application/json",
                },
                body: JSON.stringify({ runId, reason: "NOT_FOUND" }),
              },
            ),
            { params: Promise.resolve({ path: ["tasks", task.id, "link"] }) },
          )
        ).status,
      ).toBe(200);
    let row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.status).toBe("PUBLISHED");
    expect(row.recordedAt).toEqual(task.recordedAt);
    expect(row.version).toBe(task.version);
    expect(await db.taskEvent.count({ where: { taskId: task.id } })).toBe(1);
    await saveDesktopPostLink(paired.deviceId, wid, task.id, {
      runId,
      resultUrl: url("late-evidence"),
    });
    row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.resultUrl).toBe(url("late-evidence"));
    expect(row.recordedAt).toEqual(task.recordedAt);
    expect(
      await saveDesktopPostLink(paired.deviceId, wid, task.id, {
        runId: randomUUID(),
        reason: "INTERRUPTED",
      }),
    ).toMatchObject({ stale: true });
  });
  it("uses UTC+7 recorded date, excludes pending posts and sorts newest first", async () => {
    await source("before", new Date("2026-11-03T16:59:59Z"));
    const first = await source("first", new Date("2026-11-03T17:00:00Z"));
    const last = await source("last", new Date("2026-11-04T16:59:59Z"));
    await source("after", new Date("2026-11-04T17:00:00Z"));
    await source("pending", new Date("2026-11-04T01:00:00Z"), "PENDING_REVIEW");
    const list = await publishedPosts(
      wid,
      new URLSearchParams({ date: "2026-11-04", accountId: accountA }),
    );
    expect(list.items.map((t) => t.id)).toEqual([last.id, first.id]);
    expect(
      (
        await publishedPosts(
          wid,
          new URLSearchParams({ date: "2026-11-04", accountId: accountB }),
        )
      ).total,
    ).toBe(0);
    await expect(
      publishedPosts(wid, new URLSearchParams({ date: "2026-02-30" })),
    ).rejects.toThrow();
  });
  it("keeps old jobs manual, requires a different actor and a published source for automation", async () => {
    const manual = await createInteraction(
      wid,
      interactionSchema.parse({
        accountId: accountB,
        postUrl: url("manual"),
        kind: "BUMP",
        scheduledAt: new Date().toISOString(),
      }),
    );
    expect(manual.executionMode).toBe("MANUAL");
    const task = await source();
    const input = {
      accountId: accountA,
      sourceTaskId: task.id,
      executionMode: "AUTOMATIC",
      postUrl: task.resultUrl,
      kind: "BUMP",
      scheduledAt: new Date().toISOString(),
    };
    await expect(
      createInteraction(wid, interactionSchema.parse(input)),
    ).rejects.toThrow();
    await db.task.update({
      where: { id: task.id },
      data: { status: "PENDING_REVIEW" },
    });
    await expect(
      createInteraction(
        wid,
        interactionSchema.parse({ ...input, accountId: accountB }),
      ),
    ).rejects.toThrow();
  });
  it("requires independent opt-in and preserves the posting consent", async () => {
    const row = await job();
    await expect(
      interactionAction(wid, row.id, { action: "approve", note: "" }),
    ).rejects.toThrow();
    const connection = await db.facebookConnection.findUniqueOrThrow({
      where: { accountId: accountB },
    });
    expect(connection.interactionEnabled).toBe(false);
    expect(connection.interactionDailyLimit).toBe(10);
    expect(connection.interactionIntervalMinutes).toBe(5);
    await updateInteractionSettings(wid, accountB, {
      enabled: true,
      dailyLimit: 8,
      intervalMinutes: 6,
    });
    expect(
      (
        await db.facebookConnection.findUniqueOrThrow({
          where: { accountId: accountB },
        })
      ).automationEnabled,
    ).toBe(false);
    await interactionAction(wid, row.id, { action: "approve", note: "" });
  });
  it("old runners get no interaction; concurrent claims return only one job and hold the device", async () => {
    await approved();
    expect(
      await desktop.claimDesktopWork(paired.deviceId, wid, instanceId),
    ).toBeNull();
    const results = await Promise.all([
      desktop.claimDesktopWork(paired.deviceId, wid, instanceId, true),
      desktop.claimDesktopWork(paired.deviceId, wid, instanceId, true),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(
      await desktop.claimDesktopWork(paired.deviceId, wid, instanceId, true),
    ).toBeNull();
  });
  it("freezes links during jobs and enforces canonical uniqueness after completion or skipping", async () => {
    const row = await approved();
    const task = await db.task.findUniqueOrThrow({
      where: { id: row.sourceTaskId! },
    });
    await expect(
      savePostLink(wid, task.id, {
        resultUrl: url("changed"),
        version: task.version,
        operationId: randomUUID(),
      }),
    ).rejects.toThrow();
    await interactionAction(wid, row.id, { action: "skip", note: "" });
    await savePostLink(wid, task.id, {
      resultUrl: url("changed"),
      version: task.version,
      operationId: randomUUID(),
    });
    await expect(
      createInteraction(
        wid,
        interactionSchema.parse({
          accountId: accountA,
          postUrl: row.postUrl
            .replace("www.", "m.")
            .replace("/posts/", "/permalink/"),
          kind: "BUMP",
          scheduledAt: new Date().toISOString(),
        }),
      ),
    ).rejects.toThrow();
    await expect(
      createInteraction(
        wid,
        interactionSchema.parse({
          accountId: accountB,
          sourceTaskId: task.id,
          executionMode: "AUTOMATIC",
          postUrl: url("changed"),
          kind: "BUMP",
          scheduledAt: new Date().toISOString(),
        }),
      ),
    ).rejects.toThrow();
  });
  it("limits safe retries to three attempts with 1 and 3 minute backoff and ignores duplicate results", async () => {
    const row = await approved();
    for (let i = 1; i <= 3; i++) {
      const work = await claim();
      const before = Date.now();
      await finish(work);
      const state = await db.interaction.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(state.attempts).toBe(i);
      expect(state.status).toBe(i < 3 ? "RETRY_WAIT" : "FAILED");
      if (i < 3)
        expect(state.nextAttemptAt!.getTime() - before).toBeGreaterThanOrEqual(
          i === 1 ? 60000 : 180000,
        );
      await finish(work);
      expect(
        (await db.interaction.findUniqueOrThrow({ where: { id: row.id } }))
          .version,
      ).toBe(state.version);
      expect(
        await desktop.claimDesktopWork(paired.deviceId, wid, instanceId, true),
      ).toBeNull();
      if (i < 3) await elapsePacing(row.id, true);
    }
    expect(
      await db.interactionEvent.count({ where: { interactionId: row.id } }),
    ).toBe(7);
  });
  it("does not let retry waits hide later due interactions", async () => {
    await approved();
    const first = await claim();
    await finish(first);
    const next = await approved();
    await db.facebookConnection.update({
      where: { accountId: accountB },
      data: { interactionIntervalMinutes: 0 },
    });
    await elapsePacing(first.id);
    expect((await claim()).id).toBe(next.id);
  });
  it("rejects success before authorization, target changes, expired runs and revoked consent", async () => {
    await approved();
    const work = await claim();
    await expect(finish(work, "COMPLETED")).rejects.toThrow();
    await expect(
      armInteraction(paired.deviceId, wid, work.id, work.runId, url("wrong")),
    ).rejects.toThrow();
    await db.interaction.update({
      where: { id: work.id },
      data: { startedAt: new Date(Date.now() - 241000) },
    });
    await expect(
      armInteraction(paired.deviceId, wid, work.id, work.runId, work.targetUrl),
    ).rejects.toThrow();
    await db.interaction.update({
      where: { id: work.id },
      data: { startedAt: new Date() },
    });
    await updateInteractionSettings(wid, accountB, {
      enabled: false,
      dailyLimit: 10,
      intervalMinutes: 5,
    });
    await expect(
      armInteraction(paired.deviceId, wid, work.id, work.runId, work.targetUrl),
    ).rejects.toThrow();
  });
  it("lost authorization responses require review without disabling posting", async () => {
    await approved();
    const work = await claim();
    await db.facebookConnection.update({
      where: { accountId: accountB },
      data: { automationEnabled: true },
    });
    await armInteraction(
      paired.deviceId,
      wid,
      work.id,
      work.runId,
      work.targetUrl,
    );
    await finish(work);
    expect(
      (await db.interaction.findUniqueOrThrow({ where: { id: work.id } }))
        .status,
    ).toBe("NEEDS_REVIEW");
    expect(
      (
        await db.facebookConnection.findUniqueOrThrow({
          where: { accountId: accountB },
        })
      ).automationEnabled,
    ).toBe(true);
    expect(
      await desktop.claimDesktopWork(paired.deviceId, wid, instanceId, true),
    ).toBeNull();
    const task = await source();
    await db.task.update({
      where: { id: task.id },
      data: {
        accountId: accountB,
        executionMode: "AUTOMATIC",
        status: "READY",
        startedAt: null,
      },
    });
    expect(
      (await desktop.claimDesktopWork(paired.deviceId, wid, instanceId, true))
        ?.type,
    ).toBe("POST");
  });
  it("recovers interrupted preparation safely but never reruns a submission", async () => {
    await approved();
    const work = await claim();
    await db.interaction.update({
      where: { id: work.id },
      data: { leaseAt: new Date(Date.now() - 301000) },
    });
    await workspaceTransaction(wid, (tx) =>
      recoverInteractions(tx, wid, new Date()),
    );
    expect(
      (await db.interaction.findUniqueOrThrow({ where: { id: work.id } }))
        .status,
    ).toBe("RETRY_WAIT");
    await elapsePacing(work.id, true);
    const second = await claim();
    expect(second.runId).not.toBe(work.runId);
    await expect(
      armInteraction(paired.deviceId, wid, work.id, work.runId, work.targetUrl),
    ).rejects.toThrow();
    expect(await finish(work)).toMatchObject({ stale: true });
    await armInteraction(
      paired.deviceId,
      wid,
      second.id,
      second.runId,
      second.targetUrl,
    );
    await db.interaction.update({
      where: { id: second.id },
      data: { leaseAt: new Date(Date.now() - 301000) },
    });
    await workspaceTransaction(wid, (tx) =>
      recoverInteractions(tx, wid, new Date()),
    );
    expect(
      (await db.interaction.findUniqueOrThrow({ where: { id: second.id } }))
        .status,
    ).toBe("NEEDS_REVIEW");
  });
  it("applies the quiet-hour toggle to interaction claims and final authorization", async () => {
    await approved();
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date()),
    );
    await db.facebookAccount.update({
      where: { id: accountB },
      data: {
        quietHoursEnabled: true,
        quietStart: hour,
        quietEnd: (hour + 1) % 24,
      },
    });
    expect(
      await desktop.claimDesktopWork(paired.deviceId, wid, instanceId, true),
    ).toBeNull();
    await setAccountQuietHours(wid, accountB, false);
    const work = await claim();
    await setAccountQuietHours(wid, accountB, true);
    await expect(
      armInteraction(paired.deviceId, wid, work.id, work.runId, work.targetUrl),
    ).rejects.toThrow("giờ nghỉ");
    await setAccountQuietHours(wid, accountB, false);
    await armInteraction(
      paired.deviceId,
      wid,
      work.id,
      work.runId,
      work.targetUrl,
    );
  });
  it("prioritizes due posts and maintains independent daily, interval and quiet-hour limits", async () => {
    const row = await approved();
    const task = await source();
    await db.facebookConnection.update({
      where: { accountId: accountA },
      data: { automationEnabled: true },
    });
    await db.task.update({
      where: { id: task.id },
      data: { status: "READY", executionMode: "AUTOMATIC" },
    });
    const work = await desktop.claimDesktopWork(
      paired.deviceId,
      wid,
      instanceId,
      true,
    );
    expect(work?.type).toBe("POST");
    await db.task.update({
      where: { id: task.id },
      data: { status: "SKIPPED" },
    });
    const interaction = await claim();
    await armInteraction(
      paired.deviceId,
      wid,
      interaction.id,
      interaction.runId,
      interaction.targetUrl,
    );
    await finish(interaction, "COMPLETED", true);
    await approved();
    expect(
      await desktop.claimDesktopWork(paired.deviceId, wid, instanceId, true),
    ).toBeNull();
    await db.facebookConnection.update({
      where: { accountId: accountB },
      data: { interactionDailyLimit: 1, interactionIntervalMinutes: 0 },
    });
    expect(
      await desktop.claimDesktopWork(paired.deviceId, wid, instanceId, true),
    ).toBeNull();
    await db.facebookConnection.update({
      where: { accountId: accountB },
      data: { interactionDailyLimit: 10 },
    });
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date()),
    );
    await db.facebookAccount.update({
      where: { id: accountB },
      data: {
        quietHoursEnabled: true,
        quietStart: hour,
        quietEnd: (hour + 1) % 24,
      },
    });
    expect(
      await desktop.claimDesktopWork(paired.deviceId, wid, instanceId, true),
    ).toBeNull();
    expect(
      (await db.interaction.findUniqueOrThrow({ where: { id: row.id } }))
        .status,
    ).toBe("COMPLETED");
  });
});
