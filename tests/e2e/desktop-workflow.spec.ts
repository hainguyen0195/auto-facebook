import { test, expect } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
const origin = "http://localhost:3100";

test("connects a local account without a pairing dialog or terminal", async ({
  page,
}) => {
  const status = await (await page.request.get("/api/v1/desktop")).json();
  test.skip(
    !status.localConnectAvailable,
    "Requires a local Windows installation",
  );
  const bootstrap = await (await page.request.get("/api/v1/bootstrap")).json();
  const workspaceId = bootstrap.workspace.id as string;
  const root = path.resolve(
    ".data/desktop",
    `local-${createHash("sha256").update(workspaceId).digest("hex")}`,
  );
  const suffix = randomUUID().slice(0, 8);
  const name = `Kết nối trực tiếp ${suffix}`;
  const created = await page.request.post("/api/v1/accounts", {
    headers: { Origin: origin },
    data: {
      name,
      profileName: "Local connection test",
      url: `https://facebook.com/local.${suffix}`,
    },
  });
  expect(created.ok()).toBe(true);
  let deviceId: string | undefined;
  try {
    await page.goto("/accounts");
    const card = page
      .locator(".account-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    const connected = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/desktop/connect") &&
        response.request().method() === "POST",
    );
    await card
      .getByRole("button", { name: "Kết nối Facebook", exact: true })
      .click();
    const response = await connected;
    const command = await response.json();
    expect(response.ok(), JSON.stringify(command)).toBe(true);
    deviceId = command.deviceId;
    expect(command.kind).toBe("LOGIN");
    expect(command.workspaceId).toBe(workspaceId);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const after = await (await page.request.get("/api/v1/desktop")).json();
    expect(after.devices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: deviceId, online: true }),
      ]),
    );
  } finally {
    if (deviceId)
      await page.request.patch(`/api/v1/desktop/devices/${deviceId}`, {
        headers: { Origin: origin },
        data: { action: "revoke" },
      });
    const pid = Number(
      await readFile(path.join(root, "runner.lock"), "utf8").catch(() => ""),
    );
    if (pid > 0) {
      try {
        execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {
        /* Runner may already have stopped. */
      }
    }
  }
});

test("connect a desktop, check and confirm Facebook identity, then pause and revoke it", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const name = `Facebook kết nối ${suffix}`;
  const response = await page.request.post("/api/v1/accounts", {
    headers: { Origin: origin },
    data: {
      name,
      url: `https://facebook.com/bridge.${suffix}`,
      profileName: "Shop kết nối",
    },
  });
  expect(response.ok()).toBe(true);
  const account = await response.json();
  await page.goto("/desktop");
  await page.getByRole("button", { name: /Kết nối máy (mới|khác)/ }).click();
  const pairingDialog = page.getByRole("dialog");
  const command = await pairingDialog.getByLabel("Lệnh kết nối").inputValue();
  const code = command.match(/--code "([A-Za-z0-9_-]+)"/)?.[1];
  expect(code).toBeTruthy();
  const pairedResponse = await page.request.post("/api/desktop/pair", {
    data: { code, name: `Máy thử ${suffix}` },
  });
  expect(pairedResponse.ok()).toBe(true);
  const paired = await pairedResponse.json();
  const headers = { Authorization: `Bearer ${paired.token}` };
  const instanceId = randomUUID();
  expect(
    (
      await page.request.post("/api/desktop/heartbeat", {
        headers,
        data: { instanceId },
      })
    ).ok(),
  ).toBe(true);
  await pairingDialog
    .getByRole("button", { name: "Đóng", exact: true })
    .click();
  const card = page
    .locator(".desktop-account")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(
    card.locator(".field-hint").filter({ hasText: `Máy thử ${suffix}` }),
  ).toContainText("đang trực tuyến", { timeout: 10_000 });
  await expect(
    card.getByRole("button", { name: "Kết nối Facebook", exact: true }),
  ).toBeEnabled({ timeout: 10_000 });
  const commandSent = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/desktop/commands") &&
      response.request().method() === "POST",
  );
  await card
    .getByRole("button", { name: "Kết nối Facebook", exact: true })
    .click();
  expect((await commandSent).ok()).toBe(true);
  const claim = await page.request.post("/api/desktop/claim", {
    headers,
    data: { instanceId },
  });
  const work = await claim.json();
  expect(work.kind).toBe("LOGIN");
  expect(work.account.id).toBe(account.id);
  expect(
    (
      await page.request.post(`/api/desktop/commands/${work.id}`, {
        headers,
        data: {
          runId: work.runId,
          state: "LOGIN_REQUIRED",
          message: "Đăng nhập trong cửa sổ Facebook vừa mở.",
        },
      })
    ).ok(),
  ).toBe(true);
  await expect(
    card.getByRole("button", { name: "Kiểm tra phiên", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.post(`/api/desktop/sessions/${account.id}`, {
        headers,
        data: {
          instanceId,
          state: "READY",
          identityHash: createHash("sha256").update(suffix).digest("hex"),
          message: "Đã tự nhận biết phiên Facebook sau khi đăng nhập.",
        },
      })
    ).ok(),
  ).toBe(true);
  await expect(
    card.getByRole("button", { name: "Xác nhận đúng tài khoản", exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await card
    .getByRole("button", { name: "Xác nhận đúng tài khoản", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Đúng tài khoản này", exact: true })
    .click();
  await card
    .getByRole("checkbox", { name: "Cho phép tự đăng bài đã lên lịch" })
    .check();
  await expect(
    card.getByRole("checkbox", { name: "Cho phép tự đăng bài đã lên lịch" }),
  ).toBeChecked();
  await expect(
    card.getByRole("checkbox", { name: "Cho phép tự đăng bài đã lên lịch" }),
  ).toBeEnabled();
  const reconnect = await page.request.post("/api/v1/desktop/commands", {
    headers: { Origin: origin },
    data: { accountId: account.id, deviceId: paired.deviceId, kind: "LOGIN" },
  });
  expect(reconnect.ok()).toBe(true);
  const restoredWork = await (
    await page.request.post("/api/desktop/claim", {
      headers,
      data: { instanceId },
    })
  ).json();
  expect(restoredWork.id).toBe((await reconnect.json()).id);
  expect(
    (
      await page.request.post(`/api/desktop/commands/${restoredWork.id}`, {
        headers,
        data: {
          runId: restoredWork.runId,
          state: "READY",
          identityHash: createHash("sha256").update(suffix).digest("hex"),
          message: "Restored Facebook session",
        },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await expect(
    card.getByText("Đã kết nối Facebook", { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Xác nhận đúng tài khoản", exact: true }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("checkbox", { name: "Cho phép tự đăng bài đã lên lịch" }),
  ).toBeChecked();
  await expect(page.locator(".skip-link")).not.toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: ".data/screenshots/desktop-connected.png",
    fullPage: true,
  });
  const device = page
    .locator(".desktop-device")
    .filter({ hasText: `Máy thử ${suffix}` });
  await device.getByRole("button", { name: "Tạm dừng", exact: true }).click();
  await expect(
    device.getByRole("button", { name: "Tiếp tục", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: ".data/screenshots/mobile-desktop.png",
    fullPage: true,
  });
  await device
    .getByRole("button", { name: "Ngắt kết nối", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ngắt kết nối", exact: true })
    .click();
  await expect(device).toHaveCount(0);
  expect(
    (
      await page.request.post("/api/desktop/heartbeat", {
        headers,
        data: { instanceId },
      })
    ).status(),
  ).toBe(401);
});

test("interaction choices, cross-account duplicate detection and explicit completion", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const response = await page.request.post("/api/v1/accounts", {
    headers: { Origin: origin },
    data: {
      name: `Tương tác ${suffix}`,
      url: `https://facebook.com/interaction.${suffix}`,
      profileName: "Shop tương tác",
    },
  });
  expect(response.ok()).toBe(true);
  const account = await response.json();
  const postId = `post${suffix}`;
  await page.goto("/interactions");
  await page
    .getByRole("button", { name: "Thêm tương tác", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tài khoản thực hiện").click();
  await page
    .getByRole("option", {
      name: `Tương tác ${suffix} — Shop tương tác`,
      exact: true,
    })
    .click();
  await dialog
    .getByLabel("Link bài viết Facebook")
    .fill(`https://www.facebook.com/groups/fixture/posts/${postId}`);
  await dialog.getByLabel("Loại tương tác").click();
  await page.getByRole("option", { name: "Thả cảm xúc", exact: true }).click();
  await dialog.getByLabel("Cảm xúc").click();
  await expect(page.getByRole("option")).toHaveCount(7);
  await page.keyboard.press("Escape");
  await dialog.getByLabel("Loại tương tác").click();
  await page.getByRole("option", { name: "Bình luận up", exact: true }).click();
  await expect(
    dialog.getByText("Nội dung chuẩn bị là “up”.", { exact: false }),
  ).toBeVisible();
  await dialog.getByLabel("Loại tương tác").click();
  await page.getByRole("option", { name: "Bình luận", exact: true }).click();
  await dialog
    .getByLabel("Bình luận cần duyệt")
    .fill(`Thông tin tư vấn ${suffix}`);
  await dialog
    .getByRole("button", { name: "Lưu để duyệt", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const card = page
    .locator(".interaction-card")
    .filter({ hasText: `Thông tin tư vấn ${suffix}` });
  await card
    .getByRole("button", { name: "Duyệt tương tác", exact: true })
    .click();
  await card.getByRole("button", { name: "Mở công việc", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Xác nhận đã thực hiện", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Xác nhận đã thực hiện", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    card.getByText("Bạn xác nhận đã thực hiện", { exact: true }),
  ).toBeVisible();
  const duplicate = await page.request.post("/api/v1/interactions", {
    headers: { Origin: origin },
    data: {
      accountId: account.id,
      postUrl: `https://m.facebook.com/groups/fixture/permalink/${postId}/?ref=x`,
      kind: "BUMP",
      scheduledAt: new Date().toISOString(),
    },
  });
  expect(duplicate.status()).toBe(409);
  await page.screenshot({
    path: ".data/screenshots/desktop-interactions.png",
    fullPage: true,
  });
});
