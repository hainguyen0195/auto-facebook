"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  MessageCircle,
  MessagesSquare,
  Plus,
  Settings2,
  ShieldCheck,
  Users,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { api, useResource, type DashboardData } from "@/lib/client";
import { inboxUnreadTotal, type InboxData } from "@/lib/inbox-types";
import { MobileAppBridge } from "./mobile-app-bridge";
import { disconnectMobilePush } from "@/lib/mobile-app-client";
import { cn, formatDate, formatTime, initials } from "@/lib/utils";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import { TaskProcessor } from "./task-processor";
import { ErrorState, Skeleton } from "./common";

const navigation = [
  { href: "/", label: "Hôm nay", icon: LayoutDashboard },
  { href: "/calendar", label: "Lịch đăng", icon: CalendarDays },
  { href: "/posts", label: "Thư viện bài", icon: FileText },
  { href: "/accounts", label: "Tài khoản Facebook", icon: Users },
  { href: "/desktop", label: "Máy đăng & Facebook", icon: Monitor },
  { href: "/inbox", label: "Tin nhắn", icon: MessagesSquare },
  { href: "/interactions", label: "Tương tác", icon: MessageCircle },
  { href: "/groups", label: "Hội nhóm", icon: UsersRound },
  { href: "/history", label: "Lịch sử", icon: History },
  { href: "/guide", label: "Hướng dẫn", icon: CircleHelp },
];
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span>
        nhịp<span className="brand-light">đăng</span>
        <span className="brand-dot">.</span>
      </span>
    </span>
  );
}
export function AppShell({
  user,
  children,
}: {
  user: { name: string; email: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const client = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [notices, setNotices] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const dashboard = useResource<DashboardData>("dashboard", {
    refetchInterval: 30_000,
  });
  const data = dashboard.data;
  const inbox = useResource<InboxData>("inbox?view=summary", {
    refetchInterval: 30_000,
  });
  const inboxUnread = inbox.data ? inboxUnreadTotal(inbox.data) : 0;
  const [readingNotices, setReadingNotices] = useState(false);
  const current =
    navigation.find((n) => n.href === pathname)?.label || "Thiết lập";
  const nav = (
    <>
      <div className="nav-caption">GÓC LÀM VIỆC</div>
      <nav aria-label="Điều hướng chính">
        {navigation.map((item) => (
          <Link
            href={item.href}
            key={item.href}
            onClick={() => setMenu(false)}
            className={cn("nav-item", pathname === item.href && "nav-active")}
            aria-current={pathname === item.href ? "page" : undefined}
          >
            <item.icon size={19} strokeWidth={1.7} />
            <span>{item.label}</span>
            {item.href === "/" && !!data?.due && (
              <span className="nav-count">{data.due}</span>
            )}
            {item.href === "/inbox" && inboxUnread > 0 && (
              <span className="nav-count">{inboxUnread}</span>
            )}
          </Link>
        ))}
      </nav>
      <div className="sidebar-tip">
        <div className="tip-icon">
          <ShieldCheck size={19} />
        </div>
        <strong>Đăng bài có chủ đích</strong>
        <p>Kiểm tra đúng tài khoản và theo dõi kết quả từng bài.</p>
        <Link href="/guide" onClick={() => setMenu(false)}>
          Xem hướng dẫn <ChevronRight size={13} />
        </Link>
      </div>
    </>
  );
  async function logout() {
    setLoggingOut(true);
    try {
      await disconnectMobilePush().catch(() => {});
      const result = await authClient.signOut();
      if (result.error) throw new Error("Chưa thể đăng xuất.");
      client.clear();
      window.location.assign("/login");
    } catch (e) {
      toast.error((e as Error).message);
      setLoggingOut(false);
    }
  }
  return (
    <div className="app-shell">
      <MobileAppBridge
        unread={inbox.data && !inbox.error ? inboxUnread : null}
      />
      <a className="skip-link" href="#main">
        Đến nội dung chính
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand-link" aria-label="Nhịp Đăng, trang chủ">
          <Brand />
        </Link>
        <div className="workspace-switch">
          <span className="workspace-icon">N</span>
          <div>
            <strong>Không gian của bạn</strong>
            <small>Gọn việc, đều nhịp</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="sidebar-scroll">{nav}</div>
        <div className="sidebar-bottom">
          <Link
            href="/settings"
            className={cn("nav-item", pathname === "/settings" && "nav-active")}
          >
            <Settings2 size={18} />
            Thiết lập & hướng dẫn
          </Link>
          <div className="user-card">
            <span className="user-avatar">{initials(user.name)}</span>
            <div>
              <strong>{user.name}</strong>
              <small title={user.email}>{user.email}</small>
            </div>
            <button
              className="icon-button"
              onClick={logout}
              disabled={loggingOut}
              aria-label="Đăng xuất"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Mở menu"
              onClick={() => setMenu(true)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb-home">Góc làm việc</span>
            <ChevronRight className="breadcrumb-arrow" size={13} />
            <strong>{current}</strong>
          </div>
          <div className="topbar-right">
            <span className="timezone-tag">UTC+7</span>
            <span className="topbar-date">
              {formatDate(new Date(), { weekday: "short", year: "numeric" })}
            </span>
            <Link
              href="/inbox"
              className="inbox-shortcut"
              aria-label={`Tin nhắn${inboxUnread ? `, ${inboxUnread} hội thoại có dấu chưa đọc` : ""}`}
            >
              <MessagesSquare size={19} />
              {inboxUnread > 0 && (
                <span>{inboxUnread > 99 ? "99+" : inboxUnread}</span>
              )}
            </Link>
            <button
              className="notification-button"
              aria-label={`Thông báo${data?.notifications.length ? `, ${data.notifications.length} chưa đọc` : ""}`}
              onClick={() => setNotices(true)}
            >
              <Bell size={19} />
              {!!data?.notifications.length && <span />}
            </button>
            <Link
              href="/posts?new=1"
              className="btn btn-primary btn-sm topbar-create"
            >
              <Plus size={16} />
              Soạn bài
            </Link>
          </div>
        </header>
        <main id="main" className="main-content" tabIndex={-1}>
          {children}
          <footer className="page-footer">
            <span>
              Nhịp Đăng <span className="footer-dot">·</span> Một góc làm việc,
              nhẹ đầu hơn.
            </span>
            <span>
              <span className="small-dot" />
              Theo dõi rõ nguồn kết quả
            </span>
          </footer>
        </main>
      </div>
      <Modal
        open={menu}
        onOpenChange={setMenu}
        title="Nhịp Đăng"
        description="Góc làm việc của bạn"
      >
        {nav}
      </Modal>
      <Modal
        open={notices}
        onOpenChange={setNotices}
        title="Nhắc việc của bạn"
        description="Công việc đến hạn vẫn được giữ khi bạn đóng tab."
      >
        {dashboard.isLoading ? (
          <Skeleton rows={3} label="Đang tải nhắc việc" />
        ) : dashboard.error ? (
          <ErrorState
            error={dashboard.error}
            retry={() => dashboard.refetch()}
          />
        ) : !data?.notifications.length ? (
          <div className="empty-state compact">
            <Check size={28} />
            <h3>Bạn đã xem hết nhắc việc</h3>
            <p>Lịch đến hạn sẽ xuất hiện ở đây.</p>
          </div>
        ) : (
          <div className="notification-list">
            {data?.notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setTaskId(n.task.id);
                  setNotices(false);
                }}
              >
                <span className="notification-symbol">
                  <CalendarDays size={17} />
                </span>
                <div>
                  <strong>{n.task.titleSnapshot}</strong>
                  <p>
                    {n.task.account.name} →{" "}
                    {n.task.group?.name || "Trang cá nhân"}
                  </p>
                  <small>
                    {formatDate(n.task.scheduledAt)} ·{" "}
                    {formatTime(n.task.scheduledAt)}
                  </small>
                </div>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        )}
        {!!data?.notifications.length && (
          <div className="dialog-footer">
            <Button
              variant="outline"
              loading={readingNotices}
              onClick={async () => {
                setReadingNotices(true);
                try {
                  await api("notifications/read", "POST", {});
                  await client.invalidateQueries();
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setReadingNotices(false);
                }
              }}
            >
              Đánh dấu đã đọc
            </Button>
          </div>
        )}
      </Modal>
      <TaskProcessor id={taskId} onClose={() => setTaskId(null)} />
    </div>
  );
}
