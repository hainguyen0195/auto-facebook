"use client";
import {
  Clock3,
  ExternalLink,
  Fingerprint,
  Monitor,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useResource, type Bootstrap } from "@/lib/client";
import { PasswordDialog } from "@/components/password-dialog";
import { EmailDialog } from "@/components/email-dialog";
import { ErrorState, PageHeader, Skeleton } from "@/components/common";

export default function SettingsPage() {
  const query = useResource<Bootstrap>("bootstrap");
  const data = query.data;
  return (
    <>
      <PageHeader
        eyebrow="HIỂU CÁCH DÙNG, LÀM VIỆC NHẸ HƠN"
        title="Thiết lập & hướng dẫn"
        description="Những điều cần biết để dùng góc làm việc của bạn một cách chủ động."
        actions={
          <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
            <EmailDialog email={data?.user.email || ""} />
            <PasswordDialog />
          </div>
        }
      />
      <div className="settings-grid">
        <section className="panel settings-card">
          <h2>
            <Fingerprint size={19} />
            Không gian của bạn
          </h2>
          {query.isLoading ? (
            <Skeleton
              variant="inline"
              rows={4}
              label="Đang tải thông tin không gian"
            />
          ) : query.error ? (
            <ErrorState error={query.error} retry={() => query.refetch()} />
          ) : (
            <>
              <div className="settings-line">
                <span>Người sử dụng</span>
                <strong>{data?.user.name}</strong>
              </div>
              <div className="settings-line">
                <span>Email ứng dụng</span>
                <strong>{data?.user.email}</strong>
              </div>
              <div className="settings-line">
                <span>Múi giờ</span>
                <strong>UTC+7 · Asia/Bangkok</strong>
              </div>
              <div className="settings-line">
                <span>Cách đăng bài</span>
                <strong>Thủ công hoặc máy đăng đã kết nối</strong>
              </div>
              <p>
                Tài khoản, hội nhóm, bài viết và ảnh được giữ riêng trong không
                gian của bạn.
              </p>
            </>
          )}
        </section>
        <section className="panel settings-card">
          <h2>
            <Monitor size={19} />
            Mỗi Facebook, một profile
          </h2>
          <ol>
            <li>Mở mục Máy đăng, kết nối máy tính sẽ chạy Facebook.</li>
            <li>
              Bấm Đăng nhập Facebook trên từng tài khoản. Mỗi tài khoản có
              profile riêng trên máy đó; nhập mật khẩu và 2FA trực tiếp trong
              trình duyệt.
            </li>
            <li>
              Bấm Kiểm tra phiên, kiểm tra danh tính trong Facebook rồi xác nhận
              đúng tài khoản.
            </li>
            <li>
              Bật cho phép tự đăng và chọn cách thực hiện khi lên lịch. Giữ máy
              đăng hoạt động khi đến giờ.
            </li>
          </ol>
          <p>
            Phiên Facebook nằm trong profile riêng trên máy đăng. Webapp không
            nhận mật khẩu, cookie hay mã 2FA Facebook.
          </p>
        </section>
        <section className="panel settings-card">
          <h2>
            <Clock3 size={19} />
            Lịch nhắc và kết quả
          </h2>
          <p>
            Lịch thủ công trở thành công việc để bạn xử lý. Lịch tự động được
            máy đăng nhận tuần tự, theo giờ nghỉ, mức việc/ngày và khoảng cách
            nhóm bạn đặt.
          </p>
          <p>
            Khi đóng tab, các lịch vẫn được giữ. Máy đăng tắt sẽ giữ lại công
            việc chưa chạy. Nếu mất kết nối giữa lúc gửi hoặc kết quả chưa rõ,
            ứng dụng dừng công việc và tắt tự đăng của tài khoản để bạn kiểm
            tra; không tự gửi lại.
          </p>
          <p>
            Chọn “Chờ duyệt nhóm” khi bài đang đợi quản trị viên. Sau khi kiểm
            tra trên Facebook, quay lại Lịch sử để cập nhật kết quả.
          </p>
        </section>
        <section className="panel settings-card">
          <h2>
            <ShieldCheck size={19} />
            Giữ nhịp vừa sức
          </h2>
          <p>
            Không có tần suất đăng bảo đảm tránh khóa tài khoản. Đọc nội quy
            nhóm, dùng nội dung phù hợp và theo dõi các cảnh báo trực tiếp từ
            Facebook.
          </p>
          <p>
            Giới hạn công việc và giờ nghỉ là thiết lập cá nhân trong ứng dụng.
            Chúng giúp bạn tổ chức thời gian.
          </p>
          <p>
            Khi tài khoản bị hạn chế, cập nhật trạng thái để tạm dừng công việc.
            Chỉ tiếp tục khi bạn đã kiểm tra và xử lý vấn đề.
          </p>
          <a
            className="cell-link"
            href="https://transparency.meta.com/policies/community-standards/spam/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Xem chính sách spam của Meta <ExternalLink size={12} />
          </a>
        </section>
      </div>
      <div className="notice notice-teal" style={{ marginTop: 20 }}>
        <Sparkles size={18} />
        <p>
          Nhịp Đăng v1 tập trung vào nội dung và ảnh cho Facebook cá nhân, hội
          nhóm. Không cần cung cấp token Facebook hay quyền truy cập tài khoản
          cho ứng dụng.
        </p>
      </div>
    </>
  );
}
