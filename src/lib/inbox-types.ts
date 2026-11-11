export type InboxStatus =
  | "NOT_CONFIGURED"
  | "STARTING"
  | "LOGIN_REQUIRED"
  | "CHALLENGE"
  | "WRONG_IDENTITY"
  | "PIN_REQUIRED"
  | "UNSUPPORTED"
  | "UNSAFE_VIEW"
  | "ONLINE"
  | "OFFLINE"
  | "STOPPED";

export type InboxConversation = {
  id: string;
  name: string;
  preview: string | null;
  unread: boolean | null;
  lastMessageAt?: string | null;
  observedAt: string;
  previewObservedAt?: string | null;
  unreadObservedAt?: string | null;
};

export const INBOX_MESSAGE_WINDOW_MS = 48 * 60 * 60_000;

export function isRecentInboxConversation(
  row: { lastMessageAt?: string | null },
  now = Date.now(),
): boolean {
  if (!row.lastMessageAt) return false;
  const age = now - Date.parse(row.lastMessageAt);
  return Number.isFinite(age) && age >= 0 && age < INBOX_MESSAGE_WINDOW_MS;
}
export type DesktopInboxStatus =
  InboxStatus | "BUSY" | "UPDATE_REQUIRED" | "UNCONFIRMED";
export type InboxData = {
  configured: boolean;
  account: { id: string; name: string; color: string } | null;
  status: DesktopInboxStatus;
  source?: { id: string; name: string; online: boolean } | null;
  accounts?: {
    id: string;
    name: string;
    color: string;
    status: DesktopInboxStatus;
    fresh: boolean;
    unreadCount: number;
    lastKnownUnreadCount?: number;
    lastSuccessAt?: string | null;
  }[];
  checkedAt: string | null;
  lastSuccessAt: string | null;
  fresh: boolean;
  partial: true;
  conversations: InboxConversation[];
};

export function inboxUnreadTotal(data: InboxData): number {
  if (data.accounts)
    return data.accounts.reduce(
      (total, account) =>
        total +
        (account.fresh
          ? account.unreadCount
          : (account.lastKnownUnreadCount ?? 0)),
      0,
    );
  return data.conversations.filter(
    (row) => row.unread === true && isRecentInboxConversation(row),
  ).length;
}

export const INBOX_LABELS: Record<DesktopInboxStatus, string> = {
  NOT_CONFIGURED: "Chưa bật theo dõi tin nhắn",
  STARTING: "Đang khôi phục phiên đã lưu",
  LOGIN_REQUIRED: "Facebook yêu cầu đăng nhập trên máy đang dùng",
  CHALLENGE: "Facebook yêu cầu xác minh",
  WRONG_IDENTITY: "Cần kiểm tra đúng tài khoản",
  PIN_REQUIRED: "Messenger yêu cầu nhập PIN",
  UNSUPPORTED: "Chưa nhận diện được danh sách tin nhắn",
  UNSAFE_VIEW: "Đang mở hội thoại trên máy theo dõi",
  ONLINE: "Đang theo dõi tin nhắn",
  OFFLINE: "Tạm ngừng cập nhật",
  STOPPED: "Bộ theo dõi đã dừng",
  BUSY: "Đang thực hiện công việc",
  UPDATE_REQUIRED: "Cần cập nhật máy đăng",
  UNCONFIRMED: "Cần xác nhận đúng tài khoản",
};

export const INBOX_HINTS: Record<DesktopInboxStatus, string> = {
  NOT_CONFIGURED:
    "Chưa có tài khoản được kết nối với bộ theo dõi trong không gian này.",
  STARTING: "Đang kiểm tra phiên Facebook đã lưu trên máy được chọn.",
  LOGIN_REQUIRED:
    "Đăng nhập trong cửa sổ Facebook trên máy đang dùng. Tin nhắn dùng cùng phiên với máy đăng bài.",
  CHALLENGE:
    "Hoàn tất xác minh trực tiếp trong cửa sổ Facebook trên máy đang dùng.",
  WRONG_IDENTITY:
    "Danh tính Facebook không khớp tài khoản đã xác nhận. Dữ liệu mới sẽ chỉ được ghi nhận khi đúng tài khoản.",
  PIN_REQUIRED:
    "Nhập PIN trực tiếp trong tab theo dõi Messenger trên máy đang dùng để khôi phục đoạn xem trước.",
  UNSUPPORTED:
    "Chưa đọc được giao diện Messenger hiện tại. Đây không phải xác nhận hộp thư không có tin mới.",
  UNSAFE_VIEW:
    "Bạn có thể tiếp tục đọc hội thoại. Bộ theo dõi sẽ dùng một tab riêng ở lượt cập nhật tiếp theo.",
  ONLINE:
    "Đang đọc danh sách Messenger bằng phiên Facebook đã kết nối trên máy đang dùng.",
  OFFLINE:
    "Dữ liệu cũ được giữ cùng thời điểm quan sát. Chờ bộ theo dõi kết nối lại.",
  STOPPED: "Dữ liệu đang hiển thị là lần ghi nhận trước khi dừng.",
  BUSY: "Máy đang ưu tiên đăng bài hoặc tương tác. Tin nhắn sẽ cập nhật tiếp khi máy rảnh.",
  UPDATE_REQUIRED:
    "Cập nhật mã nguồn và khởi động lại runner trên máy đang dùng để theo dõi Tin nhắn.",
  UNCONFIRMED:
    "Kiểm tra và xác nhận đúng tài khoản tại mục Máy đăng & Facebook trước khi theo dõi.",
};
