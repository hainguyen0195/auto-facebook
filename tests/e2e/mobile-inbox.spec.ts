import { expect, test } from "@playwright/test";
import * as webPush from "web-push";

const iphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
test.use({ userAgent: iphone, viewport: { width: 390, height: 844 } });
const publicKey = webPush.generateVAPIDKeys().publicKey;
const snapshot = () => ({
  configured: true,
  account: { id: "nhi", name: "Nhi Vy", color: "teal" },
  accounts: [
    {
      id: "nhi",
      name: "Nhi Vy",
      color: "teal",
      status: "ONLINE",
      fresh: true,
      unreadCount: 2,
      lastKnownUnreadCount: 2,
      lastSuccessAt: new Date().toISOString(),
    },
    {
      id: "minh",
      name: "Minh Phan",
      color: "teal",
      status: "OFFLINE",
      fresh: false,
      unreadCount: 0,
      lastKnownUnreadCount: 1,
      lastSuccessAt: new Date().toISOString(),
    },
  ],
  status: "ONLINE",
  fresh: true,
  partial: true,
  checkedAt: new Date().toISOString(),
  lastSuccessAt: new Date().toISOString(),
  conversations: [
    {
      id: "thread",
      name: "Khách Lan",
      preview: "Xin giá",
      unread: true,
      observedAt: new Date().toISOString(),
    },
  ],
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/inbox*", (route) =>
    route.fulfill({ json: snapshot() }),
  );
  await page.route("**/api/v1/push/config", (route) =>
    route.fulfill({ json: { configured: true, publicKey } }),
  );
});

test("provides install metadata, real icons and a compact iPhone account overview", async ({
  page,
  request,
}) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    start_url: "/inbox",
    display: "standalone",
    short_name: "Autotool",
  });
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.ok()).toBe(true);
    expect(image.headers()["content-type"]).toContain("image/png");
  }
  const sw = await request.get("/sw.js");
  expect(sw.headers()["cache-control"]).toContain("no-store");
  await page.goto("/inbox");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/icons/apple-touch-icon.png",
  );
  await expect(
    page.getByRole("button", { name: "Bật thông báo", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Thông báo trên điện thoại" }),
  ).toContainText("Thêm vào Màn hình chính");
  const overview = page.getByRole("region", {
    name: "Tổng quan tin nhắn các tài khoản",
  });
  await expect(overview.locator(".inbox-overview-number")).toHaveText("3");
  const nhi = page.getByRole("button", { name: "Xem tin nhắn Nhi Vy" });
  await expect(nhi).toContainText("2");
  await expect(
    page.getByRole("button", { name: "Xem tin nhắn Minh Phan" }),
  ).toContainText("Tạm ngừng cập nhật");
  await expect(
    page.getByRole("region", { name: "Danh sách hội thoại" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".data/screenshots/mobile-inbox-overview.png",
    fullPage: true,
  });
  await nhi.click();
  await expect(
    page.getByRole("region", { name: "Danh sách hội thoại" }),
  ).toContainText("Khách Lan");
  await page.getByRole("button", { name: "Thu gọn chi tiết" }).click();
  await expect(
    page.getByRole("region", { name: "Danh sách hội thoại" }),
  ).toHaveCount(0);
});

test("requires a user gesture for permission, subscribes, sends a test and disables this phone", async ({
  page,
}) => {
  let enabled = false,
    testCalls = 0;
  await page.addInitScript(
    ({ publicKey }) => {
      Object.defineProperty(navigator, "standalone", { value: true });
      const raw = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/") + "=");
      const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const state = { permissionCalls: 0, badge: -1, subscribed: false };
      Object.assign(window, { mobileTest: state });
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: {
          permission: "default",
          requestPermission: async () => {
            state.permissionCalls++;
            Object.defineProperty(Notification, "permission", {
              value: "granted",
              configurable: true,
            });
            return "granted";
          },
        },
      });
      Object.defineProperty(window, "PushManager", {
        configurable: true,
        value: class {},
      });
      const sub = {
        endpoint: "https://web.push.apple.com/e2e-test",
        options: { applicationServerKey: bytes.buffer },
        toJSON: () => ({
          endpoint: "https://web.push.apple.com/e2e-test",
          keys: { p256dh: publicKey, auth: "test" },
        }),
        unsubscribe: async () => {
          state.subscribed = false;
          return true;
        },
      };
      const worker = {
        pushManager: {
          getSubscription: async () => (state.subscribed ? sub : null),
          subscribe: async () => {
            state.subscribed = true;
            return sub;
          },
        },
        active: { postMessage: () => {} },
      };
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
          register: async () => worker,
          ready: Promise.resolve(worker),
          getRegistration: async () => worker,
          addEventListener: () => {},
          removeEventListener: () => {},
        },
      });
      Object.defineProperty(navigator, "setAppBadge", {
        value: async (count: number) => {
          state.badge = count;
        },
      });
      Object.defineProperty(navigator, "clearAppBadge", {
        value: async () => {
          state.badge = 0;
        },
      });
    },
    { publicKey },
  );
  await page.route("**/api/v1/push/*", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/").pop();
    if (path === "config")
      return route.fulfill({ json: { configured: true, publicKey } });
    if (path === "subscribe") enabled = true;
    if (path === "unsubscribe") enabled = false;
    if (path === "test") testCalls++;
    return route.fulfill({ json: { enabled, queued: path === "test" } });
  });
  await page.goto("/inbox");
  await expect(
    page.getByRole("button", { name: "Bật thông báo", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { mobileTest: { permissionCalls: number } })
          .mobileTest.permissionCalls,
    ),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Bật thông báo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Đã bật thông báo trên thiết bị này" }),
  ).toBeVisible();
  expect(enabled).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { mobileTest: { badge: number } }).mobileTest
            .badge,
      ),
    )
    .toBe(3);
  await page
    .getByRole("button", { name: "Thử thông báo", exact: true })
    .click();
  await expect.poll(() => testCalls).toBe(1);
  await page.screenshot({
    path: ".data/screenshots/mobile-inbox-installed.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Tắt", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Bật thông báo", exact: true }),
  ).toBeVisible();
  expect(enabled).toBe(false);
});
