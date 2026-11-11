import { createHash } from "node:crypto";
import type { BrowserContext, Page } from "playwright";
import type { ConversationObservation, TrialStatus } from "./state";

export type InboxSnapshot = {
  rows: ConversationObservation[];
  recognized: boolean;
  pinRequired: boolean;
  unsafe: boolean;
};

export async function checkIdentity(
  context: BrowserContext,
  page: Page,
  expectedHash: string,
): Promise<TrialStatus | null> {
  const url = new URL(page.url());
  if (
    url.protocol !== "https:" ||
    !["www.facebook.com", "facebook.com"].includes(url.hostname)
  )
    return "UNSUPPORTED";
  if (
    /\/(checkpoint|challenge|two_step_verification|recover|confirmemail)/i.test(
      url.pathname,
    )
  )
    return "CHALLENGE";
  if (/\/(login|login\.php)(?:\/|$)/i.test(url.pathname))
    return "LOGIN_REQUIRED";
  const cookies = await context.cookies("https://www.facebook.com/");
  const user = cookies.find((c) => c.name === "c_user");
  if (!user || !/^\d+$/.test(user.value)) return "LOGIN_REQUIRED";
  const actor = cookies.find((c) => c.name === "i_user");
  if (
    (actor && actor.value !== user.value) ||
    createHash("sha256").update(user.value).digest("hex") !== expectedHash
  )
    return "WRONG_IDENTITY";
  if (
    await page
      .locator('input[name="email"], input[name="pass"]')
      .first()
      .isVisible()
  )
    return "LOGIN_REQUIRED";
  return null;
}

// The evaluator only reads rendered DOM. It never opens a thread or scrolls it.
export async function readInboxList(page: Page): Promise<InboxSnapshot> {
  // A literal script avoids TSX/esbuild injecting Node-only __name helpers.
  return page.evaluate<InboxSnapshot>(String.raw`(() => {
    const visible = (el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const clean = (s) => s?.replace(/\s+/g, " ").trim() || "";
    const messageTime = (row, lines) => {
      const now = Date.now();
      for (const el of row.querySelectorAll('time[datetime], abbr[data-utime]')) {
        if (!visible(el)) continue;
        const seconds = el.getAttribute("data-utime");
        const at = seconds ? Number(seconds) * 1000 : Date.parse(el.getAttribute("datetime"));
        if (Number.isFinite(at) && at <= now) return new Date(at).toISOString();
      }
      for (const value of lines.slice(1).reverse()) {
        if (/^(?:vừa xong|just now|now|hôm nay|today)$/i.test(value))
          return new Date(now).toISOString();
        if (/^(?:hôm qua|yesterday)$/i.test(value))
          return new Date(now - 86400000).toISOString();
        const relative = value.match(/^(\d+)\s*(phút|giờ|ngày|tuần|tháng|năm|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|[mhdwy])(?:\s*(?:trước|ago))?$/i);
        if (relative) {
          const unit = relative[2].toLowerCase();
          const duration = /^(?:phút|minutes?|mins?|m)$/.test(unit) ? 60000
            : /^(?:giờ|hours?|hrs?|h)$/.test(unit) ? 3600000
            : /^(?:ngày|days?|d)$/.test(unit) ? 86400000
            : /^(?:tuần|weeks?|w)$/.test(unit) ? 604800000
            : /^(?:tháng|months?)$/.test(unit) ? 2592000000 : 31536000000;
          const at = now - Number(relative[1]) * duration;
          if (Number.isFinite(at) && Math.abs(at) < 8640000000000000)
            return new Date(at).toISOString();
        }
        const clock = value.match(/^(\d{1,2}):(\d{2})(?:\s*([ap]m))?$/i);
        if (clock && Number(clock[1]) < 24 && Number(clock[2]) < 60) {
          const at = new Date(now);
          let hour = Number(clock[1]);
          if (clock[3]) hour = hour % 12 + (/pm/i.test(clock[3]) ? 12 : 0);
          at.setHours(hour, Number(clock[2]), 0, 0);
          if (at.getTime() > now) at.setDate(at.getDate() - 1);
          return at.toISOString();
        }
      }
      return null;
    };
    const threadId = (value) => {
      try {
        const url = new URL(value, location.href);
        if (!["facebook.com", "www.facebook.com"].includes(url.hostname)) return null;
        return url.pathname.match(/^\/messages\/(?:e2ee\/)?t\/([\w.:-]+)\/?$/)?.[1] || null;
      } catch { return null; }
    };
    const unsafe = /\/messages\/(?:e2ee\/)?t\//.test(location.pathname) ||
      [...document.querySelectorAll('[contenteditable="true"][role="textbox"]')].some((el) =>
        visible(el) && /^(message|tin nhắn|nhập tin nhắn)/i.test(el.getAttribute("aria-label") || ""),
      );
    const pinRequired = [...document.querySelectorAll('input[type="password"], input[inputmode="numeric"]')]
      .some((el) => visible(el) && /pin|mã|code/i.test([
        el.getAttribute("aria-label"), el.getAttribute("placeholder"),
        el.closest('[role="dialog"]')?.textContent,
      ].join(" ")));
    const roots = [...document.querySelectorAll('[role="dialog"], [role="grid"], [role="navigation"]')]
      .filter(visible)
      .filter((el) => /messenger|chats|đoạn chat|cuộc trò chuyện|tin nhắn/i.test([
        el.getAttribute("aria-label"),
        el.querySelector('[role="heading"], h1, h2')?.textContent,
      ].join(" ")));
    const pinSetupRequired = roots.some((root) =>
      [...root.querySelectorAll('[role="heading"], h1, h2, h3')].some((el) =>
        visible(el) && !el.closest('a') &&
        /^(?:tạo mã pin để truy cập|create a pin to access)/i.test(clean(el.textContent)),
      ),
    );
    const rows = [];
    const ids = new Set();
    for (const root of roots) {
      for (const anchor of root.querySelectorAll('a[href*="/messages/"]')) {
        const id = threadId(anchor.href);
        if (!id || ids.has(id) || !visible(anchor)) continue;
        const row = anchor.closest('[role="row"], [role="listitem"]') || anchor;
        // Do not read a container spanning multiple conversations as a single row.
        if ([...row.querySelectorAll('a[href*="/messages/"]')]
          .some((a) => { const other = threadId(a.href); return other && other !== id; })) continue;
        const activity = /^(?:active now|đang hoạt động|hoạt động (?:\d+.*|gần đây))$/i;
        const lines = row.innerText.split(/\n/).map(clean).filter((s) => s && !activity.test(s));
        const title = row.querySelector('[role="heading"], strong, h3, h4');
        const titleText = clean(title?.textContent);
        const name = (titleText && !activity.test(titleText) ? titleText : lines[0])?.replace(/^(?:nhóm chat|group chat):\s*/i, "");
        if (!name) continue;
        const labels = [...row.querySelectorAll('[aria-label]')]
          .map((el) => clean(el.getAttribute("aria-label")));
        labels.push(clean(row.getAttribute("aria-label")));
        const unread = labels.some((s) => !/mark as|đánh dấu/i.test(s) && /(?:^|[ .,:])(?:unread(?: message)?s?|chưa đọc|tin nhắn chưa đọc)(?:$|[ .,:])/i.test(s))
          || lines.some((s) => /^(?:unread(?: messages?)?|chưa đọc|tin nhắn chưa đọc)(?:\s*:|$)/i.test(s))
          ? true
          : labels.some((s) => /^(?:read|đã đọc)$/i.test(s)) ? false : null;
        const preview = lines.slice(1).map((s) => s.replace(/^(?:unread(?: messages?)?|tin nhắn chưa đọc|chưa đọc)\s*:\s*/i, "")).filter((s) =>
          !/^(?:unread(?: messages?)?|chưa đọc|tin nhắn chưa đọc|đã đọc|read|\d+\s*(?:m|h|d|phút|giờ|ngày)(?: trước)?|\d{1,2}:\d{2}(?:\s*[ap]m)?|active now|đang hoạt động)$/i.test(s),
        ).join(" ").slice(0, 500) || null;
        const lastMessageAt = messageTime(row, lines);
        rows.push({ id, name: name.slice(0, 160), preview, unread,
          ...(lastMessageAt ? { lastMessageAt } : {}),
        });
        ids.add(id);
      }
    }
    // Empty/loading lists are not evidence that all messages have been read.
    return { rows, recognized: rows.length > 0, pinRequired: pinRequired || pinSetupRequired, unsafe };
  })()`);
}

export async function openMessengerPanel(page: Page): Promise<boolean> {
  if (!/^https:\/\/(www\.)?facebook\.com\/?(?:\?.*)?$/.test(page.url()))
    return false;
  const button = page
    .getByRole("button", {
      name: /^Messenger(?:\s*,?\s*\d+\+?\s+(?:(?:tin nhắn\s+)?chưa đọc|unread(?: messages?)?))?$/i,
    })
    .and(page.locator(":not(a)"))
    .filter({ visible: true });
  if ((await button.count()) !== 1 || !(await button.isVisible())) return false;
  if ((await button.getAttribute("aria-expanded")) === "true") return false;
  const openPanel = page.locator('[role="dialog"][aria-label="Messenger"]');
  if (
    await openPanel
      .first()
      .isVisible()
      .catch(() => false)
  )
    return false;
  // This exact control opens the preview panel, never a conversation link.
  await button.click({ timeout: 5_000 });
  return true;
}

// Facebook removes the unread label after reading, without adding a read label.
// The inverse menu action confirms the state without opening or marking a thread.
export async function confirmReadStates(
  page: Page,
  snapshot: InboxSnapshot,
  previouslyUnread: string[],
): Promise<InboxSnapshot> {
  if (snapshot.unsafe || snapshot.pinRequired || !snapshot.recognized)
    return snapshot;
  const known = new Set(previouslyUnread);
  const candidates = snapshot.rows
    .filter((row) => row.unread === null && known.has(row.id))
    .slice(0, 2);
  const actionPattern =
    /^(?:Đánh dấu (?:là )?(?:chưa đọc|đã đọc)|Mark as (?:unread|read))$/i;
  const actions = page.getByText(actionPattern).filter({ visible: true });
  const confirmed = new Map<
    string,
    { preview: string | null; unread: boolean }
  >();
  let latest = snapshot;
  for (const candidate of candidates) {
    if (!/^[\w.:-]+$/.test(candidate.id) || (await actions.count())) break;
    const current = latest.rows.find((row) => row.id === candidate.id);
    if (!current || current.unread !== null) continue;
    const anchor = page.locator(
      `a[href*="/messages/"][href$="/${candidate.id}/"], a[href*="/messages/"][href$="/${candidate.id}"]`,
    );
    const row = page
      .locator('[role="row"], [role="listitem"]')
      .filter({ has: anchor })
      .filter({ visible: true });
    if ((await row.count()) !== 1) continue;
    const options = row
      .getByRole("button", {
        name: /^(?:Lựa chọn khác cho|More options for) /i,
      })
      .filter({ visible: true });
    if ((await options.count()) !== 1) continue;
    let opened = false;
    let unread: boolean | null = null;
    try {
      // Facebook only enables this control after the conversation row is hovered.
      await row.hover({ timeout: 1_000 });
      await options.click({ timeout: 1_000 });
      opened = true;
      await actions.first().waitFor({ state: "visible", timeout: 1_500 });
      if ((await actions.count()) === 1) {
        const text = (await actions.innerText()).trim();
        // "Mark as unread" is available when this conversation is already read.
        unread = !/^(?:Đánh dấu (?:là )?chưa đọc|Mark as unread)$/i.test(text);
      }
    } catch {
      // Missing or changing menus leave the previous observation intact.
    } finally {
      if (opened) await page.keyboard.press("Escape").catch(() => {});
    }
    latest = await readInboxList(page);
    if (latest.unsafe || latest.pinRequired || !latest.recognized)
      return latest;
    if (unread !== null)
      confirmed.set(candidate.id, { preview: current.preview, unread });
  }
  return {
    ...latest,
    rows: latest.rows.map((row) => {
      const proof = confirmed.get(row.id);
      return proof && row.unread === null && row.preview === proof.preview
        ? { ...row, unread: proof.unread }
        : row;
    }),
  };
}
