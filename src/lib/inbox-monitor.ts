import { z } from "zod";
import { AppError } from "./errors";
import type { InboxData } from "./inbox-types";

const snapshotSchema = z.object({
  accountName: z.string().max(200),
  status: z.enum([
    "STARTING",
    "LOGIN_REQUIRED",
    "CHALLENGE",
    "WRONG_IDENTITY",
    "PIN_REQUIRED",
    "UNSUPPORTED",
    "UNSAFE_VIEW",
    "ONLINE",
    "OFFLINE",
    "STOPPED",
  ]),
  checkedAt: z.iso.datetime(),
  lastSuccessAt: z.iso.datetime().nullable(),
  conversations: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        name: z.string().max(200),
        preview: z.string().max(1000).nullable(),
        unread: z.boolean().nullable(),
        observedAt: z.iso.datetime(),
        previewObservedAt: z.iso.datetime().nullable().optional(),
        unreadObservedAt: z.iso.datetime().nullable().optional(),
      }),
    )
    .max(1000),
});

export async function readInboxMonitor(
  origin: string,
  account: NonNullable<InboxData["account"]>,
  now = new Date(),
): Promise<InboxData> {
  try {
    const url = new URL(origin);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("Invalid monitor origin");
    const response = await fetch(new URL("/status", url), {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Monitor unavailable");
    const raw = await response.text();
    if (raw.length > 2_000_000) throw new Error("Oversized monitor response");
    const snapshot = snapshotSchema.parse(JSON.parse(raw));
    const recent = (at: string) => {
      const age = now.getTime() - Date.parse(at);
      return age >= -5000 && age < 24 * 60 * 60_000;
    };
    const age = now.getTime() - Date.parse(snapshot.checkedAt);
    return {
      configured: true,
      account,
      status: snapshot.status,
      checkedAt: snapshot.checkedAt,
      lastSuccessAt: snapshot.lastSuccessAt,
      fresh: age >= -5000 && age < 90_000,
      partial: true,
      conversations: snapshot.conversations
        .filter((row) => recent(row.observedAt))
        .map((row) => ({
          ...row,
          preview: recent(row.previewObservedAt ?? row.observedAt)
            ? row.preview
            : null,
          unread: recent(row.unreadObservedAt ?? row.observedAt)
            ? row.unread
            : null,
        })),
    };
  } catch {
    // Do not expose internal addresses, identifiers or raw monitor responses.
    throw new AppError(
      503,
      "Chưa kết nối được bộ theo dõi tin nhắn. Dữ liệu trước đó có thể đã cũ.",
    );
  }
}
