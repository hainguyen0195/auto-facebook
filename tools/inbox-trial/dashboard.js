const labels = {
  STARTING: "Đang khởi động",
  LOGIN_REQUIRED: "Cần đăng nhập Facebook trên VPS",
  CHALLENGE: "Facebook yêu cầu xác minh",
  WRONG_IDENTITY: "Sai tài khoản — đã dừng đọc tin",
  PIN_REQUIRED: "Messenger yêu cầu nhập PIN trực tiếp",
  UNSUPPORTED: "Chưa đọc được danh sách Messenger",
  UNSAFE_VIEW: "Đã dừng — có hội thoại đang mở",
  ONLINE: "Đang quan sát danh sách",
  OFFLINE: "Ngừng cập nhật — giữ dữ liệu lần trước",
  STOPPED: "Bộ thử đã dừng",
};
const eventLabels = {
  UNREAD_FOUND: "Phát hiện hội thoại chưa đọc",
  PREVIEW_CHANGED: "Đoạn xem trước thay đổi",
  READ_STATE_CHANGED: "Dấu đã đọc thay đổi",
};
const time = (value) =>
  value
    ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    : "Chưa có";
const element = (tag, text, className) => {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
};
async function refresh() {
  try {
    const response = await fetch("/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Unavailable");
    const data = await response.json();
    document.getElementById("account").textContent = data.accountName;
    const stale = Date.now() - Date.parse(data.checkedAt) > 90_000;
    document.getElementById("status").textContent = stale
      ? "Bộ theo dõi không cập nhật gần đây"
      : labels[data.status] || data.status;
    document.getElementById("reason").textContent = data.reason;
    document.getElementById("updated").textContent =
      `Quan sát thành công gần nhất: ${time(data.lastSuccessAt)} · Kiểm tra: ${time(data.checkedAt)} (giờ Việt Nam)`;
    const rows = data.conversations.sort(
      (a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt),
    );
    const unread = rows.filter((row) => row.unread === true).length;
    document.getElementById("count").textContent =
      `${rows.length} hội thoại ghi nhận · ${unread} có dấu chưa đọc trong dữ liệu đã lưu`;
    const cards = rows.map((row) => {
      const card = element("article", "", "card");
      const top = element("div", "", "top");
      top.append(
        element("strong", row.name),
        element(
          "span",
          row.unread === true
            ? "Có dấu chưa đọc"
            : row.unread === false
              ? "Có dấu đã đọc"
              : "Chưa xác định đã đọc",
          "meta",
        ),
      );
      card.append(
        top,
        element("p", row.preview || "Chưa lấy được đoạn xem trước", "preview"),
        element(
          "div",
          `ID ${row.id} · Quan sát ${time(row.observedAt)}`,
          "meta",
        ),
      );
      return card;
    });
    document
      .getElementById("conversations")
      .replaceChildren(
        ...(cards.length
          ? cards
          : [
              element(
                "p",
                "Chưa có dữ liệu. Mở cửa sổ Facebook để đăng nhập và kiểm tra bảng Messenger.",
                "meta",
              ),
            ]),
      );
    const names = new Map(rows.map((row) => [row.id, row.name]));
    document.getElementById("events").replaceChildren(
      ...data.events
        .slice(-40)
        .reverse()
        .map((event) =>
          element(
            "li",
            `${time(event.at)} · ${names.get(event.conversationId) || event.conversationId} · ${eventLabels[event.kind] || event.kind}`,
          ),
        ),
    );
  } catch {
    document.getElementById("status").textContent =
      "Mất kết nối tới bộ thử; dữ liệu đang hiển thị có thể cũ";
  }
}
void refresh();
setInterval(refresh, 5000);
