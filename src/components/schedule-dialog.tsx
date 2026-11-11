"use client";
import { Select } from "@/components/ui/select";
import { useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Globe2,
  Search,
  UsersRound,
} from "lucide-react";
import {
  api,
  useAction,
  useDebounced,
  useResource,
  type AccountRow,
  type GroupRow,
  type PageData,
  type PostRow,
} from "@/lib/client";
import {
  localInput,
  localToISO,
  formatDate,
  formatTime,
  formatIntervalMinutes,
  POST_INTERVAL_PRESETS,
} from "@/lib/utils";
import type { ScheduleInput } from "@/lib/schemas";
import type { ScheduleGroupAccessCheck, ScheduleWarning } from "@/lib/service";
import { Avatar, ErrorState, Field, SearchBox, Skeleton } from "./common";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import { DateTimePicker } from "./ui/date-picker";

type Target = {
  accountId: string;
  groupId: string | null;
  name: string;
  accountName: string;
  sourceAccountId?: string;
  sourceAccountName?: string;
};
type Preview = {
  warnings: ScheduleWarning[];
  total: number;
  membershipLinks: ScheduleGroupAccessCheck[];
  targets: { accountId: string; groupId: string | null; scheduledAt: string }[];
};
export function ScheduleDialog({
  post,
  onClose,
}: {
  post?: PostRow;
  onClose: () => void;
}) {
  const [postId, setPostId] = useState(post?.id || "");
  const [executionMode, setExecutionMode] = useState<"MANUAL" | "AUTOMATIC">(
    "AUTOMATIC",
  );
  const [accountId, setAccountId] = useState("");
  const [groupSourceId, setGroupSourceId] = useState("");
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [time, setTime] = useState(
    localInput(new Date(Date.now() + 5 * 60_000)),
  );
  const [interval, setInterval] = useState(5);
  const [targets, setTargets] = useState<Target[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ack, setAck] = useState(false);
  const [confirmGroupAccess, setConfirmGroupAccess] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const accounts = useResource<AccountRow[]>("accounts");
  const selectedAccount = accounts.data?.find((a) => a.id === accountId);
  const sourceAccountId = groupSourceId || accountId;
  const sourceAccount = accounts.data?.find((a) => a.id === sourceAccountId);
  const posts = useResource<PageData<PostRow>>("posts?size=100", {
    enabled: !post,
  });
  const groups = useResource<PageData<GroupRow>>(
    `groups?accountId=${sourceAccountId}&page=${page}&size=15&q=${encodeURIComponent(q)}`,
    { enabled: !!accountId },
  );
  const inspect = useAction((input: ScheduleInput) =>
    api<Preview>("schedules/preview", "POST", input),
  );
  const create = useAction(
    (input: ScheduleInput) =>
      api<{ id: string; total: number }>("schedules", "POST", input),
    executionMode === "AUTOMATIC"
      ? "Đã tạo lịch tự đăng. Giữ máy đăng hoạt động khi đến giờ."
      : "Đã tạo lịch nhắc để bạn đăng thủ công.",
  );
  function toggle(groupId: string | null, name: string) {
    if (!selectedAccount) return;
    setTargets((items) =>
      items.some((t) => t.accountId === accountId && t.groupId === groupId)
        ? items.filter(
            (t) => !(t.accountId === accountId && t.groupId === groupId),
          )
        : [
            ...items,
            {
              accountId,
              groupId,
              name,
              accountName: selectedAccount.name,
              ...(groupId && sourceAccountId !== accountId
                ? { sourceAccountId, sourceAccountName: sourceAccount?.name }
                : {}),
            },
          ],
    );
  }
  function input(): ScheduleInput {
    return {
      executionMode,
      postId,
      scheduledAt: localToISO(time),
      intervalMinutes: interval,
      targets: targets.map(({ accountId, groupId, sourceAccountId }) => ({
        accountId,
        groupId,
        ...(sourceAccountId ? { sourceAccountId } : {}),
      })),
      acknowledgeWarnings: ack,
      confirmGroupAccess,
      idempotencyKey: key.current,
    };
  }
  const selectedPost = post || posts.data?.items.find((p) => p.id === postId);
  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v && !create.isPending && !inspect.isPending) onClose();
      }}
      title={
        preview ? "Kiểm tra lịch trước khi lưu" : "Sắp xếp một lịch đăng mới"
      }
      description={
        executionMode === "AUTOMATIC"
          ? "Máy đăng sẽ xử lý khi đến giờ, theo profile bạn đã đăng nhập và xác nhận."
          : "Đến giờ, công việc xuất hiện trong danh sách chờ để bạn đăng thủ công."
      }
      wide
    >
      {!preview ? (
        <div className="composer-grid">
          <div style={{ minWidth: 0 }}>
            <Field label="Cách thực hiện" htmlFor="schedule-mode">
              <Select
                id="schedule-mode"
                value={executionMode}
                onValueChange={(value) =>
                  setExecutionMode(value as "MANUAL" | "AUTOMATIC")
                }
              >
                <option value="AUTOMATIC">Tự đăng bằng máy đã kết nối</option>
                <option value="MANUAL">Nhắc tôi đăng thủ công</option>
              </Select>
              {executionMode === "AUTOMATIC" && (
                <p className="field-hint">
                  Máy cần bật, có mạng và phiên Facebook hợp lệ. Giờ nghỉ, mức
                  việc/ngày và khoảng cách nhóm được áp dụng khi chạy. Kết nối
                  Facebook tại mục Máy đăng.
                </p>
              )}
            </Field>
            {post ? (
              <div className="schedule-post-heading">
                <span className="eyebrow">BÀI VIẾT ĐÃ CHỌN</span>
                <h3>{post.title}</h3>
                <p>
                  {post.content.slice(0, 160)}
                  {post.content.length > 160 ? "…" : ""}
                </p>
              </div>
            ) : (
              <Field label="Chọn bài từ thư viện" htmlFor="schedule-post">
                <Select
                  id="schedule-post"
                  disabled={posts.isLoading || !!posts.error}
                  value={postId}
                  onValueChange={(value) => setPostId(value)}
                >
                  <option value="">
                    {posts.isLoading ? "Đang tải thư viện…" : "Chọn bài viết…"}
                  </option>
                  {posts.data?.items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </Select>
                {posts.isLoading && (
                  <p className="field-hint">Đang tải thư viện…</p>
                )}
                {posts.error && (
                  <ErrorState
                    error={posts.error}
                    retry={() => posts.refetch()}
                  />
                )}
                {posts.data && !posts.data.items.length && (
                  <p className="field-hint">
                    Hãy tạo một bài trong thư viện trước khi lên lịch.
                  </p>
                )}
              </Field>
            )}
            <Field label="Thời gian bắt đầu (UTC+7)" htmlFor="schedule-time">
              <DateTimePicker
                id="schedule-time"
                value={time}
                onValueChange={setTime}
              />
            </Field>
            <Field
              label="Khoảng cách giữa các nơi đăng (phút)"
              htmlFor="schedule-interval"
              hint="Chọn nhanh 15, 30, 45 giây hoặc nhập số phút (0,25 phút = 15 giây). 0 = cùng thời điểm đến hạn. Máy xử lý tuần tự và vẫn áp dụng khoảng cách của tài khoản, nhóm, giới hạn ngày và giờ nghỉ."
            >
              <input
                id="schedule-interval"
                type="number"
                step={0.25}
                min={0}
                max={10080}
                value={interval}
                onChange={(e) => setInterval(Number(e.target.value))}
              />
              <div
                className="interval-presets"
                role="group"
                aria-label="Chọn nhanh khoảng cách giữa các nơi đăng"
              >
                {POST_INTERVAL_PRESETS.map((minutes) => (
                  <button
                    type="button"
                    key={minutes}
                    aria-pressed={interval === minutes}
                    onClick={() => setInterval(minutes)}
                  >
                    {formatIntervalMinutes(minutes)}
                  </button>
                ))}
              </div>
            </Field>
            <div className="notice notice-teal">
              <Check size={17} />
              <p>
                Bản lịch giữ lại nội dung và ảnh hiện tại, giúp bạn biết chính
                xác bài nào đã được chuẩn bị.
              </p>
            </div>
            <div className="selected-targets">
              <strong>{targets.length} nơi đăng đã chọn</strong>
              {targets.slice(0, 8).map((t) => (
                <div key={`${t.accountId}:${t.groupId}`}>
                  <span>
                    {t.accountName} → {t.name}
                  </span>
                  <button
                    aria-label={`Bỏ ${t.accountName} tại ${t.name}`}
                    onClick={() =>
                      setTargets((items) => items.filter((item) => item !== t))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              {targets.length > 8 && (
                <small>Và {targets.length - 8} nơi khác.</small>
              )}
            </div>
          </div>
          <div className="preview-column" style={{ minWidth: 0 }}>
            <Field label="Tài khoản đăng" htmlFor="schedule-account">
              <Select
                id="schedule-account"
                disabled={accounts.isLoading || !!accounts.error}
                value={accountId}
                onValueChange={(value) => {
                  setAccountId(value);
                  setGroupSourceId("");
                  setPage(1);
                  setSearch("");
                }}
              >
                <option value="">
                  {accounts.isLoading
                    ? "Đang tải tài khoản…"
                    : "Chọn tài khoản…"}
                </option>
                {accounts.data
                  ?.filter((a) => a.status === "ACTIVE")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {a.profileName}
                    </option>
                  ))}
              </Select>
              {accounts.error && (
                <ErrorState
                  error={accounts.error}
                  retry={() => accounts.refetch()}
                />
              )}
            </Field>
            {selectedAccount && (
              <>
                <label className="schedule-group schedule-profile">
                  <input
                    type="checkbox"
                    checked={targets.some(
                      (t) => t.accountId === accountId && t.groupId === null,
                    )}
                    onChange={() => toggle(null, "Trang cá nhân")}
                  />
                  <Globe2 size={15} />
                  <span>Trang cá nhân của {selectedAccount.name}</span>
                </label>
                <Field
                  label="Lấy danh sách nhóm từ"
                  htmlFor="schedule-group-source"
                >
                  <Select
                    id="schedule-group-source"
                    value={groupSourceId}
                    onValueChange={(value) => {
                      setGroupSourceId(value);
                      setPage(1);
                      setSearch("");
                    }}
                  >
                    <option value="">Nhóm của tài khoản đăng</option>
                    {accounts.data
                      ?.filter((a) => a.id !== accountId)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} — {a.profileName}
                          {a.status === "RESTRICTED"
                            ? " (Hạn chế)"
                            : a.status === "PAUSED"
                              ? " (Tạm dừng)"
                              : ""}
                        </option>
                      ))}
                  </Select>
                  {groupSourceId && (
                    <p className="field-hint">
                      Lấy nhóm của {sourceAccount?.name} để đăng bằng{" "}
                      {selectedAccount.name}. Chỉ dùng danh sách nhóm để tạo
                      lịch; danh sách nhóm và các lịch cũ của từng tài khoản vẫn
                      giữ nguyên.
                    </p>
                  )}
                </Field>
                <SearchBox
                  value={search}
                  onChange={(v) => {
                    setSearch(v);
                    setPage(1);
                  }}
                  placeholder="Tìm trong danh sách nhóm…"
                />
                {groups.isLoading ? (
                  <Skeleton rows={3} />
                ) : groups.error ? (
                  <ErrorState
                    error={groups.error}
                    retry={() => groups.refetch()}
                  />
                ) : (
                  <>
                    <div
                      className="schedule-selection-heading"
                      style={{ gap: 12, flexWrap: "wrap" }}
                    >
                      <span>
                        {groups.data?.total || 0} nhóm của {sourceAccount?.name}
                      </span>
                      <button
                        onClick={() => {
                          const additions = (groups.data?.items || [])
                            .filter(
                              (g) =>
                                !targets.some(
                                  (t) =>
                                    t.accountId === accountId &&
                                    t.groupId === g.id,
                                ),
                            )
                            .map((g) => ({
                              accountId,
                              groupId: g.id,
                              name: g.name,
                              accountName: selectedAccount.name,
                              ...(sourceAccountId !== accountId
                                ? {
                                    sourceAccountId,
                                    sourceAccountName: sourceAccount?.name,
                                  }
                                : {}),
                            }));
                          setTargets((items) =>
                            [...items, ...additions].slice(0, 500),
                          );
                        }}
                      >
                        Chọn trang này
                      </button>
                    </div>
                    <div className="schedule-targets">
                      {groups.data?.items.map((group) => (
                        <label className="schedule-group" key={group.id}>
                          <input
                            type="checkbox"
                            checked={targets.some(
                              (t) =>
                                t.accountId === accountId &&
                                t.groupId === group.id,
                            )}
                            onChange={() => toggle(group.id, group.name)}
                          />
                          <UsersRound size={13} />
                          <span>{group.name}</span>
                        </label>
                      ))}
                      {!groups.data?.items.length && (
                        <p className="field-hint">
                          Chưa có nhóm phù hợp trong danh sách của{" "}
                          {sourceAccount?.name}.
                        </p>
                      )}
                    </div>
                    {groups.data && groups.data.total > 15 && (
                      <div className="schedule-pagination">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Trang nhóm trước"
                          disabled={page <= 1}
                          onClick={() => setPage((p) => p - 1)}
                        >
                          <ChevronLeft size={15} />
                        </Button>
                        <span>
                          Trang {page}/{Math.ceil(groups.data.total / 15)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Trang nhóm sau"
                          disabled={page * 15 >= groups.data.total}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          <ChevronRight size={15} />
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            <p className="field-hint" style={{ marginTop: 15 }}>
              Có thể đổi tài khoản và chọn thêm nhóm; các nơi đã chọn được giữ
              lại. Tối đa 500 nơi trong một lịch.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="schedule-review-heading">
            <CalendarPlus size={26} />
            <div>
              <h3>{selectedPost?.title || "Bài viết đã chọn"}</h3>
              <p>
                {preview.total} nơi đăng · Bắt đầu{" "}
                {formatTime(time + ":00+07:00")} ngày{" "}
                {formatDate(time + ":00+07:00", { year: "numeric" })}
              </p>
            </div>
          </div>
          <div className="csv-table">
            <table>
              <thead>
                <tr>
                  <th>TÀI KHOẢN</th>
                  <th>NƠI ĐĂNG</th>
                  <th>THỜI GIAN (UTC+7)</th>
                </tr>
              </thead>
              <tbody>
                {preview.targets.map((t, i) => (
                  <tr key={i}>
                    <td>{targets[i]?.accountName}</td>
                    <td>
                      {targets[i]?.name}
                      {targets[i]?.sourceAccountName && (
                        <p className="field-hint">
                          Nhóm từ {targets[i].sourceAccountName}
                        </p>
                      )}
                    </td>
                    <td>
                      {formatDate(t.scheduledAt)} ·{" "}
                      {formatTime(
                        t.scheduledAt,
                        interval % 1 ? { second: "2-digit" } : undefined,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!preview.membershipLinks.length && (
            <div className="warning-list">
              <strong>
                Xác nhận quyền đăng vào {preview.membershipLinks.length} nhóm từ
                tài khoản khác
              </strong>
              {preview.membershipLinks.slice(0, 5).map((link) => (
                <p key={`${link.accountId}:${link.groupId}`}>
                  {link.accountName} → {link.groupName}
                </p>
              ))}
              {preview.membershipLinks.length > 5 && (
                <p>
                  Và {preview.membershipLinks.length - 5} nhóm khác đã chọn.
                </p>
              )}
              <label className="acknowledge">
                <input
                  type="checkbox"
                  checked={confirmGroupAccess}
                  onChange={(e) => setConfirmGroupAccess(e.target.checked)}
                />
                Tôi xác nhận tài khoản đăng có quyền đăng vào các nhóm đã chọn.
              </label>
              <p>
                Chỉ dùng nhóm cho lịch này, không thêm nhóm vào danh sách của
                tài khoản đăng.
              </p>
            </div>
          )}
          {preview.warnings.length ? (
            <>
              <div className="warning-list" role="alert">
                <strong>
                  <AlertTriangle
                    size={14}
                    style={{ display: "inline", marginRight: 5 }}
                  />
                  Các điểm bạn cần xem lại
                </strong>
                {preview.warnings.map((warning, i) => (
                  <p key={i}>• {warning.message}</p>
                ))}
              </div>
              <label className="acknowledge">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                Tôi đã đọc các nhắc nhở và muốn lưu lịch này. Tôi hiểu các mức
                đặt trong ứng dụng không bảo đảm tránh hạn chế Facebook.
              </label>
            </>
          ) : (
            <div className="notice notice-teal" style={{ marginTop: 16 }}>
              <Check size={17} />
              <p>
                Chưa có xung đột với các thiết lập trong ứng dụng. Bạn vẫn cần
                kiểm tra nội quy và quyền đăng trên Facebook.
              </p>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-footer">
        <Button
          variant="outline"
          disabled={create.isPending || inspect.isPending}
          onClick={() => {
            if (preview) {
              setPreview(null);
              setAck(false);
              setConfirmGroupAccess(false);
              setError("");
            } else onClose();
          }}
        >
          {preview && <ArrowLeft size={14} />}
          {preview ? "Quay lại chỉnh" : "Hủy"}
        </Button>
        {preview ? (
          <Button
            loading={create.isPending}
            disabled={
              (!!preview.warnings.length && !ack) ||
              (!!preview.membershipLinks.length && !confirmGroupAccess)
            }
            onClick={async () => {
              setError("");
              try {
                await create.mutateAsync(input());
                onClose();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <CalendarPlus size={16} />
            Lưu {preview.total} công việc
          </Button>
        ) : (
          <Button
            loading={inspect.isPending}
            disabled={
              !postId || !targets.length || targets.length > 500 || !time
            }
            onClick={async () => {
              setError("");
              try {
                setPreview(await inspect.mutateAsync(input()));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Kiểm tra lịch <ArrowRight size={15} />
          </Button>
        )}
      </div>
    </Modal>
  );
}
