import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readInboxList } from "../../src/inbox-trial/browser";

// Exercise the same TSX serialization path used by the VPS process.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route("**/*", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<div role="dialog" aria-label="Messenger"><div role="row" aria-label="Unread"><a href="/messages/t/123/"><strong>Test customer</strong><div>Test preview</div></a></div></div>',
    }),
  );
  await page.goto("https://www.facebook.com/");
  const result = await readInboxList(page);
  assert.equal(result.recognized, true);
  assert.equal(result.rows[0]?.unread, true);
  assert.equal(result.rows[0]?.preview, "Test preview");
  console.log("Inbox trial TSX browser runtime passed (synthetic data only).");
} finally {
  await browser.close();
}
