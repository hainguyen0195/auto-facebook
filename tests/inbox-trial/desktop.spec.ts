import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { FacebookInboxReader } from "../../src/desktop/inbox";
import type { FacebookDesktop } from "../../src/desktop/facebook";

const identity = createHash("sha256").update("12345").digest("hex");
const panel =
  '<div role="dialog" aria-label="Messenger"><div role="row" aria-label="Tin nhắn chưa đọc"><a href="/messages/e2ee/t/123/"><strong>Customer</strong><div>Preview</div></a></div></div>';

test("uses the posting context in a separate tab and never opens a conversation", async ({
  context,
  page,
}) => {
  let mode = "online";
  let threadOpened = false;
  let homeNavigations = 0;
  await context.route("**/*", (route) => {
    if (
      route.request().isNavigationRequest() &&
      route.request().url() === "https://www.facebook.com/"
    )
      homeNavigations++;
    if (route.request().url().includes("/messages/")) threadOpened = true;
    if (mode === "offline") return route.abort();
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: mode === "unsupported" ? "<p>Loading</p>" : panel,
    });
  });
  await context.addCookies([
    {
      name: "c_user",
      value: "12345",
      domain: ".facebook.com",
      path: "/",
      secure: true,
    },
  ]);
  await page.goto("https://www.facebook.com/groups/posting-target");
  let postingTabActivations = 0;
  const bringToFront = page.bringToFront.bind(page);
  page.bringToFront = async () => {
    postingTabActivations++;
    await bringToFront();
  };
  const reader = new FacebookInboxReader({
    openContext: () =>
      context.pages().some((p) => !p.isClosed()) ? context : null,
  } as unknown as FacebookDesktop);
  expect(await reader.read("account", identity)).toMatchObject({
    status: "ONLINE",
    identityHash: identity,
    conversations: [{ id: "123", preview: "Preview", unread: true }],
  });
  expect(page.url()).toBe("https://www.facebook.com/groups/posting-target");
  expect(context.pages()).toHaveLength(2);
  expect(threadOpened).toBe(false);
  expect(postingTabActivations).toBe(0);
  const observer = context.pages().find((p) => p !== page)!;
  await observer.setContent(panel.replace("Preview", "Updated preview"));
  expect(await reader.read("account", identity)).toMatchObject({
    status: "ONLINE",
    conversations: [{ preview: "Updated preview" }],
  });
  expect(homeNavigations).toBe(1);
  await observer.setContent(
    '<div role="dialog">Messenger PIN<input type="password" aria-label="PIN"></div>',
  );
  expect((await reader.read("account", identity)).status).toBe("PIN_REQUIRED");
  expect(await observer.locator('input[aria-label="PIN"]').count()).toBe(1);
  await observer.setContent(panel);
  mode = "offline";
  expect((await reader.read("account", identity)).status).toBe("OFFLINE");
  mode = "online";
  expect((await reader.read("account", identity)).status).toBe("ONLINE");
  mode = "unsupported";
  await context
    .pages()
    .find((p) => p !== page)!
    .setContent("<p>Loading</p>");
  expect((await reader.read("account", identity)).status).toBe("UNSUPPORTED");
  mode = "offline";
  expect((await reader.read("account", identity)).status).toBe("OFFLINE");
  expect(page.isClosed()).toBe(false);
  expect(page.url()).toContain("/groups/posting-target");
});

test("stops on wrong identity, logout, checkpoint and an opened thread", async ({
  context,
  page,
}) => {
  await context.route("**/*", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: panel }),
  );
  await context.addCookies([
    {
      name: "c_user",
      value: "12345",
      domain: ".facebook.com",
      path: "/",
      secure: true,
    },
  ]);
  const reader = new FacebookInboxReader({
    openContext: () =>
      context.pages().some((p) => !p.isClosed()) ? context : null,
  } as unknown as FacebookDesktop);
  expect((await reader.read("account", identity)).status).toBe("ONLINE");
  const observer = context.pages().find((p) => p !== page)!;
  await observer.goto("https://www.facebook.com/messages/e2ee/t/123/");
  expect((await reader.read("account", identity)).status).toBe("UNSAFE_VIEW");
  await observer.goto("https://www.facebook.com/checkpoint");
  expect((await reader.read("account", identity)).status).toBe("CHALLENGE");
  await observer.goto("https://www.facebook.com/");
  await context.addCookies([
    {
      name: "c_user",
      value: "67890",
      domain: ".facebook.com",
      path: "/",
      secure: true,
    },
  ]);
  expect((await reader.read("account", identity)).status).toBe(
    "WRONG_IDENTITY",
  );
  await context.clearCookies();
  expect((await reader.read("account", identity)).status).toBe(
    "LOGIN_REQUIRED",
  );
  await reader.releaseExcept(new Set());
  expect(observer.isClosed()).toBe(true);
  expect(page.isClosed()).toBe(false);
});

test("does not recreate a work tab or reopen tabs after the user closes them", async ({
  context,
  page,
}) => {
  await context.route("**/*", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: panel }),
  );
  await context.addCookies([
    {
      name: "c_user",
      value: "12345",
      domain: ".facebook.com",
      path: "/",
      secure: true,
    },
  ]);
  await page.goto("https://www.facebook.com/groups/posting-target");
  const reader = new FacebookInboxReader({
    openContext: () =>
      context.pages().some((p) => !p.isClosed()) ? context : null,
  } as unknown as FacebookDesktop);
  expect((await reader.read("account", identity)).status).toBe("ONLINE");
  const observer = context.pages().find((p) => p !== page)!;
  await page.close();
  for (let i = 0; i < 3; i++)
    expect((await reader.read("account", identity)).status).toBe("ONLINE");
  expect(context.pages()).toEqual([observer]);
  await observer.close();
  for (let i = 0; i < 3; i++)
    expect((await reader.read("account", identity)).status).toBe("STOPPED");
  expect(context.pages()).toHaveLength(0);
});
