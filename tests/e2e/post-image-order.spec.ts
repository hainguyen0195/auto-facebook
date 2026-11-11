import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

test("reorders uploaded images by dragging, restores the draft, and saves the same order on desktop and mobile", async ({
  page,
}) => {
  const title = `Image order ${randomUUID().slice(0, 8)}`;
  const images = await Promise.all(
    ["#147c70", "#c74611", "#245dc4"].map(async (background, index) => ({
      name: `${index + 1}.jpg`,
      mimeType: "image/jpeg",
      buffer: await sharp({
        create: { width: 80, height: 80, channels: 3, background },
      })
        .jpeg()
        .toBuffer(),
    })),
  );
  await page.goto("/posts");
  await page.getByRole("button", { name: "Soạn bài mới", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên bài trong thư viện").fill(title);
  await dialog
    .getByLabel("Nội dung bài viết", { exact: true })
    .fill("Post with ordered images");
  await dialog.getByLabel("Thêm ảnh bài viết").setInputFiles(images);
  const list = dialog.getByRole("list", { name: "Thứ tự ảnh bài viết" });
  await expect(list.locator("img")).toHaveCount(3);
  const order = () =>
    list
      .locator("img")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("alt")));
  const previewOrder = () =>
    dialog
      .locator(".fb-preview-images img")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("alt")));
  const tile = (name: string) =>
    list
      .getByRole("listitem")
      .filter({ has: page.getByAltText(name, { exact: true }) });
  await tile("3.jpg").dragTo(tile("1.jpg"));
  await expect.poll(order).toEqual(["3.jpg", "1.jpg", "2.jpg"]);
  await expect.poll(previewOrder).toEqual(["3.jpg", "1.jpg", "2.jpg"]);
  await expect(tile("3.jpg")).toContainText("Ảnh đầu");
  await tile("3.jpg").dragTo(tile("2.jpg"));
  await expect.poll(order).toEqual(["1.jpg", "2.jpg", "3.jpg"]);
  await tile("3.jpg").dragTo(tile("1.jpg"));
  const bootstrap = await (await page.request.get("/api/v1/bootstrap")).json();
  const draftKey = `nhipdang:${bootstrap.workspace.id}:draft:new`;
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = localStorage.getItem(key);
        return raw
          ? JSON.parse(raw).assets.map(
              (asset: { originalName: string }) => asset.originalName,
            )
          : [];
      }, draftKey),
    )
    .toEqual(["3.jpg", "1.jpg", "2.jpg"]);
  await dialog
    .getByRole("button", { name: "Đóng, giữ nháp", exact: true })
    .click();
  await page.getByRole("button", { name: "Soạn bài mới", exact: true }).click();
  await expect.poll(order).toEqual(["3.jpg", "1.jpg", "2.jpg"]);
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/posts") &&
      response.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Lưu vào thư viện", exact: true })
    .click();
  const post = await (await created).json();
  expect(
    post.assets.map(
      (asset: { position: number; asset: { originalName: string } }) => [
        asset.position,
        asset.asset.originalName,
      ],
    ),
  ).toEqual([
    [0, "3.jpg"],
    [1, "1.jpg"],
    [2, "2.jpg"],
  ]);
  await expect(dialog).toHaveCount(0);
  const card = page.getByRole("article").filter({ hasText: title });
  await card
    .getByRole("button", { name: `Chỉnh sửa ${title}`, exact: true })
    .click();
  await expect.poll(order).toEqual(["3.jpg", "1.jpg", "2.jpg"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog
    .getByRole("button", { name: "Chuyển 1.jpg lên trước", exact: true })
    .click();
  await expect.poll(order).toEqual(["1.jpg", "3.jpg", "2.jpg"]);
  await dialog
    .getByRole("button", { name: "Chuyển 3.jpg ra sau", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect.poll(order).toEqual(["1.jpg", "2.jpg", "3.jpg"]);
  await expect.poll(previewOrder).toEqual(["1.jpg", "2.jpg", "3.jpg"]);
  await expect(
    dialog.getByRole("button", { name: "Chuyển 1.jpg lên trước", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Chuyển 3.jpg ra sau", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() => dialog.evaluate((node) => node.scrollWidth <= node.clientWidth))
    .toBe(true);
  await page.screenshot({
    path: ".data/screenshots/post-image-order-mobile.jpg",
    fullPage: true,
  });
  const edited = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/posts/${post.id}`) &&
      response.request().method() === "PATCH",
  );
  await dialog
    .getByRole("button", { name: "Lưu vào thư viện", exact: true })
    .click();
  const updated = await (await edited).json();
  expect(
    updated.assets.map(
      (asset: { asset: { originalName: string } }) => asset.asset.originalName,
    ),
  ).toEqual(["1.jpg", "2.jpg", "3.jpg"]);
});
