import { expect, it } from "vitest";
import {
  isRecentInboxConversation,
  INBOX_MESSAGE_WINDOW_MS,
} from "../../src/lib/inbox-types";
import { freshState, mergeSnapshot } from "../../src/inbox-trial/state";

it("counts only known message timestamps inside the last 48 hours", () => {
  const now = Date.parse("2026-11-09T14:00:00Z");
  const at = (age: number) => ({
    lastMessageAt: new Date(now - age).toISOString(),
  });
  expect(isRecentInboxConversation(at(0), now)).toBe(true);
  expect(isRecentInboxConversation(at(INBOX_MESSAGE_WINDOW_MS - 1), now)).toBe(
    true,
  );
  expect(isRecentInboxConversation(at(INBOX_MESSAGE_WINDOW_MS), now)).toBe(
    false,
  );
  expect(isRecentInboxConversation(at(7 * 86400000), now)).toBe(false);
  expect(isRecentInboxConversation(at(-60000), now)).toBe(false);
  expect(isRecentInboxConversation({}, now)).toBe(false);
  expect(isRecentInboxConversation({ lastMessageAt: "invalid" }, now)).toBe(
    false,
  );
});

it("repeated scans do not turn an old unread message into a recent one", () => {
  const now = new Date("2026-11-09T14:00:00Z");
  const row = {
    id: "123",
    name: "Customer",
    preview: "Hello",
    unread: true,
    lastMessageAt: "2026-11-06T14:00:00Z",
  };
  const baseline = mergeSnapshot(freshState("scope", now), [row], now);
  const next = mergeSnapshot(
    baseline,
    [{ id: "123", name: "Customer", preview: null, unread: true }],
    new Date(now.getTime() + 30000),
  );
  expect(next.conversations[0].lastMessageAt).toBe(row.lastMessageAt);
  expect(isRecentInboxConversation(next.conversations[0], now.getTime())).toBe(
    false,
  );
});
