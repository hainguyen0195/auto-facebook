"use client";
import { useState } from "react";
import {
  CalendarCheck,
  CalendarClock,
  CheckCheck,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import {
  useResource,
  type PageData,
  type PostRow,
  type PostScheduleAccount,
  type PostScheduleTask,
} from "@/lib/client";
import {
  STATUSES,
  STATUS_LABEL,
  formatDate,
  formatTime,
  type Status,
} from "@/lib/utils";
import { Avatar, EmptyState, ErrorState, Pagination, Skeleton } from "./common";
import { Modal } from "./ui/dialog";
import { Select } from "./ui/select";
import { Button } from "./ui/button";

const labels = { ...STATUS_LABEL, BLOCKED: "Cần kiểm tra" };
export type PostScheduleSelection = {
  post: PostRow;
  account: PostScheduleAccount;
  status?: Status;
};

export function PostScheduleSummary({
  post,
  onOpen,
}: {
  post: PostRow;
  onOpen: (selection: PostScheduleSelection) => void;
}) {
  const accounts = post.scheduledAccounts || [];
  if (!accounts.length)
    return (
      <div className="post-schedule-empty">
        <CalendarClock size={14} aria-hidden="true" />
        Chưa từng lên lịch
      </div>
    );
  const total = accounts.reduce((sum, account) => sum + account.taskCount, 0);
  return (
    <div
      className="post-schedule"
      role="group"
      aria-label={`Lịch đăng của ${post.title}`}
    >
      <div className="post-schedule-heading">
        <span>
          <CalendarCheck size={15} aria-hidden="true" />
          Đã lên lịch cho
        </span>
        <span>{total} lượt đã tạo</span>
      </div>
      <ul className="post-schedule-accounts">
        {accounts.map((account) => (
          <li key={account.id}>
            <button
              type="button"
              className="post-schedule-account"
              aria-label={`Xem lịch ${post.title} của ${account.name}`}
              onClick={() => onOpen({ post, account })}
            >
              <Avatar account={account} small />
              <span className="post-schedule-name">{account.name}</span>
              <span className="post-schedule-count">
                {account.taskCount} lượt
              </span>
              <ChevronRight size={13} aria-hidden="true" />
            </button>
            <div className="post-schedule-statuses">
              {STATUSES.filter((status) => account.byStatus[status] > 0).map(
                (status) => (
                  <button
                    type="button"
                    key={status}
                    className={`post-schedule-status post-schedule-status-${status.toLowerCase()}`}
                    onClick={() => onOpen({ post, account, status })}
                    aria-label={`Xem ${account.byStatus[status]} lượt ${labels[status]} của ${account.name} cho ${post.title}`}
                  >
                    {labels[status]} <strong>{account.byStatus[status]}</strong>
                  </button>
                ),
              )}
              {account.archivedUnfinishedCount > 0 && (
                <span className="post-schedule-archived">
                  Đã xóa trước khi xử lý {account.archivedUnfinishedCount}
                </span>
              )}
            </div>
            {account.byStatus.PUBLISHED === account.taskCount && (
              <span className="post-schedule-done">
                <CheckCheck size={12} />
                Đã đăng xong
              </span>
            )}
            {account.archivedCount > 0 && (
              <span className="post-schedule-history-note">
                Giữ lịch sử {account.archivedCount} lượt đã xóa khỏi Lịch đăng.
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="post-schedule-hint">
        Bấm tài khoản hoặc trạng thái để xem từng nơi đăng.
      </p>
    </div>
  );
}

function failureNote(task: PostScheduleTask) {
  if (
    task.status === "BLOCKED" &&
    task.automaticPhase === "SAFE_FAILED" &&
    task.note.includes("bước mở trình soạn bài")
  )
    return "Không mở được ô soạn bài trong thời gian chờ. Chưa bấm Đăng nên bài chưa được gửi.";
  return task.note;
}
export function PostScheduleDetails({
  selection,
  onClose,
  onOpenTask,
}: {
  selection: PostScheduleSelection;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const { post, account } = selection;
  const [status, setStatus] = useState(selection.status || "");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({
    accountId: account.id,
    status,
    page: String(page),
    size: "10",
  });
  const query = useResource<PageData<PostScheduleTask>>(
    `posts/${post.id}/schedules?${params}`,
    { refetchInterval: 15_000 },
  );
  return (
    <Modal
      open
      onOpenChange={onClose}
      title={`Lịch đăng · ${account.name}`}
      description={`${post.title} · Toàn bộ lịch sử, gồm cả lượt đã đăng và đã xóa khỏi Lịch đăng.`}
      wide
    >
      <div className="post-schedule-detail-toolbar">
        <Select
          aria-label="Lọc trạng thái lịch của bài"
          value={status}
          onValueChange={(value) => {
            setStatus(value as Status | "");
            setPage(1);
          }}
        >
          <option value="">Tất cả trạng thái</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {labels[s]}
            </option>
          ))}
        </Select>
        <span className="results-count">
          {query.isLoading
            ? "Đang tải…"
            : query.error
              ? "Chưa tải được dữ liệu"
              : `${query.data?.total || 0} lượt${status ? ` · ${labels[status as Status]}` : " đã tạo"}`}
        </span>
      </div>
      {query.isLoading ? (
        <Skeleton rows={3} />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      ) : query.data?.items.length ? (
        <>
          <ul className="post-schedule-detail-list">
            {query.data.items.map((task) => (
              <li key={task.id}>
                <div className="post-schedule-detail-heading">
                  <h3>{task.group?.name || "Trang cá nhân"}</h3>
                  <span
                    className={`status status-${task.status.toLowerCase()}`}
                  >
                    {task.status === "BLOCKED" &&
                    task.automaticPhase === "SAFE_FAILED"
                      ? "Chưa gửi được"
                      : labels[task.status]}
                  </span>
                </div>
                <p>
                  {task.account.name} · Hẹn {formatTime(task.scheduledAt)} ngày{" "}
                  {formatDate(task.scheduledAt, { year: "numeric" })} (UTC+7)
                </p>
                {task.recordedAt && (
                  <p>
                    Ghi nhận kết quả {formatTime(task.recordedAt)} ngày{" "}
                    {formatDate(task.recordedAt, { year: "numeric" })}
                  </p>
                )}
                {task.archivedAt && (
                  <span className="timezone-tag">
                    Đã xóa khỏi Lịch đăng · Vẫn giữ lịch sử
                  </span>
                )}
                {failureNote(task) && (
                  <p className="post-schedule-detail-note">
                    {failureNote(task)}
                  </p>
                )}
                <div className="post-schedule-detail-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onOpenTask(task.id)}
                  >
                    Xem chi tiết
                  </Button>
                  {task.resultUrl && (
                    <a
                      href={task.resultUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cell-link"
                    >
                      Xem bài trên Facebook <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            size={query.data.size}
            total={query.data.total}
            onChange={setPage}
          />
        </>
      ) : (
        <EmptyState
          title="Không có lượt ở trạng thái này"
          description="Chọn Tất cả trạng thái để xem toàn bộ lịch sử của tài khoản cho bài này."
        />
      )}
    </Modal>
  );
}
