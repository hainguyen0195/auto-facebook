import { api } from "./client";

let registration: Promise<ServiceWorkerRegistration> | undefined;
export function registerMobileWorker() {
  if (!registration)
    registration = navigator.serviceWorker
      .register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      })
      .then(async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            navigator.serviceWorker.ready,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error("Chưa khởi động được thông báo. Hãy thử lại."),
                  ),
                10_000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      })
      .catch((error) => {
        registration = undefined;
        throw error;
      });
  return registration;
}

export function standaloneMode() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export async function setInboxBadge(count: number) {
  if (
    !standaloneMode() ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  )
    return;
  const nav = navigator as Navigator & {
    setAppBadge?: (count: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) await nav.setAppBadge?.(count);
    else await nav.clearAppBadge?.();
  } catch {
    /* Unsupported badge APIs must not interrupt the inbox. */
  }
}

export function applicationKey(value: string) {
  const raw = atob(
    value.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (value.length % 4)) % 4),
  );
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function disconnectMobilePush() {
  if (!("serviceWorker" in navigator)) return;
  const worker = await navigator.serviceWorker.getRegistration("/");
  const subscription = await worker?.pushManager?.getSubscription();
  if (subscription) {
    await api("push/unsubscribe", "POST", { endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  }
  if (subscription) {
    worker?.active?.postMessage({ type: "CLEAR_INBOX" });
    await setInboxBadge(0);
  }
}
