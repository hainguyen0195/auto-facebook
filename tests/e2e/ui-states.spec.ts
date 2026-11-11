import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";

const origin = "http://localhost:3100";
const screens = [
  { name: "today", url: "/", resource: "dashboard" },
  { name: "accounts", url: "/accounts", resource: "accounts" },
  { name: "groups", url: "/groups", resource: "groups" },
  { name: "posts", url: "/posts", resource: "posts" },
  { name: "calendar-month", url: "/calendar", resource: "calendar" },
  { name: "calendar-week", url: "/calendar?view=week", resource: "calendar" },
  { name: "calendar-list", url: "/calendar?view=list", resource: "tasks" },
  { name: "history", url: "/history", resource: "tasks" },
  { name: "interactions", url: "/interactions", resource: "interactions" },
  { name: "desktop", url: "/desktop", resource: "desktop" },
  { name: "settings", url: "/settings", resource: "bootstrap" },
];

async function write(
  request: APIRequestContext,
  resource: string,
  data: unknown,
  method = "POST",
) {
  const response = await request.fetch(`/api/v1/${resource}`, {
    method,
    headers: { Origin: origin },
    data,
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

test.beforeAll(async ({ request }) => {
  const suffix = randomUUID().slice(0, 8);
  const account = await write(request, "accounts", {
    name: `Shop giao diện ${suffix}`,
    url: `https://facebook.com/ui.${suffix}`,
    profileName: "Chrome — Shop giao diện",
  });
  const group = await write(request, "groups", {
    name: `Hội nhóm giao diện ${suffix}`,
    url: `https://facebook.com/groups/ui.${suffix}`,
    tags: ["Khách hàng"],
    accountIds: [account.id],
  });
  const post = await write(request, "posts", {
    title: `Bộ sưu tập mới ${suffix}`,
    content: "Hàng mới của shop. Nhắn tin để được tư vấn sản phẩm phù hợp.",
    tags: ["Hàng mới"],
    assetIds: [],
  });
  await write(request, "schedules", {
    postId: post.id,
    scheduledAt: new Date(Date.now() - 1000).toISOString(),
    targets: [{ accountId: account.id, groupId: group.id }],
    acknowledgeWarnings: true,
    idempotencyKey: randomUUID(),
  });
  const tasks = await (
    await request.get(`/api/v1/tasks?q=${encodeURIComponent(post.title)}`)
  ).json();
  const started = await write(
    request,
    `tasks/${tasks.items[0].id}`,
    {
      action: "start",
      version: tasks.items[0].version,
      operationId: randomUUID(),
    },
    "PATCH",
  );
  await write(
    request,
    `tasks/${started.id}`,
    {
      action: "record",
      status: "PENDING_REVIEW",
      version: started.version,
      operationId: randomUUID(),
    },
    "PATCH",
  );
  await write(request, "interactions", {
    accountId: account.id,
    postUrl: `${group.url}/posts/${suffix}`,
    kind: "COMMENT",
    content: "Shop gửi thông tin sản phẩm bạn cần nhé.",
    scheduledAt: new Date().toISOString(),
  });
});

async function fitsViewport(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
}

for (const screen of screens) {
  for (const width of [1440, 390]) {
    test(`${screen.name} shows loading then content at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/v1/**", async (route) => {
        await gate;
        await route.continue();
      });
      try {
        await page.goto(screen.url);
        await expect(page.locator(".loading-skeleton").first()).toBeVisible();
        await expect(page.locator(".loading-skeleton").first()).toHaveAttribute(
          "aria-busy",
          "true",
        );
        await fitsViewport(page);
        await page.screenshot({
          path: `.data/screenshots/audit/${screen.name}-${width}-loading.png`,
        });
      } finally {
        release();
      }
      await expect(page.locator(".loading-skeleton")).toHaveCount(0);
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
      await fitsViewport(page);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `.data/screenshots/audit/${screen.name}-${width}-ready.png`,
      });
    });
  }
}

for (const screen of screens.filter(
  (screen) => !["calendar-month", "calendar-week"].includes(screen.name),
)) {
  test(`${screen.name} reports a failed request and recovers on retry`, async ({
    page,
  }) => {
    let fail = true;
    const message = "Kết nối kiểm thử bị gián đoạn.";
    await page.route(`**/api/v1/${screen.resource}*`, async (route) => {
      if (fail) await route.fulfill({ status: 503, json: { error: message } });
      else await route.continue();
    });
    await page.goto(screen.url);
    await expect(
      page.getByRole("alert").filter({ hasText: message }).first(),
    ).toBeVisible();
    await expect(page.locator(".loading-skeleton")).toHaveCount(0);
    fail = false;
    await page
      .getByRole("alert")
      .filter({ hasText: message })
      .first()
      .getByRole("button", { name: "Thử lại" })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: message }),
    ).toHaveCount(0);
    await expect(page.locator("h1")).toBeVisible();
    await fitsViewport(page);
  });
}

test("notification loading never appears as an empty inbox", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/dashboard", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto("/groups");
    await page.getByRole("button", { name: /^Thông báo/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("status", { name: "Đang tải nhắc việc" }),
    ).toBeVisible();
    await expect(dialog.getByText("Bạn đã xem hết nhắc việc")).toHaveCount(0);
  } finally {
    release();
  }
  await expect(
    page.getByRole("dialog").locator(".loading-skeleton"),
  ).toHaveCount(0);
});

test("desktop distinguishes account failure from an empty account list", async ({
  page,
}) => {
  await page.route("**/api/v1/accounts", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Không tải được tài khoản." },
    }),
  );
  await page.goto("/desktop");
  await expect(
    page.getByRole("alert").filter({ hasText: "Không tải được tài khoản." }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Thêm tài khoản Facebook tại mục Tài khoản trước khi đăng nhập.",
    ),
  ).toHaveCount(0);
});

test("Facebook status stays unknown until connection data arrives", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/desktop", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto("/accounts");
    await expect(
      page.getByRole("status", { name: "Đang tải kết nối Facebook" }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Chưa kết nối Facebook", { exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
  }
  await expect(
    page.getByRole("status", { name: "Đang tải kết nối Facebook" }),
  ).toHaveCount(0);
});

test("login keeps its submit button busy until authentication finishes", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/sign-in/email", async (route) => {
    await gate;
    await route.fulfill({
      status: 401,
      json: { message: "Invalid credentials" },
    });
  });
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${origin}/login`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await fitsViewport(page);
      await page.screenshot({
        path: `.data/screenshots/audit/login-${width}-ready.png`,
      });
    }
    await page
      .getByLabel("Email", { exact: true })
      .fill("invalid@tests.nhipdang.local");
    await page.getByLabel("Mật khẩu", { exact: true }).fill("test-password");
    const submit = page.getByRole("button", { name: "Vào góc làm việc" });
    await submit.click();
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAttribute("aria-busy", "true");
    release();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(submit).toBeEnabled();
  } finally {
    release();
    await context.close();
  }
});
