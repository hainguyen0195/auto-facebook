import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { ZipReader, Uint8ArrayReader, TextWriter } from "@zip.js/zip.js";

test("downloads a one-time Windows installer and offers reconnect for an offline machine", async ({
  page,
}) => {
  const status = await (await page.request.get("/api/v1/desktop")).json();
  test.skip(
    !status.windowsInstallerAvailable,
    "Build the Windows bundle before running this test",
  );
  await page.route("**/api/v1/desktop", async (route) => {
    await route.fulfill({
      json: {
        ...status,
        localConnectAvailable: false,
        devices: [
          {
            id: "offline-device",
            name: "Windows công ty",
            paused: false,
            online: false,
            lastSeenAt: null,
            supportsInbox: true,
          },
        ],
      },
    });
  });
  await page.goto("/desktop");
  await expect(
    page.getByRole("heading", {
      name: "Windows",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Chờ kết nối để nhận lịch")).toBeVisible();
  await expect(
    page
      .locator(".desktop-device")
      .getByRole("link", { name: "Kết nối lại", exact: true }),
  ).toHaveAttribute("href", "nhipdang://start");
  await expect(
    page.getByText("Sẵn sàng nhận lịch", { exact: false }),
  ).toHaveCount(0);
  await page.screenshot({
    path: ".data/screenshots/desktop-background-setup.png",
    fullPage: true,
  });
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tải bộ cài Windows" }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe("Cai-Nhip-Dang.cmd");
  const installer = await readFile((await download.path())!, "utf8");
  expect(installer).toContain("http://localhost:3100");
  expect(installer).toContain("SHA256");
  const code = installer.match(/\$code = '([A-Za-z0-9_-]{43})'/)?.[1];
  expect(code).toBeTruthy();
  const paired = await page.request.post("/api/desktop/pair", {
    data: { code, name: "Installer test PC" },
  });
  expect(paired.ok()).toBe(true);
  const device = await paired.json();
  try {
    const checked = await page.request.get("/api/desktop/status", {
      headers: { Authorization: `Bearer ${device.token}` },
    });
    expect(checked.ok()).toBe(true);
    expect(await checked.json()).toEqual({
      id: device.deviceId,
      workspaceId: device.workspaceId,
    });
    const reused = await page.request.post("/api/desktop/pair", {
      data: { code, name: "Reused installer" },
    });
    expect(reused.status()).toBe(401);
  } finally {
    await page.request.patch(`/api/v1/desktop/devices/${device.deviceId}`, {
      headers: { Origin: "http://localhost:3100" },
      data: { action: "revoke" },
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Tải bộ cài Windows" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".data/screenshots/desktop-background-mobile.png",
    fullPage: true,
  });
});

test("protects installer generation and device status", async ({
  page,
  browser,
}) => {
  const anonymous = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  try {
    for (const platform of ["windows", "macos"]) {
      const response = await anonymous.request.post(
        `http://localhost:3100/api/v1/desktop/installer/${platform}`,
        {
          headers: { Origin: "http://localhost:3100" },
          data: {},
        },
      );
      expect(response.status()).toBe(401);
    }
    const deviceStatus = await anonymous.request.get(
      "http://localhost:3100/api/desktop/status",
    );
    expect(deviceStatus.status()).toBe(401);
  } finally {
    await anonymous.close();
  }
  for (const platform of ["windows", "macos"]) {
    const foreign = await page.request.post(
      `/api/v1/desktop/installer/${platform}`,
      {
        headers: { Origin: "https://other.example" },
        data: {},
      },
    );
    expect(foreign.status()).toBe(403);
  }
});

test("downloads an executable MacBook installer bound to the signed-in workspace", async ({
  page,
  browser,
}) => {
  const status = await (await page.request.get("/api/v1/desktop")).json();
  expect(status.macosInstallerAvailable).toBe(true);
  await page.route("**/api/v1/desktop", (route) =>
    route.fulfill({ json: { ...status, localConnectAvailable: false } }),
  );
  await page.goto("/desktop");
  await expect(
    page.getByRole("heading", {
      name: "MacBook",
      exact: true,
    }),
  ).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tải bộ cài MacBook" }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toBe("Cai-Nhip-Dang-Mac.zip");
  const reader = new ZipReader(
    new Uint8ArrayReader(await readFile((await file.path())!)),
    { useWebWorkers: false },
  );
  let script: string;
  try {
    const command = (await reader.getEntries()).find(
      (e) => e.filename === "Cai-Nhip-Dang.command",
    )!;
    if (command.directory) throw new Error("Installer must be a file");
    expect(command.unixMode! & 0o777).toBe(0o755);
    script = await command.getData!(new TextWriter());
  } finally {
    await reader.close();
  }
  const code = script.match(/^code='([A-Za-z0-9_-]{43})'$/m)?.[1];
  const workspaceId = script.match(/^workspace='([A-Za-z0-9_-]+)'$/m)?.[1];
  expect(code).toBeTruthy();
  expect(workspaceId).toBeTruthy();
  const paired = await page.request.post("/api/desktop/pair", {
    data: { code, name: "Installer test Mac" },
  });
  expect(paired.ok()).toBe(true);
  const device = await paired.json();
  const other = await browser.newContext({
    storageState: ".data/e2e/other.json",
  });
  try {
    expect(device.workspaceId).toBe(workspaceId);
    expect(script).not.toContain(device.token);
    const otherStatus = await (
      await other.request.get("http://localhost:3100/api/v1/desktop")
    ).json();
    expect(
      otherStatus.devices.some((d: { id: string }) => d.id === device.deviceId),
    ).toBe(false);
    const reused = await page.request.post("/api/desktop/pair", {
      data: { code, name: "Reused Mac installer" },
    });
    expect(reused.status()).toBe(401);
  } finally {
    await other.close();
    await page.request.patch(`/api/v1/desktop/devices/${device.deviceId}`, {
      headers: { Origin: "http://localhost:3100" },
      data: { action: "revoke" },
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Tải bộ cài MacBook" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".data/screenshots/desktop-macos-mobile.png",
    fullPage: true,
  });
});
