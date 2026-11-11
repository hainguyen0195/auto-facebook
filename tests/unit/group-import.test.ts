import { describe, expect, it } from "vitest";
import { groupRowsFromSheet } from "../../src/lib/group-import";
import { validateCsvRows } from "../../src/lib/csv";

describe("Excel group imports", () => {
  it("reads optional empty cells without changing the default interval to zero", () => {
    const rows = groupRowsFromSheet([
      ["name", "url", "tags", "rules", "minIntervalHours"],
      [
        "Hội nhóm",
        "https://facebook.com/groups/shop/?ref=share",
        null,
        null,
        null,
      ],
    ]);
    expect(validateCsvRows(rows, new Set())[0].data).toMatchObject({
      name: "Hội nhóm",
      url: "https://www.facebook.com/groups/shop",
      tags: [],
      rules: "",
      minIntervalMinutes: 5,
    });
  });
  it("supports Vietnamese headers, BOM, numeric hours and explicit zero minutes", () => {
    const rows = groupRowsFromSheet([
      [
        "\uFEFF Tên nhóm ",
        "Link nhóm",
        "minIntervalHours",
        "minIntervalMinutes",
      ],
      ["Theo giờ", "facebook.com/groups/hours", 24, null],
      ["Không chờ", "facebook.com/groups/zero", null, 0],
    ]);
    expect(
      validateCsvRows(rows, new Set()).map(
        (row) => row.data?.minIntervalMinutes,
      ),
    ).toEqual([1440, 0]);
  });
  it("rejects missing and ambiguous required columns", () => {
    expect(() => groupRowsFromSheet([["name"]])).toThrow("name, url");
    expect(() => groupRowsFromSheet([["name", "Tên nhóm", "url"]])).toThrow(
      "trùng tên",
    );
    expect(() => groupRowsFromSheet([])).toThrow("Dòng đầu");
  });
  it("ignores blank rows and rejects more than 1000 non-empty rows", () => {
    expect(
      groupRowsFromSheet([
        ["name", "url"],
        [null, null],
        [" ", null],
      ]),
    ).toEqual([]);
    const data = Array.from({ length: 1001 }, (_, index) => [
      `Group ${index}`,
      `facebook.com/groups/g${index}`,
    ]);
    expect(() => groupRowsFromSheet([["name", "url"], ...data])).toThrow(
      "1.000 nhóm",
    );
  });
  it("keeps duplicate validation and skips the unchanged example row", () => {
    const result = validateCsvRows(
      groupRowsFromSheet([
        ["name", "url"],
        ["Tên nhóm của bạn", "https://www.facebook.com/groups/THAY_TEN_NHOM"],
        ["Nhóm thật", "facebook.com/groups/shop"],
        ["Nhóm trùng", "https://m.facebook.com/groups/shop/?ref=share"],
      ]),
      new Set(),
    );
    expect(result.map((row) => row.status)).toEqual([
      "invalid",
      "valid",
      "duplicate",
    ]);
    expect(result[0].message).toContain("dòng ví dụ");
  });
});
