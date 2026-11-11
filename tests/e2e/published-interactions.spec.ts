import { test, expect, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";

const origin = "http://localhost:3100";
async function write(
  page: Page,
  method: "post" | "patch",
  route: string,
  data: unknown,
) {
  const response = await page.request[method](`/api/v1/${route}`, {
    headers: { Origin: origin },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
test("save a published link, select another account and approve one automatic interaction", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8),
    title = `Bài hôm nay ${suffix}`;
  const account = await write(page, "post", "accounts", {
    name: `A ${suffix}`,
    profileName: "A",
    url: `https://facebook.com/poster.${suffix}`,
  });
  const actor = await write(page, "post", "accounts", {
    name: `B ${suffix}`,
    profileName: "B",
    url: `https://facebook.com/actor.${suffix}`,
  });
  const post = await write(page, "post", "posts", {
    title,
    content: "Nội dung đã đăng để chọn tương tác",
    tags: [],
    assetIds: [],
  });
  await write(page, "post", "schedules", {
    postId: post.id,
    scheduledAt: new Date(Date.now() - 10000).toISOString(),
    targets: [{ accountId: account.id, groupId: null }],
    idempotencyKey: randomUUID(),
    acknowledgeWarnings: true,
  });
  let task = (
    await (
      await page.request.get(`/api/v1/tasks?q=${encodeURIComponent(title)}`)
    ).json()
  ).items[0];
  task = await write(page, "patch", `tasks/${task.id}`, {
    action: "start",
    version: task.version,
    operationId: randomUUID(),
  });
  task = await write(page, "patch", `tasks/${task.id}`, {
    action: "record",
    status: "PUBLISHED",
    version: task.version,
    operationId: randomUUID(),
  });
  const recordedAt = task.recordedAt;
  const postUrl = `https://www.facebook.com/groups/fixture/posts/${suffix}`;
  const pairing = await write(page, "post", "desktop/pairing", {});
  const pairedResponse = await page.request.post("/api/desktop/pair", {
    data: { code: pairing.code, name: `Interaction PC ${suffix}` },
  });
  expect(pairedResponse.ok()).toBe(true);
  const paired = await pairedResponse.json(),
    instanceId = randomUUID();
  const headers = { Authorization: `Bearer ${paired.token}` };
  const desktop = async (route: string, data: unknown) => {
    const response = await page.request.post(`/api/desktop/${route}`, {
      headers,
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  try {
    await desktop("heartbeat", { instanceId });
    await write(page, "post", "desktop/commands", {
      accountId: actor.id,
      deviceId: paired.deviceId,
      kind: "LOGIN",
    });
    const command = await desktop("claim", { instanceId });
    await desktop(`commands/${command.id}`, {
      runId: command.runId,
      state: "READY",
      identityHash: createHash("sha256").update(suffix).digest("hex"),
      message: "Fixture ready",
    });
    await write(page, "patch", `desktop/connections/${actor.id}`, {
      action: "confirm",
    });
    await page.goto("/interactions");
    await expect(
      page.getByRole("heading", { name: "Bài đã đăng hôm nay", exact: true }),
    ).toBeVisible();
    const source = page
      .locator(".published-post-card")
      .filter({ hasText: title });
    await expect(
      source.getByText("Chưa lấy được link", { exact: true }),
    ).toBeVisible();
    await expect(
      source.getByRole("button", { name: "Chọn bài này", exact: true }),
    ).toBeDisabled();
    await source
      .getByRole("button", { name: "Lưu/sửa link", exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Link bài đã đăng").fill(postUrl);
    const savedLink = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/tasks/${task.id}/link`) &&
        response.request().method() === "PATCH",
    );
    await dialog
      .getByRole("button", { name: "Lưu link bài", exact: true })
      .click();
    expect((await savedLink).ok()).toBe(true);
    await dialog
      .getByRole("button", { name: "Đóng", exact: true })
      .last()
      .click();
    await expect(
      source.getByRole("link", { name: "Xem bài trên Facebook" }),
    ).toHaveAttribute("href", postUrl);
    expect(
      (await (await page.request.get(`/api/v1/tasks/${task.id}`)).json())
        .recordedAt,
    ).toBe(recordedAt);
    await source
      .getByRole("button", { name: "Chọn bài này", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Cách thực hiện")).toContainText(
      "Máy thực hiện một lần",
    );
    await dialog.getByLabel("Tài khoản thực hiện").click();
    await page
      .getByPlaceholder("Tìm trong danh sách…", { exact: true })
      .fill(suffix);
    await expect(
      page.getByRole("option", { name: `A ${suffix} — A`, exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("option", { name: `B ${suffix} — B`, exact: true })
      .click();
    await dialog
      .getByLabel("Bình luận cần duyệt")
      .fill(`Bình luận thử ${suffix}`);
    await dialog
      .getByRole("button", { name: "Lưu để duyệt", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const card = page
      .locator(".interaction-card")
      .filter({ hasText: `Bình luận thử ${suffix}` });
    await card
      .getByRole("button", { name: "Duyệt tương tác", exact: true })
      .click();
    await expect(
      page
        .getByText(
          "Xác nhận đúng Facebook và bật Cho phép tự tương tác trước khi duyệt.",
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    await page.goto("/desktop");
    const actorCard = page.locator(".desktop-account").filter({
      has: page.getByRole("heading", { name: `B ${suffix}`, exact: true }),
    });
    await expect(
      actorCard.getByLabel("Cho phép tự tương tác", { exact: true }),
    ).not.toBeChecked();
    await expect(actorCard.getByLabel("Tương tác tối đa/ngày")).toHaveValue(
      "10",
    );
    await expect(
      actorCard.getByLabel("Khoảng cách tương tác (phút)"),
    ).toHaveValue("5");
    await actorCard
      .getByLabel("Cho phép tự tương tác", { exact: true })
      .check();
    const savedSettings = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/v1/desktop/interaction-settings/${actor.id}`) &&
        response.request().method() === "PATCH",
    );
    await actorCard
      .getByRole("button", { name: "Lưu cài đặt tương tác", exact: true })
      .click();
    expect((await savedSettings).ok()).toBe(true);
    const status = await (await page.request.get("/api/v1/desktop")).json();
    expect(
      status.connections.find(
        (c: { accountId: string }) => c.accountId === actor.id,
      ),
    ).toMatchObject({ interactionEnabled: true, automationEnabled: false });
    await page.goto("/interactions");
    await card
      .getByRole("button", { name: "Duyệt tương tác", exact: true })
      .click();
    await expect(
      card.getByText("Đã duyệt · chờ giờ/máy", { exact: true }),
    ).toBeVisible();
    await expect(
      source.getByRole("button", { name: "Chọn bài này", exact: true }),
    ).toBeDisabled();
    await source
      .getByRole("button", { name: "Lưu/sửa link", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Link bài đã đăng")
      .fill(postUrl.replace(suffix, "changed"));
    await dialog
      .getByRole("button", { name: "Lưu link bài", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("Bỏ qua hoặc xử lý");
    await dialog
      .getByRole("button", { name: "Đóng", exact: true })
      .last()
      .click();
    await page
      .getByRole("heading", { name: "Bài đã đăng hôm nay", exact: true })
      .click();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
      timeout: 10000,
    });
    await page.screenshot({
      path: ".data/screenshots/published-interactions-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(source).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".data/screenshots/published-interactions-mobile.png",
      fullPage: true,
    });
  } finally {
    await write(page, "patch", `desktop/devices/${paired.deviceId}`, {
      action: "revoke",
    });
  }
});
