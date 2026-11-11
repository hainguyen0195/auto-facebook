import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  FacebookDesktop,
  publishOnPage,
  type PublishInput,
} from "../../src/desktop/facebook";

const identityHash = createHash("sha256").update("12345").digest("hex");
const input: PublishInput = {
  accountId: "fixture",
  identityHash,
  targetUrl: "https://www.facebook.com/groups/fixture",
  group: true,
  content: "Nội dung thử nghiệm có kiểm soát",
  files: [],
};
test("login observation reads the open Facebook window without navigating or reopening it", async ({
  page,
}) => {
  const desktop = new FacebookDesktop("unused-login-profiles");
  expect(await desktop.observeLogin("fixture")).toBeNull();
  await page.route("https://www.facebook.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body><input name="email"></body></html>',
    }),
  );
  await page.goto("https://www.facebook.com/");
  (desktop as unknown as { contexts: Map<string, unknown> }).contexts.set(
    "fixture",
    page.context(),
  );
  expect((await desktop.observeLogin("fixture"))?.state).toBe("LOGIN_REQUIRED");
  await page.context().addCookies([
    {
      name: "c_user",
      value: "12345",
      domain: ".facebook.com",
      path: "/",
      secure: true,
    },
  ]);
  await page.locator("input").evaluate((element) => element.remove());
  const url = page.url();
  expect(await desktop.observeLogin("fixture")).toMatchObject({
    state: "READY",
    identityHash,
  });
  expect(page.url()).toBe(url);
  await page.goto("https://www.facebook.com/checkpoint");
  expect((await desktop.observeLogin("fixture"))?.state).toBe("CHALLENGE");
  await page.close();
  expect(await desktop.observeLogin("fixture")).toBeNull();
});
async function fixture(
  page: Page,
  outcome: "published" | "pending" | "no-confirmation" | "editor-still-open",
  variant:
    | "default"
    | "no-role"
    | "plaintext-only"
    | "empty-contenteditable"
    | "textarea"
    | "aria-modal"
    | "hidden-duplicate"
    | "unrelated-dialog" = "default",
) {
  const editor =
    variant === "textarea"
      ? '<textarea id="editor"></textarea>'
      : `<div id="editor" contenteditable="${variant === "plaintext-only" ? "plaintext-only" : variant === "empty-contenteditable" ? "" : "true"}" ${variant === "no-role" ? "" : 'role="textbox"'}></div>`;
  const modal =
    variant === "aria-modal" ? 'aria-modal="true"' : 'role="dialog"';
  const decoy =
    variant === "default"
      ? ""
      : '<div id="comment" contenteditable="true">Existing comment</div><button id="comment-submit">Post</button>';
  const otherDialog =
    variant === "hidden-duplicate"
      ? '<div role="dialog" hidden><div contenteditable="true" role="textbox"></div><button>Post</button></div>'
      : variant === "unrelated-dialog"
        ? '<div role="dialog"><div contenteditable="true">Unrelated dialog</div><button>Close</button></div>'
        : "";
  await page.context().addCookies([
    {
      name: "c_user",
      value: "12345",
      domain: ".facebook.com",
      path: "/",
      secure: true,
    },
  ]);
  await page.route("https://www.facebook.com/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><button id="open">Write something</button>
      ${decoy}<div id="composer" ${modal} style="display:none">${editor}<button id="submit">Post</button></div>${otherDialog}<div role="status" id="toast"></div>
      <script>
        window.submitCount = 0;
        document.querySelector('#open').onclick = () => document.querySelector('#composer').style.display = 'block';
        document.querySelector('#comment-submit')?.addEventListener('click', () => { throw new Error('Wrong submit button'); });
        document.querySelector('#submit').onclick = () => {
          window.submitCount++;
          const kind = ${JSON.stringify(outcome)};
          if (kind !== 'editor-still-open') document.querySelector('#composer').style.display = 'none';
          if (kind === 'published') document.querySelector('#toast').textContent = 'Post published';
          if (kind === 'pending') document.querySelector('#toast').textContent = 'Your post is pending approval';
        };
      </script>`,
    }),
  );
  await page.goto(input.targetUrl);
}

test("selects the restored Facebook tab instead of Chrome's initial blank tab", async ({
  context,
  page,
}) => {
  const restored = await context.newPage();
  await fixture(restored, "published");
  const desktop = new FacebookDesktop("unused-restored-profiles");
  (desktop as unknown as { contexts: Map<string, unknown> }).contexts.set(
    "fixture",
    context,
  );
  const opened = await desktop.open("fixture");
  expect(opened.page).toBe(restored);
  expect(page.url()).toBe("about:blank");
  expect(opened.page.url()).toBe(input.targetUrl);
});

for (const variant of [
  "no-role",
  "plaintext-only",
  "empty-contenteditable",
  "textarea",
  "aria-modal",
  "hidden-duplicate",
  "unrelated-dialog",
] as const) {
  test(`recognizes the ${variant} composer without editing a comment or another dialog`, async ({
    page,
  }) => {
    await fixture(page, "published", variant);
    let arms = 0;
    const result = await publishOnPage(page, input, async () => {
      const editor = page.locator("#editor");
      expect(
        variant === "textarea"
          ? await editor.inputValue()
          : await editor.textContent(),
      ).toBe(input.content);
      expect(await page.locator("#comment").textContent()).toBe(
        "Existing comment",
      );
      arms++;
    });
    expect(result.outcome).toBe("PUBLISHED");
    expect(arms).toBe(1);
    expect(
      await page.evaluate(
        () => (window as unknown as { submitCount: number }).submitCount,
      ),
    ).toBe(1);
  });
}

for (const kind of [
  "published",
  "pending",
  "no-confirmation",
  "editor-still-open",
] as const) {
  test(`records publication immediately after the authorized click with ${kind}`, async ({
    page,
  }) => {
    await fixture(page, kind);
    let arms = 0;
    const result = await publishOnPage(page, input, async () => {
      expect(
        await page.evaluate(
          () => (window as unknown as { submitCount: number }).submitCount,
        ),
      ).toBe(0);
      expect(await page.getByRole("textbox").textContent()).toBe(input.content);
      arms++;
    });
    expect(result.outcome).toBe("PUBLISHED");
    expect(result.resultUrl).toBeUndefined();
    expect(arms).toBe(1);
    expect(
      await page.evaluate(
        () => (window as unknown as { submitCount: number }).submitCount,
      ),
    ).toBe(1);
  });
}

test("revoked authorization prevents the final publish click", async ({
  page,
}) => {
  await fixture(page, "published");
  await expect(
    publishOnPage(page, input, async () => {
      throw new Error("Revoked");
    }),
  ).rejects.toThrow("Revoked");
  expect(
    await page.evaluate(
      () => (window as unknown as { submitCount: number }).submitCount,
    ),
  ).toBe(0);
});

test("an identity change prevents authorization and publication", async ({
  page,
}) => {
  await fixture(page, "published");
  let arms = 0;
  await expect(
    publishOnPage(page, { ...input, identityHash: "changed" }, async () => {
      arms++;
    }),
  ).rejects.toThrow();
  expect(arms).toBe(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { submitCount: number }).submitCount,
    ),
  ).toBe(0);
});

test("a failed submit click does not record publication", async ({ page }) => {
  await fixture(page, "published");
  await expect(
    publishOnPage(page, input, async () => {
      await page.close();
    }),
  ).rejects.toThrow();
});

test("waits through a slow composer that loads after the previous 45-second limit", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await fixture(page, "published");
  await page.evaluate(() => {
    const editor = document.querySelector("#editor")!;
    editor.remove();
    setTimeout(
      () => document.querySelector("#composer")!.prepend(editor),
      46_000,
    );
  });
  let arms = 0;
  expect(
    (
      await publishOnPage(page, input, async () => {
        arms++;
      })
    ).outcome,
  ).toBe("PUBLISHED");
  expect(arms).toBe(1);
  expect(
    await page.evaluate(
      () => (window as unknown as { submitCount: number }).submitCount,
    ),
  ).toBe(1);
});

test("cancels the browser at the attempt deadline and never submits after late authorization", async ({
  page,
}) => {
  await fixture(page, "published");
  const desktop = new FacebookDesktop("unused-deadline-profiles");
  (desktop as unknown as { contexts: Map<string, unknown> }).contexts.set(
    "fixture",
    page.context(),
  );
  const controller = new AbortController();
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const armed = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let clicks = 0;
  page.on("console", (message) => {
    if (message.text() === "late-submit") clicks++;
  });
  await page.addInitScript(() =>
    document.addEventListener("click", (event) => {
      if ((event.target as Element).id === "submit") console.log("late-submit");
    }),
  );
  const result = desktop.publish(
    input,
    async () => {
      entered();
      await waiting;
    },
    controller.signal,
  );
  await armed;
  controller.abort(new DOMException("Attempt expired", "TimeoutError"));
  expect(await result).toMatchObject({
    outcome: "FAILED",
    failure: { submitAttempted: false, code: "TIMEOUT" },
  });
  await expect.poll(() => page.isClosed()).toBe(true);
  release();
  expect(clicks).toBe(0);
});

test("classifies a navigation timeout before authorization as retryable", async ({
  page,
}) => {
  await fixture(page, "published");
  const desktop = new FacebookDesktop("unused-network-profiles");
  (desktop as unknown as { contexts: Map<string, unknown> }).contexts.set(
    "fixture",
    page.context(),
  );
  await page.route(input.targetUrl, (route) => route.abort("timedout"));
  let arms = 0;
  const result = await desktop.publish(input, async () => {
    arms++;
  });
  expect(result).toMatchObject({
    outcome: "FAILED",
    failure: { submitAttempted: false, code: "NETWORK" },
  });
  expect(arms).toBe(0);
});
