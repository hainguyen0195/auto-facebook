import { groupSchema } from "./schemas";

export type CsvRow = Record<string, unknown>;
export function validateCsvRows(rows: CsvRow[], existingUrls: Set<string>) {
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const result = groupSchema.safeParse({
      name: String(row.name ?? row["Tên nhóm"] ?? ""),
      url: String(row.url ?? row["Link nhóm"] ?? ""),
      tags: String(row.tags ?? row["Nhãn"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      rules: String(row.rules ?? row["Nội quy"] ?? ""),
      minIntervalMinutes:
        row.minIntervalMinutes === "" || row.minIntervalMinutes === undefined
          ? row.minIntervalHours === "" || row.minIntervalHours === undefined
            ? 5
            : Number(row.minIntervalHours) * 60
          : Number(row.minIntervalMinutes),
    });
    if (!result.success)
      return {
        row: index + 2,
        status: "invalid" as const,
        name: String(row.name ?? row["Tên nhóm"] ?? ""),
        message: result.error.issues.map((i) => i.message).join(" "),
        data: null,
      };
    if (result.data.url.endsWith("/groups/thay_ten_nhom"))
      return {
        row: index + 2,
        status: "invalid" as const,
        name: result.data.name,
        message:
          "Đây là dòng ví dụ trong file mẫu. Thay bằng nhóm thật hoặc xóa dòng này; dòng mẫu sẽ không được nhập.",
        data: null,
      };
    const duplicate =
      seen.has(result.data.url) || existingUrls.has(result.data.url);
    seen.add(result.data.url);
    return {
      row: index + 2,
      status: duplicate ? ("duplicate" as const) : ("valid" as const),
      name: result.data.name,
      message: duplicate
        ? "Nhóm đã có hoặc trùng trong file."
        : "Sẵn sàng nhập",
      data: result.data,
    };
  });
}
