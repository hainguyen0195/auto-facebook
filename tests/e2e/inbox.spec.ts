import { expect, test } from "@playwright/test";

test("inbox previews, unread filter, failure retention and mobile navigation", async ({
  page,
}) => {
  let failed = false;
  await page.route("**/api/v1/inbox*", (route) => {
    if (failed)
      return route.fulfill({
        status: 503,
        json: { error: "Bộ theo dõi tạm mất kết nối" },
      });
    const at = new Date().toISOString();
    return route.fulfill({
      json: {
        configured: true,
        account: { id: "account", name: "Minh Phan", color: "teal" },
        source: { id: "pc", name: "Company Windows", online: true },
        status: "ONLINE",
        checkedAt: at,
        lastSuccessAt: at,
        fresh: true,
        partial: true,
        conversations: [
          {
            id: "one",
            name: "Khách Lan",
            preview: "Cho mình hỏi giá sản phẩm",
            unread: true,
            lastMessageAt: at,
            observedAt: at,
          },
          {
            id: "two",
            name: "Khách Nam",
            preview: "Cảm ơn bạn",
            unread: null,
            observedAt: at,
          },
        ],
      },
    });
  });
  await page.goto("/inbox");
  await page.getByRole("button", { name: "Xem tin nhắn Minh Phan" }).click();
  await expect(
    page.getByRole("heading", { name: "Tin nhắn", exact: true }),
  ).toBeVisible();
  const list = page.getByRole("region", { name: "Danh sách hội thoại" });
  await list.getByRole("button", { name: /Khách Lan/ }).click();
  await expect(
    page.getByRole("region", { name: "Đoạn tin xem trước" }),
  ).toContainText("Cho mình hỏi giá sản phẩm");
  await expect(
    page.getByRole("link", { name: "Tin nhắn, 1 hội thoại có dấu chưa đọc" }),
  ).toBeVisible();
  await page.getByLabel("Lọc trạng thái đọc").click();
  await page
    .getByRole("option", { name: "Có dấu chưa đọc", exact: true })
    .click();
  await expect(list.getByRole("button")).toHaveCount(1);
  failed = true;
  await page.getByRole("button", { name: "Cập nhật", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Chưa tải được dữ liệu" }),
  ).toContainText("Bộ theo dõi tạm mất kết nối");
  await expect(list).toContainText("Khách Lan");
  await page.screenshot({
    path: ".data/screenshots/inbox-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: ".data/screenshots/inbox-mobile.png",
    fullPage: true,
  });
});

test("selects accounts without mixing previews and displays the active source machine", async ({
  page,
}) => {
  await page.route("**/api/v1/inbox*", (route) => {
    const second =
      new URL(route.request().url()).searchParams.get("accountId") === "second";
    const at = new Date().toISOString();
    return route.fulfill({
      json: {
        configured: true,
        account: {
          id: second ? "second" : "first",
          name: second ? "Second account" : "Minh Phan",
          color: "teal",
        },
        accounts: [
          {
            id: "first",
            name: "Minh Phan",
            color: "teal",
            status: "ONLINE",
            fresh: true,
            unreadCount: 1,
          },
          {
            id: "second",
            name: "Second account",
            color: "teal",
            status: "OFFLINE",
            fresh: false,
            unreadCount: 0,
          },
        ],
        source: {
          id: second ? "mac" : "pc",
          name: second ? "Home MacBook" : "Company Windows",
          online: !second,
        },
        status: second ? "OFFLINE" : "ONLINE",
        fresh: !second,
        partial: true,
        checkedAt: at,
        lastSuccessAt: at,
        conversations: [
          {
            id: "same-thread",
            name: second ? "Customer B" : "Customer A",
            preview: second ? "Mac preview" : "Windows preview",
            unread: true,
            lastMessageAt: at,
            observedAt: at,
          },
        ],
      },
    });
  });
  await page.goto("/inbox");
  await page.getByRole("button", { name: "Xem tin nhắn Minh Phan" }).click();
  await expect(
    page.getByText("Company Windows", { exact: true }),
  ).toBeVisible();
  const list = page.getByRole("region", { name: "Danh sách hội thoại" });
  await list.getByRole("button", { name: /Customer A/ }).click();
  const preview = page.getByRole("region", { name: "Đoạn tin xem trước" });
  await expect(preview).toContainText("Windows preview");
  await page.getByLabel("Tài khoản xem tin nhắn").click();
  await page
    .getByRole("option", { name: "Second account", exact: true })
    .click();
  await expect(page.getByText("Home MacBook", { exact: true })).toBeVisible();
  await expect(list).toContainText("Customer B");
  await expect(preview).not.toContainText("Windows preview");
  await expect(
    page.getByRole("heading", { name: "Tạm ngừng cập nhật" }),
  ).toBeVisible();
  await list.getByRole("button", { name: /Customer B/ }).click();
  await expect(preview).toContainText("Mac preview");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await expect(page.getByLabel("Tài khoản xem tin nhắn")).toBeVisible();
  await page.screenshot({
    path: ".data/screenshots/inbox-accounts-mobile.png",
    fullPage: true,
  });
});
