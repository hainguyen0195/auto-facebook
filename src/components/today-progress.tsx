"use client";
import Link from "next/link";
import { ArrowRight, CheckCheck } from "lucide-react";
import type { DashboardData } from "@/lib/client";
import { formatDate, formatTime, STATUSES, STATUS_LABEL } from "@/lib/utils";

type Progress = DashboardData["progress"];
function remainingReason(task: Progress["remainingTasks"][number]) {
  if (
    task.status === "BLOCKED" &&
    task.automaticPhase === "SAFE_FAILED" &&
    task.note.includes("bước mở trình soạn bài")
  )
    return "Không mở được ô soạn bài trong thời gian chờ. Chưa bấm Đăng nên bài chưa được gửi.";
  if (task.status === "BLOCKED")
    return (
      task.note ||
      "Lượt đăng đang tạm dừng. Mở chi tiết để kiểm tra nguyên nhân."
    );
  if (task.status === "IN_PROGRESS") return "Đang thực hiện lượt đăng này.";
  return new Date(task.scheduledAt).getTime() > Date.now()
    ? "Chưa đến giờ đăng đã hẹn."
    : "Đã đến giờ, chưa bắt đầu. Mở chi tiết để xem điều kiện xử lý.";
}

export function TodayProgress({
  progress,
  onOpen,
}: {
  progress: Progress;
  onOpen: (id: string) => void;
}) {
  const remaining = progress.total - progress.handled;
  const calendarUrl = (filters: Record<string, string>) =>
    `/calendar?${new URLSearchParams({
      view: "list",
      date: progress.date,
      day: progress.date,
      ...filters,
    })}`;
  return (
    <section className="progress-box" aria-label="Tiến độ lịch hôm nay">
      <div className="progress-label">
        <span>Tiến độ lịch hôm nay</span>
        <strong>
          {progress.total
            ? `Đã xử lý ${progress.handled}/${progress.total} lượt đăng`
            : "Chưa có lịch hôm nay"}
        </strong>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label="Tiến độ lịch hôm nay"
        aria-valuemin={0}
        aria-valuemax={progress.total || 1}
        aria-valuenow={progress.handled}
        aria-valuetext={`${progress.handled}/${progress.total} lượt đã xử lý; còn ${remaining} lượt chưa xử lý`}
      >
        <span
          style={{
            width: `${progress.total ? (progress.handled / progress.total) * 100 : 0}%`,
          }}
        />
      </div>
      <p className="progress-explanation">
        Tính theo giờ hẹn ngày {formatDate(`${progress.date}T12:00:00Z`)}{" "}
        (UTC+7). Mỗi lượt là một bài của một tài khoản tại một nhóm hoặc trang
        cá nhân.
      </p>
      <div className="progress-statuses" aria-label="Số lượt theo trạng thái">
        {STATUSES.filter((status) => progress.byStatus[status] > 0).map(
          (status) => (
            <Link
              key={status}
              href={calendarUrl({ status })}
              className={`progress-status progress-status-${status.toLowerCase()}`}
            >
              <span>
                {status === "BLOCKED" ? "Cần kiểm tra" : STATUS_LABEL[status]}
              </span>
              <strong>{progress.byStatus[status]}</strong>
            </Link>
          ),
        )}
      </div>
      {progress.total > 0 && (
        <p className="progress-definition">
          “Đã xử lý” gồm đã đăng, chờ duyệt nhóm, đã bỏ qua và đã hủy. Chờ duyệt
          nhóm chưa được tính là đăng thành công. Lịch đã xóa không được tính
          vào tổng.
        </p>
      )}
      {remaining > 0 ? (
        <div className="progress-remaining">
          <div className="progress-remaining-heading">
            <h3>Còn {remaining} lượt chưa xử lý</h3>
            <Link
              className="panel-link"
              href={calendarUrl({ remaining: "true" })}
              aria-label={`Xem ${remaining} lượt chưa xử lý`}
            >
              Xem tất cả <ArrowRight size={13} />
            </Link>
          </div>
          <ul className="progress-remaining-list">
            {progress.remainingTasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => onOpen(task.id)}
                  aria-label={`Xem chi tiết ${task.titleSnapshot} của ${task.account.name}`}
                >
                  <span className="progress-task-heading">
                    <strong>{task.titleSnapshot}</strong>
                    <span
                      className={`status status-${task.status.toLowerCase()}`}
                    >
                      {task.automaticPhase === "SAFE_FAILED" &&
                      task.status === "BLOCKED"
                        ? "Chưa gửi được"
                        : task.status === "BLOCKED"
                          ? "Cần kiểm tra"
                          : STATUS_LABEL[task.status]}
                    </span>
                  </span>
                  <span className="progress-task-destination">
                    {task.account.name} → {task.group?.name || "Trang cá nhân"}
                  </span>
                  <span className="progress-task-reason">
                    Hẹn {formatTime(task.scheduledAt)} · {remainingReason(task)}
                  </span>
                  <span className="progress-task-open">
                    Xem chi tiết <ArrowRight size={12} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {remaining > progress.remainingTasks.length && (
            <p className="progress-preview-note">
              Hiển thị {progress.remainingTasks.length}/{remaining} lượt. Chọn
              “Xem tất cả” để xem đầy đủ.
            </p>
          )}
        </div>
      ) : progress.total > 0 ? (
        <p className="progress-complete">
          <CheckCheck size={15} />
          Không còn lượt nào chờ xử lý trong lịch hôm nay.
        </p>
      ) : null}
    </section>
  );
}
