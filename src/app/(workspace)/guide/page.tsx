import Link from "next/link";
import {
  BookOpen,
  Cloud,
  KeyRound,
  Laptop,
  Monitor,
  Smartphone,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/common";

export default function GuidePage() {
  return (
    <>
      <PageHeader
        eyebrow="BẮT ĐẦU VÀ DÙNG TRÊN NHIỀU THIẾT BỊ"
        title="Hướng dẫn sử dụng"
        description="Kết nối Facebook, chọn máy đăng và quản lý công việc từ máy tính hoặc điện thoại."
        actions={
          <Link className="btn btn-outline" href="/settings">
            Thiết lập tài khoản
          </Link>
        }
      />
      <div className="notice notice-teal" style={{ marginBottom: 20 }}>
        <BookOpen size={20} />
        <p>
          <strong>Web quản lý lịch; máy đăng thực hiện trên Facebook.</strong>{" "}
          Khi web ở VPS, bạn có thể quản lý từ xa. Máy đăng vẫn cần bật, có
          mạng, không ngủ và đang chạy phần mềm để nhận bài.
        </p>
      </div>
      <nav
        aria-label="Các mục hướng dẫn"
        className="page-actions"
        style={{ marginBottom: 20, flexWrap: "wrap" }}
      >
        <a className="btn btn-outline btn-sm" href="#bat-dau">
          Bắt đầu
        </a>
        <a className="btn btn-outline btn-sm" href="#vps">
          Dùng VPS
        </a>
        <a className="btn btn-outline btn-sm" href="#may-moi">
          Cài máy đăng
        </a>
        <a className="btn btn-outline btn-sm" href="#hai-may">
          Desktop & laptop
        </a>
        <a className="btn btn-outline btn-sm" href="#dien-thoai">
          Điện thoại
        </a>
        <a className="btn btn-outline btn-sm" href="#tai-khoan">
          Email & mật khẩu
        </a>
      </nav>
      <div className="settings-grid guide-grid">
        <section id="bat-dau" className="panel settings-card">
          <h2>
            <Users size={19} />
            Kết nối Facebook và lên lịch
          </h2>
          <ol>
            <li>
              Vào{" "}
              <Link className="cell-link" href="/accounts">
                Tài khoản Facebook
              </Link>
              , thêm tên và đúng link trang cá nhân.
            </li>
            <li>
              Trên bản local Windows, bấm <strong>Kết nối Facebook</strong> để
              mở cửa sổ Facebook riêng. Nếu web ở VPS, ghép nối máy đăng trước.
            </li>
            <li>
              Đăng nhập và nhập mã 2FA trực tiếp trong cửa sổ Facebook trên máy
              đăng. Kiểm tra tên, ảnh, link cá nhân rồi bấm{" "}
              <strong>Xác nhận đúng tài khoản</strong>.
            </li>
            <li>
              Bật <strong>Cho phép tự đăng bài đã lên lịch</strong> nếu cần.
              Soạn bài, thêm hội nhóm rồi lên lịch với cách thực hiện{" "}
              <strong>Tự đăng bằng máy đã kết nối</strong>.
            </li>
            <li>
              Xem kết quả tại{" "}
              <Link className="cell-link" href="/history">
                Lịch sử
              </Link>
              . Bài chờ duyệt nhóm cần được kiểm tra riêng.
            </li>
          </ol>
          <p>
            Mỗi Facebook có profile riêng trên máy đăng. Mật khẩu, cookie và 2FA
            Facebook ở trong trình duyệt trên máy đó. Phần tự đăng hiện được
            kiểm thử bằng Facebook mô phỏng; hãy thử một bài thật được phép
            trước khi dùng nhiều lịch.
          </p>
        </section>
        <section id="vps" className="panel settings-card">
          <h2>
            <Cloud size={19} />
            Khi chuyển web lên VPS
          </h2>
          <p>
            VPS chạy web, database và worker. Bạn mở tên miền HTTPS để soạn bài,
            lên lịch và xem kết quả ở bất cứ đâu. Máy tính đã kết nối nhận lịch
            từ VPS và mở Facebook để đăng.
          </p>
          <p>
            Facebook sử dụng mạng của máy đăng. Chuyển riêng web lên VPS không
            đổi IP đăng Facebook sang IP VPS. VPS Linux thông thường không thay
            thế máy đăng trong cách triển khai hiện tại.
          </p>
          <ol>
            <li>
              Sao lưu và chuyển database cùng ảnh lên VPS; cấu hình tên miền
              HTTPS.
            </li>
            <li>
              Tạm dừng máy đăng/lịch ở hệ thống cũ trước khi chuyển. Tránh chạy
              song song hai bản dữ liệu có cùng lịch.
            </li>
            <li>
              Vào{" "}
              <Link className="cell-link" href="/desktop">
                Máy đăng & Facebook
              </Link>{" "}
              trên web mới, chọn <strong>Kết nối máy mới</strong> và ghép nối
              lại với địa chỉ VPS.
            </li>
            <li>
              Kiểm tra phiên Facebook, xác nhận đúng tài khoản và bật lại tự
              đăng sau khi kiểm tra xong.
            </li>
          </ol>
          <p>
            Bản sao lưu database/ảnh không gồm profile Facebook. Phiên đã lưu
            trên máy cũ không tự xuất hiện trên máy mới.
          </p>
        </section>
        <section id="may-moi" className="panel settings-card">
          <h2>
            <Monitor size={19} />
            Cài máy tính để tự đăng
          </h2>
          <p>
            Nếu chỉ mở web để quản lý, máy tính khác chỉ cần trình duyệt. Nếu
            muốn máy Windows đó trực tiếp đăng Facebook, cài ứng dụng nền một
            lần từ website. Không cần cài Node.js hoặc sao chép lệnh.
          </p>
          <ol>
            <li>
              Trên máy Windows sẽ chạy Facebook, mở{" "}
              <strong>Máy đăng & Facebook → Tải bộ cài Windows</strong>. Mở file
              vừa tải trong 15 phút. Giữ kín bộ cài có mã ghép nối riêng.
            </li>
            <li>
              Kết nối Facebook, đăng nhập và xác nhận từng tài khoản trên máy
              đó.
            </li>
            <li>
              Những lần sau, chỉ thao tác trên website. Ứng dụng tự chạy khi
              đăng nhập Windows; máy cần bật và có mạng. Nếu cần, bấm Kết nối
              lại để mở ứng dụng nền trên máy đang dùng.
            </li>
          </ol>
          <p>
            Máy đăng không cần cài database khi web ở VPS. Nếu muốn chạy toàn bộ
            web local trên một máy mới, cần thiết lập database riêng hoặc khôi
            phục bản sao lưu; chạy <code>npm run local</code> sau khi thiết lập.
          </p>
        </section>
        <section id="hai-may" className="panel settings-card">
          <h2>
            <Laptop size={19} />
            Dùng cả desktop và laptop
          </h2>
          <p>
            Bạn có thể đăng nhập cùng tài khoản Nhịp Đăng trên cả hai máy để
            quản lý chung dữ liệu, miễn cùng truy cập một máy chủ. Hai bản web
            local và database riêng không tự đồng bộ.
          </p>
          <p>
            Mỗi máy lưu phiên Facebook riêng. Đăng nhập và xác nhận một lần trên
            từng máy; những lần sau chọn máy muốn chạy rồi bấm{" "}
            <strong>Dùng máy này</strong>. Chỉ máy được chọn nhận lịch và theo
            dõi Tin nhắn của tài khoản đó.
          </p>
          <p>
            Mỗi tài khoản Facebook hiện gắn với một máy đăng tại một thời điểm.
            Nếu chuyển sang laptop:
          </p>
          <ol>
            <li>
              Đợi công việc đang đăng hoặc tương tác hoàn tất, bật runner trên
              máy muốn dùng.
            </li>
            <li>
              Ghép nối laptop. Chọn laptop tại tài khoản Facebook rồi bấm{" "}
              <strong>Dùng máy này</strong>.
            </li>
            <li>
              Lần đầu đăng nhập Facebook trên laptop, xác nhận đúng tài khoản và
              bật quyền tự động. Khi chuyển về máy đã dùng, app kiểm tra phiên
              rồi khôi phục các quyền đã lưu riêng trên máy đó.
            </li>
          </ol>
          <p>
            Facebook có thể yêu cầu 2FA hoặc xác minh khi thấy thiết bị/IP mới.
            Việc dùng hai máy không đồng nghĩa sẽ bị khóa, nhưng không bảo đảm
            tránh xác minh. Nên giữ một máy đăng ổn định, không gửi bài thủ công
            đồng thời trong profile đang tự đăng. Không sao chép profile đang
            chạy giữa hai máy.
          </p>
        </section>
        <section className="panel settings-card">
          <h2>MacBook và Tin nhắn</h2>
          <p>
            Trên MacBook macOS 14 trở lên (Apple Silicon hoặc Intel), mở Máy
            đăng & Facebook → Tải bộ cài MacBook. Giải nén ZIP rồi mở
            Cai-Nhip-Dang.command trong 15 phút. Bộ cài tự cài Node.js và
            Chromium, thiết lập tự chạy khi đăng nhập macOS; không cần database.
          </p>
          <p>
            Chọn Mac tại tài khoản rồi bấm Dùng máy này. Đăng nhập Facebook và
            bật quyền tự động ở lần đầu trên Mac. Những lần sau chỉ cần mở web;
            nếu cần, mở ứng dụng Nhip Dang trong Applications hoặc bấm Kết nối
            lại. Mac cần bật, không ngủ và có mạng.
          </p>
          <p>
            Tin nhắn dùng cùng phiên Facebook trên máy đang được chọn. Chọn tài
            khoản trong mục Tin nhắn để xem máy nguồn và lần quan sát cuối. Khi
            cả hai máy tắt, dữ liệu dừng cập nhật. App chỉ đọc danh sách và đoạn
            xem trước, không mở hội thoại hoặc gửi tin.
          </p>
        </section>
        <section id="dien-thoai" className="panel settings-card">
          <h2>
            <Smartphone size={19} />
            Dùng trên điện thoại
          </h2>
          <p>
            Mở tên miền HTTPS của ứng dụng bằng Chrome hoặc Safari. Bấm nút menu
            để vào Thư viện bài, Lịch đăng, Tài khoản Facebook, Lịch sử và Hướng
            dẫn.
          </p>
          <p>
            Bạn có thể soạn bài, tải ảnh, tạo lịch và xem kết quả. Tự đăng được
            thực hiện bởi máy tính đã ghép nối; điện thoại chưa chạy được thành
            phần máy đăng.
          </p>
          <p>
            Khi bấm <strong>Kết nối Facebook</strong> hoặc{" "}
            <strong>Mở Facebook</strong> cho máy đã ghép nối, cửa sổ mở trên máy
            tính đó. Việc đăng nhập/2FA cần làm trên máy tính đó.
          </p>
          <p>
            <code>localhost:3000</code> chỉ trỏ về thiết bị đang mở trình duyệt.
            Địa chỉ local trên máy tính không dùng trực tiếp trên điện thoại;
            dùng tên miền VPS để truy cập từ xa.
          </p>
          <p>
            Nếu máy đăng tắt hoặc ngủ, lịch chưa chạy vẫn được giữ. Khi máy hoạt
            động lại, bài quá hạn có thể được xử lý khi các điều kiện cho phép;
            kiểm tra lịch trước khi bật lại sau thời gian dài.
          </p>
        </section>
        <section id="tai-khoan" className="panel settings-card">
          <h2>
            <KeyRound size={19} />
            Đổi email và mật khẩu ứng dụng
          </h2>
          <ol>
            <li>
              Mở{" "}
              <Link className="cell-link" href="/settings">
                Thiết lập & hướng dẫn
              </Link>
              .
            </li>
            <li>
              Bấm <strong>Đổi email đăng nhập</strong>, nhập email mới và mật
              khẩu Nhịp Đăng hiện tại.
            </li>
            <li>
              Lưu xong, đăng nhập lại bằng email mới và mật khẩu cũ. Các phiên
              web trên thiết bị khác cũng kết thúc.
            </li>
            <li>
              Muốn đổi mật khẩu, bấm <strong>Đổi mật khẩu</strong> trong cùng
              trang.
            </li>
          </ol>
          <p>
            Thay email ứng dụng giữ nguyên bài viết, ảnh, lịch và kết nối máy
            đăng. Email/mật khẩu Facebook được quản lý riêng trong Facebook.
            Hiện chưa gửi email xác minh hoặc email đặt lại mật khẩu; kiểm tra
            kỹ địa chỉ mới và liên hệ quản trị nếu quên mật khẩu.
          </p>
        </section>
      </div>
    </>
  );
}
