"use client";
import { Select } from "@/components/ui/select";
import { useEffect, useRef, useState } from "react";
import { useQueryStates } from "nuqs";
import { calendarFilters } from "@/lib/calendar-filters";
import {
  CalendarDays,
  CalendarPlus,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  List,
  Timer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  useAction,
  useDebounced,
  useResource,
  type AccountRow,
  type CalendarData,
  type PageData,
  type TaskRow,
} from "@/lib/client";
import { calendarRange } from "@/lib/calendar";
import {
  cn,
  dateKey,
  formatDate,
  formatTime,
  STATUSES,
  STATUS_LABEL,
  type Status,
} from "@/lib/utils";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchBox,
  Skeleton,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { ScheduleDialog } from "@/components/schedule-dialog";
import { TaskProcessor } from "@/components/task-processor";
import { TaskTable } from "@/components/task-table";

type TaskPage = PageData<TaskRow> & {
  summary: Partial<Record<Status, number>>;
};
export default function CalendarPage() {
  const [
    {
      view,
      date,
      day,
      q: search,
      status,
      remaining,
      accountId,
      target,
      page: urlPage,
    },
    setFilters,
  ] = useQueryStates(calendarFilters, { history: "push", shallow: true });
  const cursor = new Date(`${date || dateKey()}T12:00:00Z`);
  const page = Math.max(1, Math.min(100_000, urlPage));
  const setSearch = (q: string) =>
    void setFilters({ q, page: 1 }, { history: "replace" });
  const setStatus = (status: string) =>
    void setFilters({
      status: status as typeof calendarFilters.status.defaultValue,
      remaining: false,
      page: 1,
    });
  const setAccountId = (accountId: string) =>
    void setFilters({ accountId, page: 1 });
  const setTarget = (target: string) =>
    void setFilters({ target: target as "" | "PROFILE" | "GROUP", page: 1 });
  const setPage = (page: number) => void setFilters({ page });
  const q = useDebounced(search);
  const [schedule, setSchedule] = useState(false);
  const [task, setTask] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [removeTargets, setRemoveTargets] = useState<
    { id: string; version: number; title: string }[]
  >([]);
  const removeId = useRef(crypto.randomUUID());
  const cancelId = useRef(crypto.randomUUID());
  const range = calendarRange(cursor, view === "week" ? "week" : "month");
  const start = day ? `${day}T00:00:00+07:00` : range.start;
  const end = day
    ? `${new Date(new Date(`${day}T12:00:00Z`).getTime() + 86400_000).toISOString().slice(0, 10)}T00:00:00+07:00`
    : range.end;
  const filters = new URLSearchParams({
    q,
    status,
    remaining: String(remaining),
    accountId,
    target,
    start,
    end,
  }).toString();
  const accounts = useResource<AccountRow[]>("accounts");
  const list = useResource<TaskPage>(`tasks?${filters}&page=${page}&size=20`, {
    enabled: view === "list",
    refetchInterval: 15_000,
  });
  const calendar = useResource<CalendarData>(
    `calendar?${filters}&view=${view === "week" ? "week" : "month"}`,
    { enabled: view !== "list", refetchInterval: 15_000 },
  );
  const data = view === "list" ? list.data : calendar.data;
  const tasks = view === "list" ? list.data?.items || [] : [];
  const loading = view === "list" ? list.isLoading : calendar.isLoading;
  const error = view === "list" ? list.error : calendar.error;
  useEffect(() => {
    setSelected({});
    setConfirmCancel(false);
  }, [filters, view]);
  useEffect(() => {
    if (view !== "list" || !list.data || list.isFetching) return;
    const lastPage = Math.max(1, Math.ceil(list.data.total / list.data.size));
    if (page > lastPage)
      void setFilters({ page: lastPage }, { history: "replace" });
  }, [view, list.data, list.isFetching, page, setFilters]);
  const cancel = useAction(
    (tasks: { id: string; version: number }[]) =>
      api("tasks/bulk-cancel", "POST", {
        tasks,
        operationId: cancelId.current,
      }),
    "Đã hủy các công việc đã chọn.",
  );
  const remove = useAction(
    (tasks: { id: string; version: number }[]) =>
      api("tasks/bulk-archive", "POST", {
        tasks,
        operationId: removeId.current,
      }),
    "Đã xóa khỏi lịch. Bạn vẫn có thể tra cứu trong Lịch sử.",
  );
  function confirmRemove(items: TaskRow[]) {
    removeId.current = crypto.randomUUID();
    setRemoveTargets(
      items.map((item) => ({
        id: item.id,
        version: item.version,
        title: item.titleSnapshot,
      })),
    );
  }
  function changeView(value: "month" | "week" | "list") {
    void setFilters({ view: value, day: null, page: 1 });
  }
  function move(direction: number) {
    const d = cursor;
    const next =
      view === "week"
        ? new Date(d.getTime() + direction * 7 * 86400_000)
        : new Date(
            Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + direction, 15, 12),
          );
    void setFilters({
      date: next.toISOString().slice(0, 10),
      day: null,
      page: 1,
    });
  }
  const totalSelected = Object.keys(selected).length;
  const selectedTasks = tasks.filter((item) => selected[item.id] !== undefined);
  const canCancelSelected =
    selectedTasks.length > 0 &&
    selectedTasks.every((item) =>
      ["SCHEDULED", "READY", "IN_PROGRESS", "BLOCKED"].includes(item.status),
    );
  return (
    <>
      <PageHeader
        eyebrow="CHỦ ĐỘNG THỜI GIAN, GIỮ ĐỀU NHỊP"
        title="Lịch đăng & điều phối"
        description="Chọn rõ nơi đăng, theo dõi tiến độ và xử lý từng công việc khi đến giờ."
        actions={
          <Button onClick={() => setSchedule(true)}>
            <CalendarPlus size={16} />
            Tạo lịch mới
          </Button>
        }
      />
      <div className="destination-tabs" role="group" aria-label="Loại nơi đăng">
        {[
          { value: "", label: "Tất cả nơi đăng" },
          { value: "PROFILE", label: "Facebook cá nhân" },
          { value: "GROUP", label: "Hội nhóm" },
        ].map((t) => (
          <button
            key={t.value}
            className={cn(target === t.value && "selected")}
            onClick={() => setTarget(t.value)}
          >
            {t.label}
          </button>
        ))}
        <span>Fanpage API: giai đoạn mở rộng</span>
      </div>
      {data && (
        <div className="stats-grid compact-stats">
          {[
            {
              label: "Tổng trong bộ lọc",
              value: data.total,
              icon: CalendarDays,
              tone: "blue",
            },
            {
              label: "Đã đăng",
              value: data.summary.PUBLISHED || 0,
              icon: CheckCheck,
              tone: "green",
            },
            {
              label: "Đang chờ xử lý",
              value:
                (data.summary.SCHEDULED || 0) +
                (data.summary.READY || 0) +
                (data.summary.IN_PROGRESS || 0),
              icon: Clock3,
              tone: "amber",
            },
            {
              label: "Chờ duyệt nhóm",
              value: data.summary.PENDING_REVIEW || 0,
              icon: Timer,
              tone: "violet",
            },
          ].map((s) => (
            <div className="stat-card" data-tone={s.tone} key={s.label}>
              <div className="stat-top">
                <span>{s.label}</span>
                <span className={cn("stat-icon", s.tone)}>
                  <s.icon size={15} />
                </span>
              </div>
              <div className="stat-number">
                <strong>{s.value}</strong>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="toolbar">
        <div className="toolbar-left">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Tìm bài, tài khoản, hội nhóm…"
          />
          <Select
            aria-label="Lọc lịch theo tài khoản"
            value={accountId}
            onValueChange={(value) => setAccountId(value)}
          >
            <option value="">Tất cả tài khoản</option>
            {accounts.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Lọc lịch theo trạng thái"
            value={status}
            onValueChange={(value) => setStatus(value)}
          >
            <option value="">
              {remaining ? "Các lượt chưa xử lý" : "Tất cả trạng thái"}
            </option>
            {STATUSES.map((s) => (
              <option value={s} key={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {remaining && (
        <div className="notice notice-amber calendar-remaining-filter">
          <p>
            Đang xem các lượt chưa xử lý: đang chờ, đến lượt đăng, đang xử lý
            hoặc cần kiểm tra.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void setFilters({ remaining: false, status: "", page: 1 })
            }
          >
            Bỏ lọc chưa xử lý
          </Button>
        </div>
      )}
      <div className="calendar-controls">
        <div className="calendar-nav">
          <Button
            variant="outline"
            size="icon"
            aria-label="Khoảng thời gian trước"
            onClick={() => move(-1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <strong>
            {day
              ? `Ngày ${formatDate(day + "T12:00:00Z")}`
              : view === "week"
                ? `${formatDate(range.start)} – ${formatDate(new Date(new Date(range.end).getTime() - 1))}`
                : `Tháng ${cursor.getUTCMonth() + 1}, ${cursor.getUTCFullYear()}`}
          </strong>
          <Button
            variant="outline"
            size="icon"
            aria-label="Khoảng thời gian sau"
            onClick={() => move(1)}
          >
            <ChevronRight size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const today = dateKey();
              void setFilters({
                date: today,
                day: view === "list" ? today : null,
                page: 1,
              });
            }}
          >
            Hôm nay
          </Button>
        </div>
        <div className="view-switch" role="group" aria-label="Kiểu xem lịch">
          {(
            [
              { value: "month", label: "Tháng" },
              { value: "week", label: "Tuần" },
              { value: "list", label: "Danh sách" },
            ] as const
          ).map((v) => (
            <button
              key={v.value}
              className={cn(view === v.value && "selected")}
              onClick={() => changeView(v.value)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {!!totalSelected && view === "list" && (
        <div className="bulk-toolbar">
          <span>Đã chọn {totalSelected} công việc</span>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirmCancel(true)}
            disabled={!canCancelSelected}
            title={
              !canCancelSelected
                ? "Chỉ hủy công việc chưa hoàn tất; dùng Xóa khỏi lịch cho bài đã đăng"
                : undefined
            }
          >
            <Trash2 size={13} />
            Hủy các lịch đã chọn
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => confirmRemove(selectedTasks)}
          >
            <Trash2 size={13} /> Xóa khỏi lịch đã chọn
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected({})}>
            Bỏ chọn
          </Button>
        </div>
      )}
      {loading ? (
        <Skeleton
          variant={
            view === "list"
              ? "table"
              : view === "week"
                ? "calendar-week"
                : "calendar"
          }
          columns={6}
          rows={6}
          label="Đang tải lịch đăng"
        />
      ) : error ? (
        <ErrorState
          error={error}
          retry={() => (view === "list" ? list.refetch() : calendar.refetch())}
        />
      ) : view === "list" ? (
        <div className="panel">
          {tasks.length ? (
            <>
              <TaskTable
                tasks={tasks}
                onOpen={setTask}
                onRemove={(item) => confirmRemove([item])}
                selected={selected}
                onSelect={(t, checked) =>
                  setSelected((current) => {
                    const next = { ...current };
                    if (checked && Object.keys(next).length < 100)
                      next[t.id] = t.version;
                    else if (!checked) delete next[t.id];
                    return next;
                  })
                }
              />
              <Pagination
                page={page}
                size={20}
                total={data?.total || 0}
                onChange={setPage}
              />
            </>
          ) : (
            <EmptyState
              title="Chưa có lịch trong khoảng này"
              description="Thử đổi thời gian, bộ lọc hoặc tạo một lịch mới từ thư viện bài."
              action={
                <Button variant="secondary" onClick={() => setSchedule(true)}>
                  <CalendarPlus size={15} />
                  Tạo lịch
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <>
          <div className="calendar-scroll">
            <div className="calendar-grid">
              {[
                "THỨ HAI",
                "THỨ BA",
                "THỨ TƯ",
                "THỨ NĂM",
                "THỨ SÁU",
                "THỨ BẢY",
                "CHỦ NHẬT",
              ].map((d) => (
                <div className="calendar-weekday" key={d}>
                  {d}
                </div>
              ))}
              {range.days.map((d) => {
                const key = d.toISOString().slice(0, 10);
                const bucket = calendar.data?.days.find(
                  (day) => day.date === key,
                );
                const items = bucket?.items || [];
                return (
                  <div
                    className={cn(
                      "calendar-cell",
                      d.getUTCMonth() !== cursor.getUTCMonth() && "outside",
                      key === dateKey() && "today",
                    )}
                    key={key}
                  >
                    <span>{d.getUTCDate()}</span>
                    {items.map((t) => (
                      <button
                        key={t.id}
                        className={cn(
                          "calendar-task",
                          `calendar-task-${t.status.toLowerCase()}`,
                        )}
                        onClick={() => setTask(t.id)}
                        title={`${t.account.name} → ${t.group?.name || "Trang cá nhân"} · ${STATUS_LABEL[t.status]}`}
                      >
                        <strong>
                          {formatTime(t.scheduledAt)} · {t.titleSnapshot}
                        </strong>
                        <small>{t.account.name}</small>
                      </button>
                    ))}
                    {bucket && bucket.total > items.length && (
                      <button
                        className="calendar-more"
                        onClick={() => {
                          void setFilters({
                            day: key,
                            date: key,
                            view: "list",
                            page: 1,
                          });
                        }}
                      >
                        Xem {bucket.total} công việc
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      <p className="field-hint" style={{ marginTop: 15 }}>
        Giờ hiển thị UTC+7. Lịch tự động cần máy đăng đang bật; lịch thủ công do
        bạn thực hiện. Công việc chưa rõ kết quả cần được kiểm tra trước khi tạo
        lại.
      </p>
      {schedule && <ScheduleDialog onClose={() => setSchedule(false)} />}
      <TaskProcessor id={task} onClose={() => setTask(null)} />
      <ConfirmDialog
        open={removeTargets.length > 0}
        onClose={() => setRemoveTargets([])}
        title={
          removeTargets.length === 1
            ? `Xóa lịch “${removeTargets[0].title}”?`
            : `Xóa ${removeTargets.length} lịch đã chọn?`
        }
        description="Các dòng đã chọn sẽ biến mất khỏi lịch. Công việc chưa hoàn tất sẽ được hủy để không đăng tiếp. Kết quả đã đăng, chờ duyệt hoặc cần kiểm tra vẫn được giữ trong Lịch sử."
        notice="Thao tác này không xóa bài trên Facebook hoặc bài trong thư viện. Nếu bạn đang đăng thủ công trong cửa sổ Facebook, hãy tự dừng thao tác tại đó."
        confirmLabel={
          removeTargets.length === 1
            ? "Xóa khỏi lịch"
            : `Xóa ${removeTargets.length} lịch`
        }
        loading={remove.isPending}
        onConfirm={async () => {
          try {
            await remove.mutateAsync(
              removeTargets.map(({ id, version }) => ({ id, version })),
            );
            setRemoveTargets([]);
            setSelected({});
            setTask(null);
          } catch {}
        }}
      />
      <ConfirmDialog
        open={confirmCancel && totalSelected > 0}
        onClose={() => setConfirmCancel(false)}
        title={`Hủy ${totalSelected} công việc đã chọn?`}
        description="Các công việc sẽ chuyển sang Đã hủy. Kiểm tra lại những bài đang xử lý trước khi xác nhận; thao tác không xóa bài trên Facebook."
        confirmLabel={`Hủy ${totalSelected} công việc`}
        loading={cancel.isPending}
        onConfirm={async () => {
          try {
            await cancel.mutateAsync(
              Object.entries(selected).map(([id, version]) => ({
                id,
                version,
              })),
            );
            setConfirmCancel(false);
            setSelected({});
            cancelId.current = crypto.randomUUID();
          } catch {}
        }}
      />
    </>
  );
}
