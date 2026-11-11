import { z } from "zod";
import { COLORS, STATUSES } from "./utils";
z.config(z.locales.vi());

const fbHosts = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
  "mbasic.facebook.com",
]);
export function normalizeFacebookUrl(
  input: string,
  type: "group" | "profile" | "post" = "post",
) {
  let url: URL;
  try {
    url = new URL(
      /^https?:\/\//i.test(input.trim())
        ? input.trim()
        : `https://${input.trim()}`,
    );
  } catch {
    throw new Error("Link Facebook không hợp lệ.");
  }
  if (
    !fbHosts.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.port ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("Vui lòng dùng link facebook.com.");
  const path = url.pathname.replace(/\/+$/, "");
  if (type === "group") {
    const match = path.match(/^\/groups\/([a-z\d._-]+)$/i);
    if (!match)
      throw new Error(
        "Link nhóm phải có dạng facebook.com/groups/ten-hoac-id.",
      );
    return `https://www.facebook.com/groups/${match[1].toLowerCase()}`;
  }
  if (type === "profile") {
    if (
      path === "/profile.php" &&
      /^\d+$/.test(url.searchParams.get("id") || "")
    )
      return `https://www.facebook.com/profile.php?id=${url.searchParams.get("id")}`;
    if (!/^\/[a-z\d._-]+$/i.test(path) && !/^\/people\/[^/]+\/\d+$/i.test(path))
      throw new Error("Link cá nhân không hợp lệ.");
    if (
      /^\/(groups|login|logout|settings|watch|marketplace|share|reel|reels|photo|photos|profile\.php)$/i.test(
        path,
      )
    )
      throw new Error("Hãy nhập link trang cá nhân.");
    return `https://www.facebook.com${path}`;
  }
  if (!path || path === "/login" || path === "/logout")
    throw new Error("Hãy nhập link bài viết Facebook.");
  url.protocol = "https:";
  url.hostname = "www.facebook.com";
  url.hash = "";
  return url.toString();
}
const fbUrl = (type: "group" | "profile" | "post") =>
  z
    .string()
    .trim()
    .max(2048)
    .transform((input, ctx) => {
      try {
        return normalizeFacebookUrl(input, type);
      } catch (e) {
        ctx.addIssue({ code: "custom", message: (e as Error).message });
        return z.NEVER;
      }
    });
export const idSchema = z.string().min(1).max(80);
const tags = z.array(z.string().trim().min(1).max(40)).max(12).default([]);
export const accountSchema = z
  .object({
    name: z.string().trim().min(1, "Nhập tên tài khoản.").max(100),
    url: fbUrl("profile"),
    profileName: z
      .string()
      .trim()
      .min(1, "Nhập tên profile trình duyệt.")
      .max(100),
    color: z.enum(COLORS).default("teal"),
    status: z.enum(["ACTIVE", "PAUSED", "RESTRICTED"]).default("ACTIVE"),
    dailyLimit: z.number().int().min(1).max(100).default(10),
    postIntervalMinutes: z
      .number()
      .min(0)
      .max(10080)
      .multipleOf(0.25)
      .default(5),
    quietHoursEnabled: z.boolean().optional(),
    quietStart: z.number().int().min(0).max(23).default(22),
    quietEnd: z.number().int().min(0).max(23).default(7),
    note: z.string().trim().max(2000).default(""),
  })
  .transform((input) => ({
    ...input,
    quietHoursEnabled:
      input.quietHoursEnabled ?? input.quietStart !== input.quietEnd,
  }))
  .refine(
    (input) => !input.quietHoursEnabled || input.quietStart !== input.quietEnd,
    {
      path: ["quietEnd"],
      message:
        "Chọn giờ kết thúc khác giờ bắt đầu, hoặc bỏ chọn Áp dụng giờ nghỉ.",
    },
  );
export const groupSchema = z.object({
  name: z.string().trim().min(1, "Nhập tên hội nhóm.").max(160),
  url: fbUrl("group"),
  tags,
  rules: z.string().trim().max(4000).default(""),
  minIntervalMinutes: z.number().int().min(0).max(525600).default(5),
  accountIds: z.array(idSchema).max(100).default([]),
});
export const postSchema = z.object({
  title: z.string().trim().min(1, "Nhập tiêu đề để dễ tìm lại.").max(160),
  content: z.string().trim().min(1, "Nhập nội dung bài viết.").max(63206),
  tags,
  assetIds: z.array(idSchema).max(20).default([]),
  version: z.number().int().positive().optional(),
});
export const scheduleSchema = z.object({
  executionMode: z.enum(["MANUAL", "AUTOMATIC"]).default("MANUAL"),
  postId: idSchema,
  scheduledAt: z.iso.datetime({ offset: true }),
  intervalMinutes: z.number().min(0).max(10080).multipleOf(0.25).default(0),
  targets: z
    .array(
      z.object({
        accountId: idSchema,
        groupId: idSchema.nullable(),
        sourceAccountId: idSchema.optional(),
      }),
    )
    .min(1, "Chọn ít nhất một nơi đăng.")
    .max(500),
  acknowledgeWarnings: z.boolean().default(false),
  confirmGroupAccess: z.boolean().optional(),
  idempotencyKey: z.uuid(),
});
export const taskActionSchema = z
  .object({
    action: z.enum(["start", "record", "cancel", "retry"]),
    status: z
      .enum(["PUBLISHED", "PENDING_REVIEW", "BLOCKED", "SKIPPED"])
      .optional(),
    version: z.number().int().positive(),
    operationId: z.uuid(),
    note: z.string().trim().max(4000).default(""),
    resultUrl: z.union([z.literal(""), fbUrl("post")]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === "record" && !v.status)
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: "Chọn kết quả xử lý.",
      });
  });
export const statusSchema = z.enum(STATUSES);
export type AccountInput = z.infer<typeof accountSchema>;
export type GroupInput = z.infer<typeof groupSchema>;
export type PostInput = z.infer<typeof postSchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
export type TaskActionInput = z.infer<typeof taskActionSchema>;
