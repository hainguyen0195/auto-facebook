import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("selects another account's groups while keeping the poster and confirming access", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  async function create<T>(route: string, data: unknown): Promise<T> {
    const response = await page.request.post(`/api/v1/${route}`, {
      headers: { Origin: "http://localhost:3100" },
      data,
    });
    expect(response.ok()).toBe(true);
    return response.json();
  }
  const source = await create<{ id: string; name: string }>("accounts", {
    name: `Nguồn hạn chế ${suffix}`,
    profileName: "Chrome nguồn",
    url: `https://facebook.com/source.${suffix}`,
    status: "RESTRICTED",
    quietStart: 0,
    quietEnd: 0,
  });
  const poster = await create<{ id: string; name: string }>("accounts", {
    name: `Đăng thay ${suffix}`,
    profileName: "Chrome đăng",
    url: `https://facebook.com/poster.${suffix}`,
    quietStart: 0,
    quietEnd: 0,
  });
  const chosen = await create<{ id: string; name: string }>("groups", {
    name: `Nhóm nhận bài ${suffix}`,
    url: `https://facebook.com/groups/chosen.${suffix}`,
    accountIds: [source.id],
  });
  const unchosen = await create<{ id: string; name: string }>("groups", {
    name: `Nhóm không nhận bài ${suffix}`,
    url: `https://facebook.com/groups/unchosen.${suffix}`,
    accountIds: [source.id],
  });
  const post = await create<{ id: string; title: string }>("posts", {
    title: `Bài chuyển nguồn ${suffix}`,
    content: `Nội dung riêng ${suffix}`,
    tags: [],
    assetIds: [],
  });
  await page.goto("/posts");
  await page
    .locator("article")
    .filter({ hasText: post.title })
    .getByRole("button", { name: "Lên lịch", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Cách thực hiện", { exact: true }).click();
  await page
    .getByRole("option", { name: "Nhắc tôi đăng thủ công", exact: true })
    .click();
  await dialog.getByLabel("Tài khoản đăng", { exact: true }).click();
  await expect(
    page.getByRole("option", { name: new RegExp(source.name) }),
  ).toHaveCount(0);
  await page
    .getByRole("option", { name: `${poster.name} — Chrome đăng`, exact: true })
    .click();
  const sourceSelect = dialog.getByLabel("Lấy danh sách nhóm từ", {
    exact: true,
  });
  await expect(sourceSelect).toHaveText("Nhóm của tài khoản đăng");
  await sourceSelect.click();
  await page
    .getByRole("option", {
      name: `${source.name} — Chrome nguồn (Hạn chế)`,
      exact: true,
    })
    .click();
  await expect(
    dialog.getByText(`2 nhóm của ${source.name}`, { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Chọn trang này", exact: true })
    .click();
  await dialog
    .getByRole("checkbox", { name: unchosen.name, exact: true })
    .uncheck();
  await expect(
    dialog.getByRole("checkbox", { name: chosen.name, exact: true }),
  ).toBeChecked();
  await sourceSelect.click();
  await page
    .getByRole("option", { name: "Nhóm của tài khoản đăng", exact: true })
    .click();
  await expect(
    dialog.getByText(`0 nhóm của ${poster.name}`, { exact: true }),
  ).toBeVisible();
  await sourceSelect.click();
  await page
    .getByRole("option", {
      name: `${source.name} — Chrome nguồn (Hạn chế)`,
      exact: true,
    })
    .click();
  await expect(
    dialog.getByRole("checkbox", { name: chosen.name, exact: true }),
  ).toBeChecked();
  await expect(
    dialog.getByLabel("Tài khoản đăng", { exact: true }),
  ).toContainText(poster.name);
  await expect(
    dialog.getByRole("checkbox", {
      name: `Trang cá nhân của ${poster.name}`,
      exact: true,
    }),
  ).not.toBeChecked();
  await page.screenshot({
    path: ".data/screenshots/schedule-group-source-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await sourceSelect.scrollIntoViewIfNeeded();
  const bounds = await sourceSelect.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: ".data/screenshots/schedule-group-source-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await dialog
    .getByRole("button", { name: "Kiểm tra lịch", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Kiểm tra lịch trước khi lưu" }),
  ).toBeVisible();
  const save = dialog.getByRole("button", {
    name: "Lưu 1 công việc",
    exact: true,
  });
  await expect(save).toBeDisabled();
  const before = await (
    await page.request.get(`/api/v1/groups?accountId=${poster.id}`)
  ).json();
  expect(before.total).toBe(0);
  await dialog
    .getByRole("checkbox", {
      name: "Tôi xác nhận tài khoản đăng có quyền đăng vào các nhóm đã chọn.",
      exact: true,
    })
    .check();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog).toHaveCount(0);
  const tasks = await (
    await page.request.get(`/api/v1/tasks?accountId=${poster.id}`)
  ).json();
  expect(tasks.total).toBe(1);
  expect(tasks.items[0]).toMatchObject({
    accountId: poster.id,
    groupId: chosen.id,
    executionMode: "MANUAL",
  });
  const linked = await (
    await page.request.get(`/api/v1/groups?accountId=${poster.id}`)
  ).json();
  expect(linked.total).toBe(0);
  const retained = await (
    await page.request.get(`/api/v1/groups?accountId=${source.id}`)
  ).json();
  expect(retained.total).toBe(2);
});
