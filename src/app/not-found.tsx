import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone-error">
      <div className="empty-state">
        <div className="eyebrow">404 · NHỊP ĐĂNG</div>
        <h1>Đường dẫn này không còn ở đây.</h1>
        <p>Quay về góc làm việc để tiếp tục nhé.</p>
        <Link className="btn btn-primary" href="/">
          Về trang hôm nay
        </Link>
      </div>
    </main>
  );
}
