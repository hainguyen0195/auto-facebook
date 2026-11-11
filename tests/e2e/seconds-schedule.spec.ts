import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("15, 30, 45-second presets persist and show seconds in schedule previews", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const name = `Giãn giây ${suffix}`;
  await page.goto("/accounts");
  await page
    .getByRole("button", { name: "Thêm tài khoản", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên tài khoản", { exact: true }).fill(name);
  await dialog.getByLabel("Tên profile trình duyệt").fill(name);
  await dialog
    .getByLabel("Link trang cá nhân")
    .fill(`https://facebook.com/seconds.${suffix}`);
  await dialog.getByRole("checkbox", { name: "Áp dụng giờ nghỉ" }).uncheck();
  for (const seconds of [30, 45, 15]) {
    await dialog
      .getByRole("button", { name: `${seconds} giây`, exact: true })
      .click();
    await expect(
      dialog.getByLabel("Khoảng cách giữa các bài (phút)", { exact: true }),
    ).toHaveValue(String(seconds / 60));
  }
  await dialog
    .getByRole("button", { name: "Lưu tài khoản", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  const accounts = await (await page.request.get("/api/v1/accounts")).json();
  const account = accounts.find((a: { name: string }) => a.name === name);
  expect(account.postIntervalMinutes).toBe(0.25);
  const post = async (route: string, data: unknown) => {
    const response = await page.request.post(`/api/v1/${route}`, {
      data,
      headers: { origin: "http://localhost:3100" },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const groups = [];
  for (let i = 0; i < 3; i++)
    groups.push(
      await post("groups", {
        name: `Nhóm giây ${suffix} ${i}`,
        url: `facebook.com/groups/seconds.${suffix}.${i}`,
        accountIds: [account.id],
      }),
    );
  const title = `Lịch giây ${suffix}`;
  await post("posts", {
    title,
    content: "Nội dung kiểm tra khoảng cách giây",
    assetIds: [],
  });
  for (const seconds of [15, 30, 45]) {
    await page.goto("/posts");
    await page
      .locator("article")
      .filter({ hasText: title })
      .getByRole("button", { name: "Lên lịch", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Cách thực hiện", { exact: true }).click();
    await page
      .getByRole("option", { name: "Nhắc tôi đăng thủ công", exact: true })
      .click();
    await dialog.getByLabel("Tài khoản đăng", { exact: true }).click();
    await page
      .getByRole("option", { name: `${name} — ${name}`, exact: true })
      .click();
    for (const group of groups)
      await dialog
        .getByRole("checkbox", { name: group.name, exact: true })
        .check();
    await dialog
      .getByRole("button", { name: `${seconds} giây`, exact: true })
      .click();
    if (seconds === 15) {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: ".data/screenshots/seconds-schedule-mobile.png",
        fullPage: true,
      });
    }
    const previewResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/schedules/preview") &&
        r.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "Kiểm tra lịch", exact: true })
      .click();
    const preview = await (await previewResponse).json();
    const times = preview.targets.map((t: { scheduledAt: string }) =>
      new Date(t.scheduledAt).getTime(),
    );
    expect(times.map((t: number) => t - times[0])).toEqual([
      0,
      seconds * 1000,
      seconds * 2000,
    ]);
    await expect(dialog.locator("table tbody tr")).toHaveCount(3);
    for (const row of await dialog.locator("table tbody tr").all())
      await expect(row).toContainText(/\d{2}:\d{2}:\d{2}/);
    const acknowledgement = dialog.getByRole("checkbox");
    if (await acknowledgement.count()) await acknowledgement.check();
    await dialog
      .getByRole("button", { name: "Lưu 3 công việc", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
  }
});
