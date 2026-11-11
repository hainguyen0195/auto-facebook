import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Autotool · Nhịp Đăng",
    short_name: "Autotool",
    description: "Biết tài khoản Facebook nào có tin nhắn chưa đọc.",
    lang: "vi",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    background_color: "#f8f7f3",
    theme_color: "#087f75",
    icons: [
      {
        src: "/icons/app-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/app-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/app-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
