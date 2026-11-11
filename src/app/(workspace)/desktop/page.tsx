import { DesktopPanel } from "@/components/desktop-panel";
import { PageHeader } from "@/components/common";
export default function DesktopPage() {
  return (
    <>
      <PageHeader
        eyebrow="GIỮ PHIÊN RIÊNG, ĐĂNG ĐÚNG TÀI KHOẢN"
        title="Máy đăng & Facebook"
        description="Kết nối máy tính, đăng nhập Facebook và điều khiển lịch tự động của bạn."
      />
      <DesktopPanel />
    </>
  );
}
