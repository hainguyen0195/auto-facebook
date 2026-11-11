import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { normalizeFacebookUrl } from "../../src/lib/schemas";
import {
  canTransition,
  contentFingerprint,
  isQuietHour,
} from "../../src/lib/task-policy";
import {
  dayBounds,
  dateKey,
  localInput,
  localToISO,
} from "../../src/lib/utils";
import { validateCsvRows } from "../../src/lib/csv";
import { calendarRange } from "../../src/lib/calendar";

describe("Facebook links", () => {
  it("normalizes group aliases, tracking parameters and trailing slashes", () =>
    expect(
      normalizeFacebookUrl(
        "https://m.facebook.com/groups/My.Shop/?ref=share",
        "group",
      ),
    ).toBe("https://www.facebook.com/groups/my.shop"));
  it.each([
    "https://facebook.com.evil.test/groups/a",
    "https://evil.test@facebook.com/groups/a",
    "javascript:alert(1)",
    "https://facebook.com:8080/groups/a",
    "https://facebook.com/groups/a/posts/123",
  ])("rejects unsafe or non-group target %s", (input) =>
    expect(() => normalizeFacebookUrl(input, "group")).toThrow(),
  );
  it("keeps numeric profile identifiers", () =>
    expect(
      normalizeFacebookUrl(
        "facebook.com/profile.php?id=123&ref=share",
        "profile",
      ),
    ).toBe("https://www.facebook.com/profile.php?id=123"));
});
describe("manual results and pauses", () => {
  it("requires starting before claiming published", () => {
    expect(canTransition("READY", "PUBLISHED")).toBe(false);
    expect(canTransition("IN_PROGRESS", "PUBLISHED")).toBe(true);
  });
  it("keeps pending approval editable without treating it as published", () => {
    expect(canTransition("PENDING_REVIEW", "PUBLISHED")).toBe(true);
    expect(canTransition("PENDING_REVIEW", "IN_PROGRESS")).toBe(false);
  });
  it("does not re-open completed work", () =>
    expect(canTransition("PUBLISHED", "IN_PROGRESS")).toBe(false));
  it("handles overnight quiet hours and the disabled setting", () => {
    expect(isQuietHour(23, 22, 7)).toBe(true);
    expect(isQuietHour(6, 22, 7)).toBe(true);
    expect(isQuietHour(7, 22, 7)).toBe(false);
    expect(isQuietHour(12, 0, 0)).toBe(false);
  });
  it("normalizes whitespace and Vietnamese Unicode for duplicate detection", () =>
    expect(contentFingerprint("  CÀ PHÊ\n mới  ")).toBe(
      contentFingerprint("cà phê mới".normalize("NFD")),
    ));
});
describe("UTC+7 schedules", () => {
  it("puts 17:00 UTC in the next local day", () => {
    expect(dateKey("2026-11-02T17:00:00Z")).toBe("2026-11-03");
    expect(dayBounds("2026-11-02T17:00:00Z").start.toISOString()).toBe(
      "2026-11-02T17:00:00.000Z",
    );
  });
  it("round trips local form input", () =>
    expect(localInput(localToISO("2026-11-02T09:30"))).toBe(
      "2026-11-02T09:30",
    ));
  it("uses Monday-based week bounds even over year boundaries", () => {
    const range = calendarRange(new Date("2027-01-01T12:00:00Z"), "week");
    expect(range.start).toBe("2026-12-28T00:00:00+07:00");
    expect(range.days).toHaveLength(7);
  });
});
describe("CSV imports", () => {
  it("accepts minute intervals and converts the legacy hours column without losing its meaning", () => {
    const rows = validateCsvRows(
      [
        {
          name: "Minutes",
          url: "facebook.com/groups/minutes",
          minIntervalMinutes: "3",
        },
        {
          name: "Legacy",
          url: "facebook.com/groups/legacy",
          minIntervalHours: "24",
        },
        { name: "Default", url: "facebook.com/groups/default" },
      ],
      new Set(),
    );
    expect(rows.map((row) => row.data?.minIntervalMinutes)).toEqual([
      3, 1440, 5,
    ]);
  });
  it("handles quoted commas, duplicates and invalid rows independently", () => {
    const text =
      'name,url,tags\n"Chợ, nhà mình",https://facebook.com/groups/one,"Đồ nhà,Đồ bếp"\nTrùng,https://m.facebook.com/groups/one/,\nCó sẵn,https://facebook.com/groups/existing,\nSai,https://evil.test/group,';
    const rows = Papa.parse<Record<string, unknown>>(text, {
      header: true,
    }).data;
    const result = validateCsvRows(
      rows,
      new Set(["https://www.facebook.com/groups/existing"]),
    );
    expect(result.map((x) => x.status)).toEqual([
      "valid",
      "duplicate",
      "duplicate",
      "invalid",
    ]);
    expect(result[0].data?.name).toBe("Chợ, nhà mình");
    expect(result[0].data?.tags).toEqual(["Đồ nhà", "Đồ bếp"]);
  });
  it("rejects non-numeric interval instead of silently accepting it", () =>
    expect(
      validateCsvRows(
        [
          {
            name: "A",
            url: "facebook.com/groups/a",
            minIntervalMinutes: "oops",
          },
        ],
        new Set(),
      )[0].status,
    ).toBe("invalid"));
});
