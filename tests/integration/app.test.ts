import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { db } from "../../src/lib/db";
import { createAuth } from "../../src/lib/auth";
import { GET, POST, PATCH, DELETE } from "../../src/app/api/v1/[...path]/route";
import { POST as authPost } from "../../src/app/api/auth/[...all]/route";
import { scanReminders } from "../../src/lib/scheduler";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { mkdir, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import {
  backupLocal,
  pgArguments,
  postgresTools,
} from "../../scripts/backup-local";
import type {
  AccountRow,
  AssetRow,
  GroupRow,
  PostRow,
  TaskRow,
  DashboardData,
} from "../../src/lib/client";
import { dateKey, dayBounds } from "../../src/lib/utils";
import type { TaskStatus } from "@prisma/client";

const origin = "http://localhost:3000";
const password = "Integration-only-Password-2026!";
const run = randomUUID().slice(0, 8);
let cookieA = "",
  cookieB = "",
  workspaceA = "",
  workspaceB = "";
let account: AccountRow, group: GroupRow, post: PostRow, asset: AssetRow;
let approvalTask: TaskRow, restrictedTask: TaskRow;
const accountBody = {
  name: "Tài khoản A",
  url: "https://facebook.com/test.a",
  profileName: "Chrome A",
  dailyLimit: 10,
  quietStart: 0,
  quietEnd: 0,
  color: "teal",
  note: "",
  status: "ACTIVE",
};
const handlers = { GET, POST, PATCH, DELETE };
describe("daily progress details", () => {
  it("explains every status, bounds remaining previews and filters the same scheduled day", async () => {
    const before = await ok<DashboardData>("GET", "dashboard");
    const { start, end } = dayBounds();
    const scheduledAt = new Date(start.getTime() + 3600_000);
    const localPost = await ok<PostRow>("POST", "posts", {
      title: `Progress ${randomUUID()}`,
      content: "Never load full content in progress previews",
      assetIds: [],
    });
    const foreignPost = await ok<PostRow>(
      "POST",
      "posts",
      {
        title: localPost.title,
        content: "Other workspace",
        assetIds: [],
      },
      cookieB,
    );
    const fixtures = [];
    for (const [workspaceId, fixturePost, cookie] of [
      [workspaceA, localPost, cookieA],
      [workspaceB, foreignPost, cookieB],
    ] as const) {
      const account = await ok<AccountRow>(
        "POST",
        "accounts",
        accountBody,
        cookie,
      );
      const campaign = await db.campaign.create({
        data: {
          workspaceId,
          postId: fixturePost.id,
          idempotencyKey: randomUUID(),
          requestHash: randomUUID(),
        },
      });
      fixtures.push({ account, postId: fixturePost.id, campaign });
      const states: TaskStatus[] = [
        "SCHEDULED",
        "READY",
        "IN_PROGRESS",
        "BLOCKED",
        "PUBLISHED",
        "PENDING_REVIEW",
        "SKIPPED",
        "CANCELLED",
        "SCHEDULED",
        "SCHEDULED",
        "SCHEDULED",
        "BLOCKED",
        "BLOCKED",
      ];
      await db.task.createMany({
        data: states.map((status, index) => ({
          workspaceId,
          postId: fixturePost.id,
          campaignId: campaign.id,
          accountId: account.id,
          destinationKey: `progress:${index}`,
          titleSnapshot: fixturePost.title,
          contentSnapshot: fixturePost.content,
          contentHash: randomUUID(),
          status,
          scheduledAt: index === 12 ? end : scheduledAt,
          archivedAt: index === 11 ? new Date() : null,
        })),
      });
    }
    try {
      const result = await ok<DashboardData>("GET", "dashboard");
      const p = result.progress;
      expect(p.date).toBe(dateKey(start));
      expect(p.total).toBe(before.progress.total + 11);
      expect(p.handled).toBe(before.progress.handled + 4);
      expect(p.pending).toBe(before.progress.pending + 1);
      expect(Object.values(p.byStatus).reduce((sum, n) => sum + n, 0)).toBe(
        p.total,
      );
      for (const status of [
        "SCHEDULED",
        "READY",
        "IN_PROGRESS",
        "BLOCKED",
        "PUBLISHED",
        "PENDING_REVIEW",
        "SKIPPED",
        "CANCELLED",
      ] as const)
        expect(p.byStatus[status]).toBe(
          before.progress.byStatus[status] + (status === "SCHEDULED" ? 4 : 1),
        );
      expect(p.remainingTasks).toHaveLength(6);
      expect(p.remainingTasks[0].status).toBe("BLOCKED");
      for (const task of p.remainingTasks) {
        expect(["SCHEDULED", "READY", "IN_PROGRESS", "BLOCKED"]).toContain(
          task.status,
        );
        expect(task).not.toHaveProperty("contentSnapshot");
        expect(
          task.scheduledAt >= start.toISOString() &&
            task.scheduledAt < end.toISOString(),
        ).toBe(true);
        expect(task.account.name).toBeTruthy();
      }
      const params = new URLSearchParams({
        remaining: "true",
        start: start.toISOString(),
        end: end.toISOString(),
        q: localPost.title,
      });
      const remaining = await ok<{ total: number; items: TaskRow[] }>(
        "GET",
        `tasks?${params}`,
      );
      expect(remaining.total).toBe(7);
      expect(
        remaining.items.every((t) =>
          ["SCHEDULED", "READY", "IN_PROGRESS", "BLOCKED"].includes(t.status),
        ),
      ).toBe(true);
      expect(
        (await ok<{ total: number }>("GET", `calendar?${params}`)).total,
      ).toBe(7);
      expect(
        (await ok<{ total: number }>("GET", `tasks?${params}&history=true`))
          .total,
      ).toBe(8);
      expect(
        (await ok<{ total: number }>("GET", `tasks?${params}&status=PUBLISHED`))
          .total,
      ).toBe(0);
    } finally {
      const ids = fixtures.map((f) => f.postId);
      await db.task.deleteMany({ where: { postId: { in: ids } } });
      await db.campaign.deleteMany({ where: { postId: { in: ids } } });
      await db.post.deleteMany({ where: { id: { in: ids } } });
      await db.facebookAccount.deleteMany({
        where: { id: { in: fixtures.map((f) => f.account.id) } },
      });
    }
  });
});
describe("post library schedule summaries", () => {
  it("retains account history, reconciles every status and scopes paginated destinations to the post", async () => {
    const title = `Schedule summary ${randomUUID()}`;
    const localPost = await ok<PostRow>("POST", "posts", {
      title,
      content: "Summary fixture",
      assetIds: [],
    });
    const accounts: AccountRow[] = [];
    for (const name of ["An", "Bình"])
      accounts.push(
        await ok<AccountRow>("POST", "accounts", {
          ...accountBody,
          name: `${name} ${title}`,
        }),
      );
    const campaign = await db.campaign.create({
      data: {
        workspaceId: workspaceA,
        postId: localPost.id,
        idempotencyKey: randomUUID(),
        requestHash: randomUUID(),
      },
    });
    const states: TaskStatus[] = [
      "SCHEDULED",
      "READY",
      "IN_PROGRESS",
      "BLOCKED",
      "PUBLISHED",
      "PENDING_REVIEW",
      "SKIPPED",
      "CANCELLED",
      "SCHEDULED",
    ];
    await db.task.createMany({
      data: states
        .map((status, index) => ({
          workspaceId: workspaceA,
          campaignId: campaign.id,
          postId: localPost.id,
          accountId: accounts[0].id,
          destinationKey: `summary:${index}`,
          titleSnapshot: title,
          contentSnapshot: "Snapshot should not be loaded",
          contentHash: randomUUID(),
          scheduledAt: new Date(),
          status,
          archivedAt: index === 8 ? new Date() : null,
        }))
        .concat([
          {
            workspaceId: workspaceA,
            campaignId: campaign.id,
            postId: localPost.id,
            accountId: accounts[1].id,
            destinationKey: "summary:second",
            titleSnapshot: title,
            contentSnapshot: "Snapshot should not be loaded",
            contentHash: randomUUID(),
            scheduledAt: new Date(),
            status: "SCHEDULED",
            archivedAt: null,
          },
        ]),
    });
    const foreignPost = await ok<PostRow>(
      "POST",
      "posts",
      {
        title,
        content: "Other workspace",
        assetIds: [],
      },
      cookieB,
    );
    const query = `posts?q=${encodeURIComponent(title)}`;
    const own = await ok<{ items: PostRow[]; total: number }>("GET", query);
    expect(own.total).toBe(1);
    expect(own.items[0].scheduledAccounts).toMatchObject(
      accounts.map((a, index) => ({
        id: a.id,
        name: a.name,
        color: a.color,
        taskCount: index ? 1 : 9,
        archivedCount: index ? 0 : 1,
        archivedUnfinishedCount: index ? 0 : 1,
      })),
    );
    expect(own.items[0]._count.tasks).toBe(10);
    for (const a of own.items[0].scheduledAccounts!)
      expect(
        Object.values(a.byStatus).reduce((sum, n) => sum + n, 0) +
          a.archivedUnfinishedCount,
      ).toBe(a.taskCount);
    expect(own.items[0].scheduledAccounts![0].byStatus).toEqual({
      SCHEDULED: 1,
      READY: 1,
      IN_PROGRESS: 1,
      BLOCKED: 1,
      PUBLISHED: 1,
      PENDING_REVIEW: 1,
      SKIPPED: 1,
      CANCELLED: 1,
    });
    const details = `posts/${localPost.id}/schedules?accountId=${accounts[0].id}`;
    const allDetails = await ok<{
      total: number;
      items: Record<string, unknown>[];
    }>("GET", details);
    expect(allDetails.total).toBe(9);
    expect(
      allDetails.items.every((row) => row.accountId === accounts[0].id),
    ).toBe(true);
    expect(allDetails.items.some((row) => row.archivedAt)).toBe(true);
    expect(allDetails.items[0]).not.toHaveProperty("contentSnapshot");
    expect(
      (await ok<{ total: number }>("GET", details + "&status=SCHEDULED")).total,
    ).toBe(1);
    expect(
      (
        await ok<{ total: number; items: unknown[] }>(
          "GET",
          details + "&size=3&page=2",
        )
      ).items,
    ).toHaveLength(3);
    expect((await call("GET", details, undefined, cookieB)).status).toBe(404);
    expect((await call("GET", details + "&status=INVALID")).status).toBe(400);
    const foreign = await ok<{ items: PostRow[] }>(
      "GET",
      query,
      undefined,
      cookieB,
    );
    expect(foreign.items.map((p) => p.id)).toEqual([foreignPost.id]);
    expect(foreign.items[0].scheduledAccounts).toEqual([]);
    const renamed = "Đổi tên tài khoản";
    await db.facebookAccount.update({
      where: { id: accounts[0].id },
      data: { name: renamed },
    });
    expect(
      (await ok<{ items: PostRow[] }>("GET", query)).items[0].scheduledAccounts,
    ).toContainEqual(
      expect.objectContaining({
        id: accounts[0].id,
        name: renamed,
        color: accounts[0].color,
        taskCount: 9,
      }),
    );
    await db.task.updateMany({
      where: { postId: localPost.id },
      data: { status: "CANCELLED" },
    });
    const cancelled = (await ok<{ items: PostRow[] }>("GET", query)).items[0];
    expect(cancelled.scheduledAccounts).toHaveLength(2);
    expect(
      cancelled.scheduledAccounts?.map((a) => a.byStatus.CANCELLED).sort(),
    ).toEqual([1, 9]);
    expect(
      cancelled.scheduledAccounts?.every(
        (a) => a.archivedUnfinishedCount === 0,
      ),
    ).toBe(true);
    expect(
      (await ok<{ items: PostRow[] }>("GET", `posts?q=${randomUUID()}`)).items,
    ).toEqual([]);
  });
});
async function call(
  method: keyof typeof handlers,
  route: string,
  body?: unknown,
  cookie = cookieA,
  requestOrigin = origin,
) {
  const request = new NextRequest(`${origin}/api/v1/${route}`, {
    method,
    headers: {
      cookie,
      origin: requestOrigin,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return handlers[method](request, {
    params: Promise.resolve({ path: route.split("?")[0].split("/") }),
  });
}
async function ok<T>(
  method: keyof typeof handlers,
  route: string,
  body?: unknown,
  cookie = cookieA,
): Promise<T> {
  const response = await call(method, route, body, cookie);
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      `${method} ${route}: ${response.status} ${JSON.stringify(data)}`,
    );
  return data as T;
}
beforeAll(async () => {
  const auth = createAuth(true);
  for (const name of ["A", "B"]) {
    const email = `${run}-${name.toLowerCase()}@tests.nhipdang.local`;
    const result = await auth.api.signUpEmail({
      body: { email, name: `Test ${name}`, password },
    });
    const response = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const workspace = await db.workspace.findUniqueOrThrow({
      where: { ownerId: result.user.id },
    });
    if (name === "A") {
      cookieA = cookie;
      workspaceA = workspace.id;
    } else {
      cookieB = cookie;
      workspaceB = workspace.id;
    }
  }
});
afterAll(async () => {
  const ids = [workspaceA, workspaceB].filter(Boolean);
  await db.task.deleteMany({ where: { workspaceId: { in: ids } } });
  await db.postAsset.deleteMany({
    where: { post: { workspaceId: { in: ids } } },
  });
  await db.user.deleteMany({
    where: {
      email: { startsWith: run + "-", endsWith: "@tests.nhipdang.local" },
    },
  });
  await db.$disconnect();
});
describe("authentication and workspace isolation", () => {
  it("requires a real session and rejects cross-site writes", async () => {
    expect((await call("GET", "accounts", undefined, "")).status).toBe(401);
    expect(
      (
        await call(
          "POST",
          "accounts",
          accountBody,
          cookieA,
          "https://evil.test",
        )
      ).status,
    ).toBe(403);
  });
  it("disables public sign-up", async () => {
    const response = await authPost(
      new NextRequest(`${origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Public",
          email: "public@tests.nhipdang.local",
          password,
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe(
      "EMAIL_PASSWORD_SIGN_UP_DISABLED",
    );
  });
  it("creates data with account-group links scoped to the owner", async () => {
    account = await ok<AccountRow>("POST", "accounts", accountBody);
    group = await ok<GroupRow>("POST", "groups", {
      name: "Chợ nhà mình",
      url: "https://m.facebook.com/groups/test.integration/?ref=share",
      tags: ["Đồ nhà"],
      rules: "Ghi rõ giá.",
      minIntervalMinutes: 24,
      accountIds: [account.id],
    });
    expect(
      await ok<AccountRow[]>("GET", "accounts", undefined, cookieB),
    ).toHaveLength(0);
    expect(
      (await call("PATCH", `accounts/${account.id}`, accountBody, cookieB))
        .status,
    ).toBe(404);
    expect(
      (await call("DELETE", `groups/${group.id}`, undefined, cookieB)).status,
    ).toBe(404);
    expect(
      (
        await call(
          "POST",
          "groups",
          {
            name: "Foreign",
            url: "facebook.com/groups/foreign",
            accountIds: [account.id],
          },
          cookieB,
        )
      ).status,
    ).toBe(404);
  });
  it("toggles quiet hours without replacing account settings and isolates workspaces", async () => {
    const row = await ok<AccountRow>("POST", "accounts", {
      ...accountBody,
      name: "Quiet hours",
      profileName: "Quiet hours",
      quietStart: 20,
      quietEnd: 6,
      dailyLimit: 17,
      postIntervalMinutes: 9,
    });
    const route = `accounts/${row.id}/quiet-hours`;
    expect(
      (await call("PATCH", route, { enabled: false }, cookieB)).status,
    ).toBe(404);
    expect((await call("PATCH", route, { enabled: "false" })).status).toBe(400);
    expect(
      (
        await call(
          "PATCH",
          route,
          { enabled: false },
          cookieA,
          "https://evil.test",
        )
      ).status,
    ).toBe(403);
    const content = await ok<PostRow>("POST", "posts", {
      title: "Quiet preview",
      content: "Test quiet hours",
    });
    for (const enabled of [false, true]) {
      expect(await ok<AccountRow>("PATCH", route, { enabled })).toMatchObject({
        quietHoursEnabled: enabled,
        quietStart: 20,
        quietEnd: 6,
        name: row.name,
        status: row.status,
        dailyLimit: 17,
        postIntervalMinutes: 9,
      });
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + 1);
      date.setUTCHours(16, 0, 0, 0);
      const preview = await ok<{ warnings: { code: string }[] }>(
        "POST",
        "schedules/preview",
        {
          postId: content.id,
          scheduledAt: date.toISOString(),
          targets: [{ accountId: row.id, groupId: null }],
          idempotencyKey: randomUUID(),
        },
      );
      expect(
        preview.warnings.some((warning) => warning.code === "QUIET_HOUR"),
      ).toBe(enabled);
    }
    const legacy = await ok<AccountRow>("POST", "accounts", {
      ...accountBody,
      profileName: "Legacy",
    });
    expect(legacy.quietHoursEnabled).toBe(false);
    expect(
      await ok<AccountRow>("PATCH", `accounts/${legacy.id}/quiet-hours`, {
        enabled: true,
      }),
    ).toMatchObject({ quietHoursEnabled: true, quietStart: 22, quietEnd: 7 });
    await ok("DELETE", `accounts/${row.id}`);
    await ok("DELETE", `accounts/${legacy.id}`);
  });
  it("validates image bytes and protects both preview and download URLs", async () => {
    const bytes = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#147c70" },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array(bytes)], "ảnh sản phẩm.png", {
        type: "image/png",
      }),
    );
    const response = await POST(
      new NextRequest(`${origin}/api/v1/assets`, {
        method: "POST",
        headers: { cookie: cookieA, origin },
        body: form,
      }),
      { params: Promise.resolve({ path: ["assets"] }) },
    );
    expect(response.status).toBe(201);
    asset = await response.json();
    expect(
      (await call("GET", `assets/${asset.id}`, undefined, cookieB)).status,
    ).toBe(404);
    expect(
      (await call("GET", `assets/${asset.id}/download`, undefined, cookieB))
        .status,
    ).toBe(404);
    const own = await call("GET", `assets/${asset.id}/download`);
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toContain("no-store");
    expect((await own.arrayBuffer()).byteLength).toBeGreaterThan(20);
    const invalid = new FormData();
    invalid.append(
      "file",
      new File(["not an image"], "fake.jpg", { type: "image/jpeg" }),
    );
    expect(
      (
        await POST(
          new NextRequest(`${origin}/api/v1/assets`, {
            method: "POST",
            headers: { cookie: cookieA, origin },
            body: invalid,
          }),
          { params: Promise.resolve({ path: ["assets"] }) },
        )
      ).status,
    ).toBe(400);
  });
  it("cannot attach another workspace's image or edit its post", async () => {
    post = await ok<PostRow>("POST", "posts", {
      title: "Bài kiểm thử",
      content: "Cà phê mới về, giá 100.000đ.",
      tags: [],
      assetIds: [asset.id],
    });
    expect(
      (
        await call(
          "POST",
          "posts",
          { title: "Foreign", content: "No", assetIds: [asset.id] },
          cookieB,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          "PATCH",
          `posts/${post.id}`,
          { title: "Foreign", content: "No", version: post.version },
          cookieB,
        )
      ).status,
    ).toBe(404);
  });
});
describe("idempotent scheduling and manual outcomes", () => {
  it("creates one campaign under concurrent retries and preserves its snapshot", async () => {
    const body = {
      postId: post.id,
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
      intervalMinutes: 0,
      targets: [
        { accountId: account.id, groupId: null },
        { accountId: account.id, groupId: group.id },
      ],
      idempotencyKey: randomUUID(),
      acknowledgeWarnings: true,
    };
    const results = await Promise.all([
      ok<{ id: string }>("POST", "schedules", body),
      ok<{ id: string }>("POST", "schedules", body),
    ]);
    expect(results[0].id).toBe(results[1].id);
    const tasks = await db.task.findMany({
      where: { campaignId: results[0].id },
      include: { account: true, group: true },
    });
    expect(tasks).toHaveLength(2);
    approvalTask = tasks.find((t) => t.groupId)! as unknown as TaskRow;
    restrictedTask = tasks.find((t) => !t.groupId)! as unknown as TaskRow;
    expect(
      (await call("GET", `tasks/${restrictedTask.id}`, undefined, cookieB))
        .status,
    ).toBe(404);
    expect(
      (
        await call("POST", "schedules", {
          ...body,
          scheduledAt: new Date(Date.now() + 60000).toISOString(),
        })
      ).status,
    ).toBe(409);
    await ok("PATCH", `posts/${post.id}`, {
      title: "Đã sửa",
      content: "Nội dung mới",
      tags: [],
      assetIds: [],
      version: post.version,
    });
    const snapshot = await ok<TaskRow>("GET", `tasks/${restrictedTask.id}`);
    expect(snapshot.contentSnapshot).toBe(post.content);
    expect(snapshot.assetIds).toContain(asset.id);
    expect((await call("DELETE", `assets/${asset.id}`)).status).toBe(409);
  });
  it("requires starting, keeps approval separate, and records an operation only once", async () => {
    expect(
      (
        await call("PATCH", `tasks/${approvalTask.id}`, {
          action: "record",
          status: "PUBLISHED",
          operationId: randomUUID(),
          version: approvalTask.version,
        })
      ).status,
    ).toBe(409);
    const body = {
      action: "start",
      operationId: randomUUID(),
      version: approvalTask.version,
    };
    const first = await ok<TaskRow>("PATCH", `tasks/${approvalTask.id}`, body);
    await ok("PATCH", `tasks/${approvalTask.id}`, body);
    expect(await db.taskEvent.count({ where: { id: body.operationId } })).toBe(
      1,
    );
    approvalTask = await ok<TaskRow>("PATCH", `tasks/${approvalTask.id}`, {
      action: "record",
      status: "PENDING_REVIEW",
      operationId: randomUUID(),
      version: first.version,
    });
    const dashboard = await ok<{ pending: number; published: number }>(
      "GET",
      "dashboard",
    );
    expect(dashboard.pending).toBe(1);
    expect(dashboard.published).toBe(0);
  });
  it("pauses every unsubmitted task on restriction and requires an explicit account resume", async () => {
    restrictedTask = await ok<TaskRow>("PATCH", `tasks/${restrictedTask.id}`, {
      action: "start",
      operationId: randomUUID(),
      version: restrictedTask.version,
    });
    restrictedTask = await ok<TaskRow>("PATCH", `tasks/${restrictedTask.id}`, {
      action: "record",
      status: "BLOCKED",
      note: "Facebook báo hạn chế",
      operationId: randomUUID(),
      version: restrictedTask.version,
    });
    expect(
      (
        await db.facebookAccount.findUniqueOrThrow({
          where: { id: account.id },
        })
      ).status,
    ).toBe("RESTRICTED");
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: approvalTask.id } }))
        .status,
    ).toBe("PENDING_REVIEW");
    expect(
      (
        await call("PATCH", `tasks/${restrictedTask.id}`, {
          action: "start",
          operationId: randomUUID(),
          version: restrictedTask.version,
        })
      ).status,
    ).toBe(409);
    await ok("PATCH", `accounts/${account.id}`, accountBody);
    const resumed = await ok<TaskRow>("GET", `tasks/${restrictedTask.id}`);
    expect(resumed.status).toBe("READY");
    const input = {
      tasks: [{ id: resumed.id, version: resumed.version }],
      operationId: randomUUID(),
    };
    await ok("POST", "tasks/bulk-cancel", input);
    const replay = await ok<{ reused: boolean }>(
      "POST",
      "tasks/bulk-cancel",
      input,
    );
    expect(replay.reused).toBe(true);
  });
  it("updates pending approval without re-posting and protects final results", async () => {
    approvalTask = await ok<TaskRow>("PATCH", `tasks/${approvalTask.id}`, {
      action: "record",
      status: "PUBLISHED",
      note: "Đã kiểm tra",
      resultUrl: "https://facebook.com/test.a/posts/123",
      operationId: randomUUID(),
      version: approvalTask.version,
    });
    expect(approvalTask.status).toBe("PUBLISHED");
    expect(
      (
        await call("PATCH", `tasks/${approvalTask.id}`, {
          action: "start",
          operationId: randomUUID(),
          version: approvalTask.version,
        })
      ).status,
    ).toBe(409);
  });
  it("catches duplicate content across accounts in the same group", async () => {
    const second = await ok<AccountRow>("POST", "accounts", {
      ...accountBody,
      name: "A2",
      url: "facebook.com/test.a2",
    });
    await ok("PATCH", `groups/${group.id}`, {
      ...group,
      accountIds: [account.id, second.id],
    });
    const result = await ok<{ warnings: { code: string }[] }>(
      "POST",
      "schedules/preview",
      {
        postId: post.id,
        scheduledAt: new Date(Date.now() + 60000).toISOString(),
        intervalMinutes: 0,
        targets: [
          { accountId: account.id, groupId: group.id },
          { accountId: second.id, groupId: group.id },
        ],
        idempotencyKey: randomUUID(),
      },
    );
    expect(result.warnings.some((w) => w.code === "BATCH_DUPLICATE")).toBe(
      true,
    );
  });
});
describe("scheduling with groups from another account", () => {
  async function fixture() {
    const suffix = randomUUID();
    const source = await ok<AccountRow>("POST", "accounts", {
      ...accountBody,
      name: "Nguồn nhóm",
      url: `facebook.com/source.${suffix}`,
    });
    const poster = await ok<AccountRow>("POST", "accounts", {
      ...accountBody,
      name: "Tài khoản đăng thay",
      url: `facebook.com/poster.${suffix}`,
    });
    const chosen = await ok<GroupRow>("POST", "groups", {
      name: "Nhóm đã chọn",
      url: `facebook.com/groups/chosen.${suffix}`,
      accountIds: [source.id],
    });
    const unchosen = await ok<GroupRow>("POST", "groups", {
      name: "Nhóm không chọn",
      url: `facebook.com/groups/unchosen.${suffix}`,
      accountIds: [source.id],
    });
    const original = await ok<{ id: string }>("POST", "schedules", {
      postId: post.id,
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
      targets: [{ accountId: source.id, groupId: chosen.id }],
      acknowledgeWarnings: true,
      idempotencyKey: randomUUID(),
    });
    await ok("PATCH", `accounts/${source.id}`, {
      ...source,
      status: "RESTRICTED",
    });
    const oldTask = await db.task.findFirstOrThrow({
      where: { campaignId: original.id },
    });
    const body = {
      postId: post.id,
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
      targets: [
        {
          accountId: poster.id,
          groupId: chosen.id,
          sourceAccountId: source.id,
        },
      ],
      acknowledgeWarnings: true,
      idempotencyKey: randomUUID(),
    };
    return { source, poster, chosen, unchosen, body, oldTask };
  }
  it("previews without linking groups and requires separate confirmation before saving", async () => {
    const { source, poster, chosen, body } = await fixture();
    const legacy = {
      ...body,
      targets: [{ accountId: poster.id, groupId: chosen.id }],
    };
    expect((await call("POST", "schedules/preview", legacy)).status).toBe(400);
    const preview = await ok<{
      membershipLinks: { accountId: string; groupId: string }[];
    }>("POST", "schedules/preview", body);
    expect(preview.membershipLinks).toMatchObject([
      { accountId: poster.id, groupId: chosen.id },
    ]);
    expect(await db.membership.count({ where: { accountId: poster.id } })).toBe(
      0,
    );
    expect((await call("POST", "schedules", body)).status).toBe(409);
    expect(await db.membership.count({ where: { accountId: poster.id } })).toBe(
      0,
    );
    expect(
      await db.campaign.count({
        where: { workspaceId: workspaceA, idempotencyKey: body.idempotencyKey },
      }),
    ).toBe(0);
    expect(await db.membership.count({ where: { accountId: source.id } })).toBe(
      2,
    );
  });
  it("borrows selected groups without changing memberships or old tasks under concurrent retries", async () => {
    const { source, poster, chosen, unchosen, body, oldTask } = await fixture();
    const confirmed = { ...body, confirmGroupAccess: true };
    const results = await Promise.all([
      ok<{ id: string }>("POST", "schedules", confirmed),
      ok<{ id: string }>("POST", "schedules", confirmed),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(
      await db.membership.findMany({ where: { accountId: poster.id } }),
    ).toEqual([]);
    expect(
      await db.membership.count({
        where: { accountId: poster.id, groupId: unchosen.id },
      }),
    ).toBe(0);
    expect(await db.membership.count({ where: { accountId: source.id } })).toBe(
      2,
    );
    expect(
      await db.task.findUniqueOrThrow({ where: { id: oldTask.id } }),
    ).toEqual(oldTask);
    const created = await db.task.findMany({
      where: { campaignId: results[0].id },
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      accountId: poster.id,
      groupId: chosen.id,
      executionMode: "MANUAL",
    });
    const replay = await ok<{ id: string; reused: boolean }>(
      "POST",
      "schedules",
      { ...body, confirmGroupAccess: false, acknowledgeWarnings: false },
    );
    expect(replay).toMatchObject({ id: results[0].id, reused: true });
  });
  it("rejects forged sources, foreign workspaces, archived groups and restricted posters", async () => {
    const { source, poster, chosen, body } = await fixture();
    const forged = {
      ...body,
      targets: [
        {
          accountId: poster.id,
          groupId: chosen.id,
          sourceAccountId: account.id,
        },
      ],
      confirmGroupAccess: true,
    };
    expect((await call("POST", "schedules", forged)).status).toBe(400);
    const foreign = await ok<AccountRow>(
      "POST",
      "accounts",
      { ...accountBody, url: `facebook.com/foreign.${randomUUID()}` },
      cookieB,
    );
    expect(
      (
        await call("POST", "schedules", {
          ...body,
          targets: [{ ...body.targets[0], sourceAccountId: foreign.id }],
          confirmGroupAccess: true,
        })
      ).status,
    ).toBe(404);
    const foreignGroup = await ok<GroupRow>(
      "POST",
      "groups",
      {
        name: "Foreign",
        url: `facebook.com/groups/foreign.${randomUUID()}`,
        accountIds: [foreign.id],
      },
      cookieB,
    );
    expect(
      (
        await call("POST", "schedules", {
          ...body,
          targets: [{ ...body.targets[0], groupId: foreignGroup.id }],
          confirmGroupAccess: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("POST", "schedules", {
          ...body,
          targets: [
            { accountId: poster.id, groupId: null, sourceAccountId: source.id },
          ],
          confirmGroupAccess: true,
        })
      ).status,
    ).toBe(400);
    await ok("PATCH", `accounts/${poster.id}`, {
      ...poster,
      status: "RESTRICTED",
    });
    expect(
      (await call("POST", "schedules", { ...body, confirmGroupAccess: true }))
        .status,
    ).toBe(409);
    await ok("PATCH", `accounts/${poster.id}`, { ...poster, status: "ACTIVE" });
    await db.group.update({
      where: { id: chosen.id },
      data: { archivedAt: new Date() },
    });
    expect(
      (await call("POST", "schedules", { ...body, confirmGroupAccess: true }))
        .status,
    ).toBe(404);
    expect(await db.membership.count({ where: { accountId: poster.id } })).toBe(
      0,
    );
  });
  it("requires the posting account's automatic consent, even when the source is restricted", async () => {
    const { poster, chosen, body } = await fixture();
    const automatic = {
      ...body,
      scheduledAt: new Date().toISOString(),
      executionMode: "AUTOMATIC",
      confirmGroupAccess: true,
    };
    expect((await call("POST", "schedules", automatic)).status).toBe(409);
    const device = await db.desktopDevice.create({
      data: {
        workspaceId: workspaceA,
        name: "Fixture",
        tokenHash: randomUUID(),
      },
    });
    await db.facebookConnection.create({
      data: {
        workspaceId: workspaceA,
        accountId: poster.id,
        deviceId: device.id,
        state: "READY",
        identityHash: "poster-identity",
        confirmedIdentityHash: "poster-identity",
        automationEnabled: true,
      },
    });
    const created = await ok<{ id: string }>("POST", "schedules", automatic);
    expect(
      await db.task.findFirstOrThrow({ where: { campaignId: created.id } }),
    ).toMatchObject({
      accountId: poster.id,
      groupId: chosen.id,
      executionMode: "AUTOMATIC",
    });
    expect(await db.membership.count({ where: { accountId: poster.id } })).toBe(
      0,
    );
    const { heartbeat, claimDesktopWork } =
      await import("../../src/lib/desktop");
    const instanceId = randomUUID();
    await heartbeat(device.id, workspaceA, instanceId);
    const work = await claimDesktopWork(device.id, workspaceA, instanceId);
    expect(work).toMatchObject({
      type: "POST",
      account: { id: poster.id },
      targetUrl: chosen.url,
    });
    expect(await db.membership.count({ where: { accountId: poster.id } })).toBe(
      0,
    );
    await db.task.updateMany({
      where: { campaignId: created.id },
      data: { status: "CANCELLED" },
    });
  });
});
describe("durable reminders and volume", () => {
  it("recovers overdue reminders after a stopped worker without duplicating them", async () => {
    const date = new Date(Date.now() + 60000);
    const created = await ok<{ id: string }>("POST", "schedules", {
      postId: post.id,
      scheduledAt: date.toISOString(),
      targets: [{ accountId: account.id, groupId: null }],
      idempotencyKey: randomUUID(),
      acknowledgeWarnings: true,
    });
    const original = await db.task.findFirstOrThrow({
      where: { campaignId: created.id },
    });
    expect(original.status).toBe("SCHEDULED");
    await Promise.all([
      scanReminders(new Date(date.getTime() + 1000)),
      scanReminders(new Date(date.getTime() + 1000)),
    ]);
    const ready = await db.task.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(ready.status).toBe("READY");
    expect(
      await db.notification.count({ where: { taskId: original.id } }),
    ).toBe(1);
  });
  it("imports 100 groups and links each group to 10 accounts, then paginates correctly", async () => {
    const ids = [account.id];
    for (let i = 1; i < 10; i++) {
      const a = await ok<AccountRow>("POST", "accounts", {
        ...accountBody,
        name: `Scale ${i}`,
        url: `facebook.com/scale.${run}.${i}`,
      });
      ids.push(a.id);
    }
    const rows = Array.from({ length: 100 }, (_, i) => ({
      name: `Scale group ${i}`,
      url: `facebook.com/groups/scale.${run}.${i}`,
      tags: "Scale",
    }));
    const result = await ok<{ imported: number }>("POST", "groups/import", {
      rows,
      accountIds: ids,
    });
    expect(result.imported).toBe(100);
    const replay = await ok<{ imported: number; skipped: number }>(
      "POST",
      "groups/import",
      { rows, accountIds: ids },
    );
    expect(replay.imported).toBe(0);
    expect(replay.skipped).toBe(100);
    const page = await ok<{ total: number; items: GroupRow[] }>(
      "GET",
      "groups?q=Scale&page=2&size=20",
    );
    expect(page.total).toBe(100);
    expect(page.items).toHaveLength(20);
    expect(page.items[0].memberships).toHaveLength(10);
    expect(
      (await ok<{ total: number }>("GET", "groups?q=Scale", undefined, cookieB))
        .total,
    ).toBe(0);
  });
  it("exports filtered CSV and neutralizes spreadsheet formulas in user content", async () => {
    const current = await db.task.findUniqueOrThrow({
      where: { id: approvalTask.id },
    });
    await db.task.update({
      where: { id: current.id },
      data: { note: '=HYPERLINK("https://evil.test")' },
    });
    const response = await call(
      "GET",
      "tasks/export?history=true&status=PUBLISHED",
    );
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain("'=");
    expect(csv).toContain("PUBLISHED");
    expect(csv).not.toContain("PENDING_REVIEW");
    expect(
      await (
        await call("GET", "tasks/export?history=true", undefined, cookieB)
      ).text(),
    ).not.toContain(post.title);
  });
});

describe("removing calendar entries", () => {
  async function fixture() {
    const suffix = randomUUID().slice(0, 8);
    const localAccount = await ok<AccountRow>("POST", "accounts", {
      ...accountBody,
      name: `Archive ${suffix}`,
      url: `https://facebook.com/archive.${suffix}`,
    });
    const localGroup = await ok<GroupRow>("POST", "groups", {
      name: `Archive ${suffix}`,
      url: `https://facebook.com/groups/archive.${suffix}`,
      accountIds: [localAccount.id],
    });
    const localPost = await ok<PostRow>("POST", "posts", {
      title: `Archive ${suffix}`,
      content: "Nội dung cần giữ trong lịch sử.",
      assetIds: [asset.id],
    });
    const tasks = [];
    for (let index = 0; index < 4; index++) {
      const campaign = await ok<{ id: string }>("POST", "schedules", {
        postId: localPost.id,
        scheduledAt: new Date(
          Date.now() + 3600_000 + index * 600_000,
        ).toISOString(),
        targets: [{ accountId: localAccount.id, groupId: localGroup.id }],
        idempotencyKey: randomUUID(),
        acknowledgeWarnings: true,
      });
      const task = await db.task.findFirstOrThrow({
        where: { campaignId: campaign.id },
      });
      tasks.push(task);
    }
    tasks[1] = await db.task.update({
      where: { id: tasks[1].id },
      data: {
        status: "PUBLISHED",
        recordedAt: new Date(),
        startedAt: new Date(),
        resultUrl: `${localGroup.url}/posts/123`,
        resultSource: "DESKTOP",
      },
    });
    tasks[2] = await db.task.update({
      where: { id: tasks[2].id },
      data: {
        status: "SKIPPED",
        recordedAt: new Date(),
      },
    });
    tasks[3] = await db.task.update({
      where: { id: tasks[3].id },
      data: {
        status: "BLOCKED",
        executionMode: "AUTOMATIC",
        automaticPhase: "NEEDS_REVIEW",
        blockReason: "AUTO_UNCERTAIN",
        note: "Giữ bằng chứng chưa rõ kết quả.",
        startedAt: new Date(),
      },
    });
    return { tasks, account: localAccount, post: localPost };
  }

  it("removes all selected states atomically, preserves evidence and supports safe retries", async () => {
    const { tasks, post: localPost } = await fixture();
    const payload = {
      tasks: tasks.map(({ id, version }) => ({ id, version })),
      operationId: randomUUID(),
    };
    expect(
      (await call("POST", "tasks/bulk-archive", payload, cookieB)).status,
    ).toBe(404);
    expect(
      (
        await call("POST", "tasks/bulk-archive", {
          ...payload,
          tasks: payload.tasks.map((task, index) =>
            index === 1 ? { ...task, version: task.version + 1 } : task,
          ),
        })
      ).status,
    ).toBe(409);
    expect(
      await db.task.count({
        where: {
          id: { in: tasks.map((task) => task.id) },
          archivedAt: { not: null },
        },
      }),
    ).toBe(0);
    const result = await ok<{ archived: number; reused: boolean }>(
      "POST",
      "tasks/bulk-archive",
      payload,
    );
    expect(result).toEqual({ archived: 4, reused: false });
    expect(await ok("POST", "tasks/bulk-archive", payload)).toEqual({
      archived: 4,
      reused: true,
    });
    expect((await call("POST", "tasks/bulk-cancel", payload)).status).toBe(409);
    const calendar = await ok<{ total: number }>(
      "GET",
      `tasks?q=${encodeURIComponent(localPost.title)}`,
    );
    expect(calendar.total).toBe(0);
    const history = await ok<{ total: number; items: TaskRow[] }>(
      "GET",
      `tasks?history=true&q=${encodeURIComponent(localPost.title)}`,
    );
    expect(history.total).toBe(4);
    expect(history.items.find((task) => task.id === tasks[0].id)?.status).toBe(
      "CANCELLED",
    );
    expect(history.items.find((task) => task.id === tasks[1].id)).toMatchObject(
      {
        status: "PUBLISHED",
        resultUrl: tasks[1].resultUrl,
        resultSource: "DESKTOP",
        assetIds: [asset.id],
      },
    );
    expect(history.items.find((task) => task.id === tasks[3].id)).toMatchObject(
      {
        status: "BLOCKED",
        automaticPhase: "NEEDS_REVIEW",
        note: tasks[3].note,
      },
    );
    const cancelled = await db.task.findUniqueOrThrow({
      where: { id: tasks[0].id },
    });
    expect(
      (
        await call("PATCH", `tasks/${cancelled.id}`, {
          action: "start",
          version: cancelled.version,
          operationId: randomUUID(),
        })
      ).status,
    ).toBe(409);
    const review = history.items.find((task) => task.id === tasks[3].id)!;
    const resolved = await ok<TaskRow>("PATCH", `tasks/${review.id}`, {
      action: "record",
      status: "PUBLISHED",
      version: review.version,
      operationId: randomUUID(),
    });
    expect(resolved.status).toBe("PUBLISHED");
    expect(resolved.archivedAt).toBeTruthy();
  });

  it("excludes archived work from every dashboard statistic and chart", async () => {
    const { tasks } = await fixture();
    await db.task.update({
      where: { id: tasks[2].id },
      data: { status: "PENDING_REVIEW" },
    });
    const before = await ok<DashboardData>("GET", "dashboard");
    const { start, end } = dayBounds(new Date());
    const today = tasks.filter(
      (task) => task.scheduledAt >= start && task.scheduledAt < end,
    );
    await ok("POST", "tasks/bulk-archive", {
      tasks: tasks.map(({ id, version }) => ({ id, version })),
      operationId: randomUUID(),
    });
    const after = await ok<DashboardData>("GET", "dashboard");
    expect(after.published).toBe(before.published - 1);
    expect(after.pending).toBe(before.pending - 1);
    expect(after.progress.total).toBe(before.progress.total - today.length);
    expect(after.progress.handled).toBe(
      before.progress.handled -
        today.filter((task) => [tasks[1].id, tasks[2].id].includes(task.id))
          .length,
    );
    expect(after.week.at(-1)?.published).toBe(
      before.week.at(-1)!.published - 1,
    );
    expect(after.week.at(-1)?.pending).toBe(before.week.at(-1)!.pending - 1);
    expect(
      [...after.queue, ...after.upcoming].some((task) =>
        tasks.some((item) => item.id === task.id),
      ),
    ).toBe(false);
  });

  it("refuses to hide active automatic work, including a mixed batch", async () => {
    const { tasks } = await fixture();
    for (const phase of ["PREPARING", "SUBMITTING"]) {
      await db.task.update({
        where: { id: tasks[0].id },
        data: {
          status: "IN_PROGRESS",
          executionMode: "AUTOMATIC",
          automaticPhase: phase,
        },
      });
      const payload = {
        tasks: tasks.slice(0, 2).map(({ id, version }) => ({ id, version })),
        operationId: randomUUID(),
      };
      expect((await call("POST", "tasks/bulk-archive", payload)).status).toBe(
        409,
      );
      expect(
        await db.task.count({
          where: {
            id: { in: tasks.map((task) => task.id) },
            archivedAt: { not: null },
          },
        }),
      ).toBe(0);
    }
  });
});

describe("database and media backups", () => {
  it("restores a real database dump and image archive into an isolated database", async () => {
    const destination = await backupLocal(".data/test-backups");
    const tools = await postgresTools();
    const source = new URL(process.env.DATABASE_URL!);
    const restored = new URL(source);
    restored.pathname = `/nhipdang_restore_${run}_test`;
    const adminUrl = new URL(source);
    adminUrl.pathname = "/postgres";
    const admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    const restoredName = restored.pathname.slice(1);
    let created = false;
    try {
      await admin.query(
        `CREATE DATABASE ${admin.escapeIdentifier(restoredName)}`,
      );
      created = true;
      const result = spawnSync(
        tools.restore,
        [
          ...pgArguments(restored),
          "--exit-on-error",
          path.join(destination, "database.dump"),
        ],
        {
          env: {
            ...process.env,
            PGPASSWORD: decodeURIComponent(restored.password),
          },
          windowsHide: true,
          encoding: "utf8",
        },
      );
      expect(result.status, result.stderr).toBe(0);
      const client = new Client({ connectionString: restored.toString() });
      await client.connect();
      try {
        const count = (
          await client.query(
            'SELECT count(*)::int AS count FROM "Group" WHERE "workspaceId" = $1',
            [workspaceA],
          )
        ).rows[0].count;
        expect(count).toBeGreaterThanOrEqual(100);
        const stored = (
          await client.query('SELECT "storageKey" FROM "Asset" WHERE id = $1', [
            asset.id,
          ])
        ).rows[0].storageKey as string;
        const output = path.resolve(".data/test-restore", run);
        await mkdir(output, { recursive: true });
        const unpack = spawnSync(
          "tar",
          ["-C", output, "-xzf", path.join(destination, "media.tar.gz")],
          { windowsHide: true, encoding: "utf8" },
        );
        expect(unpack.status, unpack.stderr).toBe(0);
        expect(
          (await sharp(await readFile(path.join(output, stored))).metadata())
            .width,
        ).toBe(32);
      } finally {
        await client.end();
      }
    } finally {
      if (created)
        await admin.query(
          `DROP DATABASE ${admin.escapeIdentifier(restoredName)}`,
        );
      await admin.end();
    }
  });
  it("fails a backup if an image referenced by the database is missing", async () => {
    const stored = await db.asset.findUniqueOrThrow({
      where: { id: asset.id },
    });
    const filename = path.resolve(process.env.MEDIA_DIR!, stored.storageKey);
    await rename(filename, filename + ".missing");
    try {
      await expect(backupLocal(".data/test-backups")).rejects.toThrow();
    } finally {
      await rename(filename + ".missing", filename);
    }
  });
});
