import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as webPush from "web-push";
import { NextRequest } from "next/server";
import { db } from "../../src/lib/db";
import { createAuth } from "../../src/lib/auth";
import { GET, POST } from "../../src/app/api/v1/[...path]/route";
import {
  inboxForWorkspace,
  inboxReportSchema,
  reportDesktopInbox,
  pruneInboxSnapshots,
} from "../../src/lib/inbox";
import {
  flushMobilePush,
  pushSubscriptionSchema,
  subscribeMobilePush,
} from "../../src/lib/mobile-push";

vi.mock("web-push", async (original) => ({
  ...(await original<typeof import("web-push")>()),
  sendNotification: vi.fn(),
}));

const origin = "http://localhost:3000";
const identity = "a".repeat(64);
const instanceId = randomUUID();
const owners: string[] = [];
let wid: string,
  otherWid: string,
  sessionId: string,
  cookie: string,
  otherCookie: string;
let deviceId: string, accountId: string;
const vapid = webPush.generateVAPIDKeys();
const input = {
  endpoint: `https://web.push.apple.com/${randomUUID()}`,
  keys: {
    p256dh: webPush.generateVAPIDKeys().publicKey,
    auth: randomBytes(16).toString("base64url"),
  },
};
const transport = vi.mocked(webPush.sendNotification);
async function app(
  path: string,
  body?: unknown,
  auth = cookie,
  requestOrigin = origin,
) {
  return (body === undefined ? GET : POST)(
    new NextRequest(`${origin}/api/v1/${path}`, {
      method: body === undefined ? "GET" : "POST",
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
async function report(
  unread = true,
  preview = "Private message must never be pushed",
  targetAccountId = accountId,
  lastMessageAt: string | null = new Date().toISOString(),
) {
  await reportDesktopInbox(
    deviceId,
    wid,
    targetAccountId,
    inboxReportSchema.parse({
      instanceId,
      generation: 0,
      identityHash: identity,
      status: "ONLINE",
      conversations: [
        {
          id: "thread",
          name: "Private customer",
          preview,
          unread,
          lastMessageAt,
        },
      ],
    }),
  );
}
async function queued() {
  return db.mobilePushSubscription.findFirstOrThrow({
    where: { workspaceId: wid },
  });
}

beforeAll(async () => {
  vi.stubEnv("WEB_PUSH_PUBLIC_KEY", vapid.publicKey);
  vi.stubEnv("WEB_PUSH_PRIVATE_KEY", vapid.privateKey);
  vi.stubEnv("WEB_PUSH_SUBJECT", "https://autotool.pmcoding.com");
  for (const name of ["owner", "other"]) {
    const auth = createAuth(true),
      email = `${randomUUID()}@mobile-push.tests.local`,
      password = randomUUID();
    const user = await auth.api.signUpEmail({
      body: { name, email, password },
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
    if (name === "owner") {
      wid = workspace.id;
      cookie = cookies;
      sessionId = (await auth.api.getSession({
        headers: new Headers({ cookie }),
      }))!.session.id;
    } else {
      otherWid = workspace.id;
      otherCookie = cookies;
    }
  }
  const device = await db.desktopDevice.create({
    data: {
      workspaceId: wid,
      name: "Fixture Mac",
      tokenHash: randomUUID(),
      instanceId,
      supportsInbox: true,
      lastSeenAt: new Date(),
    },
  });
  deviceId = device.id;
  const account = await db.facebookAccount.create({
    data: {
      workspaceId: wid,
      name: "Nhi Vy",
      profileName: "Nhi Vy",
      url: "https://facebook.com/push.test",
    },
  });
  accountId = account.id;
  await db.facebookConnection.create({
    data: {
      workspaceId: wid,
      accountId,
      deviceId,
      state: "READY",
      generation: 0,
      identityHash: identity,
      confirmedIdentityHash: identity,
      expectedIdentityHash: identity,
    },
  });
});
beforeEach(async () => {
  transport
    .mockReset()
    .mockResolvedValue({ statusCode: 201, headers: {}, body: "" });
  await db.mobilePushSubscription.deleteMany({
    where: { workspaceId: { in: [wid, otherWid] } },
  });
  await db.facebookInboxSnapshot.deleteMany({ where: { accountId } });
  await db.desktopDevice.update({
    where: { id: deviceId },
    data: { lastSeenAt: new Date(), paused: false },
  });
  await db.facebookConnection.update({
    where: { accountId },
    data: {
      state: "READY",
      inboxPaused: false,
      identityHash: identity,
      confirmedIdentityHash: identity,
    },
  });
});
afterAll(async () => {
  transport.mockRestore();
  vi.unstubAllEnvs();
  await db.user.deleteMany({ where: { id: { in: owners } } });
  await db.$disconnect();
});

it("authenticates registrations, excludes private keys and rejects cross-origin requests", async () => {
  expect((await app("push/config", undefined, "")).status).toBe(401);
  const config = await (await app("push/config")).json();
  expect(config).toEqual({ configured: true, publicKey: vapid.publicKey });
  expect(JSON.stringify(config)).not.toContain(vapid.privateKey);
  expect(
    (await app("push/subscribe", input, cookie, "https://wrong.example"))
      .status,
  ).toBe(403);
  expect((await app("push/subscribe", input)).status).toBe(200);
  expect((await app("push/subscribe", input)).status).toBe(200);
  expect(
    await db.mobilePushSubscription.count({ where: { workspaceId: wid } }),
  ).toBe(1);
  expect(
    await (await app("push/status", { endpoint: input.endpoint })).json(),
  ).toEqual({ enabled: true });
  expect(
    await (
      await app("push/status", { endpoint: input.endpoint }, otherCookie)
    ).json(),
  ).toEqual({ enabled: false });
  await app("push/unsubscribe", { endpoint: input.endpoint }, otherCookie);
  expect(
    await db.mobilePushSubscription.count({ where: { workspaceId: wid } }),
  ).toBe(1);
});

it.each([
  "https://127.0.0.1/private",
  "https://example.org/push",
  "http://web.push.apple.com/test",
  "https://web.push.apple.com.evil.test/x",
  "https://web.push.apple.com:444/x",
  "https://user@web.push.apple.com/x",
])("rejects an untrusted push endpoint: %s", (endpoint) => {
  expect(pushSubscriptionSchema.safeParse({ ...input, endpoint }).success).toBe(
    false,
  );
});

it("queues only changed inbox reports, coalesces deliveries, and never sends message contents", async () => {
  await subscribeMobilePush(wid, sessionId, input);
  await report();
  expect((await queued()).pendingVersion).toBe(1);
  await report();
  expect((await queued()).pendingVersion).toBe(1);
  await report(true, "Changed private preview");
  expect((await queued()).pendingVersion).toBe(2);
  expect(await flushMobilePush()).toBe(1);
  expect(transport).toHaveBeenCalledTimes(1);
  const payload = JSON.parse(transport.mock.calls[0][1]!.toString());
  expect(payload).toMatchObject({ count: 1, hasNew: true, url: "/inbox" });
  expect(payload.body).toContain("Nhi Vy: 1");
  expect(JSON.stringify(payload)).not.toMatch(
    /Private customer|private preview/i,
  );
  expect((await queued()).deliveredVersion).toBe(2);
  expect(await flushMobilePush()).toBe(0);
  await report(false);
  expect(await flushMobilePush()).toBe(1);
  expect(JSON.parse(transport.mock.calls[1][1]!.toString())).toMatchObject({
    count: 0,
    hasNew: false,
  });
});

it("keeps last-known badges while paused and rejects late observations without creating pushes", async () => {
  await subscribeMobilePush(wid, sessionId, input);
  await report();
  await flushMobilePush();
  await db.desktopDevice.update({
    where: { id: deviceId },
    data: { paused: true },
  });
  await report(true, "Late message");
  expect((await queued()).pendingVersion).toBe(1);
  const data = await inboxForWorkspace(wid);
  expect(data.accounts?.[0]).toMatchObject({
    fresh: false,
    unreadCount: 0,
    lastKnownUnreadCount: 1,
  });
  expect(await flushMobilePush()).toBe(0);
});

it("excludes old and undated unread messages from counts and push events", async () => {
  await subscribeMobilePush(wid, sessionId, input);
  await report(
    true,
    "Old message",
    accountId,
    new Date(Date.now() - 3 * 86400000).toISOString(),
  );
  expect((await inboxForWorkspace(wid)).accounts?.[0].unreadCount).toBe(0);
  expect((await queued()).pendingVersion).toBe(0);
  await report(true, "Undated message", accountId, null);
  expect((await queued()).pendingVersion).toBe(0);
  expect(await flushMobilePush()).toBe(0);
  await report(true, "Recent message");
  expect(await flushMobilePush()).toBe(1);
  expect(JSON.parse(transport.mock.calls[0][1]!.toString()).count).toBe(1);
});

it("pushes zero when the last unread message ages beyond 48 hours while polling is stopped", async () => {
  await subscribeMobilePush(wid, sessionId, input);
  await report();
  await flushMobilePush();
  const snapshot = await db.facebookInboxSnapshot.findUniqueOrThrow({
    where: { accountId },
  });
  const state = snapshot.state as unknown as {
    conversations: { lastMessageAt: string }[];
  };
  state.conversations[0].lastMessageAt = new Date(
    Date.now() - 48 * 3600000 - 1,
  ).toISOString();
  await db.facebookInboxSnapshot.update({
    where: { accountId },
    data: { state: JSON.parse(JSON.stringify(state)) },
  });
  await db.desktopDevice.update({
    where: { id: deviceId },
    data: { paused: true },
  });
  await pruneInboxSnapshots();
  expect(await flushMobilePush()).toBe(1);
  expect(JSON.parse(transport.mock.calls[1][1]!.toString())).toMatchObject({
    count: 0,
    hasNew: false,
  });
  await pruneInboxSnapshots();
  expect(await flushMobilePush()).toBe(0);
});

it("reconciles multiple account counts and serves an overview without conversation contents", async () => {
  const second = await db.facebookAccount.create({
    data: {
      workspaceId: wid,
      name: "Minh Phan",
      profileName: "Minh Phan",
      url: "https://facebook.com/push.second",
    },
  });
  try {
    await db.facebookConnection.create({
      data: {
        workspaceId: wid,
        accountId: second.id,
        deviceId,
        state: "READY",
        generation: 0,
        identityHash: identity,
        confirmedIdentityHash: identity,
        expectedIdentityHash: identity,
      },
    });
    await subscribeMobilePush(wid, sessionId, input);
    await report();
    await report(true, "Another private preview", second.id);
    const response = await (await app("inbox?view=summary")).json();
    expect(response.conversations).toEqual([]);
    expect(
      response.accounts
        .map((a: { unreadCount: number }) => a.unreadCount)
        .reduce((a: number, b: number) => a + b, 0),
    ).toBe(2);
    expect(JSON.stringify(response)).not.toContain("private preview");
    await flushMobilePush();
    const payload = JSON.parse(transport.mock.calls[0][1]!.toString());
    expect(payload.count).toBe(2);
    expect(payload.body).toContain("Nhi Vy: 1");
    expect(payload.body).toContain("Minh Phan: 1");
  } finally {
    await db.facebookAccount.delete({ where: { id: second.id } });
  }
});

it("retries transient delivery failures and removes expired subscriptions", async () => {
  await subscribeMobilePush(wid, sessionId, input);
  await report();
  transport.mockRejectedValueOnce({ statusCode: 503 });
  expect(await flushMobilePush()).toBe(0);
  expect(await queued()).toMatchObject({
    attempts: 1,
    deliveredVersion: 0,
    leaseUntil: null,
  });
  await db.mobilePushSubscription.updateMany({
    where: { workspaceId: wid },
    data: { nextAttemptAt: new Date(0) },
  });
  expect(await flushMobilePush()).toBe(1);
  await report(true, "Next unread message");
  transport.mockRejectedValueOnce({ statusCode: 410 });
  expect(await flushMobilePush()).toBe(0);
  expect(
    await db.mobilePushSubscription.count({ where: { workspaceId: wid } }),
  ).toBe(0);
});

it("leases a phone once and retains changes arriving during delivery", async () => {
  await subscribeMobilePush(wid, sessionId, input);
  await report();
  let release!: () => void;
  transport.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { statusCode: 201, headers: {}, body: "" };
  });
  const sending = flushMobilePush();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(await flushMobilePush()).toBe(0);
  await report(true, "Message arrived during push");
  release();
  await sending;
  expect(await queued()).toMatchObject({
    pendingVersion: 2,
    deliveredVersion: 1,
    hasNew: true,
  });
  expect(await flushMobilePush()).toBe(1);
});

it("supports an explicit test, scopes unsubscribe and stops after logout", async () => {
  await app("push/subscribe", input);
  expect(
    await (await app("push/test", { endpoint: input.endpoint })).json(),
  ).toEqual({ queued: true });
  expect((await app("push/test", { endpoint: input.endpoint })).status).toBe(
    409,
  );
  await flushMobilePush();
  expect(JSON.parse(transport.mock.calls[0][1]!.toString()).title).toBe(
    "Thông báo đã sẵn sàng",
  );
  await app("push/unsubscribe", { endpoint: input.endpoint });
  expect(
    await db.mobilePushSubscription.count({ where: { workspaceId: wid } }),
  ).toBe(0);
  const extraSession = await db.session.create({
    data: {
      id: randomUUID(),
      token: randomUUID(),
      userId: owners[0],
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await subscribeMobilePush(wid, extraSession.id, input);
  await report();
  await db.session.delete({ where: { id: extraSession.id } });
  expect(await flushMobilePush()).toBe(0);
  expect(
    await db.mobilePushSubscription.count({ where: { workspaceId: wid } }),
  ).toBe(0);
});
