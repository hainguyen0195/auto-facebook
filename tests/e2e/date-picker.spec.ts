import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.use({ timezoneId: "America/Los_Angeles" });

test("Vietnamese calendar filters the correct day across timezones and supports keyboard navigation", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2028-02-29T17:30:00Z"));
  await page.goto("/interactions");
  const trigger = page.getByLabel("Ngày ghi nhận đăng", { exact: true });
  await expect(trigger).toContainText("01/03/2028");
  await trigger.click();
  const picker = page.getByRole("dialog", { name: "Chọn ngày", exact: true });
  await expect(picker.locator('[data-day="2028-03-01"]')).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(picker.locator('[data-day="2028-02-29"]')).toBeFocused();
  const filtered = page.waitForRequest((r) =>
    r.url().includes("published-posts?date=2028-02-29"),
  );
  await page.keyboard.press("Enter");
  await filtered;
  await expect(trigger).toContainText("29/02/2028");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("PageDown");
  await expect(picker.locator('[data-day="2028-03-29"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toContainText("29/02/2028");
  await trigger.click();
  await picker.getByRole("button", { name: "Chọn tháng và năm" }).click();
  await picker.getByRole("button", { name: "Năm sau", exact: true }).click();
  await picker.getByRole("button", { name: "Tháng 2", exact: true }).click();
  await expect(picker.locator('[data-day="2029-02-01"]')).toBeFocused();
  await picker.locator('[data-day="2029-02-28"]').click();
  await expect(trigger).toContainText("28/02/2029");
  await trigger.click();
  await picker.getByRole("button", { name: "Hôm nay", exact: true }).click();
  await expect(trigger).toContainText("01/03/2028");
  await trigger.click();
  await page.screenshot({
    path: ".data/screenshots/date-picker-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await picker.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: ".data/screenshots/date-picker-mobile.png",
    fullPage: true,
  });
});

test("date and time controls inside a modal preserve the chosen UTC+7 schedule", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const response = await page.request.post("/api/v1/accounts", {
    headers: { Origin: "http://localhost:3100" },
    data: {
      name: `Calendar ${suffix}`,
      profileName: "Calendar",
      url: `https://facebook.com/calendar.${suffix}`,
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto("/interactions");
  await page
    .getByRole("button", { name: "Thêm tương tác", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Chuẩn bị tương tác",
    exact: true,
  });
  await dialog.getByLabel("Tài khoản thực hiện").click();
  await page
    .getByRole("option", { name: `Calendar ${suffix} — Calendar`, exact: true })
    .click();
  await dialog
    .getByLabel("Link bài viết Facebook")
    .fill(`https://www.facebook.com/groups/calendar/posts/${suffix}`);
  await dialog.getByLabel("Bình luận cần duyệt").fill("Calendar fixture");
  const dateTrigger = dialog.getByLabel("Thời gian nhắc (UTC+7)");
  await dateTrigger.click();
  const picker = page.getByRole("dialog", { name: "Chọn ngày", exact: true });
  const tomorrow = await picker
    .getByRole("button", { name: "Ngày mai", exact: true })
    .evaluate(() => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const day = new Date(`${parts}T12:00:00Z`);
      day.setUTCDate(day.getUTCDate() + 1);
      return day.toISOString().slice(0, 10);
    });
  await picker.getByRole("button", { name: "Ngày mai", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dateTrigger).toBeFocused();
  await dialog.getByRole("combobox", { name: "Giờ", exact: true }).click();
  await page.getByRole("option", { name: "08 giờ", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Phút", exact: true }).click();
  await page.getByRole("option", { name: "30 phút", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const label of ["Giờ", "Phút"]) {
    expect(
      await dialog
        .getByRole("combobox", { name: label, exact: true })
        .locator(".select-value")
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
  }
  await page.screenshot({
    path: ".data/screenshots/date-time-picker-mobile.png",
    fullPage: true,
  });
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/interactions") &&
      r.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Lưu để duyệt", exact: true })
    .click();
  const result = await saved;
  expect(result.ok(), await result.text()).toBe(true);
  expect((await result.json()).scheduledAt).toBe(
    new Date(`${tomorrow}T08:30:00+07:00`).toISOString(),
  );
  await expect(dialog).toHaveCount(0);
});
