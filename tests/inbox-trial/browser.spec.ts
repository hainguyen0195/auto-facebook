import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  checkIdentity,
  confirmReadStates,
  openMessengerPanel,
  readInboxList,
} from "../../src/inbox-trial/browser";

const fixture = (content: string) =>
  `<!doctype html><html lang="vi"><body><div role="dialog" aria-label="Messenger"><h2>Messenger</h2>${content}</div><script>document.addEventListener('click',e=>{if(e.target.closest('a')){window.threadClicked=true;e.preventDefault()}})</script></body></html>`;
const row = (id: string, label: string, preview = "Khách hỏi giá") =>
  `<div role="row" aria-label="${label}"><a href="/messages/e2ee/t/${id}/"><strong>Khách ${id}</strong><div>${preview}</div><div>2 phút trước</div></a></div>`;

async function load(
  page: Page,
  html: string,
  url = "https://www.facebook.com/",
) {
  // No test can reach Facebook or use a real account/session.
  await page.route("**/*", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
  );
  await page.goto(url);
}

test("reads only visible list rows, strips relative time and never opens a thread", async ({
  page,
}) => {
  await load(
    page,
    fixture(
      row("123", "Tin nhắn chưa đọc") +
        row("456", "Đã đọc") +
        `<div style="display:none">${row("789", "Unread")}</div>`,
    ),
  );
  const result = await readInboxList(page);
  expect(result.recognized).toBe(true);
  expect(result.rows).toMatchObject([
    { id: "123", name: "Khách 123", preview: "Khách hỏi giá", unread: true },
    { id: "456", name: "Khách 456", preview: "Khách hỏi giá", unread: false },
  ]);
  expect(
    await page.evaluate(
      () => (window as Window & { threadClicked?: boolean }).threadClicked,
    ),
  ).toBeUndefined();
  expect(page.url()).toBe("https://www.facebook.com/");
});

test("keeps unknown state and rejects mark-as-unread actions as evidence", async ({
  page,
}) => {
  await load(
    page,
    fixture(row("123", "Mark as unread") + row("456", "Đánh dấu là chưa đọc")),
  );
  expect((await readInboxList(page)).rows.map((r) => r.unread)).toEqual([
    null,
    null,
  ]);
});

test("recognizes Facebook's unread preview prefix without using activity as the contact name", async ({
  page,
}) => {
  await load(
    page,
    fixture(`
    <div role="row"><a href="/messages/e2ee/t/123/">
      <div>Đang hoạt động</div><div>Nhi Phạm</div>
      <div>Tin nhắn chưa đọc: (Y)</div><div>2 phút trước</div>
    </a></div>
    <div role="row"><a href="/messages/t/456/">
      <div>Active now</div><div>Customer</div>
      <div>Unread message: Hello</div><div>2m</div>
    </a></div>
    <div role="row"><a href="/messages/t/789/">
      <div>Nhóm chat: Khách hàng</div><div>Đánh dấu là chưa đọc</div>
    </a></div>`),
  );
  expect((await readInboxList(page)).rows).toMatchObject([
    { id: "123", name: "Nhi Phạm", preview: "(Y)", unread: true },
    { id: "456", name: "Customer", preview: "Hello", unread: true },
    {
      id: "789",
      name: "Khách hàng",
      preview: "Đánh dấu là chưa đọc",
      unread: null,
    },
  ]);
  expect(
    await page.evaluate(
      () => (window as Window & { threadClicked?: boolean }).threadClicked,
    ),
  ).toBeUndefined();
});

test("does not treat an empty, loading or unrelated list as zero unread", async ({
  page,
}) => {
  await load(
    page,
    `<nav>${row("123", "Unread")}</nav><div role="dialog" aria-label="Messenger">Loading</div>`,
  );
  expect((await readInboxList(page)).recognized).toBe(false);
});

test("extracts message age from Facebook timestamps without using scan time for unknown history", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-09T14:00:00Z"));
  await load(
    page,
    fixture(
      ["5 phút trước", "1 ngày trước", "2 ngày trước", "1 week ago", "2h", ""]
        .map(
          (time, index) =>
            `<div role="row"><a href="/messages/t/${index}/"><strong>Customer ${index}</strong><div>Hello</div><div>${time}</div></a></div>`,
        )
        .join("") +
        '<div role="row"><a href="/messages/t/iso/"><strong>Timestamp</strong><time datetime="2026-11-09T12:00:00Z">Today</time></a></div>',
    ),
  );
  expect(
    (await readInboxList(page)).rows.map((r) => r.lastMessageAt ?? null),
  ).toEqual([
    "2026-11-09T13:55:00.000Z",
    "2026-11-08T14:00:00.000Z",
    "2026-11-07T14:00:00.000Z",
    "2026-11-02T14:00:00.000Z",
    "2026-11-09T12:00:00.000Z",
    null,
    "2026-11-09T12:00:00.000Z",
  ]);
});

const menuFixture = (action: string) =>
  fixture(`
  <div role="row"><a href="/messages/e2ee/t/123/"><strong>Customer</strong><div id="preview">Hello</div></a>
  <button aria-label="Lựa chọn khác cho Customer" style="width:20px;height:20px" id="options"></button></div>
  <script>
    document.querySelector('#options').onclick=()=>{
      window.menuOpened=true;
      const menu=document.createElement('div');menu.role='menu';menu.id='menu';
      const action=document.createElement('button');action.textContent=${JSON.stringify(action)};
      action.onclick=()=>window.actionClicked=true;menu.append(action);document.body.append(menu);
      if(window.changePreview)document.querySelector('#preview').textContent='New message';
    };
    document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('#menu')?.remove()});
  </script>`);

for (const action of ["Đánh dấu là chưa đọc", "Mark as unread"]) {
  test(`confirms read from ${action} without clicking it or opening a thread`, async ({
    page,
  }) => {
    await load(page, menuFixture(action));
    const result = await confirmReadStates(page, await readInboxList(page), [
      "123",
    ]);
    expect(result.rows[0].unread).toBe(false);
    expect(await page.locator("#menu").count()).toBe(0);
    expect(
      await page.evaluate(() => ({
        opened: (window as any).menuOpened,
        actionClicked: (window as any).actionClicked,
        threadClicked: (window as any).threadClicked,
      })),
    ).toEqual({
      opened: true,
      actionClicked: undefined,
      threadClicked: undefined,
    });
  });
}

test("keeps a conversation unread when its menu offers Mark as read", async ({
  page,
}) => {
  await load(page, menuFixture("Đánh dấu là đã đọc"));
  const result = await confirmReadStates(page, await readInboxList(page), [
    "123",
  ]);
  expect(result.rows[0].unread).toBe(true);
});

test("reveals hover-only conversation options before confirming a read", async ({
  page,
}) => {
  await load(page, menuFixture("Mark as unread"));
  await page.addStyleTag({
    content: `
      #options { pointer-events: none; opacity: 0; }
      [role="row"]:hover #options { pointer-events: auto; opacity: 1; }
    `,
  });
  await page.mouse.move(0, 0);
  const result = await confirmReadStates(page, await readInboxList(page), [
    "123",
  ]);
  expect(result.rows[0].unread).toBe(false);
  expect(
    await page.evaluate(() => (window as any).actionClicked),
  ).toBeUndefined();
  expect(
    await page.evaluate(() => (window as any).threadClicked),
  ).toBeUndefined();
});

test("does not clear a count when a new preview arrives during the read check", async ({
  page,
}) => {
  await load(page, menuFixture("Đánh dấu là chưa đọc"));
  await page.evaluate(() => {
    (window as any).changePreview = true;
  });
  const result = await confirmReadStates(page, await readInboxList(page), [
    "123",
  ]);
  expect(result.rows[0]).toMatchObject({
    preview: "New message",
    unread: null,
  });
});

test("does not touch menus for unknown conversations or when a menu is already open", async ({
  page,
}) => {
  await load(page, menuFixture("Đánh dấu là chưa đọc"));
  const snapshot = await readInboxList(page);
  expect(
    (await confirmReadStates(page, snapshot, [])).rows[0].unread,
  ).toBeNull();
  expect(await page.evaluate(() => (window as any).menuOpened)).toBeUndefined();
  await page.locator("#options").click();
  expect(
    (await confirmReadStates(page, snapshot, ["123"])).rows[0].unread,
  ).toBeNull();
  expect(await page.locator("#menu").count()).toBe(1);
});

test("halts on an opened thread, message editor or encrypted-history PIN", async ({
  page,
}) => {
  await load(
    page,
    fixture(row("123", "Unread")),
    "https://www.facebook.com/messages/e2ee/t/123/",
  );
  expect((await readInboxList(page)).unsafe).toBe(true);
  await page.goto("https://www.facebook.com/");
  await page.setContent(
    fixture(
      '<div contenteditable="true" role="textbox" aria-label="Tin nhắn"></div><style>[contenteditable]{width:100px;height:30px}</style>',
    ),
  );
  expect((await readInboxList(page)).unsafe).toBe(true);
  await page.setContent(
    fixture('<input type="password" aria-label="Nhập PIN Messenger">'),
  );
  expect((await readInboxList(page)).pinRequired).toBe(true);
});

test("only permits the exact Messenger preview button on the home page", async ({
  page,
}) => {
  await load(
    page,
    '<a role="button" aria-label="Messenger" href="/messages/t/123/">Messenger</a>',
  );
  expect(await openMessengerPanel(page)).toBe(false);
  await page.setContent(
    '<div role="button" aria-label="Messenger" tabindex="0" onclick="this.dataset.opened=1">Messenger</div>',
  );
  expect(await openMessengerPanel(page)).toBe(true);
  expect(
    await page.locator('[role="button"]').getAttribute("data-opened"),
  ).toBe("1");
  await page
    .locator('[role="button"]')
    .evaluate((el) => el.setAttribute("aria-expanded", "true"));
  expect(await openMessengerPanel(page)).toBe(false);
});

test("reports Messenger PIN setup before an input exists", async ({ page }) => {
  await load(
    page,
    fixture(
      "<h3>Tạo mã PIN để truy cập vào đoạn chat trên bất kỳ thiết bị nào</h3><button>Tạo mã PIN</button>",
    ),
  );
  expect((await readInboxList(page)).pinRequired).toBe(true);
  await page.setContent(
    fixture(
      '<div role="row"><a href="/messages/t/123/"><h3>Create a PIN to access chats</h3><div>Hello</div></a></div>',
    ),
  );
  expect((await readInboxList(page)).pinRequired).toBe(false);
});

test("opens one visible Messenger control even when Facebook retains hidden controls", async ({
  page,
}) => {
  await load(
    page,
    '<div role="button" aria-label="Messenger" style="display:none">Hidden</div><button aria-label="Messenger" onclick="this.dataset.opened=1">Messenger</button>',
  );
  expect(await openMessengerPanel(page)).toBe(true);
  expect(await page.locator("button").getAttribute("data-opened")).toBe("1");
  await page.setContent(
    '<button aria-label="Messenger">One</button><button aria-label="Messenger">Two</button>',
  );
  expect(await openMessengerPanel(page)).toBe(false);
});

test("opens the Messenger preview when its accessible name includes unread messages", async ({
  page,
}) => {
  await load(page, "<main></main>");
  for (const label of [
    "Messenger, 1 chưa đọc",
    "Messenger, 20+ tin nhắn chưa đọc",
    "Messenger, 2 unread messages",
  ]) {
    await page.setContent(
      `<div role="button" aria-label="${label}" onclick="this.dataset.opened=1">Messenger</div>`,
    );
    expect(await openMessengerPanel(page)).toBe(true);
    expect(
      await page.locator('[role="button"]').getAttribute("data-opened"),
    ).toBe("1");
  }
  await page.setContent(
    '<a role="button" aria-label="Messenger, 1 chưa đọc" href="/messages/t/123/">Thread</a><button aria-label="Messenger settings">Settings</button>',
  );
  expect(await openMessengerPanel(page)).toBe(false);
});

test("checks the expected personal identity and stops on login, checkpoint or actor switch", async ({
  page,
  context,
}) => {
  await load(page, fixture(row("123", "Unread")));
  const expected = createHash("sha256").update("123456789").digest("hex");
  expect(await checkIdentity(context, page, expected)).toBe("LOGIN_REQUIRED");
  await context.addCookies([
    {
      name: "c_user",
      value: "123456789",
      domain: ".facebook.com",
      path: "/",
      secure: true,
    },
  ]);
  expect(await checkIdentity(context, page, expected)).toBeNull();
  expect(await checkIdentity(context, page, "0".repeat(64))).toBe(
    "WRONG_IDENTITY",
  );
  await context.addCookies([
    {
      name: "i_user",
      value: "987654321",
      domain: ".facebook.com",
      path: "/",
      secure: true,
    },
  ]);
  expect(await checkIdentity(context, page, expected)).toBe("WRONG_IDENTITY");
  await page.goto("https://www.facebook.com/checkpoint/");
  expect(await checkIdentity(context, page, expected)).toBe("CHALLENGE");
});

test("dashboard keeps stale data visible, renders message text safely and fits a phone", async ({
  page,
}) => {
  const html = await readFile(
    new URL("../../tools/inbox-trial/dashboard.html", import.meta.url),
    "utf8",
  );
  const script = await readFile(
    new URL("../../tools/inbox-trial/dashboard.js", import.meta.url),
    "utf8",
  );
  let fail = false;
  const now = new Date().toISOString();
  await page.route("http://inbox-trial.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/status") {
      if (fail) return route.abort("connectionfailed");
      return route.fulfill({
        json: {
          accountName: "Minh Phan",
          status: "ONLINE",
          reason: "Partial list only",
          checkedAt: now,
          lastSuccessAt: now,
          events: [],
          conversations: [
            {
              id: "123",
              name: "Customer",
              preview: '<img src=x onerror="window.injected=1">',
              unread: true,
              observedAt: now,
            },
          ],
        },
      });
    }
    return route.fulfill({
      contentType:
        url.pathname === "/dashboard.js"
          ? "text/javascript"
          : "text/html; charset=utf-8",
      body: url.pathname === "/dashboard.js" ? script : html,
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://inbox-trial.test/");
  await expect(page.locator("#conversations")).toContainText(
    '<img src=x onerror="window.injected=1">',
  );
  expect(await page.locator("#conversations img").count()).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  fail = true;
  await page.evaluate("refresh()");
  await expect(page.locator("#status")).toContainText("Mất kết nối");
  await expect(page.locator("#conversations")).toContainText("Customer");
  await expect(page.locator("#count")).toContainText("1 hội thoại");
});
