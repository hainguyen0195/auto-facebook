import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { AccountRow } from "../../src/lib/client";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { testDatabaseUrl } from "../database";

test("library cards show account history immediately, open destinations and keep cancelled schedules", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const title = `Bài kiểm tra lịch ${suffix}`;
  const create = async (route: string, data: unknown) => {
    const response = await page.request.post(`/api/v1/${route}`, {
      headers: { origin: "http://localhost:3100" },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const accounts: AccountRow[] = [];
  for (const [index, name] of [
    "Minh Phan",
    "Ngọc Minh Kingcrab — Hải sản tươi sống giao tận nơi",
  ].entries())
    accounts.push(
      await create("accounts", {
        name: `${name} ${suffix}`,
        url: `facebook.com/summary.${suffix}.${index}`,
        profileName: `Chrome ${index}`,
        quietHoursEnabled: false,
        color: index ? "blue" : "teal",
      }),
    );
  const group = await create("groups", {
    name: `Nhóm của Minh ${suffix}`,
    url: `facebook.com/groups/summary.${suffix}`,
    accountIds: [accounts[0].id],
  });
  await create("posts", {
    title,
    content:
      "Nội dung mẫu để kiểm tra thẻ bài đã lên lịch cho nhiều tài khoản.",
    assetIds: [],
  });
  await page.goto("/posts");
  await page.getByPlaceholder("Tìm tiêu đề, nội dung, nhãn…").fill(title);
  const card = page.getByRole("article").filter({ hasText: title });
  await expect(card).toContainText("Chưa từng lên lịch");
  await card.getByRole("button", { name: "Lên lịch", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Cách thực hiện", { exact: true }).click();
  await page
    .getByRole("option", { name: "Nhắc tôi đăng thủ công", exact: true })
    .click();
  for (const [index, account] of accounts.entries()) {
    await dialog.getByLabel("Tài khoản đăng", { exact: true }).click();
    await page
      .getByRole("option", {
        name: `${account.name} — ${account.profileName}`,
        exact: true,
      })
      .click();
    await dialog
      .getByRole("checkbox", {
        name: `Trang cá nhân của ${account.name}`,
        exact: true,
      })
      .check();
    if (!index)
      await dialog
        .getByRole("checkbox", { name: group.name, exact: true })
        .check();
  }
  await dialog
    .getByRole("button", { name: "Kiểm tra lịch", exact: true })
    .click();
  await expect(dialog.locator("table tbody tr")).toHaveCount(3);
  const ack = dialog.getByRole("checkbox");
  if (await ack.count()) await ack.check();
  await dialog
    .getByRole("button", { name: "Lưu 3 công việc", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const summary = card.getByRole("group", {
    name: `Lịch đăng của ${title}`,
    exact: true,
  });
  await expect(summary).toContainText("Đã lên lịch cho");
  await expect(summary).toContainText("3 lượt đã tạo");
  await expect(summary.getByRole("listitem")).toHaveCount(2);
  await expect(
    summary.getByRole("listitem").filter({ hasText: accounts[0].name }),
  ).toContainText("2 lượt");
  await expect(
    summary.getByRole("listitem").filter({ hasText: accounts[1].name }),
  ).toContainText("1 lượt");
  await page.screenshot({
    path: ".data/screenshots/post-schedule-summary-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(summary).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".data/screenshots/post-schedule-summary-mobile.png",
    fullPage: true,
  });
  const tasks = await (
    await page.request.get(`/api/v1/tasks?q=${encodeURIComponent(title)}`)
  ).json();
  expect(tasks.total).toBe(3);
  await summary
    .getByRole("button", {
      name: `Xem lịch ${title} của ${accounts[0].name}`,
      exact: true,
    })
    .click();
  const details = page.getByRole("dialog");
  await expect(details).toContainText(group.name);
  await expect(details).toContainText("Trang cá nhân");
  await expect(details).toContainText("2 lượt đã tạo");
  await details.getByRole("button", { name: "Đóng", exact: true }).click();
  await create("tasks/bulk-cancel", {
    tasks: tasks.items.map(
      ({ id, version }: { id: string; version: number }) => ({ id, version }),
    ),
    operationId: randomUUID(),
  });
  await page.reload();
  await expect(summary).toBeVisible();
  await expect(summary.getByRole("listitem")).toHaveCount(2);
  await expect(
    summary.getByRole("button", {
      name: `Xem 2 lượt Đã hủy của ${accounts[0].name} cho ${title}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    card.getByText("Chưa từng lên lịch", { exact: true }),
  ).toHaveCount(0);
});

test("41 completed and one failed destination reconcile, and completed archived history remains visible", async ({
  page,
}) => {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDatabaseUrl("e2e") }),
  });
  const suffix = randomUUID().slice(0, 8);
  const { workspace } = await (
    await page.request.get("/api/v1/bootstrap")
  ).json();
  const account = await db.facebookAccount.create({
    data: {
      workspaceId: workspace.id,
      name: `Nhi Vy ${suffix}`,
      url: `https://www.facebook.com/history.${suffix}`,
      profileName: `History ${suffix}`,
    },
  });
  const post = await db.post.create({
    data: {
      workspaceId: workspace.id,
      title: `Vy Nhi 7/11 ${suffix}`,
      content: "Lịch sử 42 lượt cho đúng bài này.",
    },
  });
  const campaign = await db.campaign.create({
    data: {
      workspaceId: workspace.id,
      postId: post.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
    },
  });
  const groups = Array.from({ length: 42 }, (_, index) => ({
    id: randomUUID(),
    workspaceId: workspace.id,
    name:
      index === 41
        ? "CHỢ HẢI SẢN HÀ NỘI - Group Chính Thức"
        : `Hội nhóm ${index + 1}`,
    url: `https://www.facebook.com/groups/history.${suffix}.${index}`,
  }));
  await db.group.createMany({ data: groups });
  try {
    await db.task.createMany({
      data: groups.map((group, index) => ({
        workspaceId: workspace.id,
        postId: post.id,
        campaignId: campaign.id,
        accountId: account.id,
        groupId: group.id,
        destinationKey: `group:${group.id}`,
        titleSnapshot: post.title,
        contentSnapshot: post.content,
        contentHash: randomUUID(),
        scheduledAt: new Date(Date.now() - index * 60000),
        status: index === 41 ? "BLOCKED" : "PUBLISHED",
        archivedAt: index === 0 ? new Date() : null,
        executionMode: "AUTOMATIC",
        automaticPhase: index === 41 ? "SAFE_FAILED" : "NONE",
        blockReason: index === 41 ? "AUTO_FAILED" : null,
        note:
          index === 41
            ? "Chưa bấm Đăng; lỗi ở bước mở trình soạn bài: locator.click: Timeout 20000ms exceeded.. Đã dừng lượt này trước khi gửi."
            : "",
      })),
    });
    await page.goto("/posts");
    await page
      .getByPlaceholder("Tìm tiêu đề, nội dung, nhãn…")
      .fill(post.title);
    const card = page.getByRole("article").filter({ hasText: post.title });
    const summary = card.getByRole("group", {
      name: `Lịch đăng của ${post.title}`,
      exact: true,
    });
    await expect(summary).toContainText("42 lượt đã tạo");
    await expect(
      summary.getByRole("button", {
        name: `Xem 41 lượt Đã đăng của ${account.name} cho ${post.title}`,
        exact: true,
      }),
    ).toBeVisible();
    const failedButton = summary.getByRole("button", {
      name: `Xem 1 lượt Cần kiểm tra của ${account.name} cho ${post.title}`,
      exact: true,
    });
    await expect(failedButton).toBeVisible();
    await card.screenshot({
      path: ".data/screenshots/post-history-desktop.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await card.screenshot({
      path: ".data/screenshots/post-history-mobile.png",
    });
    await page.route(`**/api/v1/posts/${post.id}/schedules?**`, (route) =>
      route.abort("connectionfailed"),
    );
    await failedButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("alert")).toContainText(
      "Chưa tải được dữ liệu",
    );
    await expect(
      dialog.getByText("Không có lượt ở trạng thái này"),
    ).toHaveCount(0);
    await page.unroute(`**/api/v1/posts/${post.id}/schedules?**`);
    await dialog.getByRole("button", { name: "Thử lại", exact: true }).click();
    await expect(dialog).toContainText(groups[41].name);
    await expect(dialog).toContainText("1 lượt · Cần kiểm tra");
    await expect(dialog).toContainText("Chưa gửi được");
    await expect(dialog).toContainText("Không mở được ô soạn bài");
    await expect(dialog.locator(".post-schedule-detail-list > li")).toHaveCount(
      1,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".data/screenshots/post-history-failure-detail-mobile.png",
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Xem chi tiết", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(post.title);
    await expect(page.getByRole("dialog")).toContainText(
      "Chưa gửi được bài này",
    );
    await page.keyboard.press("Escape");
    await summary
      .getByRole("button", {
        name: `Xem 41 lượt Đã đăng của ${account.name} cho ${post.title}`,
        exact: true,
      })
      .click();
    await expect(dialog).toContainText("41 lượt · Đã đăng");
    await expect(dialog.locator(".post-schedule-detail-list > li")).toHaveCount(
      10,
    );
    await expect(dialog).toContainText(
      "Đã xóa khỏi Lịch đăng · Vẫn giữ lịch sử",
    );
    await dialog
      .getByRole("button", { name: "Trang sau", exact: true })
      .click();
    await expect(dialog).toContainText("Trang 2/5");
    await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
    await db.task.updateMany({
      where: { postId: post.id },
      data: {
        status: "PUBLISHED",
        note: "",
        blockReason: null,
        automaticPhase: "NONE",
        recordedAt: new Date(),
        archivedAt: new Date(),
      },
    });
    await page.reload();
    await expect(summary).toContainText("Đã đăng xong");
    await expect(summary).toContainText("42 lượt đã tạo");
    await expect(summary).toContainText(account.name);
    await expect(summary).toContainText(
      "Giữ lịch sử 42 lượt đã xóa khỏi Lịch đăng",
    );
    await expect(
      summary.getByRole("button", {
        name: `Xem 42 lượt Đã đăng của ${account.name} cho ${post.title}`,
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await db.task.deleteMany({ where: { postId: post.id } });
    await db.campaign.delete({ where: { id: campaign.id } });
    await db.post.delete({ where: { id: post.id } });
    await db.group.deleteMany({
      where: { id: { in: groups.map((g) => g.id) } },
    });
    await db.facebookAccount.delete({ where: { id: account.id } });
    await db.$disconnect();
  }
});
