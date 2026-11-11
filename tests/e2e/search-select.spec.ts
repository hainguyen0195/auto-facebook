import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const origin = "http://localhost:3100";
async function create(page: Page, resource: string, data: unknown) {
  const response = await page.request.post(`/api/v1/${resource}`, {
    headers: { Origin: origin },
    data,
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

test("dropdown search ignores accents, clears, preserves selection and supports the keyboard", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const name = `Cửa hàng Đà Nẵng ${suffix}`;
  const account = await create(page, "accounts", {
    name,
    url: `https://facebook.com/search.${suffix}`,
    profileName: "Chrome tìm kiếm",
  });
  await page.goto("/calendar?view=list&status=READY");
  const trigger = page.getByLabel("Lọc lịch theo tài khoản", { exact: true });
  await trigger.click();
  const search = page.getByRole("combobox", {
    name: "Tìm trong danh sách",
    exact: true,
  });
  await expect(search).toBeFocused();
  await search.fill(`cua hang da nang ${suffix}`);
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`accountId=${account.id}`));
  await expect(trigger).toHaveText(name);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(search).toHaveValue("");
  await search.fill("khong-co-lua-chon-xyz");
  await expect(
    page.getByText("Không tìm thấy lựa chọn phù hợp.", { exact: true }),
  ).toBeVisible();
  await expect(trigger).toHaveText(name);
  await page
    .getByRole("button", { name: "Xóa từ khóa trong danh sách" })
    .click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Lọc lịch theo trạng thái", { exact: true }).click();
  await search.fill("da dang");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(
    page.getByRole("option", { name: "Đã đăng", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".data/screenshots/mobile-select-search.png",
    fullPage: true,
  });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/status=PUBLISHED/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("search works inside a dialog and required selects prevent an incomplete submission", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const title = `Áo mùa đông ${suffix}`;
  await create(page, "posts", {
    title,
    content: "Mẫu áo mới",
    tags: [],
    assetIds: [],
  });
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Tạo lịch mới", exact: true }).click();
  await page.getByLabel("Chọn bài từ thư viện", { exact: true }).click();
  let search = page.getByRole("combobox", {
    name: "Tìm trong danh sách",
    exact: true,
  });
  await search.fill(`ao mua dong ${suffix}`);
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Chọn bài từ thư viện", { exact: true }),
  ).toHaveText(title);
  await page.getByLabel("Cách thực hiện", { exact: true }).click();
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(
    page.getByLabel("Chọn bài từ thư viện", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Đóng", exact: true }).click();

  await page.goto("/interactions");
  await page
    .getByRole("button", { name: "Thêm tương tác", exact: true })
    .click();
  await page
    .getByLabel("Link bài viết Facebook", { exact: true })
    .fill("https://facebook.com/example/posts/123");
  await page
    .getByLabel("Bình luận cần duyệt", { exact: true })
    .fill("Nội dung cần duyệt");
  let submissions = 0;
  await page.route("**/api/v1/interactions", async (route) => {
    if (route.request().method() === "POST") submissions++;
    await route.continue();
  });
  await page.getByRole("button", { name: "Lưu để duyệt", exact: true }).click();
  search = page.getByRole("combobox", {
    name: "Tìm trong danh sách",
    exact: true,
  });
  await expect(search).toBeFocused();
  expect(submissions).toBe(0);
});

test("post and group titles open their existing editors", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const title = `Bấm tiêu đề ${suffix}`;
  await create(page, "posts", {
    title,
    content: "Nội dung trước khi sửa",
    tags: [],
    assetIds: [],
  });
  const group = await create(page, "groups", {
    name: `Nhóm ${title}`,
    url: `https://facebook.com/groups/title.${suffix}`,
  });
  await page.goto("/posts");
  await page.getByPlaceholder("Tìm tiêu đề, nội dung, nhãn…").fill(title);
  const titleButton = page
    .getByRole("heading", { name: title, exact: true })
    .getByRole("button");
  await titleButton.click();
  let dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Chỉnh sửa bài viết", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Tên bài trong thư viện")).toHaveValue(title);
  await dialog
    .getByLabel("Nội dung bài viết", { exact: true })
    .fill("Nội dung đã chỉnh từ tiêu đề");
  await dialog
    .getByRole("button", { name: "Lưu vào thư viện", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await titleButton.click();
  await expect(
    page.getByLabel("Nội dung bài viết", { exact: true }),
  ).toHaveValue("Nội dung đã chỉnh từ tiêu đề");
  await page.getByRole("button", { name: "Đóng", exact: true }).click();

  await page.goto("/groups");
  await page.getByPlaceholder("Tìm tên nhóm, link, nhãn…").fill(group.name);
  await page.getByRole("button", { name: group.name, exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Chỉnh sửa hội nhóm", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Tên hội nhóm", { exact: true })).toHaveValue(
    group.name,
  );
  await expect(dialog.getByLabel("Link hội nhóm", { exact: true })).toHaveValue(
    group.url,
  );
});
