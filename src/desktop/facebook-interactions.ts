import { errors, type Locator, type Page } from "playwright";
import type { PublishFailure } from "../lib/automatic-policy";
import {
  canonicalFacebookPost,
  postBelongsToDestination,
} from "../lib/facebook-post-url";
import { abortable, failureCode } from "./attempt";
import type { FacebookDesktop } from "./facebook";

export type InteractionInput = {
  accountId: string;
  identityHash: string;
  targetUrl: string;
  kind: "COMMENT" | "BUMP" | "REACTION";
  content: string;
  reaction?: string | null;
};
export type InteractionResult = {
  outcome:
    | "COMPLETED"
    | "ALREADY_DONE"
    | "FAILED"
    | "UNCERTAIN"
    | "LOGIN_REQUIRED"
    | "CHALLENGE";
  message: string;
  issueCode?: "TARGET_UNAVAILABLE";
  failure?: PublishFailure;
};
const reactionNames: Record<string, RegExp> = {
  LIKE: /^(Thích|Like|Đã thích|Bỏ thích|Gỡ thích|Remove Like|Thay đổi cảm xúc Thích|Acted with Like|Change Like reaction)$/i,
  LOVE: /^(Yêu thích|Love|Bỏ yêu thích|Gỡ yêu thích|Remove Love|Thay đổi cảm xúc Yêu thích|Acted with Love|Change Love reaction)$/i,
  CARE: /^(Thương thương|Care|Bỏ thương thương|Gỡ thương thương|Remove Care|Thay đổi cảm xúc Thương thương|Acted with Care|Change Care reaction)$/i,
  HAHA: /^(Haha|Bỏ Haha|Gỡ Haha|Remove Haha|Thay đổi cảm xúc Haha|Acted with Haha|Change Haha reaction)$/i,
  WOW: /^(Wow|Bỏ Wow|Gỡ Wow|Remove Wow|Thay đổi cảm xúc Wow|Acted with Wow|Change Wow reaction)$/i,
  SAD: /^(Buồn|Sad|Bỏ buồn|Gỡ buồn|Remove Sad|Thay đổi cảm xúc Buồn|Acted with Sad|Change Sad reaction)$/i,
  ANGRY: /^(Phẫn nộ|Angry|Bỏ phẫn nộ|Gỡ phẫn nộ|Remove Angry|Thay đổi cảm xúc Phẫn nộ|Acted with Angry|Change Angry reaction)$/i,
};
const anyReactionTrigger =
  /^(Thích|Like|Đã thích|Yêu thích|Love|Thương thương|Care|Haha|Wow|Buồn|Sad|Phẫn nộ|Angry|Remove .+|Bỏ .+|Gỡ .+|Thay đổi cảm xúc .+|Acted with .+|Change .+ reaction)$/i;
const commentPrompt =
  /^(Viết bình luận|Bình luận dưới tên|Bình luận với vai trò|Bình luận công khai|Thêm bình luận|Write a comment|Write a public comment|Comment as|Public comment|Add a comment)/i;
const nonPostCommentPrompt =
  /^(Trả lời|Phản hồi|Viết phản hồi|Reply|Write a reply|Bạn đang nghĩ gì|Bạn viết gì đi|Viết gì đó|What's on your mind|Write something)/i;

async function assertTargetAvailable(page: Page) {
  const messages = page.getByText(
    /^(This content isn't available(?: right now)?|This post is no longer available|This page isn't available(?: right now)?|Nội dung này hiện không hiển thị|Nội dung này không khả dụng|Bạn hiện không xem được nội dung này)[.!]?$/i,
  );
  for (const message of (await messages.all()).slice(0, 10)) {
    if (
      (await message.isVisible().catch(() => false)) &&
      !(await message
        .locator('xpath=ancestor::*[self::article or @role="article"]')
        .count())
    )
      throw new TargetUnavailable(
        "Bài không thể truy cập bằng tài khoản đã chọn; kiểm tra quyền nhóm hoặc bài đã bị xóa.",
      );
  }
}

function profileKey(href: string) {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("javascript:"))
    return "";
  try {
    const u = new URL(trimmed, "https://www.facebook.com");
    if (
      ![
        "facebook.com",
        "www.facebook.com",
        "web.facebook.com",
        "m.facebook.com",
      ].includes(u.hostname)
    )
      return "";
    if (u.pathname === "/profile.php")
      return (u.searchParams.get("id") || "").toLowerCase();
    if (trimmed.startsWith("?")) return "";
    const path = u.pathname.replace(/\/$/, "").toLowerCase();
    const groupUser = path.match(/^\/groups\/[^/]+\/user\/([^/]+)$/i);
    if (groupUser) return groupUser[1].toLowerCase();
    return /^\/(me|groups|posts|permalink\.php|story\.php|photo|photo\.php|photos|videos|watch|reel|reels|events|hashtag|share|login|checkpoint|messages|notifications)(?:\/|$)/i.test(
      path,
    )
      ? ""
      : path;
  } catch {
    return "";
  }
}

function addActorKey(keys: Set<string>, raw: string | null | undefined) {
  if (!raw) return;
  const key = profileKey(raw) || raw.trim().toLowerCase();
  const clean = key.replace(/^\/+|\/+$/g, "");
  if (!clean) return;
  keys.add(clean);
  keys.add(`/${clean}`);
}

function hrefPostKey(href: string, pageUrl: string): string | null {
  const trimmed = href.trim();
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("javascript:") ||
    trimmed.includes("comment_id=") ||
    trimmed.includes("reply_comment_id=")
  )
    return null;
  if (
    trimmed.startsWith("?") &&
    !/[?&](?:story_fbid|multi_permalinks|set)=/i.test(trimmed)
  )
    return null;
  try {
    const resolved = new URL(trimmed, pageUrl);
    const canonical = canonicalFacebookPost(resolved.toString());
    if (canonical) return canonical.postKey;
    const set = resolved.searchParams.get("set");
    const mediaMatch = set?.match(/^(?:gm|pcb)\.([A-Za-z0-9._-]+)$/i);
    if (mediaMatch) return `post:${mediaMatch[1]}`;
    const videoMatch = resolved.pathname.match(
      /^\/(?:groups\/[^/]+\/|[^/]+\/)?videos\/(\d+)\/?$/i,
    );
    if (videoMatch) return `post:${videoMatch[1]}`;
    return null;
  } catch {
    return null;
  }
}

async function isCommentArticle(article: Locator) {
  const label =
    (await article
      .getAttribute("aria-label", { timeout: 300 })
      .catch(() => null)) || "";
  return /^(Bình luận|Phản hồi|Trả lời|Comment|Reply)(?:\s|$|:)/i.test(
    label.trim(),
  );
}

async function ownArticleDepth(container: Locator) {
  const isArticle = await container
    .evaluate(
      (el) =>
        el.tagName.toLowerCase() === "article" ||
        el.getAttribute("role") === "article",
    )
    .catch(() => true);
  return (
    (await container
      .locator('xpath=ancestor::*[@role="article" or self::article]')
      .count()) + (isArticle ? 1 : 0)
  );
}

async function deduplicateOutermost(containers: Locator[]) {
  if (containers.length <= 1) return containers;
  const handles = await Promise.all(
    containers.map((c) => c.elementHandle({ timeout: 300 }).catch(() => null)),
  );
  const keep: Locator[] = [];
  for (let i = 0; i < containers.length; i++) {
    const current = handles[i];
    if (!current) continue;
    let nested = false;
    for (let j = 0; j < containers.length; j++) {
      if (i === j || !handles[j]) continue;
      const contains = await handles[j]!
        .evaluate((parent, child) => parent !== child && parent.contains(child), current)
        .catch(() => false);
      if (contains) {
        nested = true;
        break;
      }
    }
    if (!nested) keep.push(containers[i]);
  }
  await Promise.all(handles.map((h) => h?.dispose().catch(() => {})));
  return keep;
}

async function hasConflictingPostLink(
  container: Locator,
  pageUrl: string,
  allowedKeys: Set<string>,
) {
  const anchors = container.locator('a[href]:not([href*="comment_id="])');
  for (const link of (await anchors.all()).slice(0, 100)) {
    const href = await link
      .getAttribute("href", { timeout: 300 })
      .catch(() => null);
    const key = href ? hrefPostKey(href, pageUrl) : null;
    if (key && !allowedKeys.has(key)) return true;
  }
  return false;
}

async function hasPostActionControls(container: Locator, isDialog = false) {
  const hasCommentControl =
    (await container.getByRole("textbox", { name: commentPrompt }).count()) >
      0 ||
    (await container
      .getByRole("button", {
        name: /^(Bình luận|Comment|Viết bình luận|Write a comment)$/i,
      })
      .count()) > 0 ||
    (await container
      .getByText(
        /^(Comments are turned off|Commenting has been turned off|Bạn không thể bình luận|Tính năng bình luận đã bị tắt|Bình luận đã bị tắt)/i,
      )
      .count()) > 0;
  if (hasCommentControl) return true;
  if (isDialog) {
    return (
      (await container.locator('article:visible, [role="article"]:visible').count()) >
        0 &&
      (await container.getByRole("button", { name: anyReactionTrigger }).count()) >
        0
    );
  }
  return (
    (await container.getByRole("button", { name: anyReactionTrigger }).count()) >
    0
  );
}

async function targetArticle(
  page: Page,
  allowedKeys: Set<string>,
  allowFallback = false,
) {
  const articles = page.locator('article:visible, [role="article"]:visible');
  const allArticles = (await articles.all()).slice(0, 60);
  const matches: Locator[] = [];
  for (const article of allArticles) {
    if (await isCommentArticle(article)) continue;
    const depth = await ownArticleDepth(article);
    // Ignore nested comment articles when identifying the post itself.
    const ownAnchors = article.locator(
      `xpath=.//a[@href and not(contains(@href,"comment_id="))][count(ancestor::*[@role="article" or self::article])=${depth}]`,
    );
    let found = false;
    for (const link of (await ownAnchors.all()).slice(0, 100)) {
      const href = await link.getAttribute("href", { timeout: 300 }).catch(() => null);
      const key = href ? hrefPostKey(href, page.url()) : null;
      if (key && allowedKeys.has(key)) {
        found = true;
        break;
      }
    }
    if (!found) {
      const allAnchors = article.locator('a[href]:not([href*="comment_id="])');
      let hasMatching = false;
      let hasConflicting = false;
      for (const link of (await allAnchors.all()).slice(0, 100)) {
        const href = await link.getAttribute("href", { timeout: 300 }).catch(() => null);
        const key = href ? hrefPostKey(href, page.url()) : null;
        if (!key) continue;
        if (allowedKeys.has(key)) hasMatching = true;
        else hasConflicting = true;
      }
      if (hasMatching && !hasConflicting) found = true;
    }
    if (found) matches.push(article);
  }
  let uniqueMatches = await deduplicateOutermost(matches);
  if (uniqueMatches.length > 1) {
    const inDialog: Locator[] = [];
    for (const m of uniqueMatches) {
      if ((await m.locator('xpath=ancestor::*[@role="dialog"]').count()) > 0)
        inDialog.push(m);
    }
    if (inDialog.length === 1) uniqueMatches = inDialog;
  }
  if (uniqueMatches.length > 1)
    throw new Error(
      "Không xác định duy nhất bài viết từ permalink. Bài có thể chưa được duyệt hoặc không thể truy cập.",
    );
  if (uniqueMatches.length === 1) return uniqueMatches[0];

  // Prompt Facebook Comet to populate lazy permalink hrefs on timestamp links.
  await page
    .evaluate(() => {
      const links = document.querySelectorAll<HTMLAnchorElement>(
        'a[href="#"], a[href^="?__cft__"]',
      );
      for (let i = 0; i < Math.min(links.length, 15); i++) {
        links[i].dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        links[i].dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      }
    })
    .catch(() => {});

  if (!allowFallback) return null;

  const dialogs = (await page.locator('[role="dialog"]:visible').all()).slice(
    0,
    10,
  );
  for (const dialog of dialogs) {
    if (await isCommentArticle(dialog)) continue;
    if (await hasConflictingPostLink(dialog, page.url(), allowedKeys)) continue;
    if (!(await hasPostActionControls(dialog, true))) continue;
    const dialogArticles = (
      await dialog.locator('article:visible, [role="article"]:visible').all()
    ).slice(0, 20);
    const validDialogArticles: Locator[] = [];
    for (const a of dialogArticles) {
      if (await isCommentArticle(a)) continue;
      if (await hasConflictingPostLink(a, page.url(), allowedKeys)) continue;
      validDialogArticles.push(a);
    }
    const outermostInDialog = await deduplicateOutermost(validDialogArticles);
    if (outermostInDialog.length >= 1) return outermostInDialog[0];
    return dialog;
  }

  const validArticles: Locator[] = [];
  for (const article of allArticles) {
    if (await isCommentArticle(article)) continue;
    if (await hasConflictingPostLink(article, page.url(), allowedKeys))
      continue;
    if (await hasPostActionControls(article, false))
      validArticles.push(article);
  }
  const uniqueFallback = await deduplicateOutermost(validArticles);
  if (uniqueFallback.length >= 1) return uniqueFallback[0];

  const mains = (
    await page.locator('[role="main"]:visible, main:visible').all()
  ).slice(0, 5);
  for (const main of mains) {
    if (await hasConflictingPostLink(main, page.url(), allowedKeys)) continue;
    if (await hasPostActionControls(main, false)) return main;
  }
  return null;
}

async function isCommentElement(
  comment: Locator,
  article: Locator,
  articleDepth: number,
) {
  if ((await comment.count()) !== 1) return false;
  const commentDepth = await ownArticleDepth(comment);
  if (commentDepth > articleDepth) return true;
  if (await isCommentArticle(comment)) return true;
  const [aHandle, cHandle] = await Promise.all([
    article.elementHandle({ timeout: 300 }).catch(() => null),
    comment.elementHandle({ timeout: 300 }).catch(() => null),
  ]);
  try {
    if (!aHandle || !cHandle) return false;
    return await aHandle
      .evaluate((a, c) => a !== c && !c.contains(a), cHandle)
      .catch(() => false);
  } finally {
    await Promise.all([
      aHandle?.dispose().catch(() => {}),
      cHandle?.dispose().catch(() => {}),
    ]);
  }
}

async function ownComment(
  article: Locator,
  content: string,
  actorKeys: Set<string>,
  scope: Locator = article,
) {
  const articleDepth = await ownArticleDepth(article);
  for (const text of (
    await scope.getByText(content, { exact: true }).all()
  ).slice(0, 40)) {
    if (!(await text.isVisible().catch(() => false))) continue;
    const comment = text.locator(
      'xpath=ancestor::*[@role="article" or self::article][1]',
    );
    if (!(await isCommentElement(comment, article, articleDepth))) continue;
    const links = comment.locator('a[href]:not([href*="comment_id="])');
    const count = Math.min(await links.count(), 4);
    for (let i = 0; i < count; i++) {
      const href = await links
        .nth(i)
        .getAttribute("href", { timeout: 300 })
        .catch(() => null);
      const key = href ? profileKey(href) : "";
      if (key && (actorKeys.has(key) || actorKeys.has(key.replace(/^\//, ""))))
        return true;
    }
  }
  return false;
}

async function countMatchedComments(
  article: Locator,
  content: string,
  scope: Locator = article,
) {
  const articleDepth = await ownArticleDepth(article);
  let matched = 0;
  for (const text of (
    await scope.getByText(content, { exact: true }).all()
  ).slice(0, 40)) {
    if (!(await text.isVisible().catch(() => false))) continue;
    const comment = text.locator(
      'xpath=ancestor::*[@role="article" or self::article][1]',
    );
    if (await isCommentElement(comment, article, articleDepth)) matched++;
  }
  return matched;
}

async function enclosingPostScope(article: Locator, depth: number) {
  const dialog = article.locator('xpath=ancestor::*[@role="dialog"][1]');
  if ((await dialog.count()) === 1) return dialog;
  if (depth === 1) {
    const main = article.locator(
      'xpath=ancestor::*[@role="main" or self::main][1]',
    );
    if ((await main.count()) === 1) {
      const articlesInMain = (
        await main.locator('article:visible, [role="article"]:visible').all()
      ).slice(0, 10);
      let nonCommentCount = 0;
      for (const a of articlesInMain) {
        if (!(await isCommentArticle(a))) nonCommentCount++;
      }
      if (nonCommentCount <= 1) return main;
    }
  }
  return null;
}

async function findCommentEditorInScope(scope: Locator, targetDepth: number) {
  const atDepth = scope.locator(
    `xpath=.//*[count(ancestor::*[@role="article" or self::article])=${targetDepth}]`,
  );
  const byRole = atDepth.and(
    scope.getByRole("textbox", { name: commentPrompt }),
  );
  if ((await byRole.count()) > 0) return byRole;

  const editables = atDepth.and(
    scope.locator(
      '[contenteditable="true"]:visible, [contenteditable=""]:visible, [contenteditable="plaintext-only"]:visible, [role="textbox"]:visible, textarea:visible',
    ),
  );
  const count = await editables.count();
  for (let i = 0; i < count; i++) {
    const candidate = editables.nth(i);
    const label =
      (await candidate.getAttribute("aria-label", { timeout: 300 }).catch(() => null)) ||
      (await candidate
        .getAttribute("aria-placeholder", { timeout: 300 })
        .catch(() => null)) ||
      (await candidate
        .getAttribute("placeholder", { timeout: 300 })
        .catch(() => null)) ||
      "";
    if (!nonPostCommentPrompt.test(label.trim())) return candidate;
  }
  return null;
}

async function locatePostCommentEditor(article: Locator, depth: number) {
  const insideArticle = await findCommentEditorInScope(article, depth);
  if (insideArticle) return insideArticle;
  const outer = await enclosingPostScope(article, depth);
  if (outer && depth > 0) {
    const insideOuter = await findCommentEditorInScope(outer, depth - 1);
    if (insideOuter) return insideOuter;
  }
  return null;
}

async function locatePostButtons(article: Locator, depth: number) {
  const atArticle = article.locator(
    `xpath=.//*[self::button or @role="button"][count(ancestor::*[@role="article" or self::article])=${depth}]`,
  );
  if (
    (await atArticle
      .and(article.getByRole("button", { name: anyReactionTrigger }))
      .count()) > 0
  )
    return { scope: article, postButtons: atArticle };
  const outer = await enclosingPostScope(article, depth);
  if (outer && depth > 0) {
    const atOuter = outer.locator(
      `xpath=.//*[self::button or @role="button"][count(ancestor::*[@role="article" or self::article])=${depth - 1}]`,
    );
    if (
      (await atOuter
        .and(outer.getByRole("button", { name: anyReactionTrigger }))
        .count()) > 0
    )
      return { scope: outer, postButtons: atOuter };
  }
  return { scope: article, postButtons: atArticle };
}

async function isReactionSelected(
  postButtons: Locator,
  scope: Locator,
  reactionKey: string,
  wanted: RegExp,
) {
  const selected = postButtons.and(scope.getByRole("button", { name: wanted }));
  if ((await selected.count()) !== 1) return false;
  const pressed = await selected.getAttribute("aria-pressed").catch(() => null);
  const label =
    (await selected.getAttribute("aria-label").catch(() => null)) || "";
  if (
    pressed === "true" ||
    /^(Remove|Bỏ|Gỡ|Đã thích|Thay đổi cảm xúc|Acted with|Change)/i.test(label)
  )
    return true;
  if (reactionKey !== "LIKE" && pressed !== "false") return true;
  return false;
}

export async function interactOnFacebook(
  facebook: FacebookDesktop,
  input: InteractionInput,
  arm: () => Promise<void>,
  signal: AbortSignal,
): Promise<InteractionResult> {
  let page: Page | undefined;
  let attempted = false;
  let stage = "kiểm tra phiên và mở bài";
  const cancel = () => {
    void page?.close().catch(() => {});
  };
  try {
    return await abortable(
      signal,
      async () => {
        const expected = canonicalFacebookPost(input.targetUrl);
        if (!expected) throw new Error("Đích phải là permalink bài Facebook.");
        const opened = await facebook.open(input.accountId);
        page = opened.page;
        if (signal.aborted) {
          cancel();
          signal.throwIfAborted();
        }
        const session = await facebook.check(input.accountId);
        signal.throwIfAborted();
        if (session.state !== "READY")
          return { outcome: session.state, message: session.message };
        if (session.identityHash !== input.identityHash)
          return {
            outcome: "LOGIN_REQUIRED",
            message:
              "Profile đã đổi tài khoản; xác nhận danh tính trước khi tương tác.",
          };
        const actorKeys = new Set<string>();
        addActorKey(actorKeys, page.url());
        const canonicalMe = await page
          .locator('link[rel="canonical"]')
          .first()
          .getAttribute("href", { timeout: 300 })
          .catch(() => null);
        addActorKey(actorKeys, canonicalMe);
        const cookies = await opened.context.cookies(
          "https://www.facebook.com",
        );
        const actor = cookies.find((c) => c.name === "c_user")?.value;
        addActorKey(actorKeys, actor);
        await page.goto(input.targetUrl, { waitUntil: "domcontentloaded" });
        signal.throwIfAborted();
        const check = await facebook.check(input.accountId, false);
        if (check.state !== "READY")
          return { outcome: check.state, message: check.message };
        if (check.identityHash !== input.identityHash)
          return {
            outcome: "LOGIN_REQUIRED",
            message: "Danh tính đã đổi khi mở bài.",
          };
        await assertTargetAvailable(page);
        const currentPost = canonicalFacebookPost(page.url());
        const sameDestinationPfbid =
          !!currentPost &&
          postBelongsToDestination(currentPost.postUrl, expected.postUrl) &&
          (currentPost.postKey.startsWith("post:pfbid") ||
            expected.postKey.startsWith("post:pfbid"));
        if (
          !currentPost ||
          (currentPost.postKey !== expected.postKey && !sameDestinationPfbid)
        )
          throw new Error(
            "Facebook chuyển sang bài khác hoặc bài không còn truy cập được.",
          );
        const allowedKeys = new Set([expected.postKey, currentPost.postKey]);
        stage = "nhận diện bài viết";
        const articleStarted = Date.now();
        const articleDeadline = articleStarted + 90_000;
        let article = await targetArticle(page, allowedKeys, false);
        while (!article && Date.now() < articleDeadline) {
          signal.throwIfAborted();
          await assertTargetAvailable(page);
          await new Promise((resolve) => setTimeout(resolve, 250));
          const allowFallback = Date.now() - articleStarted >= 1_000;
          article = await targetArticle(page, allowedKeys, allowFallback);
        }
        if (!article)
          throw new errors.TimeoutError("Chưa nhận diện được đúng bài viết.");
        if (
          await article
            .getByText(
              /^(Your post is pending|Bài viết của bạn đang chờ|Đang chờ phê duyệt)/i,
            )
            .count()
        )
          throw new Error("Bài đang chờ duyệt; chưa thể tương tác.");

        const depth = await ownArticleDepth(article);
        const commentScope =
          (await enclosingPostScope(article, depth)) || article;

        if (input.kind !== "REACTION") {
          stage = "kiểm tra bình luận đã có";
          if (
            await ownComment(article, input.content, actorKeys, commentScope)
          )
            return {
              outcome: "ALREADY_DONE",
              message:
                "Đã có bình luận cùng nội dung của đúng tài khoản; không gửi thêm.",
            };
          stage = "chuẩn bị bình luận";
          if (
            await commentScope
              .getByText(
                /^(Comments are turned off|Commenting has been turned off|Bạn không thể bình luận|Tính năng bình luận đã bị tắt|Bình luận đã bị tắt)/i,
              )
              .first()
              .isVisible()
              .catch(() => false)
          )
            throw new Error(
              "Bài đã khóa bình luận hoặc tài khoản chưa có quyền bình luận.",
            );
          const editorStarted = Date.now();
          const editorDeadline = editorStarted + 90_000;
          let openedCommentBox = false;
          let editor = await locatePostCommentEditor(article, depth);
          while (!editor && Date.now() < editorDeadline) {
            signal.throwIfAborted();
            await assertTargetAvailable(page);
            if (!openedCommentBox && Date.now() - editorStarted >= 750) {
              openedCommentBox = true;
              await article
                .evaluate((el) => el.scrollIntoView({ block: "end" }))
                .catch(() => {});
              const { scope: btnScope, postButtons } = await locatePostButtons(
                article,
                depth,
              );
              const commentBtn = postButtons.and(
                btnScope.getByRole("button", {
                  name: /^(Bình luận|Comment|Viết bình luận|Write a comment)$/i,
                }),
              );
              if ((await commentBtn.count()) === 1)
                await commentBtn.click({ timeout: 5_000 }).catch(() => {});
              else {
                const placeholder = commentScope
                  .getByText(commentPrompt)
                  .first();
                if (await placeholder.isVisible().catch(() => false))
                  await placeholder.click({ timeout: 5_000 }).catch(() => {});
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
            editor = await locatePostCommentEditor(article, depth);
          }
          if (!editor)
            throw new errors.TimeoutError(
              "Chưa tìm thấy ô bình luận của bài.",
            );
          await editor.first().waitFor({ timeout: 15_000 });
          if ((await editor.count()) !== 1)
            throw new Error(
              "Không xác định duy nhất ô bình luận của bài; chưa gửi.",
            );
          const beforeComments = await countMatchedComments(
            article,
            input.content,
            commentScope,
          );
          await editor.click({ timeout: 15_000 }).catch(() => {});
          const isLexical =
            (await editor
              .getAttribute("data-lexical-editor", { timeout: 300 })
              .catch(() => null)) === "true";
          if (isLexical) {
            await editor.fill("").catch(() => {});
            await page.keyboard.insertText(input.content);
          } else {
            await editor.fill(input.content);
            const filledText =
              (await editor.textContent().catch(() => "")) ||
              (await editor.inputValue().catch(() => ""));
            if (!filledText.trim().includes(input.content.trim())) {
              await editor.click({ timeout: 5_000 });
              await page.keyboard.insertText(input.content);
            }
          }
          await authorize();
          attempted = true;
          await editor.press("Enter", { timeout: 15_000 });
          stage = "xác nhận bình luận";
          const submittedAt = Date.now();
          const until = submittedAt + 15_000;
          let clickedSendButton = false;
          while (Date.now() < until) {
            signal.throwIfAborted();
            if (
              (await ownComment(
                article,
                input.content,
                actorKeys,
                commentScope,
              )) ||
              (await countMatchedComments(
                article,
                input.content,
                commentScope,
              )) > beforeComments
            )
              return {
                outcome: "COMPLETED",
                message:
                  "Đã nhìn thấy bình luận của đúng tài khoản trên bài đã chọn.",
              };
            if (!clickedSendButton && Date.now() - submittedAt >= 750) {
              const remainingText =
                (await editor.textContent().catch(() => "")) ||
                (await editor.inputValue().catch(() => ""));
              if (remainingText.trim().includes(input.content.trim())) {
                clickedSendButton = true;
                const sendBtn = commentScope
                  .locator(
                    '#focused-state-composer-submit [role="button"]:visible:not([aria-disabled="true"]), #focused-state-composer-submit button:visible:not([disabled]), [aria-label="Bình luận"][role="button"]:visible:not([aria-disabled="true"]), [aria-label="Gửi"][role="button"]:visible:not([aria-disabled="true"])',
                  )
                  .last();
                if ((await sendBtn.count()) === 1)
                  await sendBtn.click({ timeout: 5_000 }).catch(() => {});
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          throw new Error(
            "Đã thử gửi nhưng chưa xác nhận được bình luận; cần kiểm tra Facebook.",
          );
        }

        stage = "chuẩn bị cảm xúc";
        const reactionKey = input.reaction || "LIKE";
        const wanted = reactionNames[reactionKey];
        if (!wanted) throw new Error("Cảm xúc không hợp lệ.");
        const buttonDeadline = Date.now() + 30_000;
        let { scope: reactionScope, postButtons } = await locatePostButtons(
          article,
          depth,
        );
        while (
          (await postButtons
            .and(reactionScope.getByRole("button", { name: anyReactionTrigger }))
            .count()) === 0 &&
          Date.now() < buttonDeadline
        ) {
          signal.throwIfAborted();
          await assertTargetAvailable(page);
          await new Promise((resolve) => setTimeout(resolve, 250));
          ({ scope: reactionScope, postButtons } = await locatePostButtons(
            article,
            depth,
          ));
        }
        if (
          await isReactionSelected(
            postButtons,
            reactionScope,
            reactionKey,
            wanted,
          )
        )
          return {
            outcome: "ALREADY_DONE",
            message: "Cảm xúc đã được chọn; không bấm lại.",
          };
        const requested = postButtons.and(
          reactionScope.getByRole("button", { name: wanted }),
        );
        let button: Locator;
        let trigger: Locator | undefined;
        if (reactionKey === "LIKE" && (await requested.count()) === 1)
          button = requested;
        else {
          trigger = postButtons.and(
            reactionScope.getByRole("button", {
              name: anyReactionTrigger,
            }),
          );
          if ((await trigger.count()) !== 1)
            throw new Error("Không xác định duy nhất nút cảm xúc của bài.");
          await trigger.scrollIntoViewIfNeeded().catch(() => {});
          await trigger.hover();
          const menu = page
            .locator(
              '[role="toolbar"]:visible, [role="menu"]:visible, [role="dialog"]:visible, [role="listbox"]:visible',
            )
            .filter({ hasNot: page.locator('article, [role="article"]') })
            .filter({ has: page.getByRole("button", { name: wanted }) });
          const menuDeadline = Date.now() + 10_000;
          let lastHover = Date.now();
          while ((await menu.count()) === 0 && Date.now() < menuDeadline) {
            signal.throwIfAborted();
            if (Date.now() - lastHover >= 2_000) {
              lastHover = Date.now();
              await trigger.hover().catch(() => {});
            }
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
          await menu.first().waitFor({ timeout: 2_000 });
          if ((await menu.count()) !== 1)
            throw new Error("Không xác định duy nhất bảng cảm xúc.");
          button = menu.getByRole("button", { name: wanted });
        }
        await button.click({ trial: true, timeout: 15_000 });
        await authorize();
        attempted = true;
        if (trigger && !(await button.isVisible().catch(() => false))) {
          await trigger.hover();
          await button.waitFor({ state: "visible", timeout: 5_000 });
        }
        await button.click({ timeout: 15_000 });
        stage = "xác nhận cảm xúc";
        const until = Date.now() + 15_000;
        while (Date.now() < until) {
          signal.throwIfAborted();
          const currentButtons = await locatePostButtons(article, depth);
          if (
            await isReactionSelected(
              currentButtons.postButtons,
              currentButtons.scope,
              reactionKey,
              wanted,
            )
          )
            return {
              outcome: "COMPLETED",
              message: "Đã xác nhận cảm xúc được chọn trên đúng bài.",
            };
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(
          "Chưa xác nhận được cảm xúc sau thao tác; kiểm tra Facebook.",
        );

        async function authorize() {
          stage = "xin quyền tương tác";
          signal.throwIfAborted();
          const current = await facebook.check(input.accountId, false);
          if (
            current.state !== "READY" ||
            current.identityHash !== input.identityHash
          )
            throw new IdentityChanged();
          const latestPost = canonicalFacebookPost(page!.url());
          if (!latestPost || !allowedKeys.has(latestPost.postKey))
            throw new Error("Bài đã thay đổi trước thao tác.");
          await assertTargetAvailable(page!);
          await arm();
          signal.throwIfAborted();
        }
      },
      cancel,
    );
  } catch (error) {
    if (!attempted) cancel();
    return {
      outcome:
        error instanceof IdentityChanged
          ? "LOGIN_REQUIRED"
          : attempted
            ? "UNCERTAIN"
            : "FAILED",
      message: `${attempted ? "Đã thử tương tác" : "Chưa thực hiện tương tác"}; lỗi ở bước ${stage}: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 450) : "Lỗi trình duyệt"}`,
      ...(!attempted && error instanceof TargetUnavailable
        ? { issueCode: "TARGET_UNAVAILABLE" as const }
        : {}),
      failure: {
        stage,
        submitAttempted: attempted,
        code: failureCode(error, signal),
      },
    };
  }
}
class IdentityChanged extends Error {}
class TargetUnavailable extends Error {}
