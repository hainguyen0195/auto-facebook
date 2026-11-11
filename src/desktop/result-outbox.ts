import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LinkCaptureResult } from "./published-link";

type PendingResult = { endpoint: string; body: unknown };
type PendingLink = { taskId: string; runId: string; accountId: string };

export async function persistPendingLink(root: string, pending: PendingLink) {
  await writeFile(
    path.join(root, "pending-link.tmp"),
    JSON.stringify(pending),
    { mode: 0o600 },
  );
  await rename(
    path.join(root, "pending-link.tmp"),
    path.join(root, "pending-link.json"),
  );
}

export async function flushPendingLink(
  root: string,
  capture: (accountId: string) => Promise<LinkCaptureResult>,
  send: (endpoint: string, body: unknown) => Promise<unknown>,
) {
  await flushResult(root, send);
  const file = path.join(root, "pending-link.json");
  let pending: PendingLink;
  try {
    pending = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const result = await capture(pending.accountId);
  await persistResult(root, {
    endpoint: `tasks/${pending.taskId}/link`,
    body: {
      runId: pending.runId,
      ...(result.resultUrl
        ? { resultUrl: result.resultUrl }
        : { reason: result.reason }),
    },
  });
  await unlink(file);
  await flushResult(root, send);
}

export async function persistResult(root: string, pending: PendingResult) {
  await writeFile(
    path.join(root, "pending-result.tmp"),
    JSON.stringify(pending),
    { mode: 0o600 },
  );
  await rename(
    path.join(root, "pending-result.tmp"),
    path.join(root, "pending-result.json"),
  );
}

export async function flushResult(
  root: string,
  send: (endpoint: string, body: unknown) => Promise<unknown>,
) {
  const file = path.join(root, "pending-result.json");
  let pending: PendingResult;
  try {
    pending = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await send(pending.endpoint, pending.body);
  await unlink(file);
}
