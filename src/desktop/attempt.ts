import {
  AUTOMATIC_ATTEMPT_MS,
  type PublishFailure,
} from "../lib/automatic-policy";

export function attemptSignal(deadlineAt?: string) {
  const remaining = deadlineAt
    ? Date.parse(deadlineAt) - Date.now()
    : AUTOMATIC_ATTEMPT_MS;
  return AbortSignal.timeout(
    Math.max(
      0,
      Math.min(
        AUTOMATIC_ATTEMPT_MS,
        Number.isFinite(remaining) ? remaining : 0,
      ),
    ),
  );
}

export function failureCode(
  error: unknown,
  signal?: AbortSignal,
): PublishFailure["code"] {
  if (
    signal?.aborted ||
    (error instanceof Error && error.name === "TimeoutError")
  )
    return "TIMEOUT";
  if (error instanceof Error) {
    if (
      /net::ERR_|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(
        error.message,
      )
    )
      return "NETWORK";
    if (error.cause) return failureCode(error.cause, signal);
  }
  return "OTHER";
}

export async function abortable<T>(
  signal: AbortSignal,
  run: () => Promise<T>,
  cancel: () => void = () => {},
): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    abort = () => {
      cancel();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([run(), aborted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
