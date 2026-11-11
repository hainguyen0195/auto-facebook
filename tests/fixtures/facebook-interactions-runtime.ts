import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { FacebookDesktop } from "../../src/desktop/facebook";
import { interactOnFacebook } from "../../src/desktop/facebook-interactions";

const browser = await chromium
  .launch({ headless: true })
  .catch(() => chromium.launch({ headless: true, channel: "chrome" }));
const identityHash = createHash("sha256").update("12345").digest("hex");
const targetUrl = "https://www.facebook.com/groups/fixture/posts/987";
const results: {
  scenario: string;
  outcome: string;
  arms: number;
  clicks: number;
}[] = [];
try {
  for (const scenario of [
    "comment",
    "delayed-article",
    "own-comment",
    "other-comment",
    "reply-decoy",
    "locked",
    "identity-mismatch",
    "identity-changes",
    "arm-denied",
    "click-error",
    "deadline",
    "like",
    "already-like",
    "love",
    "unavailable",
    "checkpoint",
  ] as const) {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "c_user", value: "12345", domain: ".facebook.com", path: "/" },
    ]);
    const page = await context.newPage();
    let clicks = 0,
      arms = 0;
    page.on("console", (message) => {
      if (message.text() === "interaction-submit") clicks++;
    });
    const existing =
      scenario === "own-comment" || scenario === "other-comment"
        ? `<article><a href="/profile.php?id=${scenario === "own-comment" ? "12345" : "67890"}">Author</a><span>Controlled comment</span><button>Like</button></article>`
        : "";
    const mainEditor =
      scenario === "reply-decoy" || scenario === "deadline"
        ? ""
        : '<div id="editor" role="textbox" aria-label="Write a comment" contenteditable="true"></div>';
    const html = `<!doctype html><meta charset="utf-8">
      <article><a href="/groups/fixture/posts/other">Other post</a><div role="textbox" contenteditable="true" aria-label="Write a comment"></div><button>Like</button></article>
      <article id="post"><a id="permalink" href="${targetUrl}">Timestamp</a><p>Controlled post</p>
      <button id="reaction" aria-label="${scenario === "already-like" ? "Remove Like" : "Like"}" aria-pressed="${scenario === "already-like"}">Like</button>
      ${scenario === "locked" ? "<p>Comments are turned off</p>" : mainEditor}
      ${existing}<article><a href="/profile.php?id=67890">Other author</a><span>Reply decoy</span><div role="textbox" aria-label="Write a comment" contenteditable="true"></div><button>Like</button></article></article>
      <div role="menu" id="menu" hidden><button aria-label="Love">Love</button></div>
      <script>
        const editor = document.querySelector('#editor');
        if (editor) editor.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); console.log('interaction-submit'); const comment = document.createElement('article'); comment.innerHTML = '<a href="/profile.php?id=12345">Actor</a><span></span>'; comment.querySelector('span').textContent = editor.textContent; document.querySelector('#post').append(comment); editor.textContent = ''; } };
        document.querySelector('#reaction').onclick = () => { console.log('interaction-submit'); document.querySelector('#reaction').setAttribute('aria-label', 'Remove Like'); document.querySelector('#reaction').setAttribute('aria-pressed', 'true'); };
        document.querySelector('#reaction').onmouseenter = () => document.querySelector('#menu').hidden = false;
        document.querySelector('#menu button').onclick = () => { console.log('interaction-submit'); document.querySelector('#reaction').setAttribute('aria-label', 'Remove Love'); document.querySelector('#reaction').setAttribute('aria-pressed', 'true'); document.querySelector('#menu').hidden = true; };
        ${scenario === "identity-changes" ? "if (editor) editor.oninput = () => document.cookie = 'c_user=67890;domain=.facebook.com;path=/';" : ""}
        ${scenario === "delayed-article" ? "document.querySelector('#permalink').removeAttribute('href'); setTimeout(() => document.querySelector('#permalink').href = '" + targetUrl + "', 300);" : ""}
      </script>`;
    await page.route("https://www.facebook.com/**", (route) => {
      if (
        scenario === "checkpoint" &&
        route.request().url().includes("/posts/")
      )
        return route.fulfill({
          contentType: "text/html",
          body: "<script>history.replaceState({}, '', '/checkpoint');</script>",
        });
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body:
          scenario === "unavailable"
            ? "<p>This content isn't available</p>"
            : html,
      });
    });
    const facebook = new FacebookDesktop("unused-interaction-profiles");
    (facebook as unknown as { contexts: Map<string, unknown> }).contexts.set(
      "fixture",
      context,
    );
    const result = await interactOnFacebook(
      facebook,
      {
        accountId: "fixture",
        identityHash: scenario === "identity-mismatch" ? "wrong" : identityHash,
        targetUrl,
        kind: ["like", "already-like", "love"].includes(scenario)
          ? "REACTION"
          : "COMMENT",
        reaction: scenario === "love" ? "LOVE" : "LIKE",
        content: "Controlled comment",
      },
      async () => {
        arms++;
        if (scenario === "arm-denied") throw new Error("Authorization denied");
        if (scenario === "click-error") await page.close();
      },
      AbortSignal.timeout(
        ["deadline", "reply-decoy"].includes(scenario) ? 1500 : 12000,
      ),
    );
    const expected = ["own-comment", "already-like"].includes(scenario)
      ? "ALREADY_DONE"
      : ["identity-mismatch", "identity-changes"].includes(scenario)
        ? "LOGIN_REQUIRED"
        : scenario === "checkpoint"
          ? "CHALLENGE"
          : scenario === "click-error"
            ? "UNCERTAIN"
            : [
                  "locked",
                  "reply-decoy",
                  "arm-denied",
                  "deadline",
                  "unavailable",
                ].includes(scenario)
              ? "FAILED"
              : "COMPLETED";
    assert.equal(result.outcome, expected, `${scenario}: ${result.message}`);
    assert.equal(clicks, expected === "COMPLETED" ? 1 : 0, scenario);
    assert.equal(
      arms,
      expected === "COMPLETED" ||
        ["arm-denied", "click-error"].includes(scenario)
        ? 1
        : 0,
      scenario,
    );
    if (["deadline", "reply-decoy"].includes(scenario))
      assert.equal(result.failure?.code, "TIMEOUT");
    results.push({ scenario, outcome: result.outcome, arms, clicks });
    await context.close();
  }

  for (const scenario of [
    "new-toast",
    "navigation",
    "wrong-group",
    "old-toast",
    "ambiguous",
    "feed-only",
  ] as const) {
    const context = await browser.newContext();
    await context.addCookies([
      { name: "c_user", value: "12345", domain: ".facebook.com", path: "/" },
    ]);
    const page = await context.newPage();
    const view = (href: string) => `<a href="${href}">View post</a>`;
    await page.route("https://www.facebook.com/**", (route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><button id="open">Write something</button><div role="dialog" hidden><div role="textbox" contenteditable="true"></div><button id="submit">Post</button></div>
      <article>${view(targetUrl)}</article><div role="status" id="toast">${scenario === "old-toast" ? view(targetUrl) : ""}</div>
      <script>
        document.querySelector('#open').onclick = () => document.querySelector('[role=dialog]').hidden = false;
        document.querySelector('#submit').onclick = () => { document.querySelector('[role=dialog]').hidden = true;
        ${scenario === "new-toast" || scenario === "ambiguous" ? "document.querySelector('#toast').innerHTML = " + JSON.stringify(view(targetUrl) + (scenario === "ambiguous" ? view(targetUrl.replace("987", "988")) : "")) + ";" : ""}
        ${scenario === "navigation" ? "history.pushState({}, '', " + JSON.stringify(targetUrl) + ");" : ""}
        ${scenario === "wrong-group" ? "document.querySelector('#toast').innerHTML = " + JSON.stringify(view(targetUrl.replace("fixture", "wrong"))) + ";" : ""}
        };
      </script>`,
      }),
    );
    const facebook = new FacebookDesktop("unused-capture-profiles");
    (facebook as unknown as { contexts: Map<string, unknown> }).contexts.set(
      "fixture",
      context,
    );
    const publication = await facebook.publish(
      {
        accountId: "fixture",
        identityHash,
        targetUrl: "https://www.facebook.com/groups/fixture",
        group: true,
        content: "Controlled post",
        files: [],
      },
      async () => {},
    );
    assert.equal(publication.outcome, "PUBLISHED", publication.message);
    const captured = await facebook.capturePublishedLink(
      "fixture",
      AbortSignal.timeout(700),
    );
    assert.equal(
      captured,
      ["new-toast", "navigation"].includes(scenario) ? targetUrl : null,
      scenario,
    );
    assert.equal(await facebook.capturePublishedLink("fixture"), null);
    results.push({
      scenario,
      outcome: captured ? "LINK" : "NO_LINK",
      arms: 1,
      clicks: 1,
    });
    await context.close();
  }
  process.stdout.write(JSON.stringify(results));
} finally {
  await browser.close();
}
