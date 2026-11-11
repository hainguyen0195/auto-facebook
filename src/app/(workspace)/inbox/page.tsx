"use client";

import { useState } from "react";
import {
  Clock3,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Wifi,
  WifiOff,
  ArrowLeft,
  ChevronRight,
} from "lucide-react";
import { useResource } from "@/lib/client";
import {
  INBOX_HINTS,
  INBOX_LABELS,
  inboxUnreadTotal,
  type InboxData,
} from "@/lib/inbox-types";
import { MobileNotifications } from "@/components/mobile-notifications";
import { cn, formatDate, formatTime, initials } from "@/lib/utils";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const timestamp = (value: string | null) =>
  value ? `${formatTime(value)} · ${formatDate(value)}` : "Chưa ghi nhận";

export default function InboxPage() {
  const query = useResource<InboxData>("inbox?view=summary", {
    refetchInterval: 10_000,
  });
  const [accountId, setAccountId] = useState("");
  const data = query.data;
  const accounts =
    data?.accounts ||
    (data?.account
      ? [
          {
            ...data.account,
            status: data.status,
            fresh: data.fresh,
            unreadCount: data.conversations.filter((r) => r.unread === true)
              .length,
            lastKnownUnreadCount: data.conversations.filter(
              (r) => r.unread === true,
            ).length,
            lastSuccessAt: data.lastSuccessAt,
          },
        ]
      : []);
  const countFor = (account: (typeof accounts)[number]) =>
    account.fresh ? account.unreadCount : (account.lastKnownUnreadCount ?? 0);
  const connectedAccounts = [...accounts]
    .filter((a) => a.status !== "NOT_CONFIGURED")
    .sort(
      (a, b) => countFor(b) - countFor(a) || a.name.localeCompare(b.name, "vi"),
    );
  return (
    <>
      <PageHeader
        eyebrow="KHÔNG BỎ LỠ KHÁCH"
        title="Tin nhắn"
        description="Tin nhắn chưa đọc trong 48 giờ gần nhất của các nick đã kết nối."
        actions={
          <Button
            variant="outline"
            loading={query.isFetching}
            onClick={() => query.refetch()}
          >
            <RefreshCw size={15} />
            Cập nhật
          </Button>
        }
      />
      <MobileNotifications />
      {query.error && (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      )}
      {query.isLoading ? (
        <Skeleton
          variant="inbox"
          rows={4}
          label="Đang tải tin nhắn các tài khoản"
        />
      ) : (
        data && (
          <>
            <section
              className="inbox-overview"
              aria-label="Tổng quan tin nhắn các tài khoản"
            >
              <div className="inbox-overview-total">
                <span className="inbox-overview-number">
                  {inboxUnreadTotal(data)}
                </span>
                <div>
                  <h2>hội thoại chưa đọc</h2>
                  <p>
                    Đã ghi nhận từ {connectedAccounts.length} tài khoản Facebook
                  </p>
                </div>
              </div>
              <p>
                Chỉ tính tin nhắn trong 48 giờ gần nhất. Tin cũ hơn hoặc chưa
                xác định được thời gian sẽ không tăng số đỏ và không gửi thông
                báo.
              </p>
            </section>
            <section
              className="inbox-account-list"
              aria-label="Tài khoản có tin nhắn"
            >
              {connectedAccounts.length ? (
                connectedAccounts.map((account) => {
                  const known = account.fresh || !!account.lastSuccessAt;
                  const count = countFor(account);
                  return (
                    <button
                      key={account.id}
                      className={cn(
                        "panel inbox-account-card",
                        known && count > 0 && "inbox-account-has-unread",
                      )}
                      onClick={() => setAccountId(account.id)}
                      aria-label={`Xem tin nhắn ${account.name}`}
                      aria-pressed={accountId === account.id}
                    >
                      <span className="avatar avatar-teal">
                        {initials(account.name)}
                      </span>
                      <span className="inbox-account-copy">
                        <strong>{account.name}</strong>
                        <span>
                          {account.fresh
                            ? count > 0
                              ? "Có hội thoại chưa đọc"
                              : "Chưa ghi nhận hội thoại chưa đọc"
                            : INBOX_LABELS[account.status]}
                        </span>
                        {!account.fresh && (
                          <small>
                            {account.lastSuccessAt
                              ? `Ghi nhận gần nhất: ${timestamp(account.lastSuccessAt)}`
                              : "Chưa có lần quan sát thành công"}
                          </small>
                        )}
                      </span>
                      <span
                        className={cn(
                          "inbox-account-count",
                          !account.fresh && "inbox-account-count-stale",
                        )}
                        aria-label={
                          known
                            ? `${count} hội thoại chưa đọc${account.fresh ? "" : ", dữ liệu cũ"}`
                            : "Chưa xác định số chưa đọc"
                        }
                      >
                        {known ? count : "—"}
                      </span>
                      <ChevronRight size={17} />
                    </button>
                  );
                })
              ) : (
                <div className="panel">
                  <EmptyState
                    icon={<MessageCircle size={28} />}
                    title="Chưa có tài khoản Facebook được kết nối"
                    description="Đăng nhập và xác nhận tài khoản tại Máy đăng & Facebook. Các nick sẽ xuất hiện tại đây khi được kết nối."
                  />
                </div>
              )}
            </section>
            {accountId && (
              <div className="inbox-expanded-details">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAccountId("")}
                >
                  <ArrowLeft size={15} />
                  Thu gọn chi tiết
                </Button>
                <InboxDetails
                  accountId={accountId}
                  onAccountChange={setAccountId}
                />
              </div>
            )}
          </>
        )
      )}
    </>
  );
}

function InboxDetails({
  accountId,
  onAccountChange,
}: {
  accountId: string;
  onAccountChange: (id: string) => void;
}) {
  const query = useResource<InboxData>(
    accountId ? `inbox?accountId=${encodeURIComponent(accountId)}` : "inbox",
    { refetchInterval: 10_000 },
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const data = query.data;
  const connected = data?.status === "ONLINE" && data.fresh && !query.error;
  const rows = [...(data?.conversations || [])].sort((a, b) => {
    if (a.unread === true && b.unread !== true) return -1;
    if (b.unread === true && a.unread !== true) return 1;
    return Date.parse(b.observedAt) - Date.parse(a.observedAt);
  });
  const visible = rows.filter(
    (row) =>
      `${row.name} ${row.preview || ""}`
        .toLocaleLowerCase("vi")
        .includes(search.toLocaleLowerCase("vi")) &&
      (filter === "all" ||
        (filter === "unread" ? row.unread === true : row.unread === null)),
  );
  const selected = rows.find((row) => row.id === selectedId);
  const unread = rows.filter((row) => row.unread === true).length;
  return (
    <>
      {query.error && (
        <ErrorState error={query.error} retry={() => query.refetch()} />
      )}
      {query.isLoading ? (
        <Skeleton
          variant="inbox-detail"
          rows={4}
          label="Đang tải chi tiết tin nhắn"
        />
      ) : (
        data && (
          <>
            {!!data.accounts?.length && (
              <div className="toolbar">
                <label className="toolbar-left">
                  Tài khoản Facebook
                  <Select
                    aria-label="Tài khoản xem tin nhắn"
                    value={accountId || data.account?.id || ""}
                    onValueChange={(value) => {
                      onAccountChange(value);
                      setSelectedId(null);
                      setSearch("");
                      setFilter("all");
                    }}
                  >
                    {data.accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
            )}
            <section
              className={cn(
                "inbox-connection panel",
                connected && "inbox-connected",
              )}
              aria-label="Kết nối theo dõi tin nhắn"
            >
              <span className="inbox-connection-icon">
                {connected ? <Wifi size={22} /> : <WifiOff size={22} />}
              </span>
              <div className="inbox-connection-copy">
                <div className="inbox-caption">
                  {data.account?.name || "TÀI KHOẢN FACEBOOK"}
                  <span className="timezone-tag">Bản thử</span>
                </div>
                <h2>
                  {query.error
                    ? "Mất kết nối tới bộ theo dõi"
                    : data.status === "ONLINE" && !data.fresh && data.checkedAt
                      ? "Dữ liệu chưa được cập nhật gần đây"
                      : INBOX_LABELS[data.status]}
                </h2>
                <p>{INBOX_HINTS[query.error ? "OFFLINE" : data.status]}</p>
                {data.source && (
                  <p>
                    Máy đang dùng: <strong>{data.source.name}</strong> ·{" "}
                    {data.source.online ? "Trực tuyến" : "Ngoại tuyến"}
                  </p>
                )}
                <span className="inbox-timestamp">
                  <Clock3 size={13} />
                  Quan sát thành công: {timestamp(data.lastSuccessAt)} · UTC+7
                </span>
              </div>
              <div className="inbox-known-count">
                <strong>{data.lastSuccessAt ? unread : "—"}</strong>
                <span>
                  hội thoại có dấu
                  <br />
                  chưa đọc đã ghi nhận
                </span>
              </div>
            </section>
            {data.configured ? (
              <>
                <div className="notice notice-teal inbox-notice">
                  <ShieldCheck size={18} />
                  <p>
                    Tin nhắn dùng phiên Facebook trên máy đang được chọn. Danh
                    sách chỉ gồm các hội thoại có tin trong 48 giờ gần nhất đã
                    xác định được thời gian. Xem đoạn tin tại đây không đánh dấu
                    đã đọc trên Facebook.
                  </p>
                </div>
                <div className="toolbar">
                  <div className="toolbar-left">
                    <label className="search-box">
                      <Search size={16} />
                      <input
                        aria-label="Tìm hội thoại"
                        placeholder="Tìm tên khách hoặc đoạn tin…"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <Select
                      aria-label="Lọc trạng thái đọc"
                      value={filter}
                      onValueChange={setFilter}
                    >
                      <option value="all">Tất cả hội thoại ghi nhận</option>
                      <option value="unread">Có dấu chưa đọc</option>
                      <option value="unknown">Chưa xác định đã đọc</option>
                    </Select>
                  </div>
                  <span className="results-count">
                    {visible.length} hội thoại
                  </span>
                </div>
                <div className="inbox-layout">
                  <section
                    className="panel inbox-conversations"
                    aria-label="Danh sách hội thoại"
                  >
                    {visible.length ? (
                      visible.map((row) => (
                        <button
                          key={row.id}
                          className={cn(
                            "inbox-conversation",
                            selectedId === row.id && "inbox-selected",
                            row.unread === true && "inbox-unread",
                          )}
                          onClick={() => setSelectedId(row.id)}
                          aria-pressed={selectedId === row.id}
                        >
                          <span className="avatar avatar-teal avatar-sm">
                            {initials(row.name)}
                          </span>
                          <span className="inbox-row-copy">
                            <span className="inbox-row-heading">
                              <strong>{row.name}</strong>
                              {row.unread === true && (
                                <span
                                  className="inbox-unread-dot"
                                  aria-label="Có dấu chưa đọc"
                                />
                              )}
                            </span>
                            <span className="inbox-row-preview">
                              {row.preview || "Chưa lấy được đoạn xem trước"}
                            </span>
                            <small>
                              {data.account?.name} · {timestamp(row.observedAt)}
                              {row.unread === null && " · Chưa xác định đã đọc"}
                            </small>
                          </span>
                        </button>
                      ))
                    ) : (
                      <EmptyState
                        icon={<MessageCircle size={27} />}
                        title={
                          search || filter !== "all"
                            ? "Không có hội thoại phù hợp"
                            : "Chưa có hội thoại được ghi nhận"
                        }
                        description={
                          search || filter !== "all"
                            ? "Thử đổi từ khóa hoặc bộ lọc."
                            : "Danh sách sẽ tự xuất hiện khi máy đang dùng hoạt động và đọc được bảng Messenger."
                        }
                      />
                    )}
                  </section>
                  <section
                    className="panel inbox-preview"
                    aria-label="Đoạn tin xem trước"
                  >
                    {selected ? (
                      <>
                        <div className="inbox-preview-heading">
                          <span className="avatar avatar-teal">
                            {initials(selected.name)}
                          </span>
                          <div>
                            <h2>{selected.name}</h2>
                            <p>Nhắn cho {data.account?.name}</p>
                          </div>
                        </div>
                        <p className="inbox-read-label">
                          {selected.unread === true
                            ? "Có dấu chưa đọc trên Facebook"
                            : selected.unread === false
                              ? "Có dấu đã đọc trên Facebook"
                              : "Chưa xác định trạng thái đọc"}
                        </p>
                        <div className="inbox-message-preview">
                          {selected.preview ||
                            "Chưa lấy được đoạn xem trước của hội thoại này."}
                        </div>
                        <span className="inbox-timestamp">
                          Đoạn tin ghi nhận:{" "}
                          {timestamp(
                            selected.previewObservedAt ?? selected.observedAt,
                          )}
                        </span>
                        <div className="inbox-reply-hint">
                          <MessageCircle size={17} />
                          <p>
                            Trả lời bằng Messenger trên điện thoại, chọn đúng
                            tài khoản <strong>{data.account?.name}</strong>. Đây
                            là đoạn xem trước, chưa phải toàn bộ cuộc trò
                            chuyện.
                          </p>
                        </div>
                      </>
                    ) : (
                      <EmptyState
                        icon={<MessageCircle size={30} />}
                        title="Một chỗ để biết khách đang đợi"
                        description="Chọn hội thoại bên cạnh để xem đoạn tin đã ghi nhận và tài khoản cần mở trên điện thoại."
                      />
                    )}
                  </section>
                </div>
              </>
            ) : (
              <div className="panel">
                <EmptyState
                  icon={<MessageCircle size={29} />}
                  title="Theo dõi tin nhắn từng tài khoản"
                  description="Kết nối và xác nhận Facebook tại mục Máy đăng & Facebook. Tin nhắn sẽ dùng luôn phiên đã kết nối."
                />
              </div>
            )}
          </>
        )
      )}
    </>
  );
}
