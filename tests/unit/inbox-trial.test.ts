import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  freshState,
  mergeSnapshot,
  parseState,
  pruneState,
  recordStatus,
  RETENTION_MS,
} from "../../src/inbox-trial/state";
import { loadState, saveState } from "../../src/inbox-trial/storage";

const start = new Date("2026-11-05T10:00:00Z");
const later = (ms: number) => new Date(start.getTime() + ms);
const row = { id: "123", name: "Customer", preview: "Hello", unread: true };

describe("isolated inbox trial checkpoints", () => {
  it("establishes a quiet baseline, then detects an unread preview change once", () => {
    const baseline = mergeSnapshot(
      freshState("workspace:account", start),
      [row],
      start,
    );
    expect(baseline.events).toEqual([]);
    const changed = mergeSnapshot(
      baseline,
      [{ ...row, preview: "Second message" }],
      later(30_000),
    );
    expect(changed.events.map((e) => e.kind)).toEqual(["PREVIEW_CHANGED"]);
    expect(
      mergeSnapshot(
        changed,
        [{ ...row, preview: "Second message" }],
        later(60_000),
      ).events,
    ).toHaveLength(1);
  });

  it("does not mark a missing or unrecognized row as read", () => {
    const baseline = mergeSnapshot(freshState("scope", start), [row], start);
    const missing = mergeSnapshot(baseline, [], later(30_000));
    expect(missing.conversations[0].unread).toBe(true);
    const unknown = mergeSnapshot(
      missing,
      [{ ...row, unread: null, preview: null }],
      later(60_000),
    );
    expect(unknown.conversations[0].unread).toBe(true);
    expect(unknown.conversations[0].preview).toBe("Hello");
    expect(unknown.events).toEqual([]);
  });

  it("records a confirmed read transition and a different conversation", () => {
    const baseline = mergeSnapshot(freshState("scope", start), [row], start);
    const next = mergeSnapshot(
      baseline,
      [
        { ...row, unread: false },
        { ...row, id: "456" },
      ],
      later(30_000),
    );
    expect(next.events.map((e) => e.kind)).toEqual([
      "READ_STATE_CHANGED",
      "UNREAD_FOUND",
    ]);
    expect(next.conversations).toHaveLength(2);
  });

  it("preserves the previous successful time and unread data across network, identity and session failures", () => {
    const baseline = mergeSnapshot(freshState("scope", start), [row], start);
    for (const status of [
      "OFFLINE",
      "LOGIN_REQUIRED",
      "CHALLENGE",
      "WRONG_IDENTITY",
      "UNSUPPORTED",
      "PIN_REQUIRED",
    ] as const) {
      const next = recordStatus(
        baseline,
        status,
        "Needs attention",
        later(30_000),
      );
      expect(next.lastSuccessAt).toBe(start.toISOString());
      expect(next.conversations).toEqual(baseline.conversations);
      expect(next.status).toBe(status);
    }
  });

  it("prunes private data and deduplication fingerprints after 24 hours even when offline", () => {
    const baseline = mergeSnapshot(freshState("scope", start), [row], start);
    const next = mergeSnapshot(
      baseline,
      [{ ...row, preview: "Changed" }],
      later(30_000),
    );
    const pruned = recordStatus(
      next,
      "OFFLINE",
      "Unavailable",
      later(RETENTION_MS + 30_001),
    );
    expect(pruned.conversations).toEqual([]);
    expect(pruned.events).toEqual([]);
    expect(pruned.fingerprints).toEqual([]);
    expect(pruneState(next, later(31_000)).conversations).toHaveLength(1);
  });

  it("refuses checkpoints belonging to a different workspace, account or identity", () => {
    const state = JSON.stringify(
      freshState("workspace:account:identity", start),
    );
    expect(() =>
      parseState(state, "another:account:identity", start),
    ).toThrow();
    expect(() =>
      parseState("{}", "workspace:account:identity", start),
    ).toThrow();
    expect(() =>
      parseState("broken", "workspace:account:identity", start),
    ).toThrow();
  });

  it("expires an old preview even when the row remains visible with unknown fields", () => {
    const baseline = mergeSnapshot(freshState("scope", start), [row], start);
    const unknown = { ...row, unread: null, preview: null };
    const retained = mergeSnapshot(
      baseline,
      [unknown],
      later(RETENTION_MS - 1000),
    );
    const expired = mergeSnapshot(
      retained,
      [unknown],
      later(RETENTION_MS + 1000),
    );
    expect(expired.conversations[0].preview).toBeNull();
    expect(expired.conversations[0].unread).toBeNull();
  });

  it("saves atomically and resumes without replaying observations after a restart", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "inbox-trial-"));
    const file = path.join(directory, "state.json");
    const at = new Date();
    try {
      let state = await loadState(file, "scope");
      state = mergeSnapshot(state, [row], at);
      state = mergeSnapshot(state, [{ ...row, preview: "Changed" }], at);
      await saveState(file, state);
      const restored = await loadState(file, "scope");
      expect(
        mergeSnapshot(restored, [{ ...row, preview: "Changed" }], at).events,
      ).toHaveLength(1);
      expect(JSON.parse(await readFile(file, "utf8")).scope).toBe("scope");
      await expect(loadState(file, "wrong-scope")).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
