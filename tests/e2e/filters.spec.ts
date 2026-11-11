import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("calendar filters survive reload, history navigation and mobile dropdown use", async ({
  page,
}) => {
  await page.goto(
    "/calendar?view=list&date=2026-11-02&target=GROUP&status=READY&q=fixture&page=2",
  );
  await expect(page.getByLabel("Lọc lịch theo trạng thái")).toHaveText(
    /Đến lượt đăng/,
  );
  await expect(
    page.getByPlaceholder("Tìm bài, tài khoản, hội nhóm…"),
  ).toHaveValue("fixture");
  await page.reload();
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page).toHaveURL(/target=GROUP/);
  await expect(page).toHaveURL(/status=READY/);
  await expect(page).toHaveURL(/q=fixture/);
  await page.getByLabel("Lọc lịch theo trạng thái").click();
  await page.getByRole("option", { name: "Đã đăng", exact: true }).click();
  await expect(page).toHaveURL(/status=PUBLISHED/);
  await expect(page).not.toHaveURL(/page=2/);
  await page
    .getByRole("button", { name: "Facebook cá nhân", exact: true })
    .click();
  await expect(page).toHaveURL(/target=PROFILE/);
  await page.goBack();
  await expect(page).toHaveURL(/target=GROUP/);
  await expect(page.getByLabel("Lọc lịch theo trạng thái")).toHaveText(
    /Đã đăng/,
  );
  await page.goForward();
  await expect(page).toHaveURL(/target=PROFILE/);
  await page.getByRole("button", { name: "Tuần", exact: true }).click();
  await expect(page).toHaveURL(/view=week/);
  await page.getByRole("button", { name: "Khoảng thời gian sau" }).click();
  await expect(page).toHaveURL(/date=2026-11-09/);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Tuần", exact: true }),
  ).toHaveClass(/selected/);
  await expect(page).toHaveURL(/date=2026-11-09/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Lọc lịch theo trạng thái").click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.screenshot({
    path: ".data/screenshots/mobile-calendar-select.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("group minute presets and account cooldown persist through the editors", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  await page.goto("/groups");
  await page
    .getByRole("button", { name: "Thêm hội nhóm", exact: true })
    .first()
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên hội nhóm").fill(`Nhóm phút ${suffix}`);
  await dialog
    .getByLabel("Link hội nhóm")
    .fill(`https://facebook.com/groups/minutes.${suffix}`);
  const interval = dialog.getByLabel("Khoảng cách đăng bạn đặt (phút)");
  await expect(interval).toHaveValue("5");
  await dialog.getByRole("button", { name: "3 phút", exact: true }).click();
  await expect(interval).toHaveValue("3");
  await dialog
    .getByRole("button", { name: "Lưu hội nhóm", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: `Nhóm phút ${suffix}` });
  await expect(row).toContainText("3 phút");
  await row
    .getByRole("button", { name: `Chỉnh sửa Nhóm phút ${suffix}` })
    .click();
  await expect(page.getByLabel("Khoảng cách đăng bạn đặt (phút)")).toHaveValue(
    "3",
  );
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.goto("/accounts");
  await page
    .getByRole("button", { name: "Thêm tài khoản", exact: true })
    .first()
    .click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Khoảng cách giữa các bài (phút)"),
  ).toHaveValue("5");
  await dialog.getByRole("button", { name: "3 phút", exact: true }).click();
  await dialog
    .getByLabel("Tên tài khoản", { exact: true })
    .fill(`Phút ${suffix}`);
  await dialog.getByLabel("Tên profile trình duyệt").fill("Shop phút");
  await dialog
    .getByLabel("Link trang cá nhân")
    .fill(`https://facebook.com/minutes.${suffix}`);
  await dialog.getByLabel("Trạng thái bạn ghi nhận").click();
  await page.getByRole("option", { name: "Sẵn sàng", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Lưu tài khoản", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const accounts = await (await page.request.get("/api/v1/accounts")).json();
  expect(
    accounts.find((a: { name: string }) => a.name === `Phút ${suffix}`)
      .postIntervalMinutes,
  ).toBe(3);
});
