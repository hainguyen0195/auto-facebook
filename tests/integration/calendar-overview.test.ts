import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db } from "../../src/lib/db";
import { createAuth } from "../../src/lib/auth";
import { GET } from "../../src/app/api/v1/[...path]/route";

const origin = "http://localhost:3000";
const range = {
  start: "2026-11-01T00:00:00+07:00",
  end: "2026-11-08T00:00:00+07:00",
};
const owners: string[] = [];
const cookies: string[] = [];
let wid: string, accountId: string;
const secretContent =
  "Full post content must not appear in calendar previews.".repeat(100);
async function request(
  params: Record<string, string> = {},
  cookie = cookies[0],
) {
  return GET(
    new NextRequest(
      `${origin}/api/v1/calendar?${new URLSearchParams({ ...range, ...params })}`,
      {
        headers: { cookie },
      },
    ),
    { params: Promise.resolve({ path: ["calendar"] }) },
  );
}
async function overview(params: Record<string, string> = {}) {
  const response = await request(params);
  expect(response.status).toBe(200);
  return response.json();
}
beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const auth = createAuth(true);
    const email = `calendar-${randomUUID()}@tests.nhipdang.local`;
    const password = randomUUID() + randomUUID();
    const owner = await auth.api.signUpEmail({
      body: { name: "Calendar test", email, password },
    });
    owners.push(owner.user.id);
    const session = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    cookies.push(
      session.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    );
  }
  wid = (
    await db.workspace.findUniqueOrThrow({ where: { ownerId: owners[0] } })
  ).id;
  const account = await db.facebookAccount.create({
    data: {
      workspaceId: wid,
      name: "Calendar Alpha",
      profileName: "Alpha",
      url: "https://www.facebook.com/calendar.alpha",
    },
  });
  accountId = account.id;
  const beta = await db.facebookAccount.create({
    data: {
      workspaceId: wid,
      name: "Calendar Beta",
      profileName: "Beta",
      url: "https://www.facebook.com/calendar.beta",
    },
  });
  const group = await db.group.create({
    data: {
      workspaceId: wid,
      name: "Nhóm Đại Dương",
      url: "https://www.facebook.com/groups/calendar.ocean",
    },
  });
  const post = await db.post.create({
    data: { workspaceId: wid, title: "Calendar", content: secretContent },
  });
  const rows = Array.from({ length: 205 }, (_, i) => ({
    id: randomUUID(),
    campaignId: randomUUID(),
    workspaceId: wid,
    postId: post.id,
    accountId: i < 201 ? accountId : beta.id,
    destinationKey: i < 201 && i % 2 === 0 ? group.id : "PROFILE",
    groupId: i < 201 && i % 2 === 0 ? group.id : null,
    titleSnapshot:
      i < 201 ? `Early ${String(i).padStart(3, "0")}` : `Late ${i}`,
    contentSnapshot: secretContent,
    contentHash: "calendar-fixture",
    scheduledAt:
      i < 201
        ? new Date(Date.parse("2026-11-04T02:00:00Z") + i * 1000)
        : new Date(
            [
              "2026-11-06T16:59:59Z",
              "2026-11-06T17:00:00Z",
              "2026-11-07T17:00:00Z",
              "2026-11-04T02:00:00Z",
            ][i - 201],
          ),
    status:
      i === 201
        ? ("READY" as const)
        : i === 202
          ? ("PENDING_REVIEW" as const)
          : ("PUBLISHED" as const),
    archivedAt: i === 204 ? new Date() : null,
  }));
  await db.campaign.createMany({
    data: rows.map((row) => ({
      id: row.campaignId,
      workspaceId: wid,
      postId: post.id,
      idempotencyKey: randomUUID(),
      requestHash: row.id,
    })),
  });
  await db.task.createMany({ data: rows });
});
afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: owners } } });
  await db.$disconnect();
});

describe("bounded calendar overview", () => {
  it("returns all daily counts and the earliest previews in one small response", async () => {
    const data = await overview();
    expect(data.total).toBe(203);
    expect(data.summary).toEqual({
      PUBLISHED: 201,
      READY: 1,
      PENDING_REVIEW: 1,
    });
    expect(
      data.days.map((d: { date: string; total: number }) => [d.date, d.total]),
    ).toEqual([
      ["2026-11-04", 201],
      ["2026-11-06", 1],
      ["2026-11-07", 1],
    ]);
    expect(
      data.days[0].items.map((t: { titleSnapshot: string }) => t.titleSnapshot),
    ).toEqual(["Early 000", "Early 001", "Early 002"]);
    expect(JSON.stringify(data)).not.toContain("contentSnapshot");
    expect(JSON.stringify(data)).not.toContain("Full post content");
    expect(Buffer.byteLength(JSON.stringify(data))).toBeLessThan(5000);
    const week = await overview({ view: "week" });
    expect(week.days[0].items).toHaveLength(8);
    expect(week.total).toBe(data.total);
    expect(week.summary).toEqual(data.summary);
  });
  it("applies account, destination, status and search filters to both counts and previews", async () => {
    expect((await overview({ accountId })).total).toBe(201);
    expect((await overview({ target: "GROUP" })).total).toBe(101);
    expect((await overview({ target: "PROFILE" })).total).toBe(102);
    expect((await overview({ status: "READY" })).total).toBe(1);
    expect((await overview({ q: "Late" })).total).toBe(2);
    expect((await overview({ q: "ĐẠI DƯƠNG" })).total).toBe(101);
    expect((await overview({ q: "Calendar Beta" })).total).toBe(2);
    expect(
      (await overview({ status: "PUBLISHED", target: "PROFILE", accountId }))
        .total,
    ).toBe(100);
  });
  it("requires authentication and isolates another workspace", async () => {
    expect((await request({}, "")).status).toBe(401);
    const other = await (await request({}, cookies[1])).json();
    expect(other).toEqual({ days: [], total: 0, summary: {} });
  });
  it.each<Record<string, string>>([
    { start: "" },
    { end: "" },
    { start: "bad" },
    { end: "2026-11-01T00:00:00+07:00" },
    { end: "2026-10-31T00:00:00+07:00" },
    { end: "2027-11-08T00:00:00+07:00" },
    { status: "NOT_A_STATUS" },
  ])(
    "rejects invalid or unbounded ranges and invalid filters: %j",
    async (params) => {
      expect((await request(params)).status).toBe(400);
    },
  );
});
