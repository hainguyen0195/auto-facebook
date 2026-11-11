import { describe, expect, it } from "vitest";
import { accountSchema } from "../../src/lib/schemas";
import { isQuietHour } from "../../src/lib/task-policy";

const account = { name: "Test", profileName: "Test", url: "facebook.com/test" };

describe("per-account quiet hours", () => {
  it.each([
    [21, 22, 7, false],
    [22, 22, 7, true],
    [0, 22, 7, true],
    [6, 22, 7, true],
    [7, 22, 7, false],
    [8, 9, 17, false],
    [9, 9, 17, true],
    [16, 9, 17, true],
    [17, 9, 17, false],
    [12, 0, 0, false],
  ])("checks hour %i against %i–%i", (hour, start, end, expected) => {
    expect(isQuietHour(hour, start, end, true)).toBe(expected);
    expect(isQuietHour(hour, start, end, false)).toBe(false);
  });

  it("preserves the hours when disabled and supports older clients", () => {
    expect(
      accountSchema.parse({
        ...account,
        quietHoursEnabled: false,
        quietStart: 20,
        quietEnd: 6,
      }),
    ).toMatchObject({ quietHoursEnabled: false, quietStart: 20, quietEnd: 6 });
    expect(accountSchema.parse(account).quietHoursEnabled).toBe(true);
    expect(
      accountSchema.parse({ ...account, quietStart: 0, quietEnd: 0 })
        .quietHoursEnabled,
    ).toBe(false);
  });

  it("requires a real rest interval when enabled", () => {
    expect(
      accountSchema.safeParse({
        ...account,
        quietHoursEnabled: true,
        quietStart: 0,
        quietEnd: 0,
      }).success,
    ).toBe(false);
    expect(
      accountSchema.safeParse({ ...account, quietHoursEnabled: "false" })
        .success,
    ).toBe(false);
  });
});
