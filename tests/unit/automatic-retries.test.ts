import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { automaticFailureState } from "../../src/lib/automatic-policy";
import {
  abortable,
  attemptSignal,
  failureCode,
} from "../../src/desktop/attempt";
import { flushResult, persistResult } from "../../src/desktop/result-outbox";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("retry policy and durable results", () => {
  it("uses bounded backoff and leaves permanent and exhausted errors for the user", () => {
    const now = new Date("2026-11-04T03:00:00Z");
    expect(automaticFailureState(1, true, now).nextAttemptAt).toEqual(
      new Date("2026-11-04T03:01:00Z"),
    );
    expect(automaticFailureState(2, true, now).nextAttemptAt).toEqual(
      new Date("2026-11-04T03:03:00Z"),
    );
    expect(automaticFailureState(3, true, now)).toMatchObject({
      automaticPhase: "SAFE_FAILED",
      nextAttemptAt: null,
    });
    expect(automaticFailureState(1, false, now)).toMatchObject({
      automaticPhase: "SAFE_FAILED",
      nextAttemptAt: null,
    });
    expect(
      failureCode(
        new TypeError("fetch failed", { cause: new Error("ECONNRESET") }),
      ),
    ).toBe("NETWORK");
    expect(failureCode(new Error("Unknown browser failure"))).toBe("OTHER");
  });

  it("cancels an operation that ignores its signal at the deadline", async () => {
    let cancelled = false;
    const signal = attemptSignal(new Date(Date.now() + 30).toISOString());
    // Keep the process alive while AbortSignal's unreferenced timer runs.
    const timer = setTimeout(() => {}, 1000);
    try {
      await expect(
        abortable(
          signal,
          () => new Promise(() => {}),
          () => {
            cancelled = true;
          },
        ),
      ).rejects.toHaveProperty("name", "TimeoutError");
      expect(cancelled).toBe(true);
      expect(failureCode(new Error("Page closed"), signal)).toBe("TIMEOUT");
    } finally {
      clearTimeout(timer);
    }
  });

  it("replays a saved result after a lost acknowledgement, without overwriting it with new work", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nhipdang-outbox-"));
    roots.push(root);
    const pending = {
      endpoint: "tasks/task/result",
      body: { runId: "first", outcome: "PUBLISHED" },
    };
    await persistResult(root, pending);
    let deliveries = 0;
    const send = async () => {
      deliveries++;
      if (deliveries === 1) throw new Error("Lost acknowledgement");
    };
    await expect(flushResult(root, send)).rejects.toThrow(
      "Lost acknowledgement",
    );
    expect(
      JSON.parse(
        await readFile(path.join(root, "pending-result.json"), "utf8"),
      ),
    ).toEqual(pending);
    await flushResult(root, async (endpoint, body) => {
      expect({ endpoint, body }).toEqual(pending);
      await send();
    });
    await expect(
      readFile(path.join(root, "pending-result.json")),
    ).rejects.toHaveProperty("code", "ENOENT");
    await flushResult(root, async () => {
      throw new Error("Must not deliver an acknowledged result again");
    });
    expect(deliveries).toBe(2);
  });
});
