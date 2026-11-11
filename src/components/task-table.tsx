"use client";
import { ArrowUpRight, ExternalLink, Trash2 } from "lucide-react";
import type { TaskRow } from "@/lib/client";
import { formatDate, formatTime, formatIntervalMinutes } from "@/lib/utils";
import { Avatar, StatusBadge } from "./common";
import { Button } from "./ui/button";

export function TaskTable({
  tasks,
  onOpen,
  history,
  selected,
  onSelect,
  onRemove,
}: {
  tasks: TaskRow[];
  onOpen: (id: string) => void;
  history?: boolean;
  selected?: Record<string, number>;
  onSelect?: (task: TaskRow, checked: boolean) => void;
  onRemove?: (task: TaskRow) => void;
}) {
  const selectable = (task: TaskRow) =>
    onRemove
      ? !(task.executionMode === "AUTOMATIC" && task.status === "IN_PROGRESS")
      : ["SCHEDULED", "READY", "IN_PROGRESS", "BLOCKED"].includes(task.status);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {onSelect && (
              <th>
                <input
                  type="checkbox"
                  aria-label={
                    onRemove
                      ? "Chọn tất cả lịch có thể xóa ở trang này"
                      : "Chọn tất cả lịch có thể hủy ở trang này"
                  }
                  checked={
                    tasks.some(selectable) &&
                    tasks.filter(selectable).every((t) => selected?.[t.id])
                  }
                  onChange={(e) =>
                    tasks
                      .filter(selectable)
                      .forEach((t) => onSelect(t, e.target.checked))
                  }
                />
              </th>
            )}
            <th>BÀI VIẾT / NƠI ĐĂNG</th>
            <th>TÀI KHOẢN</th>
            <th>{history ? "THỜI GIAN GHI NHẬN" : "THỜI GIAN (UTC+7)"}</th>
            <th>TRẠNG THÁI</th>
            {history && <th>LINK BÀI</th>}
            <th>
              <span className="sr-only">Thao tác</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              {onSelect && (
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Chọn lịch ${task.titleSnapshot} tại ${task.group?.name || "Trang cá nhân"}`}
                    disabled={!selectable(task)}
                    checked={!!selected?.[task.id]}
                    onChange={(e) => onSelect(task, e.target.checked)}
                  />
                </td>
              )}
              <td>
                <div className="cell-title">{task.titleSnapshot}</div>
                {!history &&
                  ["PUBLISHED", "PENDING_REVIEW"].includes(task.status) &&
                  (task.resultUrl ? (
                    <a
                      className="cell-link"
                      href={task.resultUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Xem bài <ExternalLink size={11} />
                    </a>
                  ) : (
                    <div className="cell-subtitle">
                      Chưa lấy được link · Mở để bổ sung
                    </div>
                  ))}
                {history && task.archivedAt && (
                  <span className="timezone-tag">Đã xóa khỏi lịch</span>
                )}
                {task.executionMode === "AUTOMATIC" && (
                  <span className="timezone-tag">
                    Tự đăng ·{" "}
                    {task.automaticPhase === "SUBMITTING"
                      ? "Đang gửi"
                      : task.automaticPhase === "PREPARING"
                        ? "Chuẩn bị"
                        : task.automaticPhase === "NEEDS_REVIEW"
                          ? "Cần kiểm tra"
                          : task.automaticPhase === "SAFE_FAILED"
                            ? "Chưa gửi được"
                            : task.automaticPhase === "RETRY_WAIT"
                              ? "Chờ thử lại"
                              : "Máy đăng"}
                    {!!task.automaticAttempts &&
                      ` · Lượt ${task.automaticAttempts}/3`}
                  </span>
                )}
                <div className="cell-subtitle">
                  {task.group?.name || "Trang cá nhân"}
                </div>
              </td>
              <td>
                <div className="task-account-cell">
                  <Avatar account={task.account} small />
                  <div>
                    <strong>{task.account.name}</strong>
                    <small>{task.account.profileName}</small>
                  </div>
                </div>
              </td>
              <td>
                <div className="cell-title">
                  {formatTime(
                    history && task.recordedAt
                      ? task.recordedAt
                      : task.scheduledAt,
                  )}
                </div>
                <div className="cell-subtitle">
                  {formatDate(
                    history && task.recordedAt
                      ? task.recordedAt
                      : task.scheduledAt,
                    { year: "numeric" },
                  )}
                  {history && !task.recordedAt && " · Theo lịch"}
                </div>
              </td>
              <td>
                {task.automaticHold ? (
                  <div className="task-wait">{task.automaticHold}</div>
                ) : task.automaticPhase === "SAFE_FAILED" ? (
                  <span className="timezone-tag">Chưa gửi được</span>
                ) : task.automaticWait ? (
                  <>
                    <span className="timezone-tag">
                      {task.automaticWait.reason === "RETRY_BACKOFF"
                        ? "Chờ thử lại"
                        : task.automaticWait.reason === "GROUP_INTERVAL"
                          ? "Chờ khoảng cách nhóm"
                          : "Chờ khoảng cách tài khoản"}
                    </span>
                    <div className="task-wait">
                      {task.automaticWait.reason === "RETRY_BACKOFF"
                        ? "Thử lại lúc "
                        : `Cách lần trước ${formatIntervalMinutes(task.automaticWait.minutes)} · Sớm nhất `}
                      {formatTime(task.automaticWait.until)}{" "}
                      {formatDate(task.automaticWait.until)}
                    </div>
                  </>
                ) : (
                  <StatusBadge status={task.status} />
                )}
                {history && task.recordedAt && (
                  <div className="cell-subtitle">
                    {task.resultSource === "DESKTOP"
                      ? "Máy đăng ghi nhận"
                      : "Bạn xác nhận"}
                  </div>
                )}
              </td>
              {history && (
                <td>
                  {task.resultUrl ? (
                    <a
                      className="cell-link"
                      href={task.resultUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Xem bài <ExternalLink size={11} />
                    </a>
                  ) : (
                    <span className="results-count">Chưa có link</span>
                  )}
                </td>
              )}
              <td>
                <div className="table-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpen(task.id)}
                  >
                    {history
                      ? "Chi tiết"
                      : task.status === "PENDING_REVIEW"
                        ? "Cập nhật"
                        : "Mở"}
                    <ArrowUpRight size={13} />
                  </Button>
                  {onRemove && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="post-delete-button"
                      aria-label={`Xóa lịch ${task.titleSnapshot} tại ${task.group?.name || "Trang cá nhân"}`}
                      disabled={!selectable(task)}
                      title={
                        selectable(task)
                          ? "Xóa khỏi lịch; giữ lịch sử và bài trên Facebook"
                          : "Máy đăng đang xử lý, hãy đợi kết quả"
                      }
                      onClick={() => onRemove(task)}
                    >
                      <Trash2 size={13} /> Xóa
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
