"use client";

import { useEffect, useState } from "react";
import { Bell, BellRing, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client";
import {
  applicationKey,
  disconnectMobilePush,
  registerMobileWorker,
  standaloneMode,
} from "@/lib/mobile-app-client";
import { Button } from "./ui/button";

export function MobileNotifications() {
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [config, setConfig] = useState<{
    configured: boolean;
    publicKey: string;
  } | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const isIos =
      /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = standaloneMode();
    const canPush =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setIos(isIos);
    setInstalled(standalone);
    setSupported(canPush);
    if (canPush) setPermission(Notification.permission);
    async function load() {
      try {
        const settings = await api<{ configured: boolean; publicKey: string }>(
          "push/config",
        );
        if (!alive) return;
        setConfig(settings);
        if (canPush && (!isIos || standalone)) {
          const worker = await registerMobileWorker();
          const sub = await worker.pushManager.getSubscription();
          if (
            sub &&
            Notification.permission === "granted" &&
            settings.configured
          ) {
            const key = sub.options.applicationServerKey;
            const matches =
              key &&
              btoa(String.fromCharCode(...new Uint8Array(key)))
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=+$/, "") === settings.publicKey;
            if (matches) {
              const status = await api<{ enabled: boolean }>(
                "push/status",
                "POST",
                { endpoint: sub.endpoint },
              );
              // An existing phone subscription is rebound only after the user explicitly enables it.
              if (alive) setEnabled(status.enabled);
            }
          }
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, []);

  async function enable() {
    setError("");
    setBusy(true);
    try {
      // iOS requires this permission request to start directly from the button gesture.
      const allowed = await Notification.requestPermission();
      setPermission(allowed);
      if (allowed !== "granted")
        throw new Error(
          "Chưa được cấp quyền. Mở Cài đặt iPhone → Thông báo → Autotool để kiểm tra.",
        );
      const worker = await registerMobileWorker();
      let sub = await worker.pushManager.getSubscription();
      const expected = applicationKey(config!.publicKey);
      if (sub) {
        const current = sub.options.applicationServerKey;
        if (
          !current ||
          !new Uint8Array(current).every((value, i) => value === expected[i]) ||
          current.byteLength !== expected.length
        ) {
          await sub.unsubscribe();
          sub = null;
        }
      }
      sub ||= await worker.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: expected,
      });
      await api("push/subscribe", "POST", sub.toJSON());
      setEnabled(true);
      window.dispatchEvent(new Event("mobile-push-changed"));
      toast.success("Đã bật thông báo trên thiết bị này.");
    } catch (e) {
      setError((e as Error).message || "Chưa bật được thông báo. Hãy thử lại.");
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    setError("");
    try {
      await disconnectMobilePush();
      setEnabled(false);
      window.dispatchEvent(new Event("mobile-push-changed"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setError("");
    try {
      const worker = await registerMobileWorker();
      const sub = await worker.pushManager.getSubscription();
      if (!sub) throw new Error("Hãy bật lại thông báo trên thiết bị này.");
      await api("push/test", "POST", { endpoint: sub.endpoint });
      toast.success("Đã gửi yêu cầu thử. Thông báo sẽ đến sau vài giây.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const needsInstall = ios && !installed;
  return (
    <section
      className="panel mobile-notifications"
      aria-label="Thông báo trên điện thoại"
    >
      <div className="mobile-notifications-main">
        <span className="mobile-notifications-icon">
          {enabled ? <BellRing size={22} /> : <Smartphone size={22} />}
        </span>
        <div className="mobile-notifications-copy">
          <h2>
            {enabled
              ? "Đã bật thông báo trên thiết bị này"
              : "Tin nhắn ngay trên màn hình điện thoại"}
          </h2>
          <p>
            {needsInstall
              ? "Thêm Autotool vào Màn hình chính, rồi mở từ icon để bật thông báo."
              : enabled
                ? "Có tin mới: báo tên nick và cập nhật số chưa đọc trên icon khi iPhone hỗ trợ."
                : "Bật một lần để biết nick nào có tin mới, kể cả khi bạn đóng ứng dụng."}
          </p>
        </div>
        {!loading &&
          !needsInstall &&
          supported &&
          config?.configured &&
          permission !== "denied" &&
          (enabled ? (
            <div className="mobile-notification-actions">
              <Button variant="outline" size="sm" loading={busy} onClick={test}>
                Thử thông báo
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={disable}
              >
                Tắt
              </Button>
            </div>
          ) : (
            <Button size="sm" loading={busy} onClick={enable}>
              <Bell size={15} />
              Bật thông báo
            </Button>
          ))}
      </div>
      <details
        className="mobile-install-guide"
        open={needsInstall || undefined}
      >
        <summary>Cài icon Autotool và nhận thông báo</summary>
        <ol>
          <li>
            Mở <strong>autotool.pmcoding.com/inbox</strong> bằng Safari trên
            iPhone.
          </li>
          <li>
            Bấm <strong>Chia sẻ → Thêm vào Màn hình chính → Thêm</strong>.
          </li>
          <li>
            Mở icon <strong>Autotool</strong>, đăng nhập ứng dụng và bấm{" "}
            <strong>Bật thông báo → Cho phép</strong>.
          </li>
        </ol>
        <p>
          Cần iOS 16.4 trở lên. Nếu đã có icon cũ nhưng không có hình, hãy thêm
          lại từ Safari.
        </p>
        <p>
          Số trên icon là hội thoại chưa đọc đã ghi nhận. Máy đang giữ phiên
          Facebook cần hoạt động để cập nhật tin mới.
        </p>
      </details>
      {!loading && !needsInstall && !supported && (
        <p className="mobile-notification-hint">
          Trình duyệt này chưa hỗ trợ thông báo. Trên iPhone, mở Autotool từ Màn
          hình chính và dùng iOS 16.4 trở lên.
        </p>
      )}
      {!loading && !needsInstall && permission === "denied" && (
        <p className="mobile-notification-hint">
          Thông báo đang bị chặn. Mở Cài đặt → Thông báo → Autotool để cho phép,
          sau đó mở lại ứng dụng.
        </p>
      )}
      {!loading && config && !config.configured && (
        <p className="mobile-notification-hint">
          Máy chủ chưa cấu hình gửi thông báo điện thoại.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
