import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...values: ClassValue[]) {
  return twMerge(clsx(values));
}

export const TIMEZONE = "Asia/Bangkok";
export const STATUSES = [
  "SCHEDULED",
  "READY",
  "IN_PROGRESS",
  "PENDING_REVIEW",
  "PUBLISHED",
  "BLOCKED",
  "SKIPPED",
  "CANCELLED",
] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
  SCHEDULED: "Đã lên lịch",
  READY: "Đến lượt đăng",
  IN_PROGRESS: "Đang xử lý",
  PENDING_REVIEW: "Chờ duyệt nhóm",
  PUBLISHED: "Đã đăng",
  BLOCKED: "Tạm dừng",
  SKIPPED: "Đã bỏ qua",
  CANCELLED: "Đã hủy",
};
export const ACCOUNT_LABEL = {
  ACTIVE: "Sẵn sàng",
  PAUSED: "Tạm nghỉ",
  RESTRICTED: "Bị hạn chế",
};
export const COLORS = ["teal", "blue", "amber", "rose", "slate"] as const;

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function dateKey(value: Date | string = new Date()) {
  return dateKeyFormatter.format(new Date(value));
}
export function formatDate(
  value: Date | string,
  options?: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    ...options,
  }).format(new Date(value));
}
export const POST_INTERVAL_PRESETS = [
  0.25, 0.5, 0.75, 1, 3, 5, 10, 15,
] as const;

export function formatIntervalMinutes(minutes: number) {
  const seconds = Math.round(minutes * 60);
  const wholeMinutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return [
    wholeMinutes ? `${wholeMinutes} phút` : "",
    remainder || !seconds ? `${remainder} giây` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function formatTime(
  value: Date | string,
  options?: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(new Date(value).getUTCSeconds() ? { second: "2-digit" as const } : {}),
    ...options,
  }).format(new Date(value));
}
export function localInput(value: Date | string = new Date()) {
  return new Date(new Date(value).getTime() + 7 * 3600_000)
    .toISOString()
    .slice(0, 16);
}
export function localToISO(value: string) {
  const date = new Date(`${value}:00+07:00`);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime())
  )
    throw new Error("Thời gian không hợp lệ.");
  return date.toISOString();
}
export function dayBounds(value: Date | string = new Date()) {
  const start = new Date(`${dateKey(value)}T00:00:00+07:00`);
  return { start, end: new Date(start.getTime() + 86400_000) };
}
export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
}
export function tagList(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ].slice(0, 12);
}
export function assetUrl(id: string, download = false) {
  return `/api/v1/assets/${id}${download ? "/download" : ""}`;
}
