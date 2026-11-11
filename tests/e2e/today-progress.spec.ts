import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PrismaClient, type TaskStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { testDatabaseUrl } from "../database";
import { dayBounds } from "../../src/lib/utils";

test("daily progress explains counts, identifies failures and opens the filtered remaining list", async ({
  page,
}) => {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDatabaseUrl("e2e") }),
  });
  const suffix = randomUUID().slice(0, 8);
  const before = await (await page.request.get("/api/v1/dashboard")).json();
  const bootstrap = await (await page.request.get("/api/v1/bootstrap")).json();
  const workspaceId = bootstrap.workspace.id;
  const { start } = dayBounds();
  const account = await db.facebookAccount.create({
    data: {
      workspaceId,
      name: "Nhi Vy",
      url: `https://www.facebook.com/progress.${suffix}`,
      profileName: `Progress ${suffix}`,
    },
  });
  const group = await db.group.create({
    data: {
      workspaceId,
      name: "CHỢ HẢI SẢN HÀ NỘI - Group Chính Thức",
      url: `https://www.facebook.com/groups/progress.${suffix}`,
    },
  });
  const post = await db.post.create({
    data: {
      workspaceId,
      title: `Tiến độ ${suffix}`,
      content: "Progress content",
    },
  });
  const campaign = await db.campaign.create({
    data: {
      workspaceId,
      postId: post.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
    },
  });
  try {
    const states: TaskStatus[] = [
      ...Array(210).fill("PUBLISHED"),
      ...Array(16).fill("CANCELLED"),
      "BLOCKED",
      "BLOCKED",
    ];
    await db.task.createMany({
      data: states.map((status, index) => ({
        workspaceId,
        postId: post.id,
        campaignId: campaign.id,
        accountId: account.id,
        groupId: group.id,
        destinationKey: `progress:${index}`,
        titleSnapshot: `${index === 226 ? "Vy Nhi 7/11" : index === 227 ? "Phạm ÝNhi - 7/11" : "Lịch đã xử lý"} ${suffix}`,
        contentSnapshot: post.content,
        contentHash: randomUUID(),
        status,
        scheduledAt: start,
        executionMode: "AUTOMATIC",
        blockReason: status === "BLOCKED" ? "AUTO_FAILED" : null,
        automaticPhase: status === "BLOCKED" ? "SAFE_FAILED" : "NONE",
        note:
          status === "BLOCKED"
            ? "Chưa bấm Đăng; lỗi ở bước mở trình soạn bài: locator.click: Timeout 20000ms exceeded.. Đã dừng lượt này trước khi gửi."
            : "",
      })),
    });
    await page.goto("/");
    const progress = page.getByRole("region", {
      name: "Tiến độ lịch hôm nay",
      exact: true,
    });
    await expect(progress).toContainText(
      `Đã xử lý ${before.progress.handled + 226}/${before.progress.total + 228} lượt đăng`,
    );
    await expect(progress).toContainText(
      "Mỗi lượt là một bài của một tài khoản",
    );
    await expect(progress).toContainText(
      "“Đã xử lý” gồm đã đăng, chờ duyệt nhóm, đã bỏ qua và đã hủy",
    );
    await expect(
      progress.getByRole("link", {
        name: `Đã hủy ${before.progress.byStatus.CANCELLED + 16}`,
        exact: true,
      }),
    ).toBeVisible();
    for (const title of [
      `Vy Nhi 7/11 ${suffix}`,
      `Phạm ÝNhi - 7/11 ${suffix}`,
    ]) {
      await expect(progress).toContainText(title);
    }
    await expect(
      progress
        .getByText(
          "Không mở được ô soạn bài trong thời gian chờ. Chưa bấm Đăng nên bài chưa được gửi.",
        )
        .first(),
    ).toBeVisible();
    await progress.screenshot({
      path: ".data/screenshots/today-progress-desktop.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await progress.screenshot({
      path: ".data/screenshots/today-progress-mobile.png",
    });
    await progress
      .getByRole("button", {
        name: `Xem chi tiết Vy Nhi 7/11 ${suffix} của Nhi Vy`,
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      `Vy Nhi 7/11 ${suffix}`,
    );
    await expect(page.getByRole("dialog")).toContainText(
      "Chưa gửi được bài này",
    );
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1280, height: 900 });
    await progress
      .getByRole("link", { name: /^Xem \d+ lượt chưa xử lý$/ })
      .click();
    await expect(page).toHaveURL(/remaining=true/);
    await expect(page).toHaveURL(/day=\d{4}-\d{2}-\d{2}/);
    await expect(
      page.getByText("Đang xem các lượt chưa xử lý:", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: `Vy Nhi 7/11 ${suffix}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: `Lịch đã xử lý ${suffix}` }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByText("Đang xem các lượt chưa xử lý:", { exact: false }),
    ).toBeVisible();
    await page.getByLabel("Lọc lịch theo trạng thái").click();
    await page.getByRole("option", { name: "Đã đăng", exact: true }).click();
    await expect(page).not.toHaveURL(/remaining=true/);
    await expect(page).toHaveURL(/status=PUBLISHED/);
    await expect(
      page.getByRole("row").filter({ hasText: `Lịch đã xử lý ${suffix}` }),
    ).toHaveCount(20);
  } finally {
    await db.task.deleteMany({ where: { campaignId: campaign.id } });
    await db.campaign.delete({ where: { id: campaign.id } });
    await db.post.delete({ where: { id: post.id } });
    await db.group.delete({ where: { id: group.id } });
    await db.facebookAccount.delete({ where: { id: account.id } });
    await db.$disconnect();
  }
});

test("progress has clear empty and completed states", async ({ page }) => {
  const response = await page.request.get("/api/v1/dashboard");
  const data = await response.json();
  const counts = Object.fromEntries(
    Object.keys(data.progress.byStatus).map((status) => [status, 0]),
  );
  let progress = {
    ...data.progress,
    total: 0,
    handled: 0,
    pending: 0,
    byStatus: counts,
    remainingTasks: [],
  };
  await page.route("**/api/v1/dashboard", (route) =>
    route.fulfill({ json: { ...data, progress } }),
  );
  await page.goto("/");
  const panel = page.getByRole("region", {
    name: "Tiến độ lịch hôm nay",
    exact: true,
  });
  await expect(panel).toContainText("Chưa có lịch hôm nay");
  await expect(panel.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await expect(panel.getByText(/Còn \d+ lượt chưa xử lý/)).toHaveCount(0);
  progress = {
    ...progress,
    total: 2,
    handled: 2,
    byStatus: { ...counts, PUBLISHED: 1, CANCELLED: 1 },
  };
  await page.reload();
  await expect(panel).toContainText("Đã xử lý 2/2 lượt đăng");
  await expect(panel).toContainText(
    "Không còn lượt nào chờ xử lý trong lịch hôm nay.",
  );
});
