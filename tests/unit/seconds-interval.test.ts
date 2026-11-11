import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { accountSchema, scheduleSchema } from "../../src/lib/schemas";
import { formatIntervalMinutes, formatTime } from "../../src/lib/utils";

it.each([0, 0.25, 0.5, 0.75, 1, 5, 10080])(
  "accepts legacy and 15-second increments: %s",
  (minutes) => {
    expect(
      accountSchema.parse({
        name: "Test",
        profileName: "Test",
        url: "facebook.com/test",
        postIntervalMinutes: minutes,
      }).postIntervalMinutes,
    ).toBe(minutes);
    expect(
      scheduleSchema.parse({
        postId: "post",
        scheduledAt: "2026-11-07T12:00:00Z",
        intervalMinutes: minutes,
        targets: [{ accountId: "account", groupId: null }],
        idempotencyKey: randomUUID(),
      }).intervalMinutes,
    ).toBe(minutes);
  },
);
it.each([-0.25, 0.1, 10080.25])(
  "rejects unsupported intervals: %s",
  (minutes) => {
    expect(
      accountSchema.safeParse({
        name: "Test",
        profileName: "Test",
        url: "facebook.com/test",
        postIntervalMinutes: minutes,
      }).success,
    ).toBe(false);
  },
);
it("formats second intervals and minute-plus-second values", () => {
  expect([0, 0.25, 0.5, 0.75, 1, 1.25].map(formatIntervalMinutes)).toEqual([
    "0 giây",
    "15 giây",
    "30 giây",
    "45 giây",
    "1 phút",
    "1 phút 15 giây",
  ]);
  expect(formatTime("2026-11-07T12:00:15Z")).toBe("19:00:15");
  expect(formatTime("2026-11-07T12:00:00Z")).toBe("19:00");
  expect(formatTime("2026-11-07T12:00:00Z", { second: "2-digit" })).toBe(
    "19:00:00",
  );
});
