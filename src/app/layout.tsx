import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import "@fontsource/be-vietnam-pro/800.css";
import "./globals.css";
import "./inbox.css";

export const metadata: Metadata = {
  title: {
    default: "Nhịp Đăng — Góc làm việc bán hàng",
    template: "%s · Nhịp Đăng",
  },
  description:
    "Sắp xếp nội dung, tài khoản và lịch đăng Facebook của bạn trong một góc làm việc gọn gàng.",
  robots: { index: false, follow: false },
  applicationName: "Autotool",
  appleWebApp: { capable: true, title: "Autotool", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/app-192.png", sizes: "192x192", type: "image/png" }],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};
export const viewport: Viewport = { themeColor: "#087f75" };
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
