import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { AppError, assertFound } from "./errors";
import { workspaceTransaction, digest, taskInclude } from "./service";
import { canonicalFacebookPost } from "./facebook-post-url";
import { dateKey, dayBounds } from "./utils";

export const postLinkSchema = z.object({
  resultUrl: z.string().trim().max(2048),
  version: z.number().int().positive(),
  operationId: z.uuid(),
});
const activeStatuses = [
  "PLANNED",
  "APPROVED",
  "IN_PROGRESS",
  "RETRY_WAIT",
  "NEEDS_REVIEW",
];
export const desktopPostLinkSchema = z
  .object({
    runId: z.uuid(),
    resultUrl: z.string().min(1).max(2048).optional(),
    reason: z
      .enum([
        "NOT_FOUND",
        "AMBIGUOUS",
        "SESSION_CHANGED",
        "PAGE_CLOSED",
        "INTERRUPTED",
      ])
      .optional(),
  })
  .refine(
    (input) => !!input.resultUrl !== !!input.reason,
    "Gửi link hoặc lý do chưa lấy được link.",
  );
const missingLinkNotes = {
  NOT_FOUND:
    "Không tìm thấy permalink chắc chắn trong phản hồi gửi bài, điều hướng hoặc thông báo mới trong thời gian chờ.",
  AMBIGUOUS: "Có nhiều permalink khác nhau; chưa đủ chắc chắn để gán đúng bài.",
  SESSION_CHANGED:
    "Phiên Facebook hoặc danh tính đã thay đổi trong lúc lấy link.",
  PAGE_CLOSED: "Cửa sổ Facebook đã đóng trước khi hoàn tất lấy link.",
  INTERRUPTED:
    "Tiến trình đã khởi động lại; bằng chứng của lượt gửi không còn trong bộ nhớ.",
};

export async function savePostLink(
  workspaceId: string,
  id: string,
  input: z.infer<typeof postLinkSchema>,
) {
  const target = canonicalFacebookPost(input.resultUrl);
  if (!target)
    throw new AppError(
      400,
      "Dùng link bài gốc có /posts/, /permalink/ hoặc story_fbid.",
    );
  return workspaceTransaction(workspaceId, async (tx) => {
    const task = assertFound(
      await tx.task.findFirst({ where: { id, workspaceId } }),
    );
    const requestHash = digest({ id, ...input });
    const previous = await tx.taskEvent.findUnique({
      where: { id: input.operationId },
    });
    if (previous) {
      if (previous.taskId !== id || previous.requestHash !== requestHash)
        throw new AppError(409, "Mã thao tác đã được dùng.");
      return tx.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
    }
    if (task.version !== input.version)
      throw new AppError(409, "Bài đã thay đổi. Tải lại trước khi sửa link.");
    if (!["PUBLISHED", "PENDING_REVIEW"].includes(task.status))
      throw new AppError(409, "Chỉ lưu link cho bài đã ghi nhận gửi.");
    if (
      task.resultUrl !== target.postUrl &&
      (await tx.interaction.count({
        where: {
          workspaceId,
          sourceTaskId: id,
          status: { in: activeStatuses },
        },
      }))
    )
      throw new AppError(
        409,
        "Bỏ qua hoặc xử lý công việc tương tác đang chờ trước khi đổi link nguồn.",
      );
    const updated = await tx.task.update({
      where: { id },
      data: { resultUrl: target.postUrl, version: { increment: 1 } },
      include: taskInclude,
    });
    await tx.taskEvent.create({
      data: {
        id: input.operationId,
        taskId: id,
        requestHash,
        fromStatus: task.status,
        toStatus: task.status,
        source: "USER",
        note: `Lưu link bài: ${target.postUrl}`,
      },
    });
    return updated;
  });
}

export async function saveDesktopPostLink(
  deviceId: string,
  workspaceId: string,
  id: string,
  input: z.infer<typeof desktopPostLinkSchema>,
) {
  const target = input.resultUrl
    ? canonicalFacebookPost(input.resultUrl)
    : null;
  if ((input.resultUrl && !target) || (!target && !input.reason))
    throw new AppError(400, "Link bài không hợp lệ.");
  return workspaceTransaction(workspaceId, async (tx) => {
    const task = assertFound(
      await tx.task.findFirst({ where: { id, workspaceId } }),
    );
    if (
      task.desktopDeviceId !== deviceId ||
      task.desktopRunId !== input.runId ||
      task.status !== "PUBLISHED" ||
      task.resultUrl
    )
      return { ok: true, stale: true };
    const requestHash = `${target ? "link" : "link-missing"}:${input.runId}`;
    if (await tx.taskEvent.count({ where: { taskId: id, requestHash } }))
      return { ok: true };
    if (target)
      await tx.task.update({
        where: { id },
        data: { resultUrl: target.postUrl, version: { increment: 1 } },
      });
    await tx.taskEvent.create({
      data: {
        id: randomUUID(),
        taskId: id,
        requestHash,
        fromStatus: task.status,
        toStatus: task.status,
        source: "DESKTOP",
        note: target
          ? `Đã lấy link bài: ${target.postUrl}`
          : `Chưa lấy được link [${input.reason}]: ${missingLinkNotes[input.reason!]} Kết quả gửi được giữ nguyên; không tự đăng lại.`,
      },
    });
    return { ok: true };
  });
}

export async function publishedPosts(
  workspaceId: string,
  params: URLSearchParams,
) {
  const date = params.get("date") || dateKey();
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00+07:00`)) ||
    dateKey(`${date}T00:00:00+07:00`) !== date
  )
    throw new AppError(400, "Ngày không hợp lệ.");
  const bounds = dayBounds(`${date}T12:00:00+07:00`);
  const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));
  if (!Number.isInteger(page)) throw new AppError(400, "Trang không hợp lệ.");
  const size = 20;
  const where = {
    workspaceId,
    status: "PUBLISHED" as const,
    recordedAt: { gte: bounds.start, lt: bounds.end },
    ...(params.get("accountId") ? { accountId: params.get("accountId")! } : {}),
    ...(params.get("groupId") ? { groupId: params.get("groupId")! } : {}),
  };
  const [items, total] = await Promise.all([
    db.task.findMany({
      where,
      include: {
        ...taskInclude,
        sourceInteractions: {
          select: {
            id: true,
            status: true,
            account: { select: { name: true } },
          },
        },
      },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * size,
      take: size,
    }),
    db.task.count({ where }),
  ]);
  const keys = items.flatMap((t) => {
    const p = t.resultUrl && canonicalFacebookPost(t.resultUrl);
    return p ? [p.postKey] : [];
  });
  const existing = await db.interaction.findMany({
    where: { workspaceId, postKey: { in: keys } },
    select: {
      id: true,
      postKey: true,
      status: true,
      account: { select: { name: true } },
    },
  });
  return {
    items: items.map((t) => ({
      ...t,
      interaction:
        existing.find(
          (i) =>
            i.postKey ===
            (t.resultUrl && canonicalFacebookPost(t.resultUrl)?.postKey),
        ) ||
        t.sourceInteractions[0] ||
        null,
    })),
    total,
    page,
    size,
  };
}
