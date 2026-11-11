import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { FacebookDesktop } from "../../src/desktop/facebook";

const browser = await chromium.launch({ headless: true });
const identityHash = createHash("sha256").update("456").digest("hex");
const url = "https://www.facebook.com/groups/123/posts/987";
const scenarios = [
  "response-only",
  "slow-response",
  "wrong-group",
  "wrong-actor",
  "wrong-content",
  "unrelated-response",
  "before-submit",
  "two-results",
  "flash-toast",
  "late-timeout",
  "session-changed",
  "request-after-stop",
] as const;
const results: unknown[] = [];
try {
  for (const scenario of scenarios) {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "c_user", value: "456", domain: ".facebook.com", path: "/" },
    ]);
    const page = await context.newPage();
    let requests = 0,
      arms = 0;
    const variables = {
      input: {
        actor_id: scenario === "wrong-actor" ? "789" : "456",
        message: {
          text: scenario === "wrong-content" ? "Other text" : "Selected text",
        },
        audience: { to_id: scenario === "wrong-group" ? "124" : "123" },
      },
    };
    const form = new URLSearchParams({
      fb_api_req_friendly_name:
        scenario === "unrelated-response"
          ? "CometFeedStoryQuery"
          : "ComposerStoryCreateMutation",
      variables: JSON.stringify(variables),
    }).toString();
    await page.route("https://www.facebook.com/**", async (route) => {
      if (new URL(route.request().url()).pathname === "/api/graphql/") {
        requests++;
        const current = requests;
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            ["slow-response", "late-timeout"].includes(scenario)
              ? 1200
              : scenario === "before-submit"
                ? 500
                : 80,
          ),
        );
        const story = {
          url:
            scenario === "two-results" && current % 2 === 0
              ? url.replace("987", "988")
              : url,
          actors: [{ id: "456" }],
        };
        await route
          .fulfill({
            contentType: "application/json",
            body: JSON.stringify({ data: { story_create: { story } } }),
          })
          .catch(() => {});
        return;
      }
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><button id="open">Write something</button><div role="dialog" hidden><div role="textbox" contenteditable="true"></div><button id="submit">Post</button></div><div role="status" id="toast"></div>
        <script>
          function send() { return fetch('/api/graphql/', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:${JSON.stringify(form)} }); }
          ${scenario === "before-submit" ? "void send();" : ""}
          document.querySelector('#open').onclick = () => document.querySelector('[role=dialog]').hidden = false;
          document.querySelector('#submit').onclick = () => {
            document.querySelector('[role=dialog]').hidden = true;
            ${!["before-submit", "flash-toast", "request-after-stop"].includes(scenario) ? "void send();" : ""}
            ${scenario === "two-results" ? "void send();" : ""}
            ${scenario === "flash-toast" ? "document.querySelector('#toast').innerHTML = '<a href=\"" + url + "\">View post</a>'; setTimeout(() => document.querySelector('#toast').textContent = '', 400);" : ""}
          };
        </script>`,
      });
    });
    const facebook = new FacebookDesktop("unused-response-fixture");
    const listenerCount = () =>
      (
        page as unknown as { listenerCount(event: string): number }
      ).listenerCount("request");
    const baselineListeners = listenerCount();
    (facebook as unknown as { contexts: Map<string, unknown> }).contexts.set(
      "fixture",
      context,
    );
    const result = await facebook.publish(
      {
        accountId: "fixture",
        identityHash,
        targetUrl: "https://www.facebook.com/groups/123",
        group: true,
        content: "Selected text",
        files: [],
      },
      async () => {
        arms++;
      },
    );
    assert.equal(result.outcome, "PUBLISHED", `${scenario}: ${result.message}`);
    assert.equal(arms, 1);
    if (scenario === "flash-toast") await page.waitForTimeout(600);
    if (scenario === "session-changed")
      await context.addCookies([
        { name: "c_user", value: "789", domain: ".facebook.com", path: "/" },
      ]);
    const captured = await facebook.capturePublishedLinkResult(
      "fixture",
      AbortSignal.timeout(scenario === "slow-response" ? 2200 : 650),
    );
    const expected = ["response-only", "slow-response", "flash-toast"].includes(
      scenario,
    )
      ? url
      : null;
    assert.equal(
      captured.resultUrl,
      expected,
      `${scenario}: ${JSON.stringify(captured)}`,
    );
    if (scenario === "two-results") assert.equal(captured.reason, "AMBIGUOUS");
    if (scenario === "session-changed")
      assert.equal(captured.reason, "SESSION_CHANGED");
    assert.equal(listenerCount(), baselineListeners);
    if (scenario === "request-after-stop") {
      await page.evaluate(async (body) => {
        await fetch("/api/graphql/", { method: "POST", body });
      }, form);
      assert.equal(listenerCount(), baselineListeners);
    }
    if (scenario === "late-timeout") await page.waitForTimeout(700);
    assert.equal(
      (await facebook.capturePublishedLinkResult("fixture")).reason,
      "INTERRUPTED",
    );
    results.push({
      scenario,
      reason: captured.reason,
      resultUrl: captured.resultUrl,
    });
    await context.close();
  }
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
