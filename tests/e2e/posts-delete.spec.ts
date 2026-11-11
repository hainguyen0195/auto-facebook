import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const origin = "http://localhost:3100";
async function createPost(page: Page, title: string) {
  const response = await page.request.post("/api/v1/posts", {
    headers: { Origin: origin },
    data: { title, content: `Nội dung ${title}`, tags: [], assetIds: [] },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

test("deleting from the library requires confirmation, supports retry and preserves scheduled work", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const title = `Bài xóa ${suffix}`;
  const post = await createPost(page, title);
  const accountResponse = await page.request.post("/api/v1/accounts", {
    headers: { Origin: origin },
    data: {
      name: title,
      url: `https://facebook.com/delete.${suffix}`,
      profileName: "Chrome thử xóa",
    },
  });
  expect(accountResponse.ok()).toBe(true);
  const account = await accountResponse.json();
  const scheduleResponse = await page.request.post("/api/v1/schedules", {
    headers: { Origin: origin },
    data: {
      postId: post.id,
      scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
      targets: [{ accountId: account.id, groupId: null }],
      idempotencyKey: randomUUID(),
      acknowledgeWarnings: true,
    },
  });
  expect(scheduleResponse.ok()).toBe(true);
  await page.goto("/posts");
  await page.getByPlaceholder("Tìm tiêu đề, nội dung, nhãn…").fill(title);
  const card = page.getByRole("article").filter({ hasText: title });
  await card
    .getByRole("button", { name: `Xóa bài ${title}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("1 công việc");
  await expect(dialog).toContainText("Để dừng đăng, hãy hủy lịch");
  await dialog.getByRole("button", { name: "Quay lại", exact: true }).click();
  await expect(card).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await card
    .getByRole("button", { name: `Xóa bài ${title}`, exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Xóa khỏi thư viện", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".data/screenshots/mobile-post-delete.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.route(`**/api/v1/posts/${post.id}`, (route) =>
    route.abort("connectionfailed"),
  );
  await dialog
    .getByRole("button", { name: "Xóa khỏi thư viện", exact: true })
    .click();
  await expect(
    page
      .getByText("Mất kết nối. Nội dung bạn nhập vẫn được giữ, hãy thử lại.")
      .first(),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  await page.unroute(`**/api/v1/posts/${post.id}`);

  let finishDelete!: () => void;
  const release = new Promise<void>((resolve) => {
    finishDelete = resolve;
  });
  let deleteRequests = 0;
  await page.route(`**/api/v1/posts/${post.id}`, async (route) => {
    deleteRequests++;
    await release;
    await route.continue();
  });
  const confirm = dialog.getByRole("button", {
    name: "Xóa khỏi thư viện",
    exact: true,
  });
  await confirm.click();
  try {
    await expect(confirm).toBeDisabled();
    await expect(confirm).toHaveAttribute("aria-busy", "true");
  } finally {
    finishDelete();
  }
  await expect(dialog).toHaveCount(0);
  await expect(card).toHaveCount(0);
  expect(deleteRequests).toBe(1);
  await page.reload();
  await page.getByPlaceholder("Tìm tiêu đề, nội dung, nhãn…").fill(title);
  await expect(
    page.getByText("Chưa tìm thấy bài phù hợp", { exact: true }),
  ).toBeVisible();
  const tasksResponse = await page.request.get(
    `/api/v1/tasks?q=${encodeURIComponent(title)}`,
  );
  expect(tasksResponse.ok()).toBe(true);
  const tasks = await tasksResponse.json();
  expect(tasks.total).toBe(1);
  expect(tasks.items[0]).toMatchObject({
    titleSnapshot: title,
    contentSnapshot: post.content,
    status: "SCHEDULED",
  });
});

test("deleting the last post on a page returns to a populated page", async ({
  page,
}) => {
  const title = `Trang xóa ${randomUUID().slice(0, 8)}`;
  for (let i = 0; i < 10; i++) await createPost(page, `${title} ${i}`);
  await page.goto("/posts");
  await page.getByPlaceholder("Tìm tiêu đề, nội dung, nhãn…").fill(title);
  await expect(page.getByRole("article")).toHaveCount(9);
  await page.getByRole("button", { name: "Trang sau", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: /^Xóa bài / }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".notice")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Xóa khỏi thư viện", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(9);
  await expect(page.getByText("Trang 1/1", { exact: true })).toBeVisible();
  await page.screenshot({
    path: ".data/screenshots/desktop-post-delete.png",
    fullPage: true,
  });
});
