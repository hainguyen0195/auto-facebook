import { test, expect } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";

test("shows a safe failure, retries from the UI and displays the persisted backoff", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const title = `Thử lại khi mạng chậm ${suffix}`;
  const app = async (
    method: "post" | "patch",
    resource: string,
    data: unknown,
  ) => {
    const response = await page.request[method](`/api/v1/${resource}`, {
      headers: { Origin: "http://localhost:3100" },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const account = await app("post", "accounts", {
    name: title,
    profileName: "Retry UI fixture",
    url: `facebook.com/retryui.${suffix}`,
    quietStart: 0,
    quietEnd: 0,
    postIntervalMinutes: 0,
  });
  const post = await app("post", "posts", {
    title,
    content: "Controlled retry fixture",
    tags: [],
    assetIds: [],
  });
  const code = await app("post", "desktop/pairing", {});
  const paired = await (
    await page.request.post("/api/desktop/pair", {
      data: { code: code.code, name: `Retry PC ${suffix}` },
    })
  ).json();
  const instanceId = randomUUID();
  const desktop = async (resource: string, data: unknown) => {
    const response = await page.request.post(`/api/desktop/${resource}`, {
      headers: { Authorization: `Bearer ${paired.token}` },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  try {
    await desktop("heartbeat", { instanceId });
    await app("post", "desktop/commands", {
      accountId: account.id,
      deviceId: paired.deviceId,
      kind: "LOGIN",
    });
    const login = await desktop("claim", { instanceId });
    await desktop(`commands/${login.id}`, {
      runId: login.runId,
      state: "READY",
      identityHash: createHash("sha256").update(suffix).digest("hex"),
      message: "Fixture session ready",
    });
    await app("patch", `desktop/connections/${account.id}`, {
      action: "confirm",
    });
    await app("patch", `desktop/connections/${account.id}`, {
      action: "enable",
    });
    await app("post", "schedules", {
      executionMode: "AUTOMATIC",
      postId: post.id,
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
      targets: [{ accountId: account.id, groupId: null }],
      idempotencyKey: randomUUID(),
      acknowledgeWarnings: true,
    });
    const first = await desktop("claim", { instanceId });
    await desktop(`tasks/${first.id}/result`, {
      runId: first.runId,
      outcome: "FAILED",
      message: "Destination unavailable before submission",
      failure: { stage: "composer", code: "OTHER", submitAttempted: false },
    });
    await page.goto(`/calendar?view=list&q=${encodeURIComponent(title)}`);
    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row.getByText("Chưa gửi được", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Mở", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/Các bài khác vẫn tiếp tục/)).toBeVisible();
    await dialog.getByRole("button", { name: "Thử lại", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Thử lại", exact: true }),
    ).toHaveCount(0);
    const second = await desktop("claim", { instanceId });
    expect(second.id).toBe(first.id);
    expect(second.runId).not.toBe(first.runId);
    await desktop(`tasks/${second.id}/result`, {
      runId: second.runId,
      outcome: "FAILED",
      message: "Slow composer",
      failure: { stage: "composer", code: "TIMEOUT", submitAttempted: false },
    });
    await page.reload();
    await expect(row.getByText("Chờ thử lại", { exact: true })).toBeVisible();
    await expect(row).toContainText("Thử lại lúc");
    await row.getByRole("button", { name: "Mở", exact: true }).click();
    await expect(dialog.getByText(/Đang chờ thử lại lúc/)).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Thử lại", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: ".data/screenshots/automatic-retry-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: ".data/screenshots/automatic-retry-mobile.png",
      fullPage: true,
    });
  } finally {
    await app("patch", `desktop/devices/${paired.deviceId}`, {
      action: "revoke",
    });
  }
});
