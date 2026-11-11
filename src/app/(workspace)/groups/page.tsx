"use client";
import { Select } from "@/components/ui/select";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import Papa from "papaparse";
import {
  Archive,
  Download,
  ExternalLink,
  FileUp,
  Pencil,
  Plus,
  Upload,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  useAction,
  useDebounced,
  useResource,
  type AccountRow,
  type GroupRow,
  type PageData,
} from "@/lib/client";
import { groupSchema, type GroupInput } from "@/lib/schemas";
import { tagList } from "@/lib/utils";
import type { CsvRow, validateCsvRows } from "@/lib/csv";
import { groupRowsFromSheet } from "@/lib/group-import";
import {
  Avatar,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Pagination,
  SearchBox,
  Skeleton,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";

export default function GroupsPage() {
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const query = useResource<PageData<GroupRow>>(
    `groups?page=${page}&q=${encodeURIComponent(q)}&accountId=${accountId}`,
  );
  const accounts = useResource<AccountRow[]>("accounts");
  const [editor, setEditor] = useState<GroupRow | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [archive, setArchive] = useState<GroupRow | null>(null);
  const remove = useAction(
    (id: string) => api(`groups/${id}`, "DELETE"),
    "Đã lưu trữ nhóm và hủy các công việc chưa xử lý.",
  );
  return (
    <>
      <PageHeader
        eyebrow="MỖI NHÓM, MỘT CỘNG ĐỒNG"
        title="Hội nhóm của bạn"
        description="Ghi nhớ nội quy, liên kết tài khoản và tìm đúng nơi cho nội dung của bạn."
        actions={
          <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
            <Button variant="outline" onClick={() => setImporting(true)}>
              <FileUp size={16} />
              Nhập Excel / CSV
            </Button>
            <Button onClick={() => setEditor("new")}>
              <Plus size={16} />
              Thêm hội nhóm
            </Button>
          </div>
        }
      />
      <div className="toolbar">
        <div className="toolbar-left">
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Tìm tên nhóm, link, nhãn…"
          />
          <Select
            aria-label="Lọc nhóm theo tài khoản"
            value={accountId}
            onValueChange={(value) => {
              setAccountId(value);
              setPage(1);
            }}
          >
            <option value="">Tất cả tài khoản</option>
            {accounts.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <span className="results-count">
          {query.isLoading
            ? "Đang tải…"
            : query.error
              ? "Chưa tải được dữ liệu"
              : `${query.data?.total || 0} hội nhóm`}
        </span>
      </div>
      {query.isLoading ? (
        <Skeleton
          variant="table"
          columns={5}
          rows={6}
          label="Đang tải hội nhóm"
        />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      ) : (
        <div className="panel">
          {query.data?.items.length ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>HỘI NHÓM</th>
                      <th>TÀI KHOẢN LIÊN KẾT</th>
                      <th>NHÃN</th>
                      <th>KHOẢNG CÁCH BẠN ĐẶT</th>
                      <th>
                        <span className="sr-only">Thao tác</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.items.map((group) => (
                      <tr key={group.id}>
                        <td>
                          <div className="cell-title">
                            <button
                              type="button"
                              className="title-button"
                              onClick={() => setEditor(group)}
                              title="Chỉnh sửa hội nhóm"
                            >
                              {group.name}
                            </button>
                          </div>
                          <div className="cell-subtitle">
                            <a
                              className="cell-link"
                              href={group.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Mở hội nhóm <ExternalLink size={10} />
                            </a>
                            {group.rules && (
                              <span title={group.rules}> · Đã ghi nội quy</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="table-avatars">
                            {group.memberships.slice(0, 4).map((m) => (
                              <span title={m.account.name} key={m.accountId}>
                                <Avatar account={m.account} small />
                              </span>
                            ))}
                            {group.memberships.length > 4 && (
                              <span className="results-count">
                                +{group.memberships.length - 4}
                              </span>
                            )}
                            {!group.memberships.length && (
                              <span className="results-count">
                                Chưa liên kết
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          {group.tags.length ? (
                            group.tags.map((tag) => (
                              <span className="tag" key={tag}>
                                {tag}
                              </span>
                            ))
                          ) : (
                            <span className="results-count">—</span>
                          )}
                        </td>
                        <td>
                          <span className="results-count">
                            {group.minIntervalMinutes} phút
                          </span>
                        </td>
                        <td>
                          <div className="table-actions">
                            <button
                              className="icon-button"
                              aria-label={`Chỉnh sửa ${group.name}`}
                              onClick={() => setEditor(group)}
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`Lưu trữ ${group.name}`}
                              onClick={() => setArchive(group)}
                            >
                              <Archive size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={page}
                total={query.data.total}
                size={query.data.size}
                onChange={setPage}
              />
            </>
          ) : (
            <EmptyState
              title={
                search || accountId
                  ? "Chưa tìm thấy nhóm phù hợp"
                  : "Những cộng đồng đầu tiên của bạn"
              }
              description={
                search || accountId
                  ? "Hãy thử từ khóa hoặc tài khoản khác."
                  : "Thêm nhóm bạn đã tham gia, hoặc nhập nhiều nhóm từ file CSV."
              }
              icon={<UsersRound size={29} strokeWidth={1.4} />}
              action={
                !search &&
                !accountId && (
                  <Button variant="secondary" onClick={() => setEditor("new")}>
                    <Plus size={15} />
                    Thêm hội nhóm
                  </Button>
                )
              }
            />
          )}
        </div>
      )}
      {editor && (
        <GroupEditor
          group={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}
      {importing && (
        <ImportGroups
          accounts={accounts.data || []}
          onClose={() => setImporting(false)}
        />
      )}
      <ConfirmDialog
        open={!!archive}
        onClose={() => setArchive(null)}
        title={`Lưu trữ nhóm “${archive?.name || ""}”?`}
        description="Nhóm sẽ ẩn khỏi danh sách và các lịch chưa xử lý trong nhóm sẽ bị hủy. Lịch sử đã ghi nhận được giữ lại."
        loading={remove.isPending}
        confirmLabel="Lưu trữ hội nhóm"
        onConfirm={async () => {
          if (archive) {
            try {
              await remove.mutateAsync(archive.id);
              setArchive(null);
            } catch {}
          }
        }}
      />
    </>
  );
}
function GroupEditor({
  group,
  onClose,
}: {
  group?: GroupRow;
  onClose: () => void;
}) {
  const accountsQuery = useResource<AccountRow[]>("accounts");
  const accounts = accountsQuery.data || [];
  const form = useForm<z.input<typeof groupSchema>, unknown, GroupInput>({
    resolver: zodResolver(groupSchema),
    defaultValues: group
      ? { ...group, accountIds: group.memberships.map((m) => m.accountId) }
      : {
          name: "",
          url: "",
          tags: [],
          rules: "",
          minIntervalMinutes: 5,
          accountIds: [],
        },
  });
  const [tags, setTags] = useState(group?.tags.join(", ") || "");
  const errors = form.formState.errors;
  const save = useAction(
    (values: GroupInput) =>
      api(
        group ? `groups/${group.id}` : "groups",
        group ? "PATCH" : "POST",
        values,
      ),
    "Đã lưu hội nhóm.",
  );
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v && !save.isPending) onClose();
      }}
      title={group ? "Chỉnh sửa hội nhóm" : "Thêm một hội nhóm"}
      description="Thêm nhóm bạn đã tham gia và ghi lại các quy định cần nhớ."
    >
      <form
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          try {
            await save.mutateAsync({ ...values, tags: tagList(tags) });
            onClose();
          } catch {}
        })}
      >
        <Field
          label="Tên hội nhóm"
          htmlFor="group-name"
          error={errors.name?.message}
        >
          <input
            id="group-name"
            placeholder="Ví dụ: Chợ cư dân khu nhà mình"
            {...form.register("name")}
          />
        </Field>
        <Field
          label="Link hội nhóm"
          htmlFor="group-url"
          error={errors.url?.message}
        >
          <input
            id="group-url"
            placeholder="https://www.facebook.com/groups/…"
            {...form.register("url")}
          />
        </Field>
        <div className="form-grid">
          <Field label="Nhãn, cách nhau bằng dấu phẩy" htmlFor="group-tags">
            <input
              id="group-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Đồ gia dụng, Khu dân cư"
            />
          </Field>
          <Field
            label="Khoảng cách đăng bạn đặt (phút)"
            htmlFor="group-interval"
            error={errors.minIntervalMinutes?.message}
            hint="Khoảng cách giữa các lần bắt đầu đăng trong cùng nhóm, áp dụng chung cho các tài khoản. Đây không phải ngưỡng an toàn của Facebook."
          >
            <input
              id="group-interval"
              type="number"
              min={0}
              max={525600}
              {...form.register("minIntervalMinutes", { valueAsNumber: true })}
            />
            <div
              className="interval-presets"
              role="group"
              aria-label="Chọn nhanh khoảng cách đăng nhóm"
            >
              {[3, 5, 10, 15].map((minutes) => (
                <button
                  type="button"
                  key={minutes}
                  aria-pressed={form.watch("minIntervalMinutes") === minutes}
                  onClick={() =>
                    form.setValue("minIntervalMinutes", minutes, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                >
                  {minutes} phút
                </button>
              ))}
            </div>
          </Field>
        </div>
        <Field
          label="Tài khoản đã tham gia nhóm"
          hint="Chỉ chọn tài khoản có quyền đăng trong nhóm; một nhóm có thể liên kết nhiều tài khoản."
        >
          {accountsQuery.isLoading ? (
            <Skeleton
              variant="inline"
              rows={2}
              label="Đang tải tài khoản liên kết"
            />
          ) : accountsQuery.error ? (
            <ErrorState
              error={accountsQuery.error}
              retry={() => accountsQuery.refetch()}
            />
          ) : (
            <div className="checkbox-list">
              {accounts.map((a) => (
                <label className="checkbox-option" key={a.id}>
                  <input
                    type="checkbox"
                    value={a.id}
                    {...form.register("accountIds")}
                  />
                  <Avatar account={a} small />
                  {a.name}
                </label>
              ))}
              {!accounts.length && (
                <p className="field-hint">
                  Bạn có thể thêm tài khoản rồi quay lại liên kết sau.
                </p>
              )}
            </div>
          )}
        </Field>
        <Field
          label="Nội quy và ghi chú"
          htmlFor="group-rules"
          error={errors.rules?.message}
        >
          <textarea
            id="group-rules"
            rows={4}
            placeholder="Ví dụ: Chỉ đăng bán vào thứ Ba; ghi rõ giá và địa chỉ…"
            {...form.register("rules")}
          />
        </Field>
        <div className="dialog-footer">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={save.isPending}
          >
            Hủy
          </Button>
          <Button type="submit" loading={save.isPending}>
            Lưu hội nhóm
          </Button>
        </div>
      </form>
    </Modal>
  );
}
type Preview = ReturnType<typeof validateCsvRows>;
function ImportGroups({
  accounts,
  onClose,
}: {
  accounts: AccountRow[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [preview, setPreview] = useState<Preview>([]);
  const [reading, setReading] = useState(false);
  const [readCount, setReadCount] = useState(0);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const save = useAction((data: { rows: CsvRow[]; accountIds: string[] }) =>
    api<{ imported: number; skipped: number; invalid: number }>(
      "groups/import",
      "POST",
      data,
    ),
  );
  async function loadFile(file?: File) {
    if (!file) return;
    setError("");
    setPreview([]);
    setRows([]);
    setReadCount(0);
    setFilename(file.name);
    if (file.size > 1024 * 1024) {
      setError(
        "File Excel/CSV tối đa 1 MB và 1.000 nhóm. Hãy chia file lớn thành các phần nhỏ.",
      );
      return;
    }
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setError(
        "Hãy chọn file Excel .xlsx hoặc CSV .csv. Với file .xls, lưu lại dưới dạng .xlsx trong Excel.",
      );
      return;
    }
    setReading(true);
    if (/\.xlsx$/i.test(file.name)) {
      try {
        const { readSheet } = await import("read-excel-file/browser");
        let sheet;
        try {
          sheet = await readSheet(file);
        } catch {
          throw new Error(
            "Không đọc được file Excel. Hãy mở bằng Excel, lưu lại dạng .xlsx không đặt mật khẩu rồi thử lại.",
          );
        }
        const parsedRows = groupRowsFromSheet(sheet);
        setReadCount(parsedRows.length);
        await previewRows(parsedRows);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setReading(false);
      }
      return;
    }
    const parsedRows: CsvRow[] = [];
    const parseErrors: string[] = [];
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
      chunkSize: 32 * 1024,
      chunk: (results, parser) => {
        parsedRows.push(...results.data);
        setReadCount(parsedRows.length);
        if (results.errors.length)
          parseErrors.push(
            ...results.errors.map(
              (e) => `Dòng ${(e.row || 0) + 2}: ${e.message}`,
            ),
          );
        if (parsedRows.length > 1000) {
          parseErrors.push("File vượt quá 1.000 nhóm.");
          parser.abort();
          return;
        }
        parser.pause();
        setTimeout(() => parser.resume(), 0);
      },
      complete: async () => {
        if (parseErrors.length) {
          setError(parseErrors.slice(0, 5).join(" "));
          setReading(false);
          return;
        }
        try {
          await previewRows(parsedRows);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setReading(false);
        }
      },
      error: (e) => {
        setError(e.message);
        setReading(false);
      },
    });
  }
  async function previewRows(parsedRows: CsvRow[]) {
    if (!parsedRows.length)
      throw new Error("File chưa có dòng dữ liệu. Hãy dùng file mẫu bên dưới.");
    const headers = Object.keys(parsedRows[0]);
    if (
      !(headers.includes("name") || headers.includes("Tên nhóm")) ||
      !(headers.includes("url") || headers.includes("Link nhóm"))
    )
      throw new Error(
        "Dòng đầu cần có cột name, url hoặc Tên nhóm, Link nhóm. Hãy dùng file mẫu bên dưới.",
      );
    setRows(parsedRows);
    setPreview(
      await api<Preview>("groups/import-preview", "POST", { rows: parsedRows }),
    );
  }
  const valid = preview.filter((r) => r.status === "valid").length;
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v && !save.isPending && !reading) onClose();
      }}
      title="Nhập hội nhóm từ Excel / CSV"
      description="Nhận Excel .xlsx hoặc CSV. Với Excel, đọc trang tính đầu tiên. Xem trước và kiểm tra nhóm trùng trước khi nhập."
      wide
    >
      <label className="upload-zone">
        <Upload size={24} strokeWidth={1.4} />
        <strong>{filename || "Chọn file Excel hoặc CSV của bạn"}</strong>
        <small>Cột bắt buộc: name, url · Tối đa 1 MB, 1.000 nhóm</small>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv"
          aria-label="Chọn file Excel hoặc CSV hội nhóm"
          disabled={reading || save.isPending}
          onChange={(e) => loadFile(e.target.files?.[0])}
        />
      </label>
      <a
        href="/mau-hoi-nhom.csv"
        download
        className="cell-link"
        style={{ marginTop: 10, fontSize: 10 }}
      >
        <Download size={13} />
        Tải CSV mẫu có các cột nhãn, nội quy và khoảng cách đăng
      </a>
      {reading && (
        <div className="upload-progress" role="status">
          Đã đọc {readCount} dòng dữ liệu · Đang kiểm tra nhóm trùng…
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!!preview.length && (
        <>
          <div className="csv-summary">
            <span>{valid} nhóm hợp lệ</span>
            <span>
              {preview.filter((r) => r.status === "duplicate").length} nhóm
              trùng, bỏ qua
            </span>
            <span className="invalid">
              {preview.filter((r) => r.status === "invalid").length} dòng cần
              sửa
            </span>
          </div>
          <div className="csv-table">
            <table>
              <thead>
                <tr>
                  <th>DÒNG</th>
                  <th>TÊN NHÓM</th>
                  <th>KẾT QUẢ KIỂM TRA</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>{row.name || "Chưa có tên"}</td>
                    <td className={row.status}>{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 18 }}>
            <Field
              label="Liên kết các nhóm mới với tài khoản"
              hint="Có thể chọn nhiều tài khoản hoặc liên kết sau trong từng nhóm."
            >
              <div className="checkbox-list">
                {accounts.map((a) => (
                  <label className="checkbox-option" key={a.id}>
                    <input
                      type="checkbox"
                      checked={accountIds.includes(a.id)}
                      onChange={(e) =>
                        setAccountIds((ids) =>
                          e.target.checked
                            ? [...ids, a.id]
                            : ids.filter((id) => id !== a.id),
                        )
                      }
                    />
                    {a.name}
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <p className="field-hint">
            Chỉ các dòng hợp lệ được nhập. Các dòng lỗi và nhóm trùng được bỏ
            qua.
          </p>
        </>
      )}
      <div className="dialog-footer">
        <Button
          variant="outline"
          onClick={onClose}
          disabled={save.isPending || reading}
        >
          Đóng
        </Button>
        <Button
          disabled={!valid || reading}
          loading={save.isPending}
          onClick={async () => {
            try {
              const result = await save.mutateAsync({ rows, accountIds });
              toast.success(
                `Đã nhập ${result.imported} nhóm; bỏ qua ${result.skipped} nhóm trùng và ${result.invalid} dòng lỗi.`,
              );
              onClose();
            } catch {}
          }}
        >
          <FileUp size={15} />
          Nhập {valid || ""} nhóm hợp lệ
        </Button>
      </div>
    </Modal>
  );
}
