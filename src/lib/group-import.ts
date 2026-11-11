import type { CsvRow } from "./csv";

const columns: Record<string, string> = {
  name: "name",
  "Tên nhóm": "name",
  url: "url",
  "Link nhóm": "url",
  tags: "tags",
  Nhãn: "tags",
  rules: "rules",
  "Nội quy": "rules",
  minIntervalMinutes: "minIntervalMinutes",
  minIntervalHours: "minIntervalHours",
};

export function groupRowsFromSheet(
  data: readonly (readonly unknown[])[],
): CsvRow[] {
  const headers = (data[0] || []).map((value) => {
    const header = String(value ?? "")
      .replace(/^\uFEFF/, "")
      .trim();
    return Object.hasOwn(columns, header) ? columns[header] : "";
  });
  if (!headers.includes("name") || !headers.includes("url"))
    throw new Error(
      "Dòng đầu cần có cột name, url hoặc Tên nhóm, Link nhóm. Hãy kiểm tra trang tính đầu tiên.",
    );
  const selected = headers.filter(Boolean);
  if (new Set(selected).size !== selected.length)
    throw new Error(
      "File có cột trùng tên. Mỗi cột chỉ nên xuất hiện một lần.",
    );
  const rows: CsvRow[] = [];
  for (const cells of data.slice(1)) {
    if (
      !cells.some(
        (value) =>
          value !== null && value !== undefined && String(value).trim() !== "",
      )
    )
      continue;
    rows.push(
      Object.fromEntries(
        headers.flatMap((header, index) =>
          header ? [[header, cells[index] ?? ""]] : [],
        ),
      ),
    );
    if (rows.length > 1000)
      throw new Error(
        "File vượt quá 1.000 nhóm. Hãy chia file thành các phần nhỏ.",
      );
  }
  return rows;
}
