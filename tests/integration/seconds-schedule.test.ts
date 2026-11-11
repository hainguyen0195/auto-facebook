import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/lib/db";
import { createAuth } from "../../src/lib/auth";
import { accountSchema, scheduleSchema } from "../../src/lib/schemas";
import {
  createSchedule,
  getTask,
  previewSchedule,
  saveAccount,
} from "../../src/lib/service";
import * as desktop from "../../src/lib/desktop";
import { dayBounds } from "../../src/lib/utils";
import { withAutomaticWait } from "../../src/lib/task-waits";

let ownerId: string,
  wid: string,
  accountId: string,
  postId: string,
  deviceId: string;
let groupIds: string[];
const instanceId = randomUUID();
const url = `https://www.facebook.com/seconds.${randomUUID()}`;
const accountInput = (minutes: number) =>
  accountSchema.parse({
    name: "Seconds fixture",
    profileName: "Seconds",
    url,
    quietHoursEnabled: false,
    dailyLimit: 50,
    postIntervalMinutes: minutes,
  });
const input = (minutes: number, groups: (string | null)[] = groupIds) =>
  scheduleSchema.parse({
    executionMode: "AUTOMATIC",
    postId,
    scheduledAt: new Date().toISOString(),
    intervalMinutes: minutes,
    targets: groups.map((groupId) => ({ accountId, groupId })),
    acknowledgeWarnings: true,
    idempotencyKey: randomUUID(),
  });
beforeAll(async () => {
  const created = await createAuth(true).api.signUpEmail({
    body: {
      name: "Seconds test",
      email: `seconds-${randomUUID()}@tests.nhipdang.local`,
      password: randomUUID() + randomUUID(),
    },
  });
  ownerId = created.user.id;
  wid = (await db.workspace.findUniqueOrThrow({ where: { ownerId } })).id;
  accountId = (await saveAccount(wid, accountInput(0.25))).id;
  postId = (
    await db.post.create({
      data: { workspaceId: wid, title: "Seconds", content: "Seconds fixture" },
    })
  ).id;
  groupIds = [];
  for (let i = 0; i < 3; i++) {
    const group = await db.group.create({
      data: {
        workspaceId: wid,
        name: `Seconds ${i}`,
        url: `https://www.facebook.com/groups/seconds.${randomUUID()}`,
        minIntervalMinutes: 5,
        memberships: { create: { accountId } },
      },
    });
    groupIds.push(group.id);
  }
  deviceId = (
    await desktop.pairDesktop(
      (await desktop.createPairing(wid)).code,
      "Seconds fixture",
    )
  ).deviceId;
  await desktop.heartbeat(deviceId, wid, instanceId, true);
  await db.facebookConnection.create({
    data: {
      workspaceId: wid,
      accountId,
      deviceId,
      state: "READY",
      automationEnabled: true,
      identityHash: "a".repeat(64),
      confirmedIdentityHash: "a".repeat(64),
    },
  });
});
beforeEach(async () => {
  await db.task.deleteMany({ where: { workspaceId: wid } });
  await saveAccount(wid, accountInput(0.25), accountId);
  await desktop.heartbeat(deviceId, wid, instanceId, true);
});
afterAll(async () => {
  if (ownerId) await db.user.delete({ where: { id: ownerId } });
  await db.$disconnect();
});

describe("second-level scheduling and account intervals", () => {
  it.each([0.25, 0.5, 0.75])(
    "persists and previews exact %s-minute gaps",
    async (minutes) => {
      expect(
        (await saveAccount(wid, accountInput(minutes), accountId))
          .postIntervalMinutes,
      ).toBe(minutes);
      const payload = input(minutes);
      const preview = await previewSchedule(wid, payload);
      expect(preview.warnings).toEqual([]);
      const campaign = await createSchedule(wid, payload);
      const tasks = await db.task.findMany({
        where: { campaignId: campaign.id },
        orderBy: { scheduledAt: "asc" },
      });
      expect(tasks.map((t) => t.scheduledAt)).toEqual(
        preview.targets.map((t) => t.scheduledAt),
      );
      expect(
        tasks.map(
          (t) => t.scheduledAt.getTime() - tasks[0].scheduledAt.getTime(),
        ),
      ).toEqual([0, minutes * 60_000, minutes * 120_000]);
      expect((await createSchedule(wid, payload)).reused).toBe(true);
    },
  );
  it("warns when the account minimum exceeds the requested schedule gap", async () => {
    await saveAccount(wid, accountInput(1), accountId);
    const preview = await previewSchedule(wid, input(0.25));
    expect(preview.warnings.filter((w) => w.code === "INTERVAL")).toHaveLength(
      2,
    );
    expect(preview.warnings[0].message).toContain("15 giây");
    expect(preview.warnings[0].message).toContain("1 phút");
  });
  it("enforces the 15-second floor at claim and rechecks it before submitting", async () => {
    const earlier = await createSchedule(wid, input(0, [null]));
    await db.task.updateMany({
      where: { campaignId: earlier.id },
      data: { status: "PUBLISHED", startedAt: new Date() },
    });
    const pending = await createSchedule(wid, input(0, [groupIds[0]]));
    const task = await db.task.findFirstOrThrow({
      where: { campaignId: pending.id },
    });
    expect((await getTask(wid, task.id)).automaticWait).toMatchObject({
      reason: "ACCOUNT_INTERVAL",
      minutes: 0.25,
    });
    expect(
      await desktop.claimDesktopWork(deviceId, wid, instanceId),
    ).toBeNull();
    await db.task.updateMany({
      where: { campaignId: earlier.id },
      data: { startedAt: new Date(Date.now() - 16_000) },
    });
    const work = await desktop.claimDesktopWork(deviceId, wid, instanceId);
    expect(work?.id).toBe(task.id);
    if (work?.type !== "POST") throw new Error("Expected a posting task");
    await saveAccount(wid, accountInput(0.5), accountId);
    await expect(
      desktop.armDesktopPost(
        deviceId,
        wid,
        task.id,
        work.runId,
        work.targetUrl,
      ),
    ).rejects.toThrow("khoảng cách");
    await saveAccount(wid, accountInput(0.25), accountId);
    await desktop.armDesktopPost(
      deviceId,
      wid,
      task.id,
      work.runId,
      work.targetUrl,
    );
  });
  it("explains the daily cap and clears the hold on the next local day", async () => {
    await db.facebookAccount.update({
      where: { id: accountId },
      data: { dailyLimit: 1 },
    });
    const earlier = await createSchedule(wid, input(0, [null]));
    await db.task.updateMany({
      where: { campaignId: earlier.id },
      data: { status: "PUBLISHED", startedAt: new Date() },
    });
    const pending = await createSchedule(wid, input(0, [groupIds[0]]));
    const task = await db.task.findFirstOrThrow({
      where: { campaignId: pending.id },
      include: { account: true, group: true },
    });
    expect((await getTask(wid, task.id)).automaticHold).toContain("1/1");
    expect(
      await desktop.claimDesktopWork(deviceId, wid, instanceId),
    ).toBeNull();
    const tomorrow = dayBounds().end;
    expect(
      (await withAutomaticWait(db, wid, [task], tomorrow))[0].automaticHold,
    ).toBeNull();
    await db.task.updateMany({
      where: { campaignId: earlier.id },
      data: { status: "SKIPPED" },
    });
    expect((await getTask(wid, task.id)).automaticHold).toBeNull();
  });
  it("does not count the current retry against its own daily allowance", async () => {
    await db.facebookAccount.update({
      where: { id: accountId },
      data: { dailyLimit: 1 },
    });
    const campaign = await createSchedule(wid, input(0, [null]));
    const task = await db.task.findFirstOrThrow({
      where: { campaignId: campaign.id },
    });
    await db.task.update({
      where: { id: task.id },
      data: {
        startedAt: new Date(),
        automaticAttempts: 1,
        nextAttemptAt: null,
      },
    });
    expect((await getTask(wid, task.id)).automaticHold).toBeNull();
    expect(
      (await desktop.claimDesktopWork(deviceId, wid, instanceId))?.id,
    ).toBe(task.id);
  });
});
