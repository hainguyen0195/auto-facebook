import type { Status } from "./utils";

export function canTransition(from: Status, to: Status) {
  const map: Record<Status, Status[]> = {
    SCHEDULED: ["IN_PROGRESS", "CANCELLED", "BLOCKED"],
    READY: ["IN_PROGRESS", "CANCELLED", "BLOCKED"],
    IN_PROGRESS: [
      "PUBLISHED",
      "PENDING_REVIEW",
      "BLOCKED",
      "SKIPPED",
      "CANCELLED",
    ],
    PENDING_REVIEW: ["PUBLISHED", "SKIPPED"],
    BLOCKED: ["CANCELLED"],
    PUBLISHED: [],
    SKIPPED: [],
    CANCELLED: [],
  };
  return map[from].includes(to);
}
export function isQuietHour(
  hour: number,
  start: number,
  end: number,
  enabled = true,
) {
  if (!enabled || start === end) return false;
  return start < end
    ? hour >= start && hour < end
    : hour >= start || hour < end;
}
export const LIVE_STATUSES = [
  "SCHEDULED",
  "READY",
  "IN_PROGRESS",
  "BLOCKED",
] as const;
export function contentFingerprint(content: string) {
  return content
    .normalize("NFC")
    .toLocaleLowerCase("vi")
    .replace(/\s+/g, " ")
    .trim();
}
