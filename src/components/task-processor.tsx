"use client";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Download,
  ExternalLink,
  Globe2,
  SkipForward,
  Timer,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { api, useAction, useResource, type TaskRow } from "@/lib/client";
import {
  assetUrl,
  cn,
  formatDate,
  formatTime,
  formatIntervalMinutes,
  STATUS_LABEL,
} from "@/lib/utils";
import type { TaskActionInput } from "@/lib/schemas";
import { Avatar, ErrorState, Field, Skeleton, StatusBadge } from "./common";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import { PostLinkEditor } from "./post-link-editor";

type Outcome = "PUBLISHED" | "PENDING_REVIEW" | "BLOCKED" | "SKIPPED";
export function TaskProcessor({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const query = useResource<TaskRow>(`tasks/${id || "closed"}`, {
    enabled: !!id,
  });
  const task = query.data;
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  const [confirmedProfile, setConfirmedProfile] = useState(false);
  const [clipboardFallback, setClipboardFallback] = useState(false);
  const [copying, setCopying] = useState(false);
  const fallback = useRef<HTMLTextAreaElement>(null);
  const operation = useRef<string>("");
  const mutation = useAction(
    (data: TaskActionInput) => api<TaskRow>(`tasks/${id}`, "PATCH", data),
    "Đã cập nhật công việc.",
  );
  useEffect(() => {
    setOutcome(null);
    setNote(task?.note || "");
    setUrl(task?.resultUrl || "");
    setConfirmedProfile(false);
    setClipboardFallback(false);
    operation.current = crypto.randomUUID();
  }, [id, task?.id]);
  async function act(action: TaskActionInput["action"]) {
    if (!task) return;
    try {
      await mutation.mutateAsync({
        action,
        status: action === "record" ? outcome || undefined : undefined,
        note,
        resultUrl: url,
        version: task.version,
        operationId: operation.current,
      });
      operation.current = crypto.randomUUID();
      setOutcome(null);
    } catch {
      /* The form stays open so network failures can be retried. */
    }
  }
  async function copy() {
    if (!task) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(task.contentSnapshot);
      toast.success("Đã sao chép nội dung. Bạn kiểm tra trước khi đăng nhé.");
    } catch {
      setClipboardFallback(true);
      toast.info(
        "Trình duyệt chưa cho phép sao chép. Hãy chọn nội dung và nhấn Ctrl+C.",
      );
    } finally {
      setCopying(false);
    }
  }
  const automaticReview =
    task?.status === "BLOCKED" && task.blockReason?.startsWith("AUTO_");
  const safeFailed =
    task?.status === "BLOCKED" && task.automaticPhase === "SAFE_FAILED";
  const editable =
    (task?.status === "IN_PROGRESS" && task.executionMode !== "AUTOMATIC") ||
    task?.status === "PENDING_REVIEW" ||
    automaticReview;
  const canStart =
    task &&
    task.executionMode !== "AUTOMATIC" &&
    ["READY", "SCHEDULED"].includes(task.status) &&
    new Date(task.scheduledAt) <= new Date() &&
    task.account.status === "ACTIVE";
  const choices = [
    { value: "PUBLISHED" as const, label: "Đã đăng", icon: CheckCircle2 },
    { value: "PENDING_REVIEW" as const, label: "Chờ duyệt nhóm", icon: Timer },
    {
      value: "BLOCKED" as const,
      label: "Tài khoản bị hạn chế",
      icon: AlertTriangle,
    },
    { value: "SKIPPED" as const, label: "Bỏ qua bài này", icon: SkipForward },
  ].filter(
    (c) =>
      (!automaticReview || c.value !== "BLOCKED") &&
      (c.value !== "PENDING_REVIEW" || !!task?.groupId) &&
      (task?.status !== "PENDING_REVIEW" ||
        ["PUBLISHED", "SKIPPED"].includes(c.value)),
  );
  return (
    <Modal
      open={!!id}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
      title="Một bài đăng, từng bước rõ ràng"
      description="Kiểm tra đúng tài khoản và nhóm trước khi bạn bấm đăng trên Facebook."
      wide
    >
      {query.isLoading ? (
        <Skeleton rows={5} />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      ) : task ? (
        <>
          <div className="processor-top">
            {safeFailed ? (
              <span className="timezone-tag">Chưa gửi được</span>
            ) : (
              <StatusBadge status={task.status} />
            )}
            <span>
              {formatDate(task.scheduledAt, { year: "numeric" })} ·{" "}
              {formatTime(task.scheduledAt)} · UTC+7
            </span>
          </div>
          <div className="composer-grid processor-grid">
            <div>
              <h3 className="processor-title">{task.titleSnapshot}</h3>
              {task.executionMode === "AUTOMATIC" && (
                <div className="notice notice-amber">
                  <Clock3 size={17} />
                  <p>
                    {safeFailed
                      ? "Chưa gửi được bài này. Các bài khác vẫn tiếp tục; bạn có thể bấm Thử lại để cấp tối đa 3 lượt mới."
                      : task.automaticHold
                        ? task.automaticHold
                        : automaticReview
                          ? "Máy đăng đã dừng. Kiểm tra Facebook trước khi xác nhận kết quả hoặc tạo lịch mới."
                          : task.automaticWait?.reason === "RETRY_BACKOFF"
                            ? `Đang chờ thử lại lúc ${formatTime(task.automaticWait.until)} ngày ${formatDate(task.automaticWait.until)} (UTC+7). Các bài khác đủ điều kiện vẫn tiếp tục.`
                            : task.automaticWait
                              ? `Đang chờ khoảng cách ${task.automaticWait.reason === "GROUP_INTERVAL" ? "nhóm" : "tài khoản"} ${formatIntervalMinutes(task.automaticWait.minutes)}. Sớm nhất ${formatTime(task.automaticWait.until)} ngày ${formatDate(task.automaticWait.until, { year: "numeric" })} (UTC+7). Các công việc đã bắt đầu nhưng chưa xác nhận kết quả cũng được tính; hãy kiểm tra và cập nhật kết quả công việc cũ.`
                              : task.status === "IN_PROGRESS"
                                ? "Máy đăng đang xử lý. Bấm Đăng thành công trên Facebook sẽ ghi nhận Đã đăng ngay."
                                : "Công việc được thực hiện bởi máy đăng đã kết nối."}{" "}
                    {task.note}
                    {!!task.automaticAttempts &&
                      ` · Đã chạy ${task.automaticAttempts}/3 lượt.`}
                  </p>
                </div>
              )}
              <div className="processor-content">{task.contentSnapshot}</div>
              <div className="processor-tools">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copy}
                  loading={copying}
                >
                  <Clipboard size={15} />
                  Sao chép nội dung
                </Button>
              </div>
              {clipboardFallback && (
                <Field
                  label="Sao chép thủ công"
                  hint="Bấm chọn tất cả rồi nhấn Ctrl+C (hoặc Cmd+C)."
                >
                  <textarea
                    ref={fallback}
                    readOnly
                    value={task.contentSnapshot}
                    aria-label="Nội dung sao chép thủ công"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      fallback.current?.focus();
                      fallback.current?.select();
                    }}
                  >
                    Chọn tất cả nội dung
                  </Button>
                </Field>
              )}
              {!!task.assets?.length && (
                <div className="processor-images">
                  {task.assets.map((asset) => (
                    <a key={asset.id} href={assetUrl(asset.id, true)} download>
                      <img src={assetUrl(asset.id)} alt={asset.originalName} />
                      <small>
                        <Download size={10} />
                        Tải ảnh
                      </small>
                    </a>
                  ))}
                </div>
              )}
              <div className="notice notice-teal">
                <Check size={16} />
                <p>
                  Nội dung và ảnh là bản chụp tại lúc lên lịch. Sao chép hoặc mở
                  Facebook chưa được tính là đã đăng.
                </p>
              </div>
              {!!task.events?.length && (
                <details className="event-history">
                  <summary>Lịch sử thao tác</summary>
                  {task.events.map((event) => (
                    <div key={event.id}>
                      <span>
                        {formatDate(event.createdAt)}{" "}
                        {formatTime(event.createdAt)}
                      </span>
                      <p>
                        {STATUS_LABEL[event.toStatus]} ·{" "}
                        {event.source === "USER"
                          ? "Bạn xác nhận"
                          : event.source === "DESKTOP"
                            ? "Máy đăng"
                            : "Hệ thống"}
                        {event.note ? ` · ${event.note}` : ""}
                      </p>
                    </div>
                  ))}
                </details>
              )}
            </div>
            <div>
              <div className="processor-meta">
                <div className="processor-account">
                  <Avatar account={task.account} />
                  <div>
                    <strong>{task.account.name}</strong>
                    <small>Tài khoản Facebook cần sử dụng</small>
                  </div>
                </div>
                <div className="processor-profile">
                  Profile trình duyệt:{" "}
                  <strong>{task.account.profileName}</strong>
                </div>
                <h3>
                  {task.group ? (
                    <>
                      <UsersRound size={14} /> {task.group.name}
                    </>
                  ) : (
                    <>
                      <Globe2 size={14} /> Trang cá nhân
                    </>
                  )}
                </h3>
                <p>
                  {task.group?.rules ||
                    (task.group
                      ? "Chưa ghi nội quy. Hãy kiểm tra nội quy trên nhóm trước khi đăng."
                      : "Kiểm tra đối tượng được xem bài viết của bạn.")}
                </p>
                <label className="acknowledge profile-check">
                  <input
                    type="checkbox"
                    checked={confirmedProfile}
                    onChange={(e) => setConfirmedProfile(e.target.checked)}
                  />
                  Tôi sẽ mở bằng profile “{task.account.profileName}” và kiểm
                  tra đúng tài khoản.
                </label>
                <Button
                  variant="secondary"
                  className="open-facebook"
                  disabled={!confirmedProfile}
                  onClick={() =>
                    window.open(
                      task.group?.url || task.account.url,
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                >
                  <ExternalLink size={15} />
                  Mở Facebook
                </Button>
                <p className="field-hint">
                  Tab được mở trong profile trình duyệt hiện tại. Ứng dụng không
                  tự chuyển tài khoản Facebook.
                </p>
              </div>
              {canStart && (
                <div className="processor-start">
                  <p>Bắt đầu để theo dõi công việc bạn đang xử lý.</p>
                  <Button
                    onClick={() => act("start")}
                    loading={mutation.isPending}
                  >
                    Bắt đầu xử lý <ArrowRight size={15} />
                  </Button>
                </div>
              )}
              {safeFailed && !task.archivedAt && (
                <div className="processor-start">
                  <Button
                    onClick={() => act("retry")}
                    loading={mutation.isPending}
                  >
                    Thử lại
                  </Button>
                </div>
              )}
              {task.status === "SCHEDULED" && !canStart && (
                <div className="notice notice-amber processor-start">
                  <Clock3 size={17} />
                  <p>Công việc chưa đến giờ hoặc tài khoản đang tạm dừng.</p>
                </div>
              )}
              {task.status === "BLOCKED" && !automaticReview && (
                <div className="notice notice-rose processor-start">
                  <AlertTriangle size={17} />
                  <p>
                    Công việc tạm dừng theo tài khoản. Bạn có thể chủ động tiếp
                    tục tài khoản trong mục Tài khoản Facebook.
                  </p>
                </div>
              )}
              {editable && (
                <div className="result-form">
                  <h3>
                    {task.status === "PENDING_REVIEW"
                      ? "Cập nhật kết quả duyệt"
                      : "Bạn đã xử lý thế nào?"}
                  </h3>
                  <div className="result-choices">
                    {choices.map((c) => (
                      <button
                        key={c.value}
                        className={cn(
                          "result-choice",
                          outcome === c.value && "selected",
                        )}
                        onClick={() => setOutcome(c.value)}
                        aria-pressed={outcome === c.value}
                      >
                        <c.icon size={16} />
                        {c.label}
                      </button>
                    ))}
                  </div>
                  {outcome === "BLOCKED" && (
                    <div className="notice notice-rose">
                      <AlertTriangle size={17} />
                      <p>
                        Tài khoản sẽ được đánh dấu bị hạn chế. Tất cả công việc
                        chưa gửi của tài khoản này sẽ tạm dừng.
                      </p>
                    </div>
                  )}
                  <Field label="Link bài viết (nếu có)" htmlFor="result-url">
                    <input
                      id="result-url"
                      placeholder="https://www.facebook.com/…"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                  </Field>
                  <Field label="Ghi chú (không bắt buộc)" htmlFor="result-note">
                    <textarea
                      id="result-note"
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Ghi chú để lần sau dễ theo dõi…"
                    />
                  </Field>
                  <Button
                    loading={mutation.isPending}
                    disabled={!outcome}
                    onClick={() => act("record")}
                    className="record-result"
                  >
                    <Check size={16} />
                    Ghi nhận kết quả
                  </Button>
                  <p className="field-hint">
                    Kết quả này do bạn xác nhận sau khi kiểm tra Facebook.
                  </p>
                </div>
              )}
              {["PUBLISHED", "PENDING_REVIEW"].includes(task.status) && (
                <div className="processor-start">
                  <PostLinkEditor key={task.id} task={task} />
                </div>
              )}
              {["PUBLISHED", "SKIPPED", "CANCELLED"].includes(task.status) && (
                <div className="notice notice-teal processor-start">
                  <CheckCircle2 size={18} />
                  <div>
                    <strong>{STATUS_LABEL[task.status]}</strong>
                    <p>
                      {task.recordedAt
                        ? `Ghi nhận lúc ${formatTime(task.recordedAt)}, ${formatDate(task.recordedAt)}.`
                        : "Trạng thái đã được lưu."}
                      {task.note && ` ${task.note}`}
                    </p>
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
                </div>
              )}
            </div>
          </div>
          <div className="dialog-footer">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Đóng
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
