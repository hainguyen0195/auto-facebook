"use client";
import { Select } from "@/components/ui/select";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  AlertTriangle,
  Archive,
  Clock3,
  ExternalLink,
  Monitor,
  Pencil,
  Plus,
  ShieldCheck,
  Users,
  UsersRound,
} from "lucide-react";
import { api, useAction, useResource, type AccountRow } from "@/lib/client";
import { accountSchema, type AccountInput } from "@/lib/schemas";
import {
  ACCOUNT_LABEL,
  cn,
  COLORS,
  formatIntervalMinutes,
  POST_INTERVAL_PRESETS,
} from "@/lib/utils";
import {
  Avatar,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  SearchBox,
  Skeleton,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { FacebookControls } from "@/components/desktop-panel";

export default function AccountsPage() {
  const params = useSearchParams();
  const query = useResource<AccountRow[]>("accounts");
  const [editor, setEditor] = useState<AccountRow | "new" | null>(null);
  const [archive, setArchive] = useState<AccountRow | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (params.get("new") === "1") setEditor("new");
  }, [params]);
  const remove = useAction(
    (id: string) => api(`accounts/${id}`, "DELETE"),
    "Đã lưu trữ tài khoản và hủy các công việc chưa xử lý.",
  );
  const items =
    query.data?.filter(
      (a) =>
        (!status || a.status === status) &&
        `${a.name} ${a.profileName}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) || [];
  return (
    <>
      <PageHeader
        eyebrow="ĐÚNG TÀI KHOẢN, ĐÚNG PROFILE"
        title="Tài khoản Facebook"
        description="Giữ thông tin tài khoản và profile trình duyệt trong một danh sách rõ ràng."
        actions={
          <Button onClick={() => setEditor("new")}>
            <Plus size={16} />
            Thêm tài khoản
          </Button>
        }
      />
      <div className="notice notice-teal" style={{ marginBottom: 22 }}>
        <ShieldCheck size={18} />
        <p>
          Chọn tài khoản rồi bấm Kết nối Facebook và đăng nhập trong cửa sổ mở
          ra. Ứng dụng tự kiểm tra phiên; bạn xác nhận đúng tài khoản để hoàn
          tất. Mỗi tài khoản dùng một cửa sổ đăng nhập riêng.
        </p>
      </div>
      <div className="toolbar">
        <div className="toolbar-left">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Tìm tên tài khoản, profile…"
          />
          <Select
            aria-label="Lọc trạng thái tài khoản"
            value={status}
            onValueChange={(value) => setStatus(value)}
          >
            <option value="">Tất cả trạng thái</option>
            {Object.entries(ACCOUNT_LABEL).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <span className="results-count">
          {query.isLoading
            ? "Đang tải…"
            : query.error
              ? "Chưa tải được dữ liệu"
              : `${items.length} tài khoản`}
        </span>
      </div>
      {query.isLoading ? (
        <Skeleton
          variant="cards"
          rows={3}
          label="Đang tải tài khoản Facebook"
        />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      ) : !items.length && query.data?.length ? (
        <div className="panel">
          <EmptyState
            title="Chưa tìm thấy tài khoản phù hợp"
            description="Thử một từ khóa hoặc bộ lọc khác."
          />
        </div>
      ) : (
        <div className="account-grid">
          {items.map((account) => (
            <article
              className="panel account-card animate-enter"
              key={account.id}
            >
              <div className="account-card-header">
                <Avatar account={account} />
                <div className="table-actions">
                  <button
                    className="icon-button"
                    aria-label={`Chỉnh sửa ${account.name}`}
                    onClick={() => setEditor(account)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Lưu trữ ${account.name}`}
                    onClick={() => setArchive(account)}
                  >
                    <Archive size={15} />
                  </button>
                </div>
              </div>
              <h3>{account.name}</h3>
              <a href={account.url} target="_blank" rel="noopener noreferrer">
                Trang cá nhân <ExternalLink size={10} />
              </a>
              <div className="account-details">
                <div>
                  <Monitor size={14} />
                  <span>{account.profileName}</span>
                </div>
                <div>
                  <UsersRound size={14} />
                  <span>
                    {account._count?.memberships || 0} hội nhóm đã liên kết
                  </span>
                </div>
              </div>
              <AccountQuietHours
                account={account}
                onEdit={() => setEditor(account)}
              />
              <div className="account-card-footer">
                <span
                  className={cn("account-status", account.status.toLowerCase())}
                >
                  <i
                    className={cn("account-dot", account.status.toLowerCase())}
                  />
                  {ACCOUNT_LABEL[account.status]}
                </span>
                <span className="results-count">
                  Mức bạn đặt: {account.dailyLimit} việc/ngày
                </span>
              </div>
              <FacebookControls account={account} />
            </article>
          ))}
          <button className="add-card" onClick={() => setEditor("new")}>
            <Plus size={26} strokeWidth={1.3} />
            <span>
              {items.length
                ? "Thêm một tài khoản"
                : "Thêm tài khoản Facebook đầu tiên"}
            </span>
            <small>Chỉ lưu thông tin, không lưu mật khẩu Facebook</small>
          </button>
        </div>
      )}
      {editor && (
        <AccountEditor
          account={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}
      <ConfirmDialog
        open={!!archive}
        onClose={() => setArchive(null)}
        title={`Lưu trữ ${archive?.name || "tài khoản"}?`}
        description="Các công việc chưa gửi của tài khoản sẽ bị hủy. Bài đã đăng và lịch sử được giữ lại."
        confirmLabel="Lưu trữ tài khoản"
        loading={remove.isPending}
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
function AccountQuietHours({
  account,
  onEdit,
}: {
  account: AccountRow;
  onEdit: () => void;
}) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const change = useAction(
    (enabled: boolean) =>
      api(`accounts/${account.id}/quiet-hours`, "PATCH", { enabled }),
    "Đã cập nhật giờ nghỉ.",
  );
  const enabled =
    optimistic ??
    (account.quietHoursEnabled && account.quietStart !== account.quietEnd);
  const hour = (value: number) => `${String(value).padStart(2, "0")}:00`;
  return (
    <div className="account-quiet-hours" data-enabled={enabled}>
      <label className="acknowledge">
        <input
          type="checkbox"
          aria-label={`Áp dụng giờ nghỉ cho ${account.name}`}
          checked={enabled}
          disabled={change.isPending}
          onChange={async (event) => {
            const checked = event.target.checked;
            setOptimistic(checked);
            try {
              await change.mutateAsync(checked);
            } catch {
            } finally {
              setOptimistic(null);
            }
          }}
        />
        Áp dụng giờ nghỉ
      </label>
      <div className="account-quiet-hours-summary" aria-live="polite">
        <Clock3 size={14} />
        <span>
          {change.isPending
            ? "Đang lưu…"
            : enabled
              ? `${hour(account.quietStart)}–${hour(account.quietEnd)} (UTC+7)`
              : "Làm cả ngày · Không áp dụng giờ nghỉ"}
        </span>
        {enabled && (
          <button type="button" onClick={onEdit} disabled={change.isPending}>
            Đổi giờ
          </button>
        )}
      </div>
    </div>
  );
}
function AccountEditor({
  account,
  onClose,
}: {
  account?: AccountRow;
  onClose: () => void;
}) {
  const form = useForm<z.input<typeof accountSchema>, unknown, AccountInput>({
    resolver: zodResolver(accountSchema),
    defaultValues: account || {
      name: "",
      url: "",
      profileName: "",
      color: "teal",
      status: "ACTIVE",
      dailyLimit: 10,
      postIntervalMinutes: 5,
      quietHoursEnabled: true,
      quietStart: 22,
      quietEnd: 7,
      note: "",
    },
  });
  const save = useAction(
    (values: AccountInput) =>
      api(
        account ? `accounts/${account.id}` : "accounts",
        account ? "PATCH" : "POST",
        values,
      ),
    account ? "Đã cập nhật tài khoản." : "Đã thêm tài khoản Facebook.",
  );
  const status = form.watch("status");
  const color = form.watch("color");
  const quietHoursEnabled = form.watch("quietHoursEnabled");
  const errors = form.formState.errors;
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v && !save.isPending) onClose();
      }}
      title={account ? "Chỉnh sửa tài khoản" : "Thêm tài khoản Facebook"}
      description="Bạn đăng nhập Facebook trong trình duyệt. Ở đây chỉ cần thông tin để tổ chức công việc."
    >
      <form
        onSubmit={form.handleSubmit(async (values) => {
          try {
            await save.mutateAsync(values);
            onClose();
          } catch {}
        })}
        noValidate
      >
        <div className="form-grid">
          <Field
            label="Tên tài khoản"
            htmlFor="account-name"
            error={errors.name?.message}
          >
            <input
              id="account-name"
              placeholder="Ví dụ: Linh — Shop nhà"
              {...form.register("name")}
            />
          </Field>
          <Field
            label="Tên profile trình duyệt"
            htmlFor="account-profile"
            error={errors.profileName?.message}
          >
            <input
              id="account-profile"
              placeholder="Ví dụ: Chrome — Linh bán hàng"
              {...form.register("profileName")}
            />
          </Field>
        </div>
        <Field
          label="Link trang cá nhân"
          htmlFor="account-url"
          error={errors.url?.message}
        >
          <input
            id="account-url"
            placeholder="https://www.facebook.com/ten-cua-ban"
            {...form.register("url")}
          />
        </Field>
        <Field label="Màu nhận diện">
          <div className="color-choices">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={cn("color-choice", c, color === c && "selected")}
                aria-label={`Màu ${c}`}
                aria-pressed={color === c}
                onClick={() => form.setValue("color", c)}
              />
            ))}
          </div>
        </Field>
        <div className="form-section-title">Nhịp làm việc do bạn đặt</div>
        <div className="form-grid">
          <Field label="Trạng thái bạn ghi nhận" htmlFor="account-status">
            <Select
              id="account-status"
              value={form.watch("status") || "ACTIVE"}
              onValueChange={(value) =>
                form.setValue(
                  "status",
                  value as "ACTIVE" | "PAUSED" | "RESTRICTED",
                  { shouldDirty: true, shouldValidate: true },
                )
              }
            >
              {Object.entries(ACCOUNT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Mức công việc mỗi ngày"
            htmlFor="daily-limit"
            error={errors.dailyLimit?.message}
          >
            <input
              id="daily-limit"
              type="number"
              min={1}
              max={100}
              {...form.register("dailyLimit", { valueAsNumber: true })}
            />
          </Field>
        </div>
        <div className="account-quiet-hours">
          <label className="acknowledge">
            <input
              type="checkbox"
              checked={quietHoursEnabled ?? true}
              onChange={(event) => {
                form.setValue("quietHoursEnabled", event.target.checked, {
                  shouldDirty: true,
                });
                if (
                  event.target.checked &&
                  form.getValues("quietStart") === form.getValues("quietEnd")
                ) {
                  form.setValue("quietStart", 22, { shouldDirty: true });
                  form.setValue("quietEnd", 7, { shouldDirty: true });
                }
                form.clearErrors("quietEnd");
              }}
            />
            Áp dụng giờ nghỉ
          </label>
          <p className="field-hint">
            {quietHoursEnabled
              ? "Tạm nghỉ đăng bài và tương tác trong khung giờ dưới đây."
              : "Làm cả ngày, không dừng theo giờ nghỉ. Khung giờ đã đặt được giữ để bật lại."}
          </p>
        </div>
        {quietHoursEnabled && (
          <div className="form-grid">
            <Field
              label="Giờ bắt đầu nghỉ (UTC+7)"
              htmlFor="quiet-start"
              error={errors.quietStart?.message}
            >
              <input
                id="quiet-start"
                type="number"
                min={0}
                max={23}
                {...form.register("quietStart", { valueAsNumber: true })}
              />
            </Field>
            <Field
              label="Giờ kết thúc nghỉ (UTC+7)"
              htmlFor="quiet-end"
              error={errors.quietEnd?.message}
            >
              <input
                id="quiet-end"
                type="number"
                min={0}
                max={23}
                {...form.register("quietEnd", { valueAsNumber: true })}
              />
            </Field>
          </div>
        )}
        <Field
          label="Khoảng cách giữa các bài (phút)"
          htmlFor="account-post-interval"
          error={errors.postIntervalMinutes?.message}
          hint="Áp dụng cho các bài tự đăng của tài khoản, kể cả khi khác nhóm hoặc khác lịch. Chọn nhanh 15, 30, 45 giây hoặc nhập số phút (0,25 phút = 15 giây). 0 = không đặt khoảng cách."
        >
          <input
            id="account-post-interval"
            type="number"
            step={0.25}
            min={0}
            max={10080}
            {...form.register("postIntervalMinutes", { valueAsNumber: true })}
          />
          <div
            className="interval-presets"
            role="group"
            aria-label="Chọn nhanh khoảng cách của tài khoản"
          >
            {POST_INTERVAL_PRESETS.map((minutes) => (
              <button
                type="button"
                key={minutes}
                aria-pressed={form.watch("postIntervalMinutes") === minutes}
                onClick={() =>
                  form.setValue("postIntervalMinutes", minutes, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              >
                {formatIntervalMinutes(minutes)}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Ghi chú" htmlFor="account-note">
          <textarea
            id="account-note"
            rows={2}
            placeholder="Điều cần nhớ khi dùng tài khoản này…"
            {...form.register("note")}
          />
        </Field>
        {status !== "ACTIVE" && (
          <div className="notice notice-amber">
            <AlertTriangle size={17} />
            <p>
              Khi lưu, các công việc chưa gửi của tài khoản sẽ tạm dừng. Bài
              đang chờ duyệt vẫn được giữ nguyên.
            </p>
          </div>
        )}
        {account?.status !== "ACTIVE" && status === "ACTIVE" && (
          <div className="notice notice-teal">
            <CheckIcon />
            <p>
              Các công việc bị tạm dừng theo tài khoản sẽ tiếp tục theo lịch cũ,
              bao gồm công việc đã quá hạn.
            </p>
          </div>
        )}
        <p className="field-hint">
          Mức công việc là thiết lập tổ chức của bạn, không bảo đảm tránh hạn
          chế Facebook. Bỏ chọn Áp dụng giờ nghỉ để làm cả ngày; mức việc/ngày
          và khoảng cách bài vẫn áp dụng.
        </p>
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
            {status !== "ACTIVE"
              ? "Lưu và tạm dừng công việc"
              : "Lưu tài khoản"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function CheckIcon() {
  return <ShieldCheck size={17} />;
}
