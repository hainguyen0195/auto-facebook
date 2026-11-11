import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const origin = "http://localhost:3100";
async function request(
  page: Page,
  method: "post" | "patch",
  resource: string,
  data: unknown,
) {
  const response = await page.request[method](`/api/v1/${resource}`, {
    headers: { Origin: origin },
    data,
  });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function createTask(
  page: Page,
  title: string,
  state: "READY" | "PUBLISHED" | "SKIPPED",
) {
  const account = await request(page, "post", "accounts", {
    name: title,
    url: `https://facebook.com/remove.${randomUUID().slice(0, 8)}`,
    profileName: "Chrome thử xóa lịch",
  });
  const post = await request(page, "post", "posts", {
    title,
    content: "Nội dung giữ trong thư viện",
    tags: [],
    assetIds: [],
  });
  await request(page, "post", "schedules", {
    postId: post.id,
    scheduledAt: new Date(Date.now() - 1000).toISOString(),
    targets: [{ accountId: account.id, groupId: null }],
    idempotencyKey: randomUUID(),
    acknowledgeWarnings: true,
  });
  const response = await page.request.get(
    `/api/v1/tasks?q=${encodeURIComponent(title)}`,
  );
  let task = (await response.json()).items[0];
  if (state !== "READY") {
    task = await request(page, "patch", `tasks/${task.id}`, {
      action: "start",
      version: task.version,
      operationId: randomUUID(),
    });
    task = await request(page, "patch", `tasks/${task.id}`, {
      action: "record",
      status: state,
      version: task.version,
      operationId: randomUUID(),
      ...(state === "PUBLISHED"
        ? { resultUrl: "https://facebook.com/example/posts/123" }
        : {}),
    });
  }
  return task;
}

test("a published row can be removed with confirmation and retry while keeping its history", async ({
  page,
}) => {
  const title = `Xóa lịch đã đăng ${randomUUID().slice(0, 8)}`;
  await createTask(page, title, "PUBLISHED");
  const before = await (await page.request.get("/api/v1/dashboard")).json();
  await page.goto(`/calendar?view=list&q=${encodeURIComponent(title)}`);
  const row = page.getByRole("row").filter({ hasText: title });
  const removeButton = row.getByRole("button", { name: /^Xóa lịch / });
  await expect(row.getByRole("checkbox")).toBeEnabled();
  await removeButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("không xóa bài trên Facebook");
  await dialog.getByRole("button", { name: "Quay lại", exact: true }).click();
  await expect(row).toBeVisible();
  await removeButton.click();
  await page.route("**/api/v1/tasks/bulk-archive", (route) =>
    route.abort("connectionfailed"),
  );
  await dialog
    .getByRole("button", { name: "Xóa khỏi lịch", exact: true })
    .click();
  await expect(
    page
      .getByText("Mất kết nối. Nội dung bạn nhập vẫn được giữ, hãy thử lại.")
      .first(),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  await page.unroute("**/api/v1/tasks/bulk-archive");
  await dialog
    .getByRole("button", { name: "Xóa khỏi lịch", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(row).toHaveCount(0);
  await page.goto("/");
  const publishedStat = page
    .locator(".stat-card")
    .filter({ has: page.getByText("Đã đăng hôm nay", { exact: true }) });
  await expect(publishedStat.locator(".stat-number strong")).toHaveText(
    String(before.published - 1),
  );
  await expect(page.locator(".progress-label strong")).toHaveText(
    before.progress.total > 1
      ? `Đã xử lý ${before.progress.handled - 1}/${before.progress.total - 1} lượt đăng`
      : "Chưa có lịch hôm nay",
  );
  await page.goto("/history");
  await page.getByPlaceholder("Tìm bài viết, nhóm, tài khoản…").fill(title);
  const historyRow = page.getByRole("row").filter({ hasText: title });
  await expect(historyRow).toContainText("Đã xóa khỏi lịch");
  await expect(historyRow.getByText("Đã đăng", { exact: true })).toBeVisible();
  await expect(
    historyRow.getByRole("link", { name: "Xem bài", exact: true }),
  ).toBeVisible();
  const posts = await (
    await page.request.get(`/api/v1/posts?q=${encodeURIComponent(title)}`)
  ).json();
  expect(posts.total).toBe(1);
});

test("bulk removal supports ready, published and skipped rows, including on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const title = `Xóa nhiều lịch ${randomUUID().slice(0, 8)}`;
  const ready = await createTask(page, `${title} chờ`, "READY");
  await createTask(page, `${title} đã đăng`, "PUBLISHED");
  await createTask(page, `${title} bỏ qua`, "SKIPPED");
  await page.goto(`/calendar?view=list&q=${encodeURIComponent(title)}`);
  await expect(page.getByRole("button", { name: /^Xóa lịch / })).toHaveCount(3);
  await page
    .getByRole("checkbox", {
      name: "Chọn tất cả lịch có thể xóa ở trang này",
      exact: true,
    })
    .check();
  await expect(
    page.getByRole("button", { name: "Hủy các lịch đã chọn", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Xóa khỏi lịch đã chọn", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Xóa 3 lịch đã chọn?", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".data/screenshots/mobile-calendar-delete.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Xóa 3 lịch", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Xóa lịch / })).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "Chưa có lịch trong khoảng này",
      exact: true,
    }),
  ).toBeVisible();
  const task = await (
    await page.request.get(`/api/v1/tasks/${ready.id}`)
  ).json();
  expect(task.status).toBe("CANCELLED");
  expect(task.archivedAt).toBeTruthy();
});
