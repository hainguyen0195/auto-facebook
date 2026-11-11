import type { Page, Request, Response } from "playwright";
import {
  canonicalFacebookPost,
  postBelongsToDestination,
} from "../lib/facebook-post-url";
import { abortable } from "./attempt";

export type LinkCaptureReason =
  | "FOUND"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "SESSION_CHANGED"
  | "PAGE_CLOSED"
  | "INTERRUPTED";
export type LinkCaptureResult = {
  resultUrl: string | null;
  reason: LinkCaptureReason;
};
type ExpectedPost = { destination: string; content: string; actorId: string };
const viewPostName = /^(Xem bài viết|Xem bài|View post|See post)$/i;
const regions = '[role="status"], [role="alert"]';
const maxResponseBytes = 2 * 1024 * 1024;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const normalizeText = (value: string) => value.replace(/\r\n/g, "\n").trim();

export function matchesPublicationRequest(
  body: string | null,
  expected: ExpectedPost,
) {
  if (!body || body.length > maxResponseBytes) return false;
  try {
    const form = new URLSearchParams(body);
    const name = form.get("fb_api_req_friendly_name") || "";
    if (
      !/^(?:use)?(?:Comet)?Composer.*(?:StoryCreate|PostCreate|Publish).*Mutation$/.test(
        name,
      )
    )
      return false;
    const input = record(
      record(JSON.parse(form.get("variables") || "null"))?.input,
    );
    const message = record(input?.message)?.text;
    if (
      input?.actor_id !== expected.actorId ||
      typeof message !== "string" ||
      normalizeText(message) !== normalizeText(expected.content)
    )
      return false;
    const group = new URL(expected.destination).pathname.match(
      /^\/groups\/([^/]+)/i,
    )?.[1];
    const audience = record(input.audience);
    const target = audience?.to_id ?? input.target_id ?? input.group_id;
    return group
      ? target === group
      : target === undefined || target === expected.actorId;
  } catch {
    return false;
  }
}

export function linksFromPublicationResponse(
  body: string,
  expected: ExpectedPost,
): string[] {
  if (Buffer.byteLength(body, "utf8") > maxResponseBytes) return [];
  const clean = body.replace(
    /^\s*(?:for\s*\(\s*;;\s*\)|while\s*\(\s*1\s*\))\s*;?\s*/,
    "",
  );
  let payloads: unknown[];
  try {
    payloads = [JSON.parse(clean)];
  } catch {
    try {
      payloads = clean
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .slice(0, 100)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }
  const urls = new Map<string, string>();
  for (const payload of payloads) {
    const root = record(payload),
      data = record(root?.data);
    if (!data || (Array.isArray(root?.errors) && root.errors.length)) continue;
    for (const [key, value] of Object.entries(data)) {
      if (!/^(?:composer_)?(?:story|post)_(?:create|publish)$/.test(key))
        continue;
      const created = record(value);
      // Inspect only the created story itself, never attached/shared or suggested posts.
      const story = record(created?.story) || record(created?.post);
      if (!story) continue;
      const actors = Array.isArray(story.actors) ? story.actors : [];
      if (actors.length && record(actors[0])?.id !== expected.actorId) continue;
      const direct = [story.url, story.permalink_url, story.permalink].filter(
        (url): url is string => typeof url === "string",
      );
      if (direct.length) {
        for (const url of direct) {
          const candidate = canonicalFacebookPost(url);
          if (
            candidate &&
            postBelongsToDestination(candidate.postUrl, expected.destination)
          )
            urls.set(candidate.postKey, candidate.postUrl);
        }
      } else {
        const id = story.post_id ?? story.legacy_fbid;
        if (typeof id !== "string" || !/^\d+$/.test(id)) continue;
        const group = new URL(expected.destination).pathname.match(
          /^\/groups\/([^/]+)/i,
        )?.[1];
        const candidate = canonicalFacebookPost(
          group
            ? `https://www.facebook.com/groups/${group}/posts/${id}`
            : `https://www.facebook.com/permalink.php?story_fbid=${id}&id=${expected.actorId}`,
        );
        if (
          candidate &&
          postBelongsToDestination(candidate.postUrl, expected.destination)
        )
          urls.set(candidate.postKey, candidate.postUrl);
      }
    }
  }
  return [...urls.values()];
}

export class PublishedLinkObserver {
  private active = false;
  private stopped = false;
  private polling = false;
  private timer?: ReturnType<typeof setInterval>;
  private expiry?: ReturnType<typeof setTimeout>;
  private requests = new Set<Request>();
  private pending = 0;
  private unresolved = false;
  private urls = new Map<string, string>();
  private initialUrl: string;
  private constructor(
    private page: Page,
    private expected: ExpectedPost,
    private previous: Set<string>,
  ) {
    this.initialUrl = page.url();
    page.on("request", this.onRequest);
    page.on("response", this.onResponse);
    page.on("framenavigated", this.onNavigation);
    page.on("close", this.onClose);
  }
  static async prepare(page: Page, expected: ExpectedPost) {
    const previous = new Set<string>();
    for (const link of await page
      .locator(regions)
      .getByRole("link", { name: viewPostName })
      .all()) {
      const href = await link.getAttribute("href", { timeout: 300 });
      const candidate =
        href && canonicalFacebookPost(new URL(href, page.url()).toString());
      if (candidate) previous.add(candidate.postKey);
    }
    const initial = canonicalFacebookPost(page.url());
    if (initial) previous.add(initial.postKey);
    return new PublishedLinkObserver(page, expected, previous);
  }
  activate() {
    if (this.stopped || this.active) return;
    this.active = true;
    // Keep short-lived evidence through the result acknowledgement, without retaining response bodies.
    this.timer = setInterval(() => {
      void this.poll().catch(() => {});
    }, 100);
    this.expiry = setTimeout(() => this.stop(), 45_000);
  }
  private add(url: string) {
    if (this.stopped || !this.active) return;
    const candidate = canonicalFacebookPost(url);
    if (
      candidate &&
      !this.previous.has(candidate.postKey) &&
      postBelongsToDestination(candidate.postUrl, this.expected.destination)
    )
      this.urls.set(candidate.postKey, candidate.postUrl);
  }
  private onRequest = (request: Request) => {
    if (
      !this.active ||
      this.stopped ||
      this.requests.size >= 20 ||
      request.method() !== "POST"
    )
      return;
    try {
      const url = new URL(request.url());
      if (
        url.protocol !== "https:" ||
        !["www.facebook.com", "facebook.com"].includes(url.hostname) ||
        url.username ||
        url.password ||
        url.port ||
        !/^\/api\/graphql\/?$/.test(url.pathname)
      )
        return;
      if (matchesPublicationRequest(request.postData(), this.expected))
        this.requests.add(request);
    } catch {
      /* An unrelated request is not evidence of this publication. */
    }
  };
  private onResponse = (response: Response) => {
    if (
      this.stopped ||
      !this.requests.delete(response.request()) ||
      !response.ok()
    )
      return;
    this.pending++;
    void (async () => {
      const length = Number(response.headers()["content-length"]);
      if (length > maxResponseBytes) return;
      const body = await response.body();
      if (!this.stopped && body.length <= maxResponseBytes)
        for (const url of linksFromPublicationResponse(
          body.toString("utf8"),
          this.expected,
        ))
          this.add(url);
    })()
      .catch(() => {})
      .finally(() => {
        this.pending--;
      });
  };
  private onNavigation = () => {
    if (this.page.url() !== this.initialUrl) this.add(this.page.url());
  };
  private onClose = () => this.stop();
  private async poll() {
    if (!this.active || this.stopped || this.polling || this.page.isClosed())
      return;
    this.polling = true;
    try {
      this.onNavigation();
      for (const link of await this.page
        .locator(regions)
        .getByRole("link", { name: viewPostName })
        .all()) {
        if (this.stopped) break;
        if (!(await link.isVisible())) continue;
        const href = await link.getAttribute("href", { timeout: 300 });
        if (href) this.add(new URL(href, this.page.url()).toString());
      }
    } finally {
      this.polling = false;
    }
  }
  async capture(
    verifyIdentity: () => Promise<boolean>,
    signal: AbortSignal,
  ): Promise<LinkCaptureResult> {
    let reason: LinkCaptureReason = "NOT_FOUND";
    try {
      return await abortable(signal, async () => {
        while (!signal.aborted) {
          if (this.page.isClosed())
            return { resultUrl: null, reason: "PAGE_CLOSED" as const };
          if (!(await verifyIdentity()))
            return { resultUrl: null, reason: "SESSION_CHANGED" as const };
          await this.poll();
          if (this.urls.size > 1)
            return { resultUrl: null, reason: "AMBIGUOUS" as const };
          if (
            this.urls.size === 1 &&
            !this.pending &&
            !this.requests.size &&
            !this.unresolved
          )
            return {
              resultUrl: [...this.urls.values()][0],
              reason: "FOUND" as const,
            };
          if (this.stopped) break;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return { resultUrl: null, reason };
      });
    } catch {
      reason = this.urls.size > 1 ? "AMBIGUOUS" : "NOT_FOUND";
      return { resultUrl: null, reason };
    } finally {
      this.stop();
    }
  }
  stop() {
    if (!this.stopped)
      this.unresolved = this.pending > 0 || this.requests.size > 0;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.expiry) clearTimeout(this.expiry);
    this.page.off("request", this.onRequest);
    this.page.off("response", this.onResponse);
    this.page.off("framenavigated", this.onNavigation);
    this.page.off("close", this.onClose);
    this.requests.clear();
  }
}
