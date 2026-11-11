import { test, expect } from "@playwright/test";

test("loads the complete month in one small request, reuses it, and filters the list to today", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-06T05:00:00Z"));
  const template = {
    status: "READY",
    executionMode: "MANUAL",
    version: 1,
    contentSnapshot: "Calendar fixture",
    account: { id: "a", name: "Calendar account" },
    group: null,
    resultUrl: null,
    recordedAt: null,
    assetIds: [],
  };
  const today = {
    ...template,
    id: "today",
    titleSnapshot: "Lịch hôm nay ở trang thứ ba",
    scheduledAt: "2026-11-06T07:00:00.000Z",
  };
  const loaded: string[] = [];
  await page.route("**/api/v1/calendar?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const view = params.get("view")!;
    loaded.push(view);
    return route.fulfill({
      json: {
        total: 202,
        summary: { READY: 202 },
        days: [
          {
            date: "2026-11-04",
            total: 201,
            items: Array.from({ length: view === "week" ? 8 : 3 }, (_, i) => ({
              ...template,
              id: `old-${i}`,
              titleSnapshot: `Lịch cũ ${i}`,
              scheduledAt: "2026-11-04T07:00:00.000Z",
            })),
          },
          { date: "2026-11-06", total: 1, items: [today] },
        ],
      },
    });
  });
  await page.route("**/api/v1/tasks?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get("size")).toBe("20");
    const isToday = params.get("start") === "2026-11-06T00:00:00+07:00";
    if (isToday) expect(params.get("end")).toBe("2026-11-07T00:00:00+07:00");
    return route.fulfill({
      json: {
        items: [today],
        total: 1,
        page: 1,
        size: 20,
        summary: { READY: 1 },
      },
    });
  });
  await page.goto("/calendar?view=month&date=2026-11-06");
  await expect(
    page.getByRole("button", { name: /Lịch hôm nay ở trang thứ ba/ }),
  ).toBeVisible();
  expect(loaded).toEqual(["month"]);
  await expect(
    page.getByRole("button", { name: "Xem 201 công việc", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".calendar-task")).toHaveCount(4);
  await page.getByRole("button", { name: "Tuần", exact: true }).click();
  await expect(page.locator(".calendar-task")).toHaveCount(9);
  expect(loaded).toEqual(["month", "week"]);
  await page.getByRole("button", { name: "Tháng", exact: true }).click();
  await expect(page.locator(".calendar-task")).toHaveCount(4);
  expect(loaded).toEqual(["month", "week"]);
  await page.getByRole("button", { name: "Danh sách", exact: true }).click();
  await page.getByRole("button", { name: "Hôm nay", exact: true }).click();
  await expect(page).toHaveURL(/day=2026-11-06/);
  await expect(
    page.getByRole("row").filter({ hasText: today.titleSnapshot }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Lịch cũ" }),
  ).toHaveCount(0);
  await expect(page.locator(".calendar-nav")).toContainText(/06[-/]11/);
  await page.reload();
  await expect(
    page.getByRole("row").filter({ hasText: today.titleSnapshot }),
  ).toBeVisible();
});
