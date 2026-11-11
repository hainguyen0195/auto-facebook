import { expect, test } from "@playwright/test";

test("uses the switch API when choosing a second machine for a ready account", async ({
  page,
}) => {
  let active = "pc";
  let sentOpenCommand = false;
  await page.route("**/api/v1/accounts", (route) =>
    route.fulfill({
      json: [
        {
          id: "account",
          name: "Minh Phan",
          url: "https://www.facebook.com/example",
          profileName: "Facebook",
          status: "ACTIVE",
        },
      ],
    }),
  );
  await page.route("**/api/v1/desktop", (route) =>
    route.fulfill({
      json: {
        localConnectAvailable: false,
        devices: [
          {
            id: "pc",
            name: "Company Windows",
            online: true,
            paused: false,
            supportsInbox: true,
          },
          {
            id: "mac",
            name: "Home MacBook",
            online: true,
            paused: false,
            supportsInbox: true,
          },
        ],
        connections: [
          {
            id: "connection",
            accountId: "account",
            deviceId: active,
            state: active === "pc" ? "READY" : "CHECKING",
            automationEnabled: true,
            interactionEnabled: false,
            interactionDailyLimit: 10,
            interactionIntervalMinutes: 5,
            checkedAt: new Date().toISOString(),
            message: "",
          },
        ],
        commands: [],
      },
    }),
  );
  await page.route("**/api/v1/desktop/commands", (route) => {
    sentOpenCommand = true;
    return route.fulfill({ json: {} });
  });
  await page.route(
    "**/api/v1/desktop/connections/account/switch",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({ deviceId: "mac" });
      active = "mac";
      await route.fulfill({ json: { generation: 1, kind: "LOGIN" } });
    },
  );
  await page.goto("/desktop");
  const card = page.locator(".desktop-account").filter({
    has: page.getByRole("heading", { name: "Minh Phan", exact: true }),
  });
  await expect(
    card.getByRole("button", { name: "Mở Facebook", exact: true }),
  ).toBeVisible();
  await card.getByLabel("Máy đăng cho Minh Phan").click();
  await page.getByRole("option", { name: /Home MacBook/ }).click();
  await expect(
    card.getByRole("button", { name: "Kiểm tra phiên", exact: true }),
  ).toHaveCount(0);
  await card.getByRole("button", { name: "Dùng máy này", exact: true }).click();
  await expect(card.locator(".desktop-active-machine")).toContainText(
    "Home MacBook",
  );
  await expect(card).toContainText("Đang kiểm tra phiên trên máy được chọn");
  expect(sentOpenCommand).toBe(false);
});

test("selects a newly paired machine when the old connection was revoked", async ({
  page,
}) => {
  await page.route("**/api/v1/accounts", (route) =>
    route.fulfill({
      json: [
        {
          id: "a",
          name: "Reconnect account",
          url: "https://www.facebook.com/example",
          profileName: "Facebook",
          status: "ACTIVE",
        },
      ],
    }),
  );
  await page.route("**/api/v1/desktop", (route) =>
    route.fulfill({
      json: {
        devices: [
          {
            id: "new-pc",
            name: "New background app",
            online: true,
            paused: false,
            supportsInbox: true,
          },
        ],
        connections: [
          {
            id: "c",
            accountId: "a",
            deviceId: "revoked-pc",
            state: "DISCONNECTED",
            automationEnabled: false,
            interactionEnabled: false,
          },
        ],
        commands: [],
      },
    }),
  );
  let switched = false;
  await page.route("**/api/v1/desktop/connections/a/switch", (route) => {
    expect(route.request().postDataJSON()).toEqual({ deviceId: "new-pc" });
    switched = true;
    return route.fulfill({ json: {} });
  });
  await page.goto("/desktop");
  const card = page.locator(".desktop-account");
  await expect(card.getByLabel("Máy đăng cho Reconnect account")).toContainText(
    "New background app",
  );
  await card.getByRole("button", { name: "Dùng máy này", exact: true }).click();
  expect(switched).toBe(true);
});

test("offers a direct reinstall path after all devices are disconnected", async ({
  page,
}) => {
  await page.route("**/api/v1/accounts", (route) =>
    route.fulfill({
      json: [
        {
          id: "a",
          name: "Disconnected account",
          url: "https://www.facebook.com/example",
          profileName: "Facebook",
          status: "ACTIVE",
        },
      ],
    }),
  );
  await page.route("**/api/v1/desktop", (route) =>
    route.fulfill({
      json: {
        devices: [],
        connections: [
          {
            id: "c",
            accountId: "a",
            deviceId: "revoked-pc",
            state: "DISCONNECTED",
          },
        ],
        commands: [],
        windowsInstallerAvailable: true,
        macosInstallerAvailable: true,
      },
    }),
  );
  await page.goto("/desktop");
  await expect(page.getByText(/Nếu đã bấm Ngắt kết nối/)).toBeVisible();
  await page
    .locator(".desktop-account")
    .getByRole("link", { name: "Cài / kết nối lại máy đăng →" })
    .click();
  await expect(page).toHaveURL(/#desktop-install$/);
  await expect(
    page.getByRole("button", { name: "Tải bộ cài Windows" }),
  ).toBeVisible();
  await expect(page.locator(".desktop-installer-help")).not.toBeVisible();
  await page.getByText("Hướng dẫn cài & chuyển máy", { exact: true }).click();
  await expect(page.locator(".desktop-installer-help")).toBeVisible();
});
