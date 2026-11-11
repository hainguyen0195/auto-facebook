import { createHash } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import { facebookBrowserChannel } from "./profiles";
import { abortable, attemptSignal, failureCode } from "./attempt";
import type { PublishFailure } from "../lib/automatic-policy";
import {
  PublishedLinkObserver,
  type LinkCaptureResult,
} from "./published-link";

export type SessionCheck = {
  state: "READY" | "LOGIN_REQUIRED" | "CHALLENGE";
  identityHash?: string;
  message: string;
};
export type PublishInput = {
  accountId: string;
  identityHash: string;
  targetUrl: string;
  group: boolean;
  content: string;
  files: { name: string; mimeType: string; buffer: Buffer }[];
};
export type PublishResult = {
  outcome:
    | "PUBLISHED"
    | "PENDING_REVIEW"
    | "LOGIN_REQUIRED"
    | "CHALLENGE"
    | "UNCERTAIN"
    | "FAILED";
  message: string;
  resultUrl?: string;
  failure?: PublishFailure;
};

type PublishProgress = {
  stage: string;
  attempted: boolean;
  onSubmit?: () => void;
};
class FacebookPublishError extends Error {
  constructor(
    readonly progress: PublishProgress,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : "Unknown publishing error", {
      cause,
    });
  }
}

export function isFacebookTarget(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["www.facebook.com", "facebook.com", "web.facebook.com"].includes(
        url.hostname,
      ) &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}

export function matchesFacebookDestination(
  expected: string,
  actual: string,
  group: boolean,
) {
  if (!isFacebookTarget(expected) || !isFacebookTarget(actual)) return false;
  const wanted = new URL(expected),
    current = new URL(actual);
  const clean = (url: URL) => url.pathname.replace(/\/+$/, "").toLowerCase();
  if (group) {
    const groupId = (url: URL) =>
      url.pathname.match(/^\/groups\/([^/]+)(?:\/|$)/i)?.[1].toLowerCase();
    return !!groupId(wanted) && groupId(wanted) === groupId(current);
  }
  return (
    clean(wanted) === clean(current) &&
    (clean(wanted) !== "/profile.php" ||
      wanted.searchParams.get("id") === current.searchParams.get("id"))
  );
}

export class FacebookDesktop {
  private contexts = new Map<string, BrowserContext>();
  private workPages = new Map<string, Page>();
  private opening = new Map<string, Promise<BrowserContext>>();
  private linkObservers = new Map<
    string,
    {
      page: Page;
      identityHash: string;
      observer: PublishedLinkObserver;
    }
  >();
  constructor(private profiles: string | ((accountId: string) => string)) {}
  async open(accountId: string) {
    let context = this.contexts.get(accountId);
    if (!context) {
      let opening = this.opening.get(accountId);
      if (!opening) {
        const profile =
          typeof this.profiles === "function"
            ? this.profiles(accountId)
            : path.join(
                this.profiles,
                createHash("sha256").update(accountId).digest("hex"),
              );
        const channel = facebookBrowserChannel();
        opening = chromium
          .launchPersistentContext(profile, {
            headless: false,
            timeout: 45_000,
            locale: "vi-VN",
            viewport: null,
            // Chrome otherwise discards session cookies on a clean restart.
            args: ["--restore-last-session"],
            ...(channel ? { channel } : {}),
          })
          .then((launched) => {
            this.contexts.set(accountId, launched);
            launched.on("close", () => {
              if (this.contexts.get(accountId) === launched) {
                this.contexts.delete(accountId);
                this.workPages.delete(accountId);
                this.linkObservers.get(accountId)?.observer.stop();
                this.linkObservers.delete(accountId);
              }
            });
            return launched;
          })
          .finally(() => this.opening.delete(accountId));
        this.opening.set(accountId, opening);
      }
      context = await opening;
    }
    let page = this.workPages.get(accountId);
    if (!page || page.isClosed() || page.context() !== context) {
      page = this.workPages.has(accountId)
        ? await context.newPage()
        : context
            .pages()
            .find(
              (candidate) =>
                isFacebookTarget(candidate.url()) &&
                !/\/messages\//.test(candidate.url()),
            ) ||
          context.pages()[0] ||
          (await context.newPage());
      this.workPages.set(accountId, page);
    }
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(45_000);
    return { context, page };
  }
  openContext(accountId: string) {
    const context = this.contexts.get(accountId);
    return context?.pages().some((page) => !page.isClosed()) ? context : null;
  }
  async login(accountId: string) {
    const { page } = await this.open(accountId);
    await page.goto("https://www.facebook.com/", {
      waitUntil: "domcontentloaded",
    });
    await this.showWindow(page);
  }
  private async showWindow(page: Page) {
    // Activating a tab alone does not restore a minimized Chromium window.
    const session = await page.context().newCDPSession(page);
    try {
      const { windowId, bounds } = await session.send(
        "Browser.getWindowForTarget",
      );
      if (bounds.windowState === "minimized")
        await session.send("Browser.setWindowBounds", {
          windowId,
          bounds: { windowState: "normal" },
        });
      await page.bringToFront();
    } finally {
      await session.detach();
    }
  }
  async show(accountId: string): Promise<SessionCheck> {
    const { context, page } = await this.open(accountId);
    await this.showWindow(page);
    if (!isFacebookTarget(page.url()))
      await page.goto("https://www.facebook.com/", {
        waitUntil: "domcontentloaded",
      });
    const result = await this.inspectSession(context, page);
    return {
      ...result,
      message:
        result.state === "READY"
          ? "Đã mở cửa sổ Facebook trên máy đăng."
          : result.message,
    };
  }
  async openTarget(accountId: string, url: string) {
    if (!isFacebookTarget(url)) throw new Error("Địa chỉ phải là Facebook.");
    const { page } = await this.open(accountId);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await this.showWindow(page);
  }
  async check(accountId: string, navigate = true): Promise<SessionCheck> {
    const { context, page } = await this.open(accountId);
    if (navigate)
      await page.goto("https://www.facebook.com/me", {
        waitUntil: "domcontentloaded",
      });
    return this.inspectSession(context, page);
  }
  async observeLogin(accountId: string): Promise<SessionCheck | null> {
    const context = this.contexts.get(accountId);
    const page = context?.pages().find((candidate) => !candidate.isClosed());
    if (!context || !page) return null;
    return this.inspectSession(context, page);
  }
  private async inspectSession(
    context: BrowserContext,
    page: Page,
  ): Promise<SessionCheck> {
    if (
      /\/(checkpoint|two_step_verification|challenge|recover|confirmemail)/i.test(
        page.url(),
      )
    )
      return {
        state: "CHALLENGE",
        message:
          "Facebook yêu cầu xác minh. Hoàn tất trực tiếp trong cửa sổ trình duyệt.",
      };
    const cookies = await context.cookies("https://www.facebook.com/");
    const identity = cookies.find(
      (c) => c.name === "c_user" && /^\d+$/.test(c.value),
    );
    const actor = cookies.find((c) => c.name === "i_user");
    if (identity && actor && actor.value !== identity.value)
      return {
        state: "LOGIN_REQUIRED",
        message:
          "Facebook đang hoạt động dưới danh nghĩa khác. Chuyển về trang cá nhân cần dùng rồi kiểm tra lại phiên.",
      };
    if (
      !identity ||
      /\/(login|login\.php)(?:[/?]|$)/i.test(page.url()) ||
      (await page
        .locator('input[name="email"], input[name="pass"]')
        .first()
        .isVisible()
        .catch(() => false))
    )
      return {
        state: "LOGIN_REQUIRED",
        message:
          "Đăng nhập trong cửa sổ Facebook vừa mở. Nhịp Đăng sẽ tự nhận biết khi bạn đăng nhập xong.",
      };
    return {
      state: "READY",
      identityHash: createHash("sha256").update(identity.value).digest("hex"),
      message:
        "Đã phát hiện phiên Facebook. Kiểm tra danh tính trong cửa sổ Facebook và xác nhận đúng tài khoản trên Nhịp Đăng.",
    };
  }
  async close(accountId?: string) {
    if (accountId) {
      this.linkObservers.get(accountId)?.observer.stop();
      this.linkObservers.delete(accountId);
      await this.opening.get(accountId)?.catch(() => {});
      await this.contexts.get(accountId)?.close();
      this.contexts.delete(accountId);
      this.workPages.delete(accountId);
      return;
    }
    for (const { observer } of this.linkObservers.values()) observer.stop();
    this.linkObservers.clear();
    await Promise.allSettled([...this.opening.values()]);
    await Promise.allSettled([...this.contexts.values()].map((c) => c.close()));
    this.contexts.clear();
    this.workPages.clear();
  }
  async publish(
    input: PublishInput,
    arm: () => Promise<void>,
    signal = attemptSignal(),
  ): Promise<PublishResult> {
    this.linkObservers.get(input.accountId)?.observer.stop();
    this.linkObservers.delete(input.accountId);
    const progress: PublishProgress = {
      stage: "mở nhóm và kiểm tra phiên",
      attempted: false,
    };
    let activePage: Page | undefined;
    const cancel = () => {
      void activePage?.close().catch(() => {});
    };
    try {
      return await abortable(
        signal,
        async () => {
          if (!isFacebookTarget(input.targetUrl))
            throw new Error("Địa chỉ đích không phải Facebook HTTPS.");
          const { context, page } = await this.open(input.accountId);
          activePage = page;
          if (signal.aborted) {
            cancel();
            signal.throwIfAborted();
          }
          if (!isFacebookTarget(page.url())) {
            await page.goto("https://www.facebook.com/me", {
              waitUntil: "commit",
            });
            await page
              .locator("body")
              .waitFor({ state: "visible", timeout: 45_000 });
          }
          const check = await this.inspectSession(context, page);
          signal.throwIfAborted();
          if (check.state !== "READY")
            return { outcome: check.state, message: check.message };
          if (check.identityHash !== input.identityHash)
            return {
              outcome: "LOGIN_REQUIRED",
              message:
                "Facebook trong profile đã đổi tài khoản. Kiểm tra lại và xác nhận danh tính trước khi bật đăng.",
            };
          // Facebook can render its composer while unrelated scripts still block DOMContentLoaded.
          await page.goto(input.targetUrl, { waitUntil: "commit" });
          await page
            .locator("body")
            .waitFor({ state: "visible", timeout: 45_000 });
          signal.throwIfAborted();
          const targetSession = await this.inspectSession(context, page);
          if (targetSession.state !== "READY")
            return {
              outcome: targetSession.state,
              message: targetSession.message,
            };
          if (
            !matchesFacebookDestination(
              input.targetUrl,
              page.url(),
              input.group,
            )
          )
            throw new Error(
              "Facebook đã chuyển sang nơi khác. Kiểm tra link đích; chưa gửi bài.",
            );
          if (/\/(checkpoint|challenge)/i.test(page.url()))
            return {
              outcome: "CHALLENGE",
              message: "Facebook đang yêu cầu xác minh.",
            };
          const cookies = await context.cookies("https://www.facebook.com/");
          const observer = await PublishedLinkObserver.prepare(page, {
            destination: page.url(),
            content: input.content,
            actorId:
              cookies.find((cookie) => cookie.name === "c_user")?.value || "",
          });
          if (signal.aborted) {
            observer.stop();
            signal.throwIfAborted();
          }
          this.linkObservers.set(input.accountId, {
            page,
            identityHash: input.identityHash,
            observer,
          });
          progress.onSubmit = () => observer.activate();
          return await prepareAndPublish(page, input, arm, progress, signal);
        },
        cancel,
      );
    } catch (error) {
      this.linkObservers.get(input.accountId)?.observer.stop();
      this.linkObservers.delete(input.accountId);
      const attempted = progress.attempted;
      const stage = progress.stage;
      // Keep a failed page visible for diagnosis; an abort still closes it to cancel pending actions.
      if (signal.aborted) cancel();
      const detail =
        error instanceof Error
          ? error.message.split("\n")[0].slice(0, 350)
          : "Lỗi trình duyệt";
      return {
        outcome:
          error instanceof FacebookIdentityError
            ? "LOGIN_REQUIRED"
            : attempted
              ? "UNCERTAIN"
              : "FAILED",
        failure: {
          stage,
          submitAttempted: attempted,
          code: failureCode(error, signal),
        },
        message: attempted
          ? `Đã thử bấm Đăng nhưng gặp lỗi ở bước ${stage}: ${detail}. Kiểm tra Facebook trước khi xử lý tiếp; ứng dụng không tự gửi lại.`
          : `Chưa bấm Đăng; lỗi ở bước ${stage}: ${detail}. Đã dừng lượt này trước khi gửi.`,
      };
    }
  }

  async capturePublishedLink(
    accountId: string,
    signal = AbortSignal.timeout(10_000),
  ): Promise<string | null> {
    return (await this.capturePublishedLinkResult(accountId, signal)).resultUrl;
  }

  async capturePublishedLinkResult(
    accountId: string,
    signal = AbortSignal.timeout(10_000),
  ): Promise<LinkCaptureResult> {
    const entry = this.linkObservers.get(accountId);
    this.linkObservers.delete(accountId);
    if (!entry) return { resultUrl: null, reason: "INTERRUPTED" };
    return entry.observer.capture(async () => {
      const session = await this.inspectSession(
        entry.page.context(),
        entry.page,
      );
      return (
        session.state === "READY" && session.identityHash === entry.identityHash
      );
    }, signal);
  }
}

class FacebookIdentityError extends Error {}

// The user chooses to record publication once the authorized submit click completes.
export async function publishOnPage(
  page: Page,
  input: PublishInput,
  arm: () => Promise<void>,
): Promise<PublishResult> {
  const progress = { stage: "mở trình soạn bài", attempted: false };
  try {
    return await prepareAndPublish(page, input, arm, progress);
  } catch (error) {
    throw new FacebookPublishError(progress, error);
  }
}

async function prepareAndPublish(
  page: Page,
  input: PublishInput,
  arm: () => Promise<void>,
  progress: PublishProgress,
  signal?: AbortSignal,
): Promise<PublishResult> {
  progress.stage = "mở trình soạn bài";
  const prompt =
    /^(Bạn đang nghĩ gì[\s\S]*|Bạn viết gì đi[\s\S]*|Viết gì đó[\s\S]*|What's on your mind[\s\S]*|Write something[\s\S]*|Create post|Tạo bài viết)$/i;
  const opener = page.getByRole("button", { name: prompt }).first();
  await opener.click();
  progress.stage = "nhận diện ô nhập nội dung";
  const editorSelector =
    '[contenteditable="true"]:visible, [contenteditable=""]:visible, [contenteditable="plaintext-only"]:visible, textarea:visible';
  const submitName = /^(Đăng|Post|Gửi|Submit)$/i;
  // Facebook editors can omit role=textbox, and old hidden dialogs may remain in the DOM.
  const dialog = page
    .locator(
      'dialog:visible, [role="dialog"]:visible, [aria-modal="true"]:visible',
    )
    .filter({ has: page.locator(editorSelector) })
    .filter({ has: page.getByRole("button", { name: submitName }) })
    .last();
  await dialog
    .waitFor({ state: "visible", timeout: 90_000 })
    .catch((error: unknown) => {
      if (!(error instanceof Error) || error.name !== "TimeoutError")
        throw error;
      error.message =
        "Không tìm thấy ô nhập nội dung và nút Đăng trong cửa sổ soạn bài sau 90 giây. Kiểm tra cửa sổ Facebook có thông báo hoặc yêu cầu quyền đăng không.";
      throw error;
    });
  const editor = dialog.locator(editorSelector).first();
  progress.stage = "điền nội dung bài viết";
  await editor.fill(input.content);
  if (input.files.length) {
    progress.stage = "tải ảnh lên Facebook";
    let fileInput = dialog
      .locator('input[type="file"][accept*="image"]')
      .first();
    if (!(await fileInput.count())) {
      await dialog
        .getByRole("button", {
          name: /^(Ảnh\/video|Photo\/video|Add photos\/videos|Thêm ảnh\/video)$/i,
        })
        .first()
        .click();
      fileInput = dialog.locator('input[type="file"][accept*="image"]').first();
    }
    await fileInput.setInputFiles(input.files);
    await dialog
      .getByRole("progressbar")
      .first()
      .waitFor({ state: "hidden", timeout: 90_000 });
  }
  const submit = dialog.getByRole("button", { name: submitName }).last();
  progress.stage = "chờ nút Đăng sẵn sàng";
  await submit.waitFor({ state: "visible" });
  await submit.click({ trial: true, timeout: 60_000 });
  // Recheck the active identity and server authorization immediately before the irreversible click.
  const cookies = await page.context().cookies("https://www.facebook.com/");
  const identity = cookies.find((c) => c.name === "c_user");
  const actor = cookies.find((c) => c.name === "i_user");
  if (
    !identity ||
    (actor && actor.value !== identity.value) ||
    createHash("sha256").update(identity.value).digest("hex") !==
      input.identityHash
  )
    throw new FacebookIdentityError("Tài khoản Facebook đã đổi trước khi gửi.");
  progress.stage = "xin quyền gửi bài";
  signal?.throwIfAborted();
  if (!matchesFacebookDestination(input.targetUrl, page.url(), input.group))
    throw new Error("Facebook đã đổi nơi đăng trước khi gửi; chưa gửi bài.");
  await arm();
  signal?.throwIfAborted();
  if (!matchesFacebookDestination(input.targetUrl, page.url(), input.group))
    throw new Error(
      "Facebook đã đổi nơi đăng trong khi xin quyền; chưa gửi bài.",
    );
  progress.stage = "bấm nút Đăng";
  progress.onSubmit?.();
  progress.attempted = true;
  await submit.click({ timeout: 15_000, noWaitAfter: true });
  return {
    outcome: "PUBLISHED",
    message: "Đã bấm Đăng trên Facebook; ghi nhận Đã đăng theo thao tác gửi.",
  };
}
