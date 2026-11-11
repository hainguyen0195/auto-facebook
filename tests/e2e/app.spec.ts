import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { localInput } from "../../src/lib/utils";
import sharp from "sharp";

const password = "E2E-only-Password-2026!";
test("login, authenticated routes, and a responsive layout", async ({
  browser,
  page,
}) => {
  const anonymous = await browser.newContext({
    baseURL: "http://localhost:3100",
    storageState: { cookies: [], origins: [] },
  });
  const login = await anonymous.newPage();
  await login.goto("/");
  await expect(login).toHaveURL(/\/login$/);
  await login
    .getByLabel("Email", { exact: true })
    .fill("e2e-owner@tests.nhipdang.local");
  await login.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await login.getByRole("button", { name: "Vào góc làm việc" }).click();
  await expect(
    login.getByRole("heading", { name: "Chào Minh, hôm nay thế nào?" }),
  ).toBeVisible();
  await anonymous.close();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Chào Minh, hôm nay thế nào?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Thêm tài khoản đầu tiên" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Đăng xuất", exact: true }).first(),
  ).toBeInViewport();
  await page.screenshot({
    path: ".data/screenshots/desktop-today.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Mở menu" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Mở menu" }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Hội nhóm", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Hội nhóm của bạn" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".data/screenshots/mobile-groups.png",
    fullPage: true,
  });
});

test("real account, group, image, schedule, clipboard fallback, and manual approval flow", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const account = `Shop thử ${suffix}`;
  const group = `Nhóm thử ${suffix}`;
  const title = `Sản phẩm mới ${suffix}`;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          Promise.reject(new DOMException("Denied", "NotAllowedError")),
      },
    });
  });
  await page.goto("/accounts");
  await page
    .getByRole("button", { name: "Thêm tài khoản", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên tài khoản", { exact: true }).fill(account);
  await dialog.getByLabel("Tên profile trình duyệt").fill("Chrome — Shop thử");
  await dialog
    .getByLabel("Link trang cá nhân")
    .fill(`https://facebook.com/shop.${suffix}`);
  await dialog
    .getByRole("button", { name: "Lưu tài khoản", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: account, exact: true }),
  ).toBeVisible();
  await page.goto("/groups");
  await page
    .getByRole("button", { name: "Thêm hội nhóm", exact: true })
    .first()
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên hội nhóm", { exact: true }).fill(group);
  await dialog
    .getByLabel("Link hội nhóm")
    .fill(`https://facebook.com/groups/shop.${suffix}`);
  await dialog.getByRole("checkbox", { name: new RegExp(account) }).check();
  await dialog
    .getByLabel("Nội quy và ghi chú")
    .fill("Ghi rõ giá, mỗi ngày một bài.");
  await dialog.getByRole("button", { name: "Lưu hội nhóm" }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto("/posts");
  await page.getByRole("button", { name: "Soạn bài mới", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên bài trong thư viện").fill(title);
  await dialog
    .getByLabel("Nội dung bài viết", { exact: true })
    .fill("Hàng mới của shop, giá 100.000đ. Bạn nhắn mình để được tư vấn nhé!");
  const image = await sharp({
    create: { width: 80, height: 80, channels: 3, background: "#147c70" },
  })
    .png()
    .toBuffer();
  await dialog.getByLabel("Thêm ảnh bài viết").setInputFiles({
    name: "san-pham.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(dialog.getByAltText("san-pham.png").first()).toBeVisible();
  await dialog.getByRole("button", { name: "Lưu vào thư viện" }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .locator("article")
    .filter({ hasText: title })
    .getByRole("button", { name: "Lên lịch", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  const mode = dialog.getByLabel("Cách thực hiện", { exact: true });
  await expect(mode).toHaveText("Tự đăng bằng máy đã kết nối");
  await mode.click();
  await expect(page.getByRole("option")).toHaveText([
    "Tự đăng bằng máy đã kết nối",
    "Nhắc tôi đăng thủ công",
  ]);
  await page
    .getByRole("option", { name: "Nhắc tôi đăng thủ công", exact: true })
    .click();
  await dialog.getByLabel("Tài khoản đăng", { exact: true }).click();
  await page
    .getByRole("option", {
      name: `${account} — Chrome — Shop thử`,
      exact: true,
    })
    .click();
  await dialog.getByRole("checkbox", { name: group, exact: true }).check();
  const [, nowTime] = localInput(new Date()).split("T");
  const [nowHour, nowMinute] = nowTime.split(":");
  await dialog.getByLabel("Thời gian bắt đầu (UTC+7)").click();
  await page.getByRole("button", { name: "Hôm nay", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Giờ", exact: true }).click();
  await page
    .getByRole("option", { name: `${nowHour} giờ`, exact: true })
    .click();
  await dialog.getByRole("combobox", { name: "Phút", exact: true }).click();
  await page
    .getByRole("option", { name: `${nowMinute} phút`, exact: true })
    .click();
  await dialog.getByRole("button", { name: "Kiểm tra lịch" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Kiểm tra lịch trước khi lưu" }),
  ).toBeVisible();
  const ack = dialog.getByRole("checkbox");
  if (await ack.count()) await ack.check();
  await dialog.getByRole("button", { name: "Lưu 1 công việc" }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto("/");
  const row = page.locator(".task-list-row").filter({ hasText: title });
  await row.getByRole("button", { name: "Xử lý", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Bắt đầu xử lý", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Bạn đã xử lý thế nào?" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Sao chép nội dung" }).click();
  await expect(dialog.getByLabel("Nội dung sao chép thủ công")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Mở Facebook", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Chờ duyệt nhóm", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Ghi nhận kết quả" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Cập nhật kết quả duyệt" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Đóng", exact: true })
    .last()
    .click();
  await page.goto("/history");
  await page.getByPlaceholder("Tìm bài viết, nhóm, tài khoản…").fill(title);
  await page.getByRole("button", { name: "Chi tiết", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Đã đăng", exact: true }).click();
  await dialog
    .getByLabel("Link bài viết (nếu có)")
    .fill(`https://facebook.com/groups/shop.${suffix}/posts/123`);
  await dialog.getByRole("button", { name: "Ghi nhận kết quả" }).click();
  await expect(
    dialog.getByText("Đã đăng", { exact: true }).first(),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Đóng", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("link", { name: "Xem bài", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất CSV cho Excel" }).click();
  expect((await download).suggestedFilename()).toBe("nhip-dang-lich-su.csv");
  await page.goto("/calendar");
  await expect(
    page.getByRole("heading", { name: "Lịch đăng & điều phối" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".data/screenshots/desktop-calendar.png",
    fullPage: true,
  });
});

test("CSV preview identifies invalid and duplicate rows before importing", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  await page.goto("/groups");
  await page
    .getByRole("button", { name: "Nhập Excel / CSV", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Chọn file Excel hoặc CSV hội nhóm").setInputFiles({
    name: "groups.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      `name,url,tags\nNhóm CSV,https://facebook.com/groups/csv.${suffix},CSV\nTrùng,https://m.facebook.com/groups/csv.${suffix}/,CSV\nSai,https://example.com/groups/no,CSV`,
      "utf8",
    ),
  });
  await expect(
    dialog.getByText("1 nhóm hợp lệ", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("1 nhóm trùng, bỏ qua")).toBeVisible();
  await expect(dialog.getByText("1 dòng cần sửa")).toBeVisible();
  await dialog.getByRole("button", { name: "Nhập 1 nhóm hợp lệ" }).click();
  await expect(dialog).toHaveCount(0);
});

test("a network error keeps the post draft and allows retry", async ({
  page,
}) => {
  const title = `Nháp mạng ${randomUUID().slice(0, 8)}`;
  await page.goto("/posts");
  await page.getByRole("button", { name: "Soạn bài mới", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên bài trong thư viện").fill(title);
  await dialog
    .getByLabel("Nội dung bài viết", { exact: true })
    .fill("Nội dung không bị mất khi mạng lỗi.");
  await page.route("**/api/v1/posts", (route) =>
    route.request().method() === "POST"
      ? route.abort("connectionfailed")
      : route.continue(),
  );
  await dialog.getByRole("button", { name: "Lưu vào thư viện" }).click();
  await expect(
    page
      .getByText("Mất kết nối. Nội dung bạn nhập vẫn được giữ, hãy thử lại.")
      .first(),
  ).toBeVisible();
  await expect(dialog.getByLabel("Tên bài trong thư viện")).toHaveValue(title);
  await page.unroute("**/api/v1/posts");
  await dialog.getByRole("button", { name: "Lưu vào thư viện" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
});

test("another user cannot fetch, update or download owner data", async ({
  page,
  browser,
}) => {
  const origin = "http://localhost:3100";
  const created = await page.request.post("/api/v1/accounts", {
    headers: { Origin: origin },
    data: {
      name: "Private owner account",
      url: "https://facebook.com/private.owner",
      profileName: "Private",
    },
  });
  expect(created.ok()).toBe(true);
  const account = await created.json();
  const other = await browser.newContext({
    baseURL: origin,
    storageState: ".data/e2e/other.json",
  });
  const list = await other.request.get("/api/v1/accounts");
  expect(await list.json()).toEqual([]);
  const update = await other.request.patch(`/api/v1/accounts/${account.id}`, {
    headers: { Origin: origin },
    data: {
      name: "Hacked",
      url: "https://facebook.com/hacked",
      profileName: "Hacked",
    },
  });
  expect(update.status()).toBe(404);
  const crossSite = await page.request.post("/api/v1/accounts", {
    headers: { Origin: "https://evil.test" },
    data: { name: "bad", url: "https://facebook.com/bad", profileName: "bad" },
  });
  expect(crossSite.status()).toBe(403);
  await other.close();
});

test("mobile composer preserves a failed image and retries the actual upload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/posts");
  await page.getByRole("button", { name: "Soạn bài mới", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const title = `Ảnh thử lại ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel("Tên bài trong thư viện").fill(title);
  await dialog
    .getByLabel("Nội dung bài viết", { exact: true })
    .fill("Ảnh và nội dung được giữ khi kết nối bị gián đoạn.");
  await page.route("**/api/v1/assets", (route) =>
    route.abort("connectionfailed"),
  );
  const image = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#157c70" },
  })
    .png()
    .toBuffer();
  const fileChooser = page.waitForEvent("filechooser");
  await dialog.getByText("Thêm hình ảnh cho bài viết", { exact: true }).click();
  await (
    await fileChooser
  ).setFiles({
    name: "retry.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(
    dialog.getByRole("button", { name: "Thử lại", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Tên bài trong thư viện")).toHaveValue(title);
  await page.unroute("**/api/v1/assets");
  await dialog.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(dialog.getByAltText("retry.png").first()).toBeVisible();
  const imageUrl = await dialog
    .getByAltText("retry.png")
    .first()
    .getAttribute("src");
  expect((await page.request.get(imageUrl!)).ok()).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await dialog.getByRole("button", { name: "Lưu vào thư viện" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
});

test("bulk cancellation changes tasks only after confirming", async ({
  page,
}) => {
  const origin = "http://localhost:3100";
  const title = `Lịch hủy ${randomUUID().slice(0, 8)}`;
  const accountResponse = await page.request.post("/api/v1/accounts", {
    headers: { Origin: origin },
    data: {
      name: title,
      url: `https://facebook.com/cancel.${randomUUID().slice(0, 8)}`,
      profileName: "Chrome hủy",
    },
  });
  expect(accountResponse.ok()).toBe(true);
  const account = await accountResponse.json();
  const postResponse = await page.request.post("/api/v1/posts", {
    headers: { Origin: origin },
    data: {
      title,
      content: "Kiểm tra xác nhận hủy lịch.",
      tags: [],
      assetIds: [],
    },
  });
  expect(postResponse.ok()).toBe(true);
  const post = await postResponse.json();
  const scheduleResponse = await page.request.post("/api/v1/schedules", {
    headers: { Origin: origin },
    data: {
      postId: post.id,
      scheduledAt: new Date().toISOString(),
      targets: [{ accountId: account.id, groupId: null }],
      idempotencyKey: randomUUID(),
      acknowledgeWarnings: true,
    },
  });
  expect(scheduleResponse.ok()).toBe(true);
  await page.goto("/calendar?view=list");
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/tasks" && url.searchParams.get("q") === title
    );
  });
  await page.getByPlaceholder("Tìm bài, tài khoản, hội nhóm…").fill(title);
  await filtered;
  const row = page.getByRole("row").filter({ hasText: title });
  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Hủy các lịch đã chọn" }).click();
  let dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Hủy 1 công việc đã chọn?" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Quay lại", exact: true }).click();
  await expect(row.getByText("Đã hủy", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Hủy các lịch đã chọn" }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Hủy 1 công việc", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByText("Đã hủy", { exact: true })).toBeVisible();
});

test("password change verifies the current password and permits a fresh login", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3100",
    storageState: ".data/e2e/other.json",
  });
  try {
    const page = await context.newPage();
    await page.goto("/settings");
    await page
      .getByRole("button", { name: "Đổi mật khẩu", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const next = `Changed-${randomUUID()}!`;
    await dialog
      .getByLabel("Mật khẩu hiện tại", { exact: true })
      .fill("incorrect-password");
    await dialog.getByLabel("Mật khẩu mới", { exact: true }).fill(next);
    await dialog.getByLabel("Nhập lại mật khẩu mới").fill(next);
    await dialog.getByRole("button", { name: "Lưu mật khẩu mới" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Hãy kiểm tra mật khẩu hiện tại",
    );
    await dialog
      .getByLabel("Mật khẩu hiện tại", { exact: true })
      .fill(password);
    await dialog.getByRole("button", { name: "Lưu mật khẩu mới" }).click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole("button", { name: "Đăng xuất", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login$/);
    await page
      .getByLabel("Email", { exact: true })
      .fill("e2e-other@tests.nhipdang.local");
    await page.getByLabel("Mật khẩu", { exact: true }).fill(next);
    await page.getByRole("button", { name: "Vào góc làm việc" }).click();
    await expect(page).toHaveURL("http://localhost:3100/");
  } finally {
    await context.close();
  }
});
