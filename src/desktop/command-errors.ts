export function browserCommandFailure(kind: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : "";
  if (
    /executable doesn't exist|browser.*not found|ENOENT.*(?:chrome|chromium|msedge)/i.test(
      detail,
    )
  )
    return "Máy đăng chưa tìm thấy trình duyệt. Cài lại bộ cài Nhịp Đăng trên máy này để bổ sung trình duyệt.";
  if (
    /processsingleton|profile.*(?:in use|locked)|user data directory is already in use/i.test(
      detail,
    )
  )
    return "Profile Facebook đang được một tiến trình khác sử dụng. Đóng cửa sổ dùng trùng profile rồi thử lại; không cần đăng xuất Facebook.";
  if (/net::ERR_ABORTED|interrupted by another navigation/i.test(detail))
    return "Facebook đang chuyển hướng trang nên chưa kiểm tra được phiên. Đợi trang ổn định rồi bấm Kiểm tra phiên lại.";
  if (/net::ERR_|Timeout|timed out|fetch failed/i.test(detail))
    return "Chưa tải hoặc kiểm tra được trang Facebook. Kiểm tra mạng trên máy đăng rồi thử lại; phiên đã lưu vẫn được giữ.";
  if (/target.*closed|context.*closed|browser.*closed/i.test(detail))
    return "Cửa sổ Facebook đã đóng trong lúc xử lý. Bấm Mở Facebook rồi thử lại.";
  return kind === "CHECK"
    ? "Chưa kiểm tra được phiên Facebook. Đợi trang ổn định rồi thử lại. Kết quả xác nhận trước đó vẫn được giữ."
    : "Chưa hoàn tất thao tác với cửa sổ Facebook. Kiểm tra máy đăng rồi thử lại; phiên đã lưu vẫn được giữ.";
}
