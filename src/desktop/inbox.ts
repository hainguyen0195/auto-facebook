import type { Page } from "playwright";
import type { FacebookDesktop } from "./facebook";
import { abortable } from "./attempt";
import {
  checkIdentity,
  confirmReadStates,
  openMessengerPanel,
  readInboxList,
} from "../inbox-trial/browser";
import type {
  ConversationObservation,
  TrialStatus,
} from "../inbox-trial/state";

export type DesktopInboxObservation = {
  status: TrialStatus;
  identityHash?: string;
  conversations: ConversationObservation[];
};

export class FacebookInboxReader {
  private pages = new Map<string, Page>();
  constructor(private facebook: FacebookDesktop) {}

  async read(
    accountId: string,
    identityHash: string,
    externalSignal?: AbortSignal,
    previouslyUnread: string[] = [],
  ): Promise<DesktopInboxObservation> {
    const timeout = AbortSignal.timeout(10_000);
    const signal = externalSignal
      ? AbortSignal.any([timeout, externalSignal])
      : timeout;
    let page = this.pages.get(accountId);
    const cancel = () => {
      void page?.close().catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await abortable(signal, async () => {
        // Inbox polling must never launch Chrome or recreate a posting tab.
        const context = this.facebook.openContext(accountId);
        if (!context) {
          this.pages.delete(accountId);
          return { status: "STOPPED" as const, conversations: [] };
        }
        signal.throwIfAborted();
        let created = false;
        if (!page || page.isClosed() || page.context() !== context) {
          page = await context.newPage();
          this.pages.set(accountId, page);
          if (signal.aborted) {
            await page.close().catch(() => {});
            signal.throwIfAborted();
          }
          created = true;
        }
        if (!created) {
          const identity = await checkIdentity(context, page, identityHash);
          if (identity) return { status: identity, conversations: [] };
          const view = await readInboxList(page);
          if (view.unsafe) {
            // Leave the user's conversation open and use a separate tab next poll.
            this.pages.delete(accountId);
            page = undefined;
            return { status: "UNSAFE_VIEW" as const, conversations: [] };
          }
          if (view.pinRequired)
            return { status: "PIN_REQUIRED" as const, conversations: [] };
        }
        // Facebook updates this tab live; polling should not reload it or dismiss prompts.
        if (created)
          await page.goto("https://www.facebook.com/", {
            waitUntil: "domcontentloaded",
            timeout: 8_000,
          });
        else {
          const reachable = await page.evaluate(async () => {
            if (!navigator.onLine) return false;
            const response = await fetch("/robots.txt", {
              cache: "no-store",
              redirect: "error",
              signal: AbortSignal.timeout(3000),
            });
            return response.ok;
          });
          if (!reachable) throw new Error("Offline");
        }
        const identity = await checkIdentity(context, page, identityHash);
        if (identity) return { status: identity, conversations: [] };
        let snapshot = await readInboxList(page);
        if (
          !snapshot.unsafe &&
          !snapshot.pinRequired &&
          !snapshot.recognized &&
          (await openMessengerPanel(page))
        ) {
          await page.waitForTimeout(1500);
          snapshot = await readInboxList(page);
        }
        if (!created)
          snapshot = await confirmReadStates(page, snapshot, previouslyUnread);
        const after = await checkIdentity(context, page, identityHash);
        if (after) return { status: after, conversations: [] };
        if (snapshot.unsafe) {
          if (created) {
            // Facebook can restore a chat in every new tab; don't accumulate those tabs.
            await page.close().catch(() => {});
            this.pages.delete(accountId);
            page = undefined;
          }
          return { status: "UNSAFE_VIEW" as const, conversations: [] };
        }
        if (snapshot.pinRequired)
          return { status: "PIN_REQUIRED" as const, conversations: [] };
        if (!snapshot.recognized)
          return { status: "UNSUPPORTED" as const, conversations: [] };
        return {
          status: "ONLINE" as const,
          identityHash,
          conversations: snapshot.rows.slice(0, 200),
        };
      });
      return result;
    } catch {
      await page?.close().catch(() => {});
      this.pages.delete(accountId);
      return { status: "OFFLINE", conversations: [] };
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  async releaseExcept(accountIds: Set<string>) {
    for (const [accountId, page] of this.pages) {
      if (accountIds.has(accountId)) continue;
      await page.close().catch(() => {});
      this.pages.delete(accountId);
    }
  }
}
