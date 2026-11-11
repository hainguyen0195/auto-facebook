/* No page or API caching: account data always comes from the signed-in server. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

async function badge(count) {
  try {
    if (count > 0 && self.navigator.setAppBadge)
      await self.navigator.setAppBadge(count);
    else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch {
    /* Badging is optional on browsers without home-screen badges. */
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data = {};
      try {
        data = event.data?.json() || {};
      } catch {
        /* Display a safe fallback. */
      }
      const count =
        Number.isSafeInteger(data.count) && data.count >= 0 ? data.count : 0;
      const title =
        typeof data.title === "string"
          ? data.title.slice(0, 150)
          : "Tin nhắn Facebook";
      const body =
        typeof data.body === "string"
          ? data.body.slice(0, 1000)
          : "Mở Autotool để xem tài khoản có tin nhắn.";
      await badge(count);
      await self.registration.showNotification(title, {
        body,
        icon: "/icons/app-192.png",
        badge: "/icons/notification-badge.png",
        tag: "nhipdang-inbox",
        renotify: data.hasNew === true,
        silent: data.hasNew !== true,
        data: { url: "/inbox" },
      });
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      windows.forEach((client) =>
        client.postMessage({ type: "INBOX_UPDATED" }),
      );
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const target = new URL("/inbox", self.location.origin).href;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.navigate(target);
        await client.focus();
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CLEAR_INBOX") return;
  event.waitUntil(
    (async () => {
      await badge(0);
      const notifications = await self.registration.getNotifications({
        tag: "nhipdang-inbox",
      });
      notifications.forEach((notification) => notification.close());
    })(),
  );
});
