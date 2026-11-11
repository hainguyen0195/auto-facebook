export const AUTOMATIC_ATTEMPT_MS = 4 * 60_000;
export const AUTOMATIC_MAX_ATTEMPTS = 3;

export type PublishFailure = {
  stage: string;
  submitAttempted: boolean;
  code: "TIMEOUT" | "NETWORK" | "OTHER";
};

export function automaticFailureState(
  attempts: number,
  retryable: boolean,
  now = new Date(),
) {
  const retry = retryable && attempts < AUTOMATIC_MAX_ATTEMPTS;
  return {
    status: retry ? ("READY" as const) : ("BLOCKED" as const),
    automaticPhase: retry ? "RETRY_WAIT" : "SAFE_FAILED",
    nextAttemptAt: retry
      ? new Date(now.getTime() + (attempts <= 1 ? 60_000 : 180_000))
      : null,
  };
}
