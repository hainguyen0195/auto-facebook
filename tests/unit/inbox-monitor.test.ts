import { afterEach, describe, expect, it, vi } from "vitest";
import { readInboxMonitor } from "../../src/lib/inbox-monitor";

const now = new Date("2026-11-05T10:00:00Z");
const at = now.toISOString();
const account = { id: "selected", name: "Minh Phan", color: "teal" };
const snapshot = {
  accountName: "Minh Phan",
  status: "ONLINE",
  checkedAt: at,
  lastSuccessAt: at,
  reason: "Internal details must not leak",
  cookie: "must-not-leak",
  conversations: [
    {
      id: "thread",
      name: "Customer",
      preview: "Hello",
      unread: true,
      observedAt: at,
    },
  ],
};
afterEach(() => vi.unstubAllGlobals());

describe("private inbox monitor bridge", () => {
  it("accepts observations produced during the request with small clock skew", async () => {
    const produced = new Date(now.getTime() + 50).toISOString();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              ...snapshot,
              checkedAt: produced,
              conversations: [
                { ...snapshot.conversations[0], observedAt: produced },
              ],
            }),
          ),
        ),
    );
    const result = await readInboxMonitor("http://monitor:8787", account, now);
    expect(result.conversations).toHaveLength(1);
    expect(result.fresh).toBe(true);
  });
  it("returns only allowed observations and filters expired rows and fields", async () => {
    const expired = new Date(now.getTime() - 86_400_001).toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...snapshot,
            conversations: [
              ...snapshot.conversations,
              {
                ...snapshot.conversations[0],
                id: "expired",
                observedAt: expired,
              },
              {
                ...snapshot.conversations[0],
                id: "old-preview",
                previewObservedAt: expired,
                unreadObservedAt: expired,
              },
            ],
          }),
        ),
      ),
    );
    const result = await readInboxMonitor("http://monitor:8787", account, now);
    expect(result.fresh).toBe(true);
    expect(result.conversations).toHaveLength(2);
    expect(result.conversations[1].preview).toBeNull();
    expect(result.conversations[1].unread).toBeNull();
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
    expect(JSON.stringify(result)).not.toContain("Internal details");
    expect(result.partial).toBe(true);
  });

  it("preserves explicitly offline observations and labels an old process snapshot stale", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...snapshot,
            status: "OFFLINE",
            checkedAt: new Date(now.getTime() - 120_000).toISOString(),
          }),
        ),
      ),
    );
    const result = await readInboxMonitor("http://monitor:8787", account, now);
    expect(result.status).toBe("OFFLINE");
    expect(result.fresh).toBe(false);
    expect(result.conversations[0].unread).toBe(true);
  });

  it("rejects invalid results and returns a generic error without internal addresses", async () => {
    for (const response of [
      new Response("failure", { status: 502 }),
      new Response("{}"),
      new Response(JSON.stringify({ ...snapshot, status: "unknown" })),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(
        readInboxMonitor("http://private-monitor:8787", account, now),
      ).rejects.toMatchObject({ status: 503 });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("secret internal URL")),
    );
    await expect(
      readInboxMonitor("http://private-monitor:8787", account, now),
    ).rejects.not.toThrow("secret internal URL");
  });
});
