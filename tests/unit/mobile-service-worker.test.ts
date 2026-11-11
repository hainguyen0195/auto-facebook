import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const badge = vi.fn(),
    clearBadge = vi.fn(),
    show = vi.fn(),
    open = vi.fn();
  const client = {
    url: "https://autotool.pmcoding.com/posts",
    navigate: vi.fn(),
    focus: vi.fn(),
    postMessage: vi.fn(),
  };
  const close = vi.fn();
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), {
    URL,
    self: {
      addEventListener: (type: string, handler: (typeof handlers)[string]) => {
        handlers[type] = handler;
      },
      skipWaiting: vi.fn(),
      navigator: { setAppBadge: badge, clearAppBadge: clearBadge },
      location: { origin: "https://autotool.pmcoding.com" },
      registration: {
        showNotification: show,
        getNotifications: async () => [{ close }],
      },
      clients: {
        matchAll: async () => [client],
        openWindow: open,
        claim: vi.fn(),
      },
    },
  });
  async function event(type: string, data: Record<string, unknown>) {
    let pending: Promise<unknown> | undefined;
    handlers[type]({
      ...data,
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise;
      },
    });
    await pending;
  }
  return { badge, clearBadge, show, open, client, close, event };
}

it("updates an app badge and shows a single grouped notification without trusting a remote URL", async () => {
  const w = worker();
  await w.event("push", {
    data: {
      json: () => ({
        count: 3,
        hasNew: true,
        title: "Tin mới",
        body: "Nhi Vy: 3",
        url: "https://evil.test",
      }),
    },
  });
  expect(w.badge).toHaveBeenCalledWith(3);
  expect(w.show).toHaveBeenCalledWith(
    "Tin mới",
    expect.objectContaining({
      tag: "nhipdang-inbox",
      renotify: true,
      silent: false,
      data: { url: "/inbox" },
    }),
  );
  expect(w.client.postMessage).toHaveBeenCalledWith({ type: "INBOX_UPDATED" });
  await w.event("push", {
    data: { json: () => ({ count: 0, hasNew: false }) },
  });
  expect(w.clearBadge).toHaveBeenCalled();
  expect(w.show).toHaveBeenLastCalledWith(
    "Tin nhắn Facebook",
    expect.objectContaining({ silent: true, renotify: false }),
  );
});

it("opens the correct account overview and clears local notifications on logout", async () => {
  const w = worker(),
    close = vi.fn();
  await w.event("notificationclick", { notification: { close } });
  expect(close).toHaveBeenCalled();
  expect(w.client.navigate).toHaveBeenCalledWith(
    "https://autotool.pmcoding.com/inbox",
  );
  expect(w.client.focus).toHaveBeenCalled();
  await w.event("message", { data: { type: "CLEAR_INBOX" } });
  expect(w.clearBadge).toHaveBeenCalled();
  expect(w.close).toHaveBeenCalled();
});
