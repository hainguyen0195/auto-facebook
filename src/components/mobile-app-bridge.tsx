"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { registerMobileWorker, setInboxBadge } from "@/lib/mobile-app-client";

export function MobileAppBridge({ unread }: { unread: number | null }) {
  const client = useQueryClient();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void registerMobileWorker().catch(() => {});
    const update = (event: MessageEvent) => {
      if (event.data?.type === "INBOX_UPDATED")
        void client.invalidateQueries({
          predicate: (query) => String(query.queryKey[0]).startsWith("inbox"),
        });
    };
    navigator.serviceWorker.addEventListener("message", update);
    return () => navigator.serviceWorker.removeEventListener("message", update);
  }, [client]);
  useEffect(() => {
    if (unread === null || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    const update = async () => {
      try {
        const worker = await navigator.serviceWorker.getRegistration("/");
        const subscription = await worker?.pushManager?.getSubscription();
        if (!cancelled) await setInboxBadge(subscription ? unread : 0);
      } catch {
        /* The account overview remains usable without push support. */
      }
    };
    void update();
    window.addEventListener("mobile-push-changed", update);
    return () => {
      cancelled = true;
      window.removeEventListener("mobile-push-changed", update);
    };
  }, [unread]);
  return null;
}
