import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("account quiet hours persist and preserve custom times on desktop and mobile", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const name = `Giờ nghỉ ${suffix}`;
  await page.goto("/accounts");
  await page
    .getByRole("button", { name: "Thêm tài khoản", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên tài khoản", { exact: true }).fill(name);
  await dialog.getByLabel("Tên profile trình duyệt").fill(name);
  await dialog
    .getByLabel("Link trang cá nhân")
    .fill(`https://facebook.com/quiet.${suffix}`);
  await expect(
    dialog.getByRole("checkbox", { name: "Áp dụng giờ nghỉ" }),
  ).toBeChecked();
  await dialog.getByLabel("Giờ bắt đầu nghỉ (UTC+7)").fill("20");
  await dialog.getByLabel("Giờ kết thúc nghỉ (UTC+7)").fill("6");
  await dialog
    .getByRole("button", { name: "Lưu tài khoản", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const card = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  const toggle = card.getByRole("checkbox", {
    name: `Áp dụng giờ nghỉ cho ${name}`,
    exact: true,
  });
  await expect(card).toContainText("20:00–06:00 (UTC+7)");
  await toggle.uncheck();
  await expect(toggle).toBeEnabled();
  await expect(card).toContainText("Làm cả ngày");
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await card
    .getByRole("button", { name: `Chỉnh sửa ${name}`, exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Giờ bắt đầu nghỉ (UTC+7)")).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: "Áp dụng giờ nghỉ" }).check();
  await expect(dialog.getByLabel("Giờ bắt đầu nghỉ (UTC+7)")).toHaveValue("20");
  await expect(dialog.getByLabel("Giờ kết thúc nghỉ (UTC+7)")).toHaveValue("6");
  // Toggling inside the form must not discard the stored custom interval.
  await dialog.getByRole("checkbox", { name: "Áp dụng giờ nghỉ" }).uncheck();
  await dialog
    .getByRole("button", { name: "Lưu tài khoản", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await toggle.check();
  await expect(toggle).toBeEnabled();
  await expect(card).toContainText("20:00–06:00 (UTC+7)");
  await page.reload();
  await expect(toggle).toBeChecked();
  await page.screenshot({
    path: ".data/screenshots/quiet-hours-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await toggle.uncheck();
  await expect(toggle).toBeEnabled();
  await expect(card).toContainText("Làm cả ngày");
  await page.screenshot({
    path: ".data/screenshots/quiet-hours-mobile.png",
    fullPage: true,
  });
});
