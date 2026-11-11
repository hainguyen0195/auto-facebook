"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  FileText,
  Leaf,
  Plus,
  Timer,
  Users,
} from "lucide-react";
import {
  useResource,
  type AccountRow,
  type Bootstrap,
  type DashboardData,
  type TaskRow,
} from "@/lib/client";
import {
  ACCOUNT_LABEL,
  cn,
  dateKey,
  formatDate,
  formatTime,
} from "@/lib/utils";
import {
  Avatar,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { TaskProcessor } from "@/components/task-processor";
import { TodayProgress } from "@/components/today-progress";

export default function TodayPage() {
  const query = useResource<DashboardData>("dashboard", {
    refetchInterval: 30_000,
  });
  const data = query.data;
  const accounts = useResource<AccountRow[]>("accounts");
  const bootstrap = useResource<Bootstrap>("bootstrap");
  const [task, setTask] = useState<string | null>(null);
  const [tab, setTab] = useState("all");
  const firstName = bootstrap.data?.user.name.trim().split(/\s+/).pop();
  return (
    <>
      <PageHeader
        eyebrow="MỖI NGÀY MỘT CHÚT, ĐỀU ĐẶN HƠN"
        title={`Chào ${firstName || "bạn"}, hôm nay thế nào?`}
        description="Một góc nhỏ để sắp xếp nội dung và bắt đầu ngày bán hàng của bạn."
        actions={
          <Button variant="outline" asChild>
            <Link href="/calendar">
              <CalendarDays size={15} />
              Xem lịch đăng
            </Link>
          </Button>
        }
      />
      {query.error && (
        <div style={{ marginBottom: 22 }}>
          <ErrorState error={query.error} retry={() => query.refetch()} />
        </div>
      )}
      {query.isLoading || (!data && !query.error) ? (
        <Skeleton variant="dashboard" rows={4} />
      ) : data ? (
        <>
          <section className="hero animate-enter">
            <div className="hero-content">
              <div className="eyebrow">
                <span />
                {data.accountCount
                  ? "GIỮ NHỊP CÔNG VIỆC CỦA BẠN"
                  : "CHÀO MỪNG ĐẾN VỚI NHỊP ĐĂNG"}
              </div>
              <h2>
                {data.due ? (
                  <>
                    Bài đã sẵn sàng.
                    <br />
                    Đến lượt bạn tạo kết nối.
                  </>
                ) : data.accountCount ? (
                  <>
                    Mọi việc có chỗ.
                    <br />
                    Một ngày nhẹ đầu hơn.
                  </>
                ) : (
                  <>
                    Bắt đầu một nhịp mới.
                    <br />
                    Bán hàng gọn gàng hơn.
                  </>
                )}
              </h2>
              <p>
                {data.due
                  ? `${data.due} công việc đang chờ bạn kiểm tra và đăng trên Facebook.`
                  : data.accountCount
                    ? "Chuẩn bị bài tiếp theo, chọn nơi đăng và sắp xếp một lịch phù hợp."
                    : "Thêm tài khoản Facebook đầu tiên, rồi chuẩn bị nội dung của bạn."}
              </p>
              {data.due ? (
                <Button onClick={() => setTask(data.queue[0]?.id || null)}>
                  Bắt đầu xử lý <ArrowRight size={14} />
                </Button>
              ) : (
                <Button asChild>
                  <Link
                    href={
                      data.accountCount ? "/posts?new=1" : "/accounts?new=1"
                    }
                  >
                    {data.accountCount
                      ? "Chuẩn bị bài mới"
                      : "Thêm tài khoản đầu tiên"}
                    <ArrowRight size={14} />
                  </Link>
                </Button>
              )}
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="art-card art-card-back" />
              <div className="art-card art-card-front">
                <div className="art-card-label">
                  <span>MỘT NGÀY CÓ NHỊP</span>
                  <Leaf size={13} />
                </div>
                {[0, 1, 2].map((i) => (
                  <div className="art-check-row" key={i}>
                    <span className="art-check">
                      <Check size={10} />
                    </span>
                    <span
                      className={cn("art-line", i === 1 && "art-line-short")}
                    />
                  </div>
                ))}
              </div>
              <span className="art-badge">
                <CheckCheck size={22} />
              </span>
            </div>
          </section>
          <div className="stats-grid">
            {[
              {
                label: "Cần xử lý",
                value: data.due,
                unit: "nơi đăng",
                icon: Clock3,
                style: "amber",
                bottom: data.overdue
                  ? `${data.overdue} việc từ những ngày trước`
                  : "Chủ động đăng khi bạn sẵn sàng",
                warn: !!data.overdue,
              },
              {
                label: "Đã đăng hôm nay",
                value: data.published,
                unit: "bài",
                icon: CheckCheck,
                style: "green",
                bottom: "Theo nguồn kết quả đã ghi nhận",
              },
              {
                label: "Đang chờ duyệt",
                value: data.pending,
                unit: "bài",
                icon: Timer,
                style: "violet",
                bottom: "Chờ quản trị viên nhóm duyệt",
              },
              {
                label: "Tài khoản của bạn",
                value: data.accountCount,
                unit: "tài khoản",
                icon: Users,
                style: "blue",
                bottom: `${data.groupCount} hội nhóm · ${data.pausedCount} tài khoản tạm dừng`,
              },
            ].map((stat) => (
              <div
                className="stat-card animate-enter"
                data-tone={stat.style}
                key={stat.label}
              >
                <div className="stat-top">
                  <span>{stat.label}</span>
                  <span className={cn("stat-icon", stat.style)}>
                    <stat.icon size={15} strokeWidth={1.7} />
                  </span>
                </div>
                <div className="stat-number">
                  <strong>{stat.value}</strong>
                  <span>{stat.unit}</span>
                </div>
                <div className={cn("stat-bottom", stat.warn && "warn")}>
                  {stat.bottom}
                </div>
              </div>
            ))}
          </div>
          <div className="dashboard-columns">
            <div className="dashboard-main">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      Danh sách cần xử lý{" "}
                      <span className="count-pill">{data.due}</span>
                    </h2>
                    <p>Từng nơi đăng, từng bước rõ ràng.</p>
                  </div>
                  <Link href="/calendar?view=list" className="panel-link">
                    Tất cả <ChevronRight size={12} />
                  </Link>
                </div>
                <div className="queue-tabs">
                  <button
                    className={cn(
                      "queue-tab",
                      tab === "all" && "queue-tab-active",
                    )}
                    onClick={() => setTab("all")}
                  >
                    Đang chờ xử lý
                  </button>
                  <button
                    className={cn(
                      "queue-tab",
                      tab === "overdue" && "queue-tab-active",
                    )}
                    onClick={() => setTab("overdue")}
                  >
                    Từ ngày trước {data.overdue > 0 && `(${data.overdue})`}
                  </button>
                </div>
                <div className="task-list">
                  {data.queue
                    .filter(
                      (t) =>
                        tab !== "overdue" || dateKey(t.scheduledAt) < dateKey(),
                    )
                    .map((t) => (
                      <TaskListRow
                        key={t.id}
                        task={t}
                        onOpen={() => setTask(t.id)}
                      />
                    ))}
                </div>
                {!data.queue.filter(
                  (t) =>
                    tab !== "overdue" || dateKey(t.scheduledAt) < dateKey(),
                ).length && (
                  <EmptyState
                    title={
                      data.accountCount
                        ? "Chưa có công việc cần xử lý"
                        : "Góc làm việc đang chờ bạn"
                    }
                    description={
                      data.accountCount
                        ? "Các lịch đến hạn sẽ xuất hiện ở đây. Bạn có thể chuẩn bị bài mới bất cứ lúc nào."
                        : "Thêm tài khoản, liên kết hội nhóm rồi lên lịch cho bài đầu tiên."
                    }
                    icon={<Leaf size={28} strokeWidth={1.3} />}
                    action={
                      <Button variant="secondary" asChild>
                        <Link
                          href={
                            data.accountCount
                              ? "/posts?new=1"
                              : "/accounts?new=1"
                          }
                        >
                          <Plus size={14} />
                          {data.accountCount
                            ? "Soạn bài mới"
                            : "Thêm tài khoản"}
                        </Link>
                      </Button>
                    }
                  />
                )}
                <TodayProgress progress={data.progress} onOpen={setTask} />
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Nhịp làm việc 7 ngày</h2>
                    <p>Số bài được ghi nhận theo ngày.</p>
                  </div>
                  <span className="timezone-tag">7 NGÀY QUA</span>
                </div>
                <figure
                  className="week-chart"
                  aria-label="Biểu đồ số bài đã đăng và chờ duyệt trong 7 ngày"
                  style={{ margin: 0 }}
                >
                  <div className="chart-bars">
                    {data.week.map((day) => {
                      const max = Math.max(
                        1,
                        ...data.week.flatMap((d) => [d.published, d.pending]),
                      );
                      return (
                        <div
                          key={day.date}
                          className="chart-column"
                          title={`${day.date}: ${day.published} đã đăng, ${day.pending} chờ duyệt`}
                        >
                          <span className="chart-value">
                            {day.published || ""}
                          </span>
                          <div className="bar-group">
                            <div
                              className="chart-bar"
                              style={{
                                height: `${Math.max(2, (day.published / max) * 78)}px`,
                              }}
                            />
                            <div
                              className="chart-bar chart-bar-pending"
                              style={{
                                height: `${Math.max(2, (day.pending / max) * 78)}px`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="chart-days">
                    {data.week.map((day) => (
                      <span key={day.date}>
                        {formatDate(`${day.date}T12:00:00+07:00`, {
                          weekday: "short",
                          day: undefined,
                          month: undefined,
                        })}
                      </span>
                    ))}
                  </div>
                  <figcaption className="chart-legend">
                    <span>
                      <i className="legend-square" />
                      Đã đăng
                    </span>
                    <span>
                      <i className="legend-square amber" />
                      Chờ duyệt nhóm
                    </span>
                  </figcaption>
                </figure>
              </section>
            </div>
            <div className="dashboard-side">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Tài khoản Facebook</h2>
                    <p>Mỗi tài khoản, một profile riêng.</p>
                  </div>
                  <Link href="/accounts" className="panel-link">
                    Quản lý <ChevronRight size={12} />
                  </Link>
                </div>
                {accounts.isLoading ? (
                  <Skeleton rows={2} />
                ) : accounts.error ? (
                  <ErrorState
                    error={accounts.error}
                    retry={() => accounts.refetch()}
                  />
                ) : accounts.data?.length ? (
                  <div className="account-mini-list">
                    {accounts.data.slice(0, 5).map((account) => (
                      <Link
                        href="/accounts"
                        className="account-mini"
                        key={account.id}
                      >
                        <Avatar account={account} />
                        <div>
                          <strong>{account.name}</strong>
                          <small>
                            {account.profileName} ·{" "}
                            {ACCOUNT_LABEL[account.status]}
                          </small>
                        </div>
                        <span
                          className={cn(
                            "account-dot",
                            account.status.toLowerCase(),
                          )}
                        />
                      </Link>
                    ))}
                    {accounts.data.length > 5 && (
                      <Link className="panel-link" href="/accounts">
                        Xem thêm {accounts.data.length - 5} tài khoản{" "}
                        <ChevronRight size={12} />
                      </Link>
                    )}
                  </div>
                ) : (
                  <EmptyState
                    title="Thêm tài khoản đầu tiên"
                    description="Giữ tên profile để luôn mở đúng tài khoản."
                    action={
                      <Button variant="outline" size="sm" asChild>
                        <Link href="/accounts?new=1">
                          <Plus size={13} />
                          Thêm tài khoản
                        </Link>
                      </Button>
                    }
                  />
                )}
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Sắp tới</h2>
                    <p>Các lịch đang chờ đến giờ.</p>
                  </div>
                  <CalendarDays size={17} color="var(--orange)" />
                </div>
                {data.upcoming.length ? (
                  data.upcoming.map((t) => (
                    <button
                      className="upcoming-row"
                      key={t.id}
                      onClick={() => setTask(t.id)}
                      style={{ width: "100%", textAlign: "left" }}
                    >
                      <span className="upcoming-time">
                        {formatTime(t.scheduledAt)}
                      </span>
                      <div>
                        <strong>{t.titleSnapshot}</strong>
                        <p>
                          {formatDate(t.scheduledAt)} · {t.account.name} →{" "}
                          {t.group?.name || "Trang cá nhân"}
                        </p>
                      </div>
                    </button>
                  ))
                ) : (
                  <EmptyState
                    title="Lịch đang thảnh thơi"
                    description="Lên lịch từ một bài trong thư viện của bạn."
                  />
                )}
              </section>
              <div className="notice notice-teal">
                <Leaf size={18} />
                <p>
                  <strong>Đều đặn, vừa sức.</strong>
                  <br />
                  Đọc nội quy nhóm và dành thời gian kiểm tra nội dung trước mỗi
                  lần đăng.
                </p>
              </div>
            </div>
          </div>
        </>
      ) : null}
      <TaskProcessor id={task} onClose={() => setTask(null)} />
    </>
  );
}
function TaskListRow({ task, onOpen }: { task: TaskRow; onOpen: () => void }) {
  return (
    <div className="task-list-row">
      <div className="task-time">
        <strong>{formatTime(task.scheduledAt)}</strong>
        <small>
          {dateKey(task.scheduledAt) === dateKey()
            ? "Hôm nay"
            : formatDate(task.scheduledAt)}
        </small>
      </div>
      <Avatar account={task.account} />
      <div className="task-row-main">
        <h3>{task.titleSnapshot}</h3>
        <div className="task-row-meta">
          <span>{task.account.name}</span>
          <ChevronRight size={9} />
          <span>{task.group?.name || "Trang cá nhân"}</span>
        </div>
      </div>
      <div className="task-row-actions">
        <StatusBadge status={task.status} />
        <Button variant="outline" size="sm" onClick={onOpen}>
          {task.status === "IN_PROGRESS" ? "Tiếp tục" : "Xử lý"}
          <ArrowRight size={11} />
        </Button>
      </div>
    </div>
  );
}
