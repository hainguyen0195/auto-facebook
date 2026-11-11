import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { FacebookDesktop } from "../../src/desktop/facebook";

// Run through tsx, exactly like scripts/desktop.ts. Playwright's test transform
// does not reproduce esbuild helpers injected into serialized page callbacks.
const browser = await chromium.launch({ headless: true });
const results: {
  scenario: string;
  outcome: string;
  clicks: number;
  arms: number;
}[] = [];
try {
  for (const scenario of [
    "published",
    "pending",
    "no-browser-evaluation",
    "arm-error",
    "click-error",
    "no-confirmation",
    "editor-without-role",
    "plaintext-editor",
    "hidden-dialog",
    "web-redirect",
    "wrong-group-redirect",
    "slow-domcontentloaded",
    "existing-group",
    "destination-change",
  ] as const) {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "c_user", value: "12345", domain: ".facebook.com", path: "/" },
    ]);
    const page = await context.newPage();
    let clickEvents = 0;
    let meVisits = 0;
    page.on("console", (message) => {
      if (message.text() !== "fixture-submit") return;
      clickEvents++;
    });
    page.setDefaultTimeout(3000);
    const editorAttributes =
      scenario === "editor-without-role"
        ? 'contenteditable="true"'
        : scenario === "plaintext-editor"
          ? 'contenteditable="plaintext-only"'
          : 'role="textbox" contenteditable="true"';
    const hiddenDialog =
      scenario === "hidden-dialog"
        ? '<div role="dialog" hidden><div role="textbox" contenteditable="true"></div><button>Post</button></div>'
        : "";
    await page.route("**/*", (route) => {
      if (route.request().url() === "https://www.facebook.com/me") meVisits++;
      if (
        scenario === "slow-domcontentloaded" &&
        route.request().url().endsWith("/slow.js")
      )
        return;
      if (
        ["web-redirect", "wrong-group-redirect"].includes(scenario) &&
        route.request().url() === "https://www.facebook.com/groups/fixture"
      )
        // HTTP redirects from route.fulfill bypass routing for the next hop.
        // Use document navigation so both hosts stay inside this offline fixture.
        return route.fulfill({
          contentType: "text/html",
          body: `<script>location.replace('https://web.facebook.com/groups/${scenario === "web-redirect" ? "fixture" : "other"}')</script>`,
        });
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><meta charset="utf-8"><button id="open">Write something</button>
        <div role="dialog" style="display:none"><div ${editorAttributes}></div><input type="file" accept="image/*"><div role="progressbar" hidden></div><button id="submit">Post</button></div>${hiddenDialog}<div role="status" id="toast"></div>
        <script>
          window.submitCount = 0; window.uploadReady = false;
          document.querySelector('#open').onclick = () => document.querySelector('[role=dialog]').style.display = 'block';
          document.querySelector('input').onchange = () => {
            document.querySelector('#submit').disabled = true;
            document.querySelector('[role=progressbar]').hidden = false;
            setTimeout(() => { window.uploadReady = true; document.querySelector('#submit').disabled = false; document.querySelector('[role=progressbar]').hidden = true; }, 150);
          };
          document.querySelector('#submit').onclick = () => {
            if (!window.uploadReady) throw new Error('Clicked before image upload finished');
            window.submitCount++;
            console.log('fixture-submit');
            document.querySelector('[role=dialog]').style.display = 'none';
            if (${JSON.stringify(scenario)} === 'published') document.querySelector('#toast').innerHTML = '<span>Post</span> published';
            if (${JSON.stringify(scenario)} === 'pending') document.querySelector('#toast').textContent = 'Your post is pending approval';
          };
        </script>${scenario === "slow-domcontentloaded" ? '<script src="/slow.js"></script>' : ""}`,
      });
    });
    if (scenario === "existing-group")
      await page.goto("https://www.facebook.com/groups/fixture");
    const desktop = new FacebookDesktop("unused-runtime-profiles");
    (desktop as unknown as { contexts: Map<string, unknown> }).contexts.set(
      "fixture",
      context,
    );
    const evaluate = page.evaluate.bind(page);
    if (scenario === "no-browser-evaluation")
      page.evaluate = (async () => {
        throw new Error("Publication must not depend on a result observer");
      }) as typeof page.evaluate;
    let arms = 0;
    const result = await desktop.publish(
      {
        accountId: "fixture",
        identityHash: createHash("sha256").update("12345").digest("hex"),
        targetUrl: "https://www.facebook.com/groups/fixture",
        group: true,
        content: "Runtime fixture",
        files: [
          {
            name: "fixture.png",
            mimeType: "image/png",
            buffer: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2S8AAAAASUVORK5CYII=",
              "base64",
            ),
          },
        ],
      },
      async () => {
        arms++;
        if (scenario === "arm-error")
          throw new Error("Fixture authorization denied");
        if (scenario === "click-error") await page.close();
        if (scenario === "destination-change")
          await page.goto("https://www.facebook.com/groups/other");
      },
    );
    const clicks =
      result.outcome !== "PUBLISHED" || page.isClosed()
        ? clickEvents
        : await evaluate(
            () => (window as unknown as { submitCount: number }).submitCount,
          );
    if (scenario === "arm-error") {
      assert.equal(result.outcome, "FAILED", result.message);
      assert.match(result.message, /Chưa bấm Đăng/);
      assert.equal(clicks, 0);
      assert.equal(
        page.isClosed(),
        false,
        "A failed pre-submit page should remain available for inspection",
      );
    } else if (
      scenario === "wrong-group-redirect" ||
      scenario === "destination-change"
    ) {
      assert.equal(result.outcome, "FAILED", result.message);
      assert.equal(arms, scenario === "destination-change" ? 1 : 0);
      assert.equal(clicks, 0);
      assert.equal(page.isClosed(), false);
    } else if (scenario === "click-error") {
      assert.equal(result.outcome, "UNCERTAIN", result.message);
      assert.equal(clicks, 0);
      assert.equal(arms, 1);
    } else {
      assert.equal(
        result.outcome,
        "PUBLISHED",
        `${scenario}: ${result.message}; URL=${page.url()}; cookies=${JSON.stringify((await context.cookies()).map((c) => ({ name: c.name, domain: c.domain })))}`,
      );
      assert.equal(clicks, 1);
      assert.equal(arms, 1);
    }
    if (scenario === "existing-group")
      assert.equal(
        meVisits,
        0,
        "An existing Facebook tab should not be redirected through /me again",
      );
    results.push({ scenario, outcome: result.outcome, clicks, arms });
    await context.close();
  }
  process.stdout.write(JSON.stringify(results));
} finally {
  await browser.close();
}
