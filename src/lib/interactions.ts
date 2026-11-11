import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { AppError, assertFound } from "./errors";
import { canonicalFacebookPost } from "./facebook-post-url";
import { pagination, workspaceTransaction, type Tx } from "./service";
import { interactionWait } from "./interaction-work";
import { dateKey, dayBounds } from "./utils";

function yesterdayBounds(now: Date) {
  return dayBounds(new Date(dayBounds(now).start.getTime() - 86_400_000));
}

export function interactionTarget(input: string) {
  const target = canonicalFacebookPost(input);
  if (!target)
    throw new AppError(
      400,
      "Dùng link bài đầy đủ có /posts/…, /permalink/… hoặc story_fbid. Link chia sẻ rút gọn cần mở trên Facebook rồi lấy link bài gốc.",
    );
  return target;
}
export const interactionSchema = z
  .object({
    accountId: z.string().min(1).max(80),
    postUrl: z.string().trim().min(1).max(2048),
    sourceTaskId: z.string().min(1).max(80).optional(),
    executionMode: z.enum(["MANUAL", "AUTOMATIC"]).default("MANUAL"),
    kind: z.enum(["COMMENT", "BUMP", "REACTION"]),
    content: z.string().trim().max(4000).default(""),
    reaction: z
      .enum(["LIKE", "LOVE", "CARE", "HAHA", "WOW", "SAD", "ANGRY"])
      .optional(),
    scheduledAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((value, ctx) => {
    if (value.executionMode === "AUTOMATIC" && !value.sourceTaskId)
      ctx.addIssue({
        code: "custom",
        path: ["sourceTaskId"],
        message: "Chọn bài đã đăng từ danh sách để tự tương tác.",
      });
    if (value.kind === "COMMENT" && !value.content)
      ctx.addIssue({
        code: "custom",
        path: ["content"],
        message: "Nhập bình luận cần duyệt.",
      });
    if (value.kind === "REACTION" && !value.reaction)
      ctx.addIssue({
        code: "custom",
        path: ["reaction"],
        message: "Chọn cảm xúc.",
      });
  });
export async function listInteractions(
  workspaceId: string,
  params: URLSearchParams,
  now = new Date(),
) {
  const p = pagination(params);
  const status = params.get("status");
  if (
    status &&
    ![
      "PLANNED",
      "APPROVED",
      "COMPLETED",
      "SKIPPED",
      "IN_PROGRESS",
      "RETRY_WAIT",
      "FAILED",
      "NEEDS_REVIEW",
      "TARGET_UNAVAILABLE",
    ].includes(status)
  )
    throw new AppError(400, "Trạng thái không hợp lệ.");
  const where = {
    workspaceId,
    archivedAt: null,
    ...(status === "TARGET_UNAVAILABLE"
      ? { skipReason: "TARGET_UNAVAILABLE" }
      : status
        ? { status }
        : {}),
    ...(params.get("accountId") ? { accountId: params.get("accountId")! } : {}),
  };
  const yesterday = yesterdayBounds(now);
  const yesterdayWhere = {
    workspaceId,
    archivedAt: null,
    scheduledAt: { gte: yesterday.start, lt: yesterday.end },
  };
  const [items, total, unavailableCount, yesterdayCount, yesterdayRunning] =
    await Promise.all([
      db.interaction.findMany({
        where,
        include: {
          account: true,
          sourceTask: { include: { account: true, group: true } },
          events: { orderBy: { createdAt: "desc" }, take: 10 },
        },
        orderBy:
          status === "TARGET_UNAVAILABLE"
            ? [{ unavailableAt: "desc" }, { id: "desc" }]
            : [{ scheduledAt: "asc" }, { id: "asc" }],
        skip: p.skip,
        take: p.size,
      }),
      db.interaction.count({ where }),
      db.interaction.count({
        where: {
          workspaceId,
          archivedAt: null,
          skipReason: "TARGET_UNAVAILABLE",
          ...(params.get("accountId")
            ? { accountId: params.get("accountId")! }
            : {}),
        },
      }),
      db.interaction.count({
        where: { ...yesterdayWhere, status: { not: "IN_PROGRESS" } },
      }),
      db.interaction.count({
        where: { ...yesterdayWhere, status: "IN_PROGRESS" },
      }),
    ]);
  const connections = await db.facebookConnection.findMany({
    where: { workspaceId, accountId: { in: items.map((i) => i.accountId) } },
    include: { device: true },
  });
  async function waitReason(row: (typeof items)[number]) {
    if (row.executionMode !== "AUTOMATIC" || row.status !== "APPROVED")
      return null;
    if (row.scheduledAt > new Date()) return "Chưa đến giờ tương tác.";
    if (row.nextAttemptAt && row.nextAttemptAt > new Date())
      return "Đang giãn khoảng cách trước bước tương tác tiếp theo.";
    if (process.env.NHIPDANG_AUTOMATIC_INTERACTIONS === "0")
      return "Tự tương tác đang tắt trên máy chủ.";
    const connection =
      connections.find((c) => c.accountId === row.accountId) || null;
    const reason = await interactionWait(db, row, connection, new Date());
    if (reason) return reason;
    if (connection?.device.revokedAt) return "Máy đăng đã ngắt kết nối.";
    if (connection?.device.paused)
      return "Máy đăng đang tạm dừng nhận công việc.";
    if (
      !connection?.device.lastSeenAt ||
      Date.now() - connection.device.lastSeenAt.getTime() >= 45_000
    )
      return "Máy đăng đang ngoại tuyến.";
    return "Chờ máy rảnh; bài đăng đến lượt được ưu tiên.";
  }
  const enriched = await Promise.all(
    items.map(async (row) => ({
      ...row,
      waitReason: await waitReason(row),
    })),
  );
  return {
    items: enriched,
    total,
    unavailableCount,
    yesterdayDate: dateKey(yesterday.start),
    yesterdayCount,
    yesterdayRunning,
    page: p.page,
    size: p.size,
  };
}

async function archiveMatchingInteractions(
  tx: Tx,
  where: Prisma.InteractionWhereInput,
  now: Date,
) {
  const rows = await tx.interaction.findMany({
    where: { ...where, archivedAt: null, status: { not: "IN_PROGRESS" } },
    select: { id: true, status: true },
  });
  if (!rows.length) return { archived: 0 };
  const ids = rows.map((row) => row.id);
  const pending = rows
    .filter((row) => ["PLANNED", "APPROVED", "RETRY_WAIT"].includes(row.status))
    .map((row) => row.id);
  const pendingIds = new Set(pending);
  // Retain the post key so automatic scans cannot recreate deleted work.
  await tx.interaction.updateMany({
    where: { id: { in: ids } },
    data: { archivedAt: now, nextAttemptAt: null, version: { increment: 1 } },
  });
  if (pending.length) {
    await tx.interaction.updateMany({
      where: { id: { in: pending } },
      data: { status: "SKIPPED", phase: "DONE", runId: null, leaseAt: null },
    });
    for (const field of ["reactionState", "commentState"] as const)
      await tx.interaction.updateMany({
        where: {
          id: { in: pending },
          [field]: { notIn: ["NONE", "COMPLETED"] },
        },
        data: { [field]: "SKIPPED" },
      });
  }
  await tx.interactionEvent.createMany({
    data: rows.map((row) => ({
      interactionId: row.id,
      fromStatus: row.status,
      toStatus: pendingIds.has(row.id) ? "SKIPPED" : row.status,
      note: "Đã xóa khỏi danh sách công việc tương tác; giữ nguyên bài trên Facebook.",
    })),
  });
  return { archived: rows.length };
}

export async function archiveInteraction(workspaceId: string, id: string) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const row = assertFound(
      await tx.interaction.findFirst({ where: { id, workspaceId } }),
    );
    if (row.archivedAt) return { archived: 0 };
    if (row.status === "IN_PROGRESS")
      throw new AppError(409, "Công việc đang chạy. Đợi có kết quả rồi xóa.");
    return archiveMatchingInteractions(tx, { workspaceId, id }, new Date());
  });
}

export const archiveYesterdaySchema = z.object({ date: z.iso.date() });

export async function archiveYesterdayInteractions(
  workspaceId: string,
  date: string,
  now = new Date(),
) {
  const { start, end } = yesterdayBounds(now);
  if (date !== dateKey(start))
    throw new AppError(
      409,
      "Ngày đã thay đổi. Tải lại danh sách trước khi xóa.",
    );
  return workspaceTransaction(workspaceId, async (tx) => {
    const where = { workspaceId, scheduledAt: { gte: start, lt: end } };
    const running = await tx.interaction.count({
      where: { ...where, archivedAt: null, status: "IN_PROGRESS" },
    });
    return { ...(await archiveMatchingInteractions(tx, where, now)), running };
  });
}
export async function createInteraction(
  workspaceId: string,
  input: z.infer<typeof interactionSchema>,
) {
  const target = interactionTarget(input.postUrl);
  return workspaceTransaction(workspaceId, async (tx) => {
    if (input.sourceTaskId) {
      if (
        await tx.interaction.count({
          where: { workspaceId, sourceTaskId: input.sourceTaskId },
        })
      )
        throw new AppError(409, "Bài nguồn này đã có công việc tương tác.");
      const source = assertFound(
        await tx.task.findFirst({
          where: { workspaceId, id: input.sourceTaskId, status: "PUBLISHED" },
        }),
        "Chọn bài đã ghi nhận Đã đăng.",
      );
      if (
        !source.resultUrl ||
        interactionTarget(source.resultUrl).postKey !== target.postKey
      )
        throw new AppError(
          409,
          "Link bài nguồn đã thay đổi. Tải lại danh sách.",
        );
      if (
        input.executionMode === "AUTOMATIC" &&
        source.accountId === input.accountId
      )
        throw new AppError(400, "Chọn tài khoản khác với tài khoản đăng bài.");
    }
    assertFound(
      await tx.facebookAccount.findFirst({
        where: {
          id: input.accountId,
          workspaceId,
          archivedAt: null,
          status: "ACTIVE",
        },
      }),
      "Chọn tài khoản đang hoạt động trong không gian của bạn.",
    );
    const previous = await tx.interaction.findUnique({
      where: { workspaceId_postKey: { workspaceId, postKey: target.postKey } },
      include: { account: true },
    });
    if (previous)
      throw new AppError(
        409,
        `Bài này đã được giao cho ${previous.account.name}. Mỗi bài chỉ có một công việc tương tác trong không gian của bạn.`,
      );
    return tx.interaction.create({
      data: {
        workspaceId,
        accountId: input.accountId,
        sourceTaskId: input.sourceTaskId,
        executionMode: input.executionMode,
        ...target,
        kind: input.kind,
        content:
          input.kind === "BUMP"
            ? "up"
            : input.kind === "COMMENT"
              ? input.content
              : "",
        reaction: input.kind === "REACTION" ? input.reaction : null,
        reactionState: input.kind === "REACTION" ? "PENDING" : "NONE",
        commentState: input.kind !== "REACTION" ? "PENDING" : "NONE",
        scheduledAt: new Date(input.scheduledAt),
      },
      include: { account: true },
    });
  });
}
export const interactionActionSchema = z.object({
  action: z.enum(["approve", "complete", "skip"]),
  note: z.string().trim().max(2000).default(""),
});
export async function interactionAction(
  workspaceId: string,
  id: string,
  input: z.infer<typeof interactionActionSchema>,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const row = assertFound(
      await tx.interaction.findFirst({
        where: { id, workspaceId, archivedAt: null },
        include: { account: true },
      }),
    );
    const status =
      input.action === "approve"
        ? "APPROVED"
        : input.action === "complete"
          ? "COMPLETED"
          : "SKIPPED";
    if (row.status === status) return row;
    if (row.status === "IN_PROGRESS")
      throw new AppError(
        409,
        "Máy đang tương tác; đợi kết quả trước khi cập nhật.",
      );
    if (
      ["COMPLETED", "SKIPPED"].includes(row.status) ||
      (input.action === "approve" && row.status !== "PLANNED") ||
      (input.action === "complete" &&
        !(row.executionMode === "AUTOMATIC"
          ? row.status === "NEEDS_REVIEW"
          : row.status === "APPROVED"))
    )
      throw new AppError(
        409,
        "Duyệt công việc trước khi xác nhận đã tương tác.",
      );
    if (
      input.action !== "skip" &&
      (row.account.status !== "ACTIVE" || row.account.archivedAt)
    )
      throw new AppError(409, "Tài khoản đang tạm dừng hoặc đã lưu trữ.");
    if (input.action === "complete" && row.scheduledAt > new Date())
      throw new AppError(409, "Chưa đến thời gian đã chọn.");
    if (input.action === "approve" && row.executionMode === "AUTOMATIC") {
      const connection = await tx.facebookConnection.findUnique({
        where: { accountId: row.accountId },
      });
      if (
        !connection?.interactionEnabled ||
        connection.state !== "READY" ||
        !connection.confirmedIdentityHash ||
        connection.identityHash !== connection.confirmedIdentityHash
      )
        throw new AppError(
          409,
          "Xác nhận đúng Facebook và bật Cho phép tự tương tác trước khi duyệt.",
        );
    }
    const updated = await tx.interaction.update({
      where: { id },
      data: {
        status,
        note: input.note,
        nextAttemptAt: null,
        version: { increment: 1 },
        ...(status === "COMPLETED" || status === "SKIPPED"
          ? {
              reactionState:
                row.kind === "REACTION" || row.kind === "COMBINED"
                  ? row.reactionState === "COMPLETED"
                    ? "COMPLETED"
                    : status
                  : "NONE",
              commentState:
                row.kind !== "REACTION"
                  ? row.commentState === "COMPLETED"
                    ? "COMPLETED"
                    : status
                  : "NONE",
            }
          : {}),
        ...(status === "COMPLETED"
          ? { completedAt: new Date(), phase: "DONE", resultSource: "USER" }
          : {}),
      },
      include: { account: true },
    });
    await tx.interactionEvent.create({
      data: {
        interactionId: id,
        fromStatus: row.status,
        toStatus: status,
        note: input.note || `Bạn xác nhận ${status}`,
      },
    });
    return updated;
  });
}
