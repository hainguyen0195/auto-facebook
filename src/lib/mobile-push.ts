import { createHash } from "node:crypto";
import * as webPush from "web-push";
import { z } from "zod";
import { db } from "./db";
import { AppError } from "./errors";
import { inboxForWorkspace } from "./inbox";
import { inboxUnreadTotal, type InboxData } from "./inbox-types";

const endpointHash = (endpoint: string) =>
  createHash("sha256").update(endpoint).digest("hex");
export const pushEndpointSchema = z
  .string()
  .max(4096)
  .url()
  .refine((value) => {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      (host === "web.push.apple.com" ||
        host.endsWith(".push.apple.com") ||
        host === "fcm.googleapis.com" ||
        host === "updates.push.services.mozilla.com" ||
        host.endsWith(".notify.windows.com"))
    );
  }, "Địa chỉ dịch vụ thông báo không hợp lệ.");
const key = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine(
      (value) => Buffer.from(value, "base64url").length === bytes,
      "Khóa thông báo không hợp lệ.",
    );
export const pushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: key(65).refine((v) => Buffer.from(v, "base64url")[0] === 4),
    auth: key(16),
  }),
});

export function pushConfig() {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY || "";
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY || "";
  const subject =
    process.env.WEB_PUSH_SUBJECT || process.env.BETTER_AUTH_URL || "";
  const configured =
    /^[A-Za-z0-9_-]{87}$/.test(publicKey) &&
    /^[A-Za-z0-9_-]{43}$/.test(privateKey) &&
    /^(https:\/\/|mailto:)/.test(subject);
  return {
    configured,
    publicKey: configured ? publicKey : "",
    privateKey,
    subject,
  };
}

export async function subscribeMobilePush(
  workspaceId: string,
  sessionId: string,
  input: z.infer<typeof pushSubscriptionSchema>,
) {
  const config = pushConfig();
  if (!config.configured)
    throw new AppError(503, "Thông báo điện thoại chưa được cấu hình.");
  const hash = endpointHash(input.endpoint);
  const previous = await db.mobilePushSubscription.findUnique({
    where: { endpointHash: hash },
  });
  const unchanged =
    previous?.workspaceId === workspaceId &&
    previous?.sessionId === sessionId &&
    previous?.p256dh === input.keys.p256dh &&
    previous?.auth === input.keys.auth &&
    previous?.vapidPublicKey === config.publicKey;
  if (unchanged) return { enabled: true };
  await db.mobilePushSubscription.upsert({
    where: { endpointHash: hash },
    create: {
      workspaceId,
      sessionId,
      endpointHash: hash,
      endpoint: input.endpoint,
      ...input.keys,
      vapidPublicKey: config.publicKey,
    },
    update: {
      workspaceId,
      sessionId,
      endpoint: input.endpoint,
      ...input.keys,
      vapidPublicKey: config.publicKey,
      pendingVersion: 0,
      deliveredVersion: 0,
      hasNew: false,
      testRequested: false,
      attempts: 0,
      leaseUntil: null,
      nextAttemptAt: new Date(),
    },
  });
  return { enabled: true };
}

export async function mobilePushStatus(
  workspaceId: string,
  sessionId: string,
  endpoint: string,
) {
  const record = await db.mobilePushSubscription.findFirst({
    where: {
      workspaceId,
      sessionId,
      endpointHash: endpointHash(endpoint),
      vapidPublicKey: pushConfig().publicKey,
      session: { expiresAt: { gt: new Date() } },
    },
    select: { id: true },
  });
  return { enabled: !!record };
}

export async function unsubscribeMobilePush(
  workspaceId: string,
  endpoint: string,
) {
  await db.mobilePushSubscription.deleteMany({
    where: { workspaceId, endpointHash: endpointHash(endpoint) },
  });
  return { enabled: false };
}

export async function testMobilePush(
  workspaceId: string,
  sessionId: string,
  endpoint: string,
) {
  const now = new Date();
  const result = await db.mobilePushSubscription.updateMany({
    where: {
      workspaceId,
      sessionId,
      endpointHash: endpointHash(endpoint),
      session: { expiresAt: { gt: now } },
      OR: [
        { lastTestAt: null },
        { lastTestAt: { lt: new Date(now.getTime() - 60_000) } },
      ],
    },
    data: {
      pendingVersion: { increment: 1 },
      testRequested: true,
      nextAttemptAt: now,
      lastTestAt: now,
    },
  });
  if (!result.count)
    throw new AppError(
      409,
      "Hãy bật thông báo trước; mỗi lần thử cần cách nhau một phút.",
    );
  return { queued: true };
}

export function inboxPushPayload(
  data: InboxData,
  hasNew: boolean,
  test = false,
) {
  const count = inboxUnreadTotal(data);
  const accounts = (data.accounts || []).filter(
    (a) => (a.fresh ? a.unreadCount : (a.lastKnownUnreadCount ?? 0)) > 0,
  );
  const names = accounts
    .slice(0, 3)
    .map(
      (a) => `${a.name}: ${a.fresh ? a.unreadCount : a.lastKnownUnreadCount}`,
    )
    .join(" · ");
  const freshNew = hasNew && accounts.some((a) => a.fresh);
  return {
    title: test
      ? "Thông báo đã sẵn sàng"
      : freshNew
        ? "Facebook có tin nhắn chưa đọc"
        : "Đã cập nhật tin nhắn",
    body: test
      ? "Nhịp Đăng sẽ báo tài khoản nào có tin nhắn mới tại đây."
      : count
        ? `${names}${accounts.length > 3 ? ` · và ${accounts.length - 3} tài khoản khác` : ""}. ${count} hội thoại chưa đọc đã ghi nhận.`
        : "Không còn hội thoại chưa đọc trong 48 giờ gần nhất đã ghi nhận.",
    count,
    hasNew: freshNew || test,
    url: "/inbox",
    tag: "nhipdang-inbox",
  };
}

export async function flushMobilePush() {
  const config = pushConfig();
  if (!config.configured) return 0;
  const now = new Date();
  // Compare versions in SQL so repeated reports coalesce into one delivery per phone.
  const candidates = await db.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM "MobilePushSubscription" p
    JOIN "session" s ON s.id = p."sessionId"
    WHERE p."pendingVersion" > p."deliveredVersion" AND s."expiresAt" > ${now}
      AND p."nextAttemptAt" <= ${now} AND (p."leaseUntil" IS NULL OR p."leaseUntil" < ${now})
      AND p."vapidPublicKey" = ${config.publicKey}
    ORDER BY p."nextAttemptAt" LIMIT 20`;
  let sent = 0;
  for (const { id } of candidates) {
    const claimed = await db.mobilePushSubscription.updateMany({
      where: {
        id,
        session: { expiresAt: { gt: new Date() } },
        pendingVersion: {
          gt: db.mobilePushSubscription.fields.deliveredVersion,
        },
        vapidPublicKey: config.publicKey,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: { leaseUntil: new Date(Date.now() + 30_000) },
    });
    if (!claimed.count) continue;
    const subscription = await db.mobilePushSubscription.findUnique({
      where: { id },
    });
    if (!subscription) continue;
    const version = subscription.pendingVersion;
    try {
      const data = await inboxForWorkspace(subscription.workspaceId);
      const payload = inboxPushPayload(
        data,
        subscription.hasNew,
        subscription.testRequested,
      );
      const stillActive = await db.mobilePushSubscription.count({
        where: {
          id,
          sessionId: subscription.sessionId,
          session: { expiresAt: { gt: new Date() } },
        },
      });
      if (!stillActive) continue;
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        JSON.stringify(payload),
        {
          vapidDetails: {
            subject: config.subject,
            publicKey: config.publicKey,
            privateKey: config.privateKey,
          },
          TTL: 300,
          urgency: "normal",
          topic: "nhipdang-inbox",
          timeout: 10_000,
        },
      );
      await db.mobilePushSubscription.updateMany({
        where: { id, sessionId: subscription.sessionId },
        data: {
          deliveredVersion: version,
          leaseUntil: null,
          attempts: 0,
          lastSentAt: new Date(),
        },
      });
      await db.mobilePushSubscription.updateMany({
        where: {
          id,
          sessionId: subscription.sessionId,
          pendingVersion: version,
        },
        data: { hasNew: false, testRequested: false },
      });
      sent++;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.mobilePushSubscription.deleteMany({
          where: { id, sessionId: subscription.sessionId },
        });
      } else {
        await db.mobilePushSubscription.updateMany({
          where: { id, sessionId: subscription.sessionId },
          data: {
            leaseUntil: null,
            attempts: { increment: 1 },
            nextAttemptAt: new Date(
              Date.now() +
                Math.min(
                  900_000,
                  10_000 * 2 ** Math.min(subscription.attempts, 7),
                ),
            ),
          },
        });
        console.warn(
          JSON.stringify({
            event: "mobile-push.retry",
            status: status || "transport",
          }),
        );
      }
    }
  }
  return sent;
}
