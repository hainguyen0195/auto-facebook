import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  flushPendingLink,
  flushResult,
  persistPendingLink,
  persistResult,
} from "../../src/desktop/result-outbox";

describe("publication result before link capture", () => {
  it("retains the pending link across a lost result acknowledgement", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nhipdang-links-"));
    try {
      const pending = { taskId: "task", runId: "run", accountId: "actor" };
      await persistResult(root, {
        endpoint: "tasks/task/result",
        body: { outcome: "PUBLISHED" },
      });
      await persistPendingLink(root, pending);
      await expect(
        flushResult(root, async () => {
          throw new Error("lost ACK");
        }),
      ).rejects.toThrow("lost ACK");
      expect(
        JSON.parse(
          await readFile(path.join(root, "pending-link.json"), "utf8"),
        ),
      ).toEqual(pending);
      const sent: string[] = [];
      await expect(
        flushPendingLink(
          root,
          async (accountId) => {
            expect(accountId).toBe("actor");
            expect(sent).toEqual(["tasks/task/result"]);
            return {
              reason: "FOUND",
              resultUrl: "https://www.facebook.com/a/posts/987",
            };
          },
          async (endpoint) => {
            sent.push(endpoint);
            if (endpoint.endsWith("/link")) throw new Error("link ACK lost");
          },
        ),
      ).rejects.toThrow("link ACK lost");
      let body: unknown;
      await flushResult(root, async (_, input) => {
        body = input;
      });
      expect(body).toEqual({
        runId: "run",
        resultUrl: "https://www.facebook.com/a/posts/987",
      });
      await flushPendingLink(
        root,
        async () => {
          throw new Error("Must not recapture after the durable link result");
        },
        async () => {},
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("records an interruption after restart without replaying a Facebook action", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nhipdang-links-"));
    try {
      await persistPendingLink(root, {
        taskId: "task",
        runId: "run",
        accountId: "actor",
      });
      let sent: unknown;
      await flushPendingLink(
        root,
        async () => ({ resultUrl: null, reason: "INTERRUPTED" }),
        async (endpoint, body) => {
          sent = { endpoint, body };
        },
      );
      expect(sent).toEqual({
        endpoint: "tasks/task/link",
        body: { runId: "run", reason: "INTERRUPTED" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
