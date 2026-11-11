"use client";

import { useState } from "react";
import Link from "next/link";
import { Heart, MessageCircle, Shuffle, Pause, Play, Save } from "lucide-react";
import { api, useAction, useResource } from "@/lib/client";
import { dateKey, formatDate, formatTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { ErrorState, Field, Skeleton } from "./common";

type Settings = {
  enabled: boolean;
  mode: "COMMENT" | "REACTION" | "COMBINED";
  content: string;
  reactions: string[];
  startsAt: string | null;
  backfillDays: string[];
  gapMinutes: number;
  version: number;
};
type Data = {
  settings: Settings;
  actors: { id: string; name: string }[];
  counts: Record<string, number>;
  waitingSources: number;
  dayOptions: {
    value: "YESTERDAY" | "TODAY";
    date: string;
    total: number;
    waiting: number;
  }[];
};

export function AutoInteractions() {
  const query = useResource<Data>("auto-interactions", {
    refetchInterval: 15_000,
  });
  if (query.isLoading)
    return <Skeleton variant="form" label="Đang tải thiết lập" />;
  if (query.error)
    return <ErrorState error={query.error} retry={() => query.refetch()} />;
  if (!query.data) return null;
  return (
    <AutoInteractionForm key={query.data.settings.version} data={query.data} />
  );
}

function AutoInteractionForm({ data }: { data: Data }) {
  const { settings, actors, counts } = data;
  const [mode, setMode] = useState(settings.mode);
  const [content, setContent] = useState(settings.content);
  const [reactions, setReactions] = useState(settings.reactions);
  const [selectedDays, setSelectedDays] = useState<string[]>(() =>
    data.dayOptions
      .filter((day) =>
        settings.backfillDays.some((saved) => dateKey(saved) === day.date),
      )
      .map((day) => day.value),
  );
  const [gapMinutes, setGapMinutes] = useState(settings.gapMinutes);
  const save = useAction(
    (action: "SAVE" | "START" | "STOP") =>
      api("auto-interactions", "PATCH", {
        enabled: action === "SAVE" ? settings.enabled : action === "START",
        mode,
        content,
        reactions,
        selectedDays,
        gapMinutes,
        version: settings.version,
      }),
    "Đã lưu thiết lập tự tương tác.",
  );
  const queued =
    (counts.APPROVED || 0) +
    (counts.RETRY_WAIT || 0) +
    (counts.IN_PROGRESS || 0);
  const issues = (counts.NEEDS_REVIEW || 0) + (counts.FAILED || 0);
  const valid =
    (mode === "REACTION" || content.trim().length > 0) &&
    (mode === "COMMENT" || reactions.length > 0);
  return (
    <section
      className="panel auto-interactions"
      aria-labelledby="auto-interactions-title"
    >
      <div className="auto-interactions-heading">
        <div>
          <span className="eyebrow">THIẾT LẬP MỘT LẦN</span>
          <h2 id="auto-interactions-title">Tự tương tác bài mới</h2>
          <p>
            Bài đăng thành công có link sẽ tự được giao cho một tài khoản khác,
            luân phiên giữa các tài khoản. Mỗi bài thực hiện một lần.
          </p>
        </div>
        <span className={`auto-state ${settings.enabled ? "is-on" : ""}`}>
          <span />
          {settings.enabled ? "Đang bật" : "Đang tắt"}
        </span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate("SAVE");
        }}
      >
        <fieldset className="auto-mode-options" disabled={save.isPending}>
          <legend>Hành động cho mỗi bài</legend>
          {(
            [
              ["COMMENT", "Chỉ bình luận", MessageCircle],
              ["REACTION", "Chỉ thả cảm xúc", Heart],
              ["COMBINED", "Cảm xúc + bình luận", Shuffle],
            ] as const
          ).map(([value, label, Icon]) => (
            <label key={value} className={mode === value ? "is-selected" : ""}>
              <input
                type="radio"
                name="auto-interaction-mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <Icon size={18} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <div className="auto-interaction-fields">
          {mode !== "COMMENT" && (
            <fieldset className="auto-reactions" disabled={save.isPending}>
              <legend>Ngẫu nhiên một cảm xúc trong các mục đã chọn</legend>
              <div>
                {[
                  ["LIKE", "Like"],
                  ["LOVE", "Tim"],
                  ["HAHA", "Haha"],
                ].map(([value, label]) => (
                  <label
                    key={value}
                    className={reactions.includes(value) ? "is-selected" : ""}
                  >
                    <input
                      type="checkbox"
                      checked={reactions.includes(value)}
                      onChange={(e) =>
                        setReactions((current) =>
                          e.target.checked
                            ? [...current, value]
                            : current.filter((v) => v !== value),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              {!reactions.length && (
                <p className="form-error">Chọn ít nhất một cảm xúc.</p>
              )}
            </fieldset>
          )}
          {mode !== "REACTION" && (
            <Field
              label="Các mẫu bình luận (mỗi dòng một mẫu)"
              htmlFor="auto-interaction-content"
            >
              <textarea
                id="auto-interaction-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={4000}
                required
                rows={5}
                placeholder={
                  "Up nè\nHàng có sẵn nè\nAnh/chị cần thêm thông tin cứ nhắn em nhé"
                }
                disabled={save.isPending}
              />
              <p className="field-hint">
                {
                  new Set(
                    content
                      .split(/\r?\n/)
                      .map((line) => line.trim())
                      .filter(Boolean),
                  ).size
                }{" "}
                mẫu · Mỗi bài chọn ngẫu nhiên một mẫu. Khi có từ 2 mẫu, hai bài
                được giao liên tiếp sẽ dùng mẫu khác nhau.
              </p>
            </Field>
          )}
        </div>
        <fieldset className="auto-days" disabled={save.isPending}>
          <legend>Lấy thêm tất cả bài đã đăng (UTC+7)</legend>
          <div>
            {data.dayOptions.map((day) => (
              <label
                key={day.value}
                className={
                  selectedDays.includes(day.value) ? "is-selected" : ""
                }
              >
                <input
                  type="checkbox"
                  checked={selectedDays.includes(day.value)}
                  onChange={(e) =>
                    setSelectedDays((current) =>
                      e.target.checked
                        ? [...current, day.value]
                        : current.filter((d) => d !== day.value),
                    )
                  }
                />
                <span>
                  <strong>
                    {day.value === "YESTERDAY" ? "Bài hôm qua" : "Bài hôm nay"}
                  </strong>
                  <small>
                    {formatDate(`${day.date}T00:00:00+07:00`)} · {day.total} bài
                    đã đăng · {day.waiting} chưa giao
                  </small>
                </span>
              </label>
            ))}
          </div>
          <p className="field-hint">
            Có thể chọn cả hai ngày. Khi bật tự chạy, các bài phù hợp sẽ được
            đưa vào hàng đợi. Bài đã có công việc sẽ không tạo lại.
          </p>
        </fieldset>
        <p className="field-hint">
          Mặc định nhận bài mới từ lúc bật. Bài chưa có link sẽ chờ; thêm link
          sau vẫn được nhận. Lưu thay đổi chỉ áp dụng cho công việc mới.
        </p>
        {settings.enabled && settings.backfillDays.length > 0 && (
          <p className="field-hint">
            Đã nhận thêm các ngày:{" "}
            {settings.backfillDays.map((day) => formatDate(day)).join(", ")}.
            Bài của các ngày này được thêm link sau vẫn được nhận.
          </p>
        )}
        <div className="auto-spacing">
          <Field
            label="Khoảng cách chung giữa các bước"
            htmlFor="auto-gap-minutes"
          >
            <select
              id="auto-gap-minutes"
              value={gapMinutes}
              onChange={(e) => setGapMinutes(Number(e.target.value))}
              disabled={save.isPending}
            >
              {[
                1,
                5,
                10,
                15,
                30,
                60,
                ...(![1, 5, 10, 15, 30, 60].includes(gapMinutes)
                  ? [gapMinutes]
                  : []),
              ]
                .sort((a, b) => a - b)
                .map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} phút
                  </option>
                ))}
            </select>
          </Field>
          <p className="field-hint">
            Chạy lần lượt trên tất cả tài khoản, kể cả bước cảm xúc → bình luận.
            Khi máy hoạt động lại sẽ tiếp tục giãn lượt. Giờ trên từng công việc
            là thời điểm sớm nhất; giới hạn riêng và giờ nghỉ có thể làm chạy
            muộn hơn.
          </p>
        </div>
        <p className="auto-policy-note">
          Meta có thể hạn chế nội dung lặp lại hoặc tương tác không xác thực kể
          cả khi chạy chậm. Không có khoảng cách nào được bảo đảm tránh khóa.
          Nên bình luận thông tin hữu ích, đúng với bài đăng.{" "}
          <a
            href="https://transparency.meta.com/policies/community-standards/spam/"
            target="_blank"
            rel="noreferrer"
          >
            Xem chính sách spam của Meta
          </a>
          .
        </p>
        <div className="auto-actors">
          <strong>{actors.length} tài khoản sẵn sàng tham gia</strong>
          <p>
            {actors.length
              ? actors.map((a) => a.name).join(" · ")
              : "Chưa có tài khoản được xác nhận và bật quyền tự tương tác."}
          </p>
          <p className="field-hint">
            Với bài trong nhóm, chỉ giao cho tài khoản có nhóm đó trong danh
            sách. Giờ nghỉ, giới hạn mỗi ngày và khoảng cách của từng tài khoản
            vẫn được áp dụng.{" "}
            <Link href="/desktop">Quản lý quyền tại Máy đăng</Link>.
          </p>
        </div>
        <div className="auto-interactions-footer">
          <div className="auto-interaction-counts" aria-live="polite">
            <span>
              <b>{queued}</b> đang chờ/chạy
            </span>
            <span>
              <b>{counts.COMPLETED || 0}</b> hoàn tất
            </span>
            <span>
              <b>{issues}</b> cần kiểm tra
            </span>
          </div>
          <div className="desktop-control-buttons">
            {settings.enabled && (
              <Button
                type="button"
                variant="outline"
                loading={save.isPending && save.variables === "STOP"}
                disabled={save.isPending}
                onClick={() => save.mutate("STOP")}
              >
                <Pause size={15} />
                Tắt tự chạy
              </Button>
            )}
            <Button
              type="submit"
              variant="outline"
              loading={save.isPending && save.variables === "SAVE"}
              disabled={!valid || save.isPending}
            >
              <Save size={15} />
              Lưu thiết lập
            </Button>
            {!settings.enabled && (
              <Button
                type="button"
                loading={save.isPending && save.variables === "START"}
                disabled={!valid || save.isPending}
                onClick={() => save.mutate("START")}
              >
                <Play size={15} />
                Lưu và bật tự chạy
              </Button>
            )}
          </div>
        </div>
        <p className="field-hint">
          Lưu thiết lập giữ nguyên trạng thái bật/tắt hiện tại.
          {!settings.enabled &&
            " Khi đang tắt, lưu chỉ ghi nhớ nội dung, cảm xúc và khoảng cách; chưa đưa bài vào hàng đợi. Chọn ngày khi bạn muốn bật tự chạy."}
        </p>
        {settings.enabled && settings.startsAt && (
          <p className="field-hint">
            Nhận bài đăng từ {formatTime(settings.startsAt)} ·{" "}
            {formatDate(settings.startsAt)}. Quét bài mới khoảng mỗi phút.
          </p>
        )}
        {settings.enabled && data.waitingSources > 0 && (
          <p className="field-hint">
            {data.waitingSources} bài chưa được giao: chờ link, tài khoản phù
            hợp hoặc lần quét kế tiếp. Các bài trùng link chỉ xử lý một lần.
          </p>
        )}
        {save.error && (
          <p className="form-error" role="alert">
            {save.error.message}
          </p>
        )}
      </form>
    </section>
  );
}

const stepLabels: Record<string, string> = {
  PENDING: "Chờ thực hiện",
  PREPARING: "Đang chuẩn bị",
  SUBMITTING: "Đang gửi",
  COMPLETED: "Đã xong",
  FAILED: "Chưa thực hiện được",
  NEEDS_REVIEW: "Cần kiểm tra trên Facebook",
  SKIPPED: "Đã dừng/bỏ qua",
};
export function InteractionSteps({
  reaction,
  reactionState,
  commentState,
}: {
  reaction: string | null;
  reactionState: string;
  commentState: string;
}) {
  return (
    <div className="interaction-steps">
      {[
        [
          reactionState,
          `Cảm xúc ${({ LIKE: "Like", LOVE: "Tim", HAHA: "Haha" } as Record<string, string>)[reaction || ""] || reaction || ""}`,
        ],
        [commentState, "Bình luận"],
      ]
        .filter(([state]) => state && state !== "NONE")
        .map(([state, label]) => (
          <p key={label} className={state === "COMPLETED" ? "is-complete" : ""}>
            <span>{label}</span>
            <strong>{stepLabels[state] || state}</strong>
          </p>
        ))}
    </div>
  );
}
