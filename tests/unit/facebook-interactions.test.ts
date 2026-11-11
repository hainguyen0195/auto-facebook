import { createHash } from "node:crypto";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FacebookDesktop } from "../../src/desktop/facebook";
import { interactOnFacebook } from "../../src/desktop/facebook-interactions";

const identityHash = createHash("sha256").update("12345").digest("hex");
const targetUrl = "https://www.facebook.com/groups/fixture/posts/987";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium
    .launch({ headless: true })
    .catch(() => chromium.launch({ headless: true, channel: "chrome" }));
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

async function runScenario(
  html: string,
  input: Partial<Parameters<typeof interactOnFacebook>[1]> = {},
) {
  const context = await browser.newContext();
  await context.addCookies([
    { name: "c_user", value: "12345", domain: ".facebook.com", path: "/" },
  ]);
  const page = await context.newPage();
  let clicks = 0;
  let arms = 0;
  page.on("console", (msg) => {
    if (msg.text() === "interaction-submit") clicks++;
  });
  await page.route("https://www.facebook.com/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: html,
    }),
  );
  const facebook = new FacebookDesktop("unused-comet-profiles");
  (facebook as unknown as { contexts: Map<string, unknown> }).contexts.set(
    "fixture",
    context,
  );
  try {
    const result = await interactOnFacebook(
      facebook,
      {
        accountId: "fixture",
        identityHash,
        targetUrl,
        kind: "COMMENT",
        content: "Mẫu bình luận chuẩn",
        reaction: "LIKE",
        ...input,
      },
      async () => {
        arms++;
      },
      AbortSignal.timeout(12_000),
    );
    return { result, clicks, arms };
  } finally {
    await context.close();
  }
}

describe("Facebook Comet interactions runtime", () => {
  it("submits a comment when the post is inside a permalink modal [role=dialog] with sticky footer composer and sibling comment articles", async () => {
    const html = `<!doctype html><meta charset="utf-8">
      <div role="main">
        <article><a href="/groups/fixture/posts/other">Background post</a><a href="#">Hash</a><button>Thích</button></article>
        <article><a href="${targetUrl}">Background duplicate</a><button>Thích</button></article>
      </div>
      <div role="dialog" aria-label="Bài viết">
        <div role="article" id="post">
          <a href="?__cft__[0]=1">2 giờ</a>
          <a href="https://www.facebook.com/photo/?fbid=555&amp;set=gm.987">Ảnh bài viết</a>
          <p>Nội dung bài viết trong dialog</p>
          <div role="button" aria-label="Thích">Thích</div>
          <div role="button" aria-label="Bình luận">Bình luận</div>
        </div>
        <div id="comments-list">
          <div role="article" aria-label="Bình luận dưới tên Người Khác">
            <a href="/groups/fixture/user/67890/">Người Khác</a>
            <a href="#">Thích</a>
            <span>Bình luận cũ</span>
          </div>
        </div>
        <div id="sticky-footer">
          <div id="editor" role="textbox" aria-label="Viết bình luận công khai..." contenteditable="true"></div>
        </div>
      </div>
      <script>
        const editor = document.querySelector('#editor');
        editor.onkeydown = e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            console.log('interaction-submit');
            const c = document.createElement('div');
            c.setAttribute('role', 'article');
            c.setAttribute('aria-label', 'Bình luận dưới tên Tôi');
            c.innerHTML = '<a href="/groups/fixture/user/12345/">Tôi</a><span></span>';
            c.querySelector('span').textContent = editor.textContent;
            document.querySelector('#comments-list').append(c);
            editor.textContent = '';
          }
        };
      </script>`;
    const { result, clicks, arms } = await runScenario(html);
    expect(result.outcome).toBe("COMPLETED");
    expect(clicks).toBe(1);
    expect(arms).toBe(1);
  });

  it("opens a collapsed comment box by clicking Bình luận, types into Lexical contenteditable without role=textbox, and clicks composer send button", async () => {
    const html = `<!doctype html><meta charset="utf-8">
      <article id="post">
        <a id="ts" href="?__cft__[0]=abc">Vừa xong</a>
        <p>Bài viết ẩn ô bình luận</p>
        <div role="button" aria-label="Thích">Thích</div>
        <div role="button" id="open-comment" aria-label="Bình luận">Bình luận</div>
        <div id="composer-slot"></div>
      </article>
      <script>
        document.querySelector('#ts').addEventListener('mouseenter', e => {
          e.target.href = '${targetUrl}';
        });
        document.querySelector('#open-comment').onclick = () => {
          document.querySelector('#composer-slot').innerHTML =
            '<div id="editor" contenteditable="true" data-lexical-editor="true" aria-placeholder="Viết bình luận..."></div>' +
            '<div id="focused-state-composer-submit"><div role="button" id="send-btn" aria-label="Bình luận">Gửi</div></div>';
          document.querySelector('#send-btn').onclick = () => {
            const editor = document.querySelector('#editor');
            console.log('interaction-submit');
            const c = document.createElement('div');
            c.setAttribute('role', 'article');
            c.setAttribute('aria-label', 'Bình luận dưới tên Tôi');
            c.innerHTML = '<a href="/groups/fixture/user/12345/">Tôi</a><span></span>';
            c.querySelector('span').textContent = editor.textContent;
            document.querySelector('#post').append(c);
            editor.textContent = '';
          };
        };
      </script>`;
    const { result, clicks, arms } = await runScenario(html);
    expect(result.outcome).toBe("COMPLETED");
    expect(clicks).toBe(1);
    expect(arms).toBe(1);
  });

  it("selects HAHA reaction from a [role=toolbar] reaction picker inside a post [role=dialog] and confirms Vietnamese button state", async () => {
    const html = `<!doctype html><meta charset="utf-8">
      <div role="dialog" aria-label="Bài viết">
        <div role="article" id="post">
          <a href="${targetUrl}">1 giờ</a>
          <p>Bài viết thả Haha</p>
        </div>
        <div id="footer-actions">
          <div role="button" id="reaction" aria-label="Thích">Thích</div>
          <div role="button" aria-label="Bình luận">Bình luận</div>
        </div>
      </div>
      <div role="toolbar" id="picker" hidden>
        <div role="button" aria-label="Thích">Thích</div>
        <div role="button" aria-label="Yêu thích">Yêu thích</div>
        <div role="button" id="haha-btn" aria-label="Haha">Haha</div>
      </div>
      <script>
        const reaction = document.querySelector('#reaction');
        const picker = document.querySelector('#picker');
        reaction.onmouseenter = () => { picker.hidden = false; };
        document.querySelector('#haha-btn').onclick = () => {
          console.log('interaction-submit');
          reaction.setAttribute('aria-label', 'Haha');
          reaction.textContent = 'Haha';
          picker.hidden = true;
        };
      </script>`;
    const { result, clicks, arms } = await runScenario(html, {
      kind: "REACTION",
      reaction: "HAHA",
    });
    expect(result.outcome).toBe("COMPLETED");
    expect(clicks).toBe(1);
    expect(arms).toBe(1);
  });

  it("handles full-page permalink inside [role=main] where only comments have [role=article]", async () => {
    const html = `<!doctype html><meta charset="utf-8">
      <main role="main">
        <div id="permalink-post">
          <p>Bài viết permalink không dùng role=article cho thân bài</p>
          <div role="button" aria-label="Thích">Thích</div>
          <div role="button" aria-label="Bình luận">Bình luận</div>
          <div id="editor" role="textbox" aria-label="Viết bình luận..." contenteditable="true"></div>
          <div id="comments">
            <div role="article" aria-label="Bình luận dưới tên Người Khác">
              <a href="/profile.php?id=67890">Người Khác</a>
              <span>Mẫu bình luận chuẩn</span>
            </div>
          </div>
        </div>
      </main>
      <script>
        const editor = document.querySelector('#editor');
        editor.onkeydown = e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            console.log('interaction-submit');
            const c = document.createElement('div');
            c.setAttribute('role', 'article');
            c.setAttribute('aria-label', 'Bình luận dưới tên Tôi');
            c.innerHTML = '<a href="/profile.php?id=12345">Tôi</a><span></span>';
            c.querySelector('span').textContent = editor.textContent;
            document.querySelector('#comments').append(c);
            editor.textContent = '';
          }
        };
      </script>`;
    const { result, clicks, arms } = await runScenario(html);
    expect(result.outcome).toBe("COMPLETED");
    expect(clicks).toBe(1);
    expect(arms).toBe(1);
  });
});
