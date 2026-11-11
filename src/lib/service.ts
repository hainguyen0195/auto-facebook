import { createHash, randomUUID } from "node:crypto";
import { Prisma, type AccountStatus, type TaskStatus } from "@prisma/client";
import { db } from "./db";
import { AppError, assertFound } from "./errors";
import type {
  AccountInput,
  GroupInput,
  PostInput,
  ScheduleInput,
  TaskActionInput,
} from "./schemas";
import {
  canTransition,
  contentFingerprint,
  isQuietHour,
  LIVE_STATUSES,
} from "./task-policy";
import { dateKey, dayBounds, formatIntervalMinutes, STATUSES } from "./utils";
import { validateCsvRows, type CsvRow } from "./csv";
import { withAutomaticWait } from "./task-waits";

export const taskInclude = {
  account: true,
  group: true,
} satisfies Prisma.TaskInclude;
export type Tx = Prisma.TransactionClient;
export const digest = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");

// Serialize mutations within a workspace, including retries from separate tabs.
export async function workspaceTransaction<T>(
  workspaceId: string,
  callback: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${workspaceId}))`;
      return callback(tx);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}
export function pagination(params: URLSearchParams) {
  const page = Math.min(100_000, Math.max(1, Number(params.get("page")) || 1));
  const size = Math.min(100, Math.max(1, Number(params.get("size")) || 20));
  return {
    page: Math.floor(page),
    size: Math.floor(size),
    skip: (Math.floor(page) - 1) * Math.floor(size),
  };
}
async function checkAccounts(tx: Tx, workspaceId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const count = await tx.facebookAccount.count({
    where: { id: { in: unique }, workspaceId, archivedAt: null },
  });
  if (count !== unique.length)
    throw new AppError(
      404,
      "Có tài khoản không tồn tại trong không gian của bạn.",
    );
  return unique;
}
export async function listAccounts(workspaceId: string) {
  return db.facebookAccount.findMany({
    where: { workspaceId, archivedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      _count: {
        select: { memberships: { where: { group: { archivedAt: null } } } },
      },
    },
  });
}
async function updateAccountState(
  tx: Tx,
  workspaceId: string,
  accountId: string,
  status: AccountStatus,
) {
  if (status === "ACTIVE") {
    const reason = ["ACCOUNT_PAUSED", "ACCOUNT_RESTRICTED"];
    await tx.task.updateMany({
      where: {
        workspaceId,
        accountId,
        status: "BLOCKED",
        archivedAt: null,
        blockReason: { in: reason },
        scheduledAt: { lte: new Date() },
      },
      data: { status: "READY", blockReason: null, version: { increment: 1 } },
    });
    await tx.task.updateMany({
      where: {
        workspaceId,
        accountId,
        status: "BLOCKED",
        archivedAt: null,
        blockReason: { in: reason },
        scheduledAt: { gt: new Date() },
      },
      data: {
        status: "SCHEDULED",
        blockReason: null,
        version: { increment: 1 },
      },
    });
    return;
  }
  const tasks = await tx.task.findMany({
    where: {
      workspaceId,
      accountId,
      status: { in: ["SCHEDULED", "READY", "IN_PROGRESS"] },
      NOT: { executionMode: "AUTOMATIC", automaticPhase: "SUBMITTING" },
    },
    select: { id: true, status: true },
  });
  if (tasks.length) {
    await tx.task.updateMany({
      where: { id: { in: tasks.map((t) => t.id) }, workspaceId },
      data: {
        status: "BLOCKED",
        blockReason:
          status === "PAUSED" ? "ACCOUNT_PAUSED" : "ACCOUNT_RESTRICTED",
        version: { increment: 1 },
      },
    });
    await tx.taskEvent.createMany({
      data: tasks.map((t) => ({
        id: randomUUID(),
        taskId: t.id,
        requestHash: "account-status",
        fromStatus: t.status,
        toStatus: "BLOCKED" as const,
        source: "SYSTEM",
        note: "Tạm dừng theo trạng thái tài khoản do người dùng cập nhật.",
      })),
    });
  }
}
export async function saveAccount(
  workspaceId: string,
  input: AccountInput,
  id?: string,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    if (!id)
      return tx.facebookAccount.create({ data: { ...input, workspaceId } });
    const current = assertFound(
      await tx.facebookAccount.findFirst({
        where: { id, workspaceId, archivedAt: null },
      }),
    );
    const result = await tx.facebookAccount.update({
      where: { id: current.id },
      data: input,
    });
    if (current.url !== input.url) {
      await tx.facebookConnection.updateMany({
        where: { workspaceId, accountId: id },
        data: {
          automationEnabled: false,
          interactionEnabled: false,
          state: "LOGIN_REQUIRED",
          confirmedIdentityHash: null,
          expectedIdentityHash: null,
          identityHash: null,
          generation: { increment: 1 },
        },
      });
      await tx.facebookDeviceSession.deleteMany({ where: { accountId: id } });
      await tx.facebookInboxSnapshot.deleteMany({ where: { accountId: id } });
    }
    if (current.status !== input.status)
      await updateAccountState(tx, workspaceId, id, input.status);
    return result;
  });
}
export async function setAccountQuietHours(
  workspaceId: string,
  id: string,
  enabled: boolean,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const current = assertFound(
      await tx.facebookAccount.findFirst({
        where: { id, workspaceId, archivedAt: null },
      }),
    );
    return tx.facebookAccount.update({
      where: { id: current.id },
      data: {
        quietHoursEnabled: enabled,
        ...(enabled && current.quietStart === current.quietEnd
          ? { quietStart: 22, quietEnd: 7 }
          : {}),
      },
    });
  });
}
export async function archiveAccount(workspaceId: string, id: string) {
  return workspaceTransaction(workspaceId, async (tx) => {
    if (
      await tx.interaction.count({
        where: {
          workspaceId,
          accountId: id,
          status: "IN_PROGRESS",
          executionMode: "AUTOMATIC",
        },
      })
    )
      throw new AppError(
        409,
        "Máy đang tương tác; đợi kết quả trước khi lưu trữ tài khoản.",
      );
    if (
      await tx.task.count({
        where: {
          workspaceId,
          accountId: id,
          executionMode: "AUTOMATIC",
          status: "IN_PROGRESS",
          automaticPhase: "SUBMITTING",
        },
      })
    )
      throw new AppError(
        409,
        "Máy đăng đang gửi bài; đợi kết quả trước khi lưu trữ tài khoản.",
      );
    assertFound(
      await tx.facebookAccount.findFirst({
        where: { id, workspaceId, archivedAt: null },
      }),
    );
    await tx.task.updateMany({
      where: { workspaceId, accountId: id, status: { in: [...LIVE_STATUSES] } },
      data: {
        status: "CANCELLED",
        version: { increment: 1 },
        note: "Tài khoản được lưu trữ.",
      },
    });
    await tx.facebookAccount.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return { ok: true };
  });
}
export async function listGroups(workspaceId: string, params: URLSearchParams) {
  const { page, size, skip } = pagination(params);
  const q = (params.get("q") || "").slice(0, 160);
  const accountId = params.get("accountId");
  const where: Prisma.GroupWhereInput = {
    workspaceId,
    archivedAt: null,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { tags: { has: q } },
            { url: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(accountId
      ? { memberships: { some: { accountId, account: { workspaceId } } } }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.group.findMany({
      where,
      skip,
      take: size,
      orderBy: { createdAt: "desc" },
      include: {
        memberships: {
          where: { account: { archivedAt: null, workspaceId } },
          include: { account: true },
        },
      },
    }),
    db.group.count({ where }),
  ]);
  return { items, total, page, size };
}
export async function saveGroup(
  workspaceId: string,
  input: GroupInput,
  id?: string,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const accountIds = await checkAccounts(tx, workspaceId, input.accountIds);
    const { accountIds: _ignored, ...data } = input;
    if (id)
      assertFound(
        await tx.group.findFirst({
          where: { workspaceId, id, archivedAt: null },
        }),
      );
    const duplicate = await tx.group.findFirst({
      where: { workspaceId, url: data.url, ...(id ? { id: { not: id } } : {}) },
    });
    if (duplicate)
      throw new AppError(
        409,
        "Nhóm này đã có trong danh sách, kể cả mục đã lưu trữ.",
      );
    const group = id
      ? await tx.group.update({ where: { id }, data })
      : await tx.group.create({ data: { ...data, workspaceId } });
    if (id) {
      const removedTasks = await tx.task.count({
        where: {
          workspaceId,
          groupId: id,
          accountId: { notIn: accountIds },
          status: { in: [...LIVE_STATUSES] },
        },
      });
      if (removedTasks)
        throw new AppError(
          409,
          "Hãy hủy các lịch đang chờ của tài khoản trước khi bỏ tài khoản khỏi nhóm.",
        );
      await tx.membership.deleteMany({ where: { groupId: group.id } });
    }
    if (accountIds.length)
      await tx.membership.createMany({
        data: accountIds.map((accountId) => ({ groupId: group.id, accountId })),
      });
    return group;
  });
}
export async function archiveGroup(workspaceId: string, id: string) {
  return workspaceTransaction(workspaceId, async (tx) => {
    if (
      await tx.task.count({
        where: {
          workspaceId,
          groupId: id,
          executionMode: "AUTOMATIC",
          status: "IN_PROGRESS",
          automaticPhase: "SUBMITTING",
        },
      })
    )
      throw new AppError(
        409,
        "Máy đăng đang gửi bài vào nhóm; đợi kết quả trước khi lưu trữ nhóm.",
      );
    assertFound(
      await tx.group.findFirst({
        where: { id, workspaceId, archivedAt: null },
      }),
    );
    await tx.task.updateMany({
      where: { workspaceId, groupId: id, status: { in: [...LIVE_STATUSES] } },
      data: {
        status: "CANCELLED",
        version: { increment: 1 },
        note: "Hội nhóm được lưu trữ.",
      },
    });
    await tx.group.update({ where: { id }, data: { archivedAt: new Date() } });
    return { ok: true };
  });
}
export async function previewImport(workspaceId: string, rows: CsvRow[]) {
  const existing = await db.group.findMany({
    where: { workspaceId },
    select: { url: true },
  });
  return validateCsvRows(rows, new Set(existing.map((x) => x.url)));
}
export async function importGroups(
  workspaceId: string,
  rows: CsvRow[],
  accountIds: string[],
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const ids = await checkAccounts(tx, workspaceId, accountIds);
    const existing = await tx.group.findMany({
      where: { workspaceId },
      select: { url: true },
    });
    const preview = validateCsvRows(rows, new Set(existing.map((x) => x.url)));
    const valid = preview.filter((x) => x.status === "valid" && x.data);
    for (const item of valid) {
      const { accountIds: _ignored, ...data } = item.data!;
      await tx.group.create({
        data: {
          ...data,
          workspaceId,
          memberships: { create: ids.map((accountId) => ({ accountId })) },
        },
      });
    }
    return {
      imported: valid.length,
      skipped: preview.filter((x) => x.status === "duplicate").length,
      invalid: preview.filter((x) => x.status === "invalid").length,
    };
  });
}
const postInclude = {
  assets: { include: { asset: true }, orderBy: { position: "asc" as const } },
  _count: { select: { tasks: true } },
};
export async function listPosts(workspaceId: string, params: URLSearchParams) {
  const { page, size, skip } = pagination(params);
  const q = (params.get("q") || "").slice(0, 160);
  const where: Prisma.PostWhereInput = {
    workspaceId,
    archivedAt: null,
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { content: { contains: q, mode: "insensitive" } },
            { tags: { has: q } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.post.findMany({
      where,
      skip,
      take: size,
      orderBy: { updatedAt: "desc" },
      include: postInclude,
    }),
    db.post.count({ where }),
  ]);
  // Keep the complete history, while separating archived unfinished work from live work.
  const scheduled = items.length
    ? await db.$queryRaw<
        {
          postId: string;
          accountId: string;
          status: TaskStatus;
          total: number;
          visible: number;
        }[]
      >`
        SELECT "postId", "accountId", status,
          COUNT(*)::int AS total,
          (COUNT(*) FILTER (WHERE "archivedAt" IS NULL))::int AS visible
        FROM "Task"
        WHERE "workspaceId" = ${workspaceId}
          AND "postId" IN (${Prisma.join(items.map((post) => post.id))})
        GROUP BY "postId", "accountId", status
      `
    : [];
  const accounts = scheduled.length
    ? await db.facebookAccount.findMany({
        where: {
          workspaceId,
          id: { in: [...new Set(scheduled.map((row) => row.accountId))] },
        },
        select: { id: true, name: true, color: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      })
    : [];
  type ScheduleCounts = {
    taskCount: number;
    byStatus: Record<TaskStatus, number>;
    archivedCount: number;
    archivedUnfinishedCount: number;
  };
  const byPost = new Map<string, Map<string, ScheduleCounts>>();
  for (const row of scheduled) {
    if (!byPost.has(row.postId)) byPost.set(row.postId, new Map());
    const accountsForPost = byPost.get(row.postId)!;
    const counts = accountsForPost.get(row.accountId) || {
      taskCount: 0,
      byStatus: Object.fromEntries(
        STATUSES.map((status) => [status, 0]),
      ) as Record<TaskStatus, number>,
      archivedCount: 0,
      archivedUnfinishedCount: 0,
    };
    const live = LIVE_STATUSES.some((status) => status === row.status);
    counts.taskCount += row.total;
    counts.byStatus[row.status] += live ? row.visible : row.total;
    counts.archivedCount += row.total - row.visible;
    if (live) counts.archivedUnfinishedCount += row.total - row.visible;
    accountsForPost.set(row.accountId, counts);
  }
  return {
    items: items.map((post) => ({
      ...post,
      scheduledAccounts: accounts.flatMap((account) => {
        const counts = byPost.get(post.id)?.get(account.id);
        return counts ? [{ ...account, ...counts }] : [];
      }),
    })),
    total,
    page,
    size,
  };
}
export async function listPostSchedules(
  workspaceId: string,
  postId: string,
  params: URLSearchParams,
) {
  assertFound(
    await db.post.findFirst({
      where: { workspaceId, id: postId, archivedAt: null },
      select: { id: true },
    }),
  );
  const { page, size, skip } = pagination(params);
  const accountId = params.get("accountId");
  const status = params.get("status");
  const where: Prisma.TaskWhereInput = {
    workspaceId,
    postId,
    ...(accountId ? { accountId } : {}),
    ...(status ? { status: status as TaskStatus } : {}),
    ...(status && LIVE_STATUSES.some((live) => live === status)
      ? { archivedAt: null }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.task.findMany({
      where,
      take: size,
      skip,
      orderBy: [{ scheduledAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        accountId: true,
        scheduledAt: true,
        recordedAt: true,
        status: true,
        note: true,
        blockReason: true,
        automaticPhase: true,
        archivedAt: true,
        resultUrl: true,
        account: { select: { id: true, name: true, color: true } },
        group: { select: { name: true } },
      },
    }),
    db.task.count({ where }),
  ]);
  return { items, total, page, size };
}
export async function savePost(
  workspaceId: string,
  input: PostInput,
  id?: string,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const assetIds = [...new Set(input.assetIds)];
    const count = await tx.asset.count({
      where: { workspaceId, id: { in: assetIds } },
    });
    if (count !== assetIds.length)
      throw new AppError(404, "Có ảnh không thuộc thư viện của bạn.");
    const { version, assetIds: _ignored, ...data } = input;
    if (id) {
      const current = assertFound(
        await tx.post.findFirst({
          where: { id, workspaceId, archivedAt: null },
        }),
      );
      if (!version || current.version !== version)
        throw new AppError(
          409,
          "Bài đã được sửa ở tab khác. Hãy tải lại trước khi lưu.",
        );
      await tx.postAsset.deleteMany({ where: { postId: id } });
    }
    return id
      ? tx.post.update({
          where: { id },
          data: {
            ...data,
            version: { increment: 1 },
            assets: {
              create: assetIds.map((assetId, position) => ({
                assetId,
                position,
              })),
            },
          },
          include: postInclude,
        })
      : tx.post.create({
          data: {
            ...data,
            workspaceId,
            assets: {
              create: assetIds.map((assetId, position) => ({
                assetId,
                position,
              })),
            },
          },
          include: postInclude,
        });
  });
}
export async function archivePost(workspaceId: string, id: string) {
  return workspaceTransaction(workspaceId, async (tx) => {
    assertFound(
      await tx.post.findFirst({ where: { id, workspaceId, archivedAt: null } }),
    );
    await tx.post.update({
      where: { id },
      data: { archivedAt: new Date(), version: { increment: 1 } },
    });
    return { ok: true };
  });
}

export type ScheduleWarning = {
  code: string;
  message: string;
  targetIndex: number;
};
export type ScheduleGroupAccessCheck = {
  accountId: string;
  groupId: string;
  accountName: string;
  groupName: string;
};
async function buildSchedule(
  tx: Tx,
  workspaceId: string,
  input: ScheduleInput,
) {
  const post = assertFound(
    await tx.post.findFirst({
      where: { workspaceId, id: input.postId, archivedAt: null },
      include: postInclude,
    }),
  );
  const base = new Date(input.scheduledAt);
  if (
    base.getTime() < Date.now() - 5 * 60_000 ||
    base.getTime() > Date.now() + 730 * 86400_000
  )
    throw new AppError(400, "Chọn thời gian từ hiện tại đến tối đa 2 năm tới.");
  const accounts = await tx.facebookAccount.findMany({
    where: {
      workspaceId,
      archivedAt: null,
      id: { in: input.targets.map((t) => t.accountId) },
    },
  });
  await checkAccounts(
    tx,
    workspaceId,
    input.targets.flatMap((target) =>
      target.sourceAccountId ? [target.sourceAccountId] : [],
    ),
  );
  if (input.executionMode === "AUTOMATIC") {
    const connections = await tx.facebookConnection.findMany({
      where: {
        workspaceId,
        accountId: { in: accounts.map((a) => a.id) },
        state: "READY",
        automationEnabled: true,
        device: { revokedAt: null },
      },
    });
    if (
      accounts.some(
        (a) =>
          !connections.some(
            (c) =>
              c.accountId === a.id &&
              c.confirmedIdentityHash &&
              c.identityHash === c.confirmedIdentityHash,
          ),
      )
    )
      throw new AppError(
        409,
        "Đăng nhập, kiểm tra đúng Facebook và bật đăng tự động cho tất cả tài khoản đã chọn trước khi tạo lịch.",
      );
  }
  const groups = await tx.group.findMany({
    where: {
      workspaceId,
      archivedAt: null,
      id: { in: input.targets.flatMap((t) => (t.groupId ? [t.groupId] : [])) },
    },
    include: { memberships: true },
  });
  const hash = digest(contentFingerprint(post.content));
  const warnings: ScheduleWarning[] = [];
  const groupAccessChecks: ScheduleGroupAccessCheck[] = [];
  const targets: {
    accountId: string;
    groupId: string | null;
    destinationKey: string;
    scheduledAt: Date;
  }[] = [];
  const seen = new Set<string>();
  const dayCounts = new Map<string, number>();
  for (const [index, target] of input.targets.entries()) {
    const account = assertFound(
      accounts.find((a) => a.id === target.accountId),
      "Không tìm thấy tài khoản đã chọn.",
    );
    if (account.status !== "ACTIVE")
      throw new AppError(
        409,
        `Tài khoản ${account.name} đang tạm dừng hoặc bị hạn chế.`,
      );
    const group = target.groupId
      ? assertFound(
          groups.find((g) => g.id === target.groupId),
          "Không tìm thấy nhóm đã chọn.",
        )
      : null;
    if (
      target.sourceAccountId &&
      (!group ||
        !group.memberships.some((m) => m.accountId === target.sourceAccountId))
    )
      throw new AppError(
        400,
        "Nhóm đã chọn không thuộc danh sách của tài khoản nguồn.",
      );
    if (group && !group.memberships.some((m) => m.accountId === account.id)) {
      if (!target.sourceAccountId)
        throw new AppError(
          400,
          `${account.name} chưa được liên kết với nhóm ${group.name}.`,
        );
      groupAccessChecks.push({
        accountId: account.id,
        groupId: group.id,
        accountName: account.name,
        groupName: group.name,
      });
    }
    const destinationKey = group?.id || "PROFILE";
    const key = `${account.id}:${destinationKey}`;
    if (seen.has(key))
      throw new AppError(
        400,
        "Danh sách nơi đăng có cặp tài khoản và nhóm bị trùng.",
      );
    seen.add(key);
    const scheduledAt = new Date(
      base.getTime() + index * input.intervalMinutes * 60_000,
    );
    if (scheduledAt.getTime() > Date.now() + 730 * 86400_000)
      throw new AppError(
        400,
        "Giãn công việc làm lịch cuối vượt quá 2 năm. Hãy giảm số nơi hoặc khoảng giãn.",
      );
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(scheduledAt),
    );
    const name = group?.name || "trang cá nhân";
    if (
      isQuietHour(
        hour,
        account.quietStart,
        account.quietEnd,
        account.quietHoursEnabled,
      )
    )
      warnings.push({
        code: "QUIET_HOUR",
        targetIndex: index,
        message: `${account.name} → ${name}: lịch nằm trong giờ nghỉ bạn đặt.`,
      });
    const dailyKey = `${account.id}:${dateKey(scheduledAt)}`;
    if (!dayCounts.has(dailyKey)) {
      const { start, end } = dayBounds(scheduledAt);
      dayCounts.set(
        dailyKey,
        await tx.task.count({
          where: {
            workspaceId,
            accountId: account.id,
            scheduledAt: { gte: start, lt: end },
            status: { notIn: ["CANCELLED", "SKIPPED"] },
          },
        }),
      );
    }
    const count = dayCounts.get(dailyKey)! + 1;
    dayCounts.set(dailyKey, count);
    if (count > account.dailyLimit)
      warnings.push({
        code: "DAILY_LIMIT",
        targetIndex: index,
        message: `${account.name}: vượt mức ${account.dailyLimit} công việc/ngày do bạn đặt (${dateKey(scheduledAt)}).`,
      });
    if (
      input.executionMode === "AUTOMATIC" &&
      account.postIntervalMinutes > 0 &&
      targets.some(
        (t) =>
          t.accountId === account.id &&
          scheduledAt.getTime() - t.scheduledAt.getTime() <
            account.postIntervalMinutes * 60_000,
      )
    )
      warnings.push({
        code: "INTERVAL",
        targetIndex: index,
        message: `${account.name}: lịch giãn ${formatIntervalMinutes(input.intervalMinutes)} nhưng tài khoản đang đặt tối thiểu ${formatIntervalMinutes(account.postIntervalMinutes)} giữa hai bài. Máy sẽ chờ đủ khoảng cách; bạn có thể sửa trong Tài khoản.`,
      });
    const gap =
      (group?.minIntervalMinutes ?? account.postIntervalMinutes) * 60_000;
    const window = Math.max(gap, 24 * 3600_000);
    const recent = await tx.task.findMany({
      where: {
        workspaceId,
        ...(group
          ? { groupId: group.id }
          : { accountId: account.id, destinationKey }),
        status: { notIn: ["CANCELLED", "SKIPPED"] },
        OR: [
          {
            scheduledAt: {
              gte: new Date(scheduledAt.getTime() - window),
              lte: new Date(scheduledAt.getTime() + window),
            },
          },
          {
            recordedAt: {
              gte: new Date(scheduledAt.getTime() - window),
              lte: new Date(scheduledAt.getTime() + window),
            },
          },
        ],
      },
      select: { contentHash: true, scheduledAt: true, recordedAt: true },
    });
    if (
      gap > 0 &&
      recent.some(
        (t) =>
          Math.abs(t.scheduledAt.getTime() - scheduledAt.getTime()) < gap ||
          (t.recordedAt &&
            Math.abs(t.recordedAt.getTime() - scheduledAt.getTime()) < gap),
      )
    )
      warnings.push({
        code: "INTERVAL",
        targetIndex: index,
        message: `${account.name} → ${name}: đã có công việc gần thời điểm này${group ? ` (khoảng cách bạn đặt: ${group.minIntervalMinutes} phút)` : ""}.`,
      });
    if (recent.some((t) => t.contentHash === hash))
      warnings.push({
        code: "DUPLICATE_CONTENT",
        targetIndex: index,
        message: `${account.name} → ${name}: nội dung giống bài đã lên lịch hoặc ghi nhận gần đây.`,
      });
    if (
      group &&
      targets.some(
        (t) =>
          t.groupId === group.id &&
          Math.abs(t.scheduledAt.getTime() - scheduledAt.getTime()) < window,
      )
    )
      warnings.push({
        code: "BATCH_DUPLICATE",
        targetIndex: index,
        message: `${name}: cùng nội dung được chọn cho nhiều tài khoản trong một khoảng gần nhau.`,
      });
    targets.push({
      accountId: account.id,
      groupId: group?.id || null,
      destinationKey,
      scheduledAt,
    });
  }
  return { post, targets, warnings, groupAccessChecks, hash };
}
export async function previewSchedule(
  workspaceId: string,
  input: ScheduleInput,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const { warnings, targets, groupAccessChecks } = await buildSchedule(
      tx,
      workspaceId,
      input,
    );
    // Keep the response field compatible with already-open schedule forms.
    return {
      warnings,
      targets,
      membershipLinks: groupAccessChecks,
      total: targets.length,
    };
  });
}
export async function createSchedule(
  workspaceId: string,
  input: ScheduleInput,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const {
      acknowledgeWarnings: _ack,
      confirmGroupAccess: _confirm,
      idempotencyKey: _key,
      ...payload
    } = input;
    const requestHash = digest(payload);
    const previous = await tx.campaign.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: { _count: { select: { tasks: true } } },
    });
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new AppError(
          409,
          "Mã yêu cầu đã được dùng cho một lịch khác. Hãy mở lại màn hình lên lịch.",
        );
      return { id: previous.id, total: previous._count.tasks, reused: true };
    }
    const { post, targets, warnings, groupAccessChecks, hash } =
      await buildSchedule(tx, workspaceId, input);
    if (warnings.length && !input.acknowledgeWarnings)
      throw new AppError(
        409,
        "Hãy đọc và xác nhận các nhắc nhở trước khi tạo lịch.",
        { warnings },
      );
    if (groupAccessChecks.length && !input.confirmGroupAccess)
      throw new AppError(
        409,
        "Xác nhận tài khoản đăng có quyền đăng vào các nhóm đã chọn.",
        { membershipLinks: groupAccessChecks },
      );
    const campaign = await tx.campaign.create({
      data: {
        workspaceId,
        postId: post.id,
        idempotencyKey: input.idempotencyKey,
        requestHash,
      },
    });
    await tx.task.createMany({
      data: targets.map((target) => ({
        ...target,
        workspaceId,
        campaignId: campaign.id,
        postId: post.id,
        titleSnapshot: post.title,
        contentSnapshot: post.content,
        contentHash: hash,
        executionMode: input.executionMode,
        assetIds: post.assets.map((a) => a.assetId),
        status:
          target.scheduledAt <= new Date()
            ? ("READY" as const)
            : ("SCHEDULED" as const),
      })),
    });
    const ready = await tx.task.findMany({
      where: { workspaceId, campaignId: campaign.id, status: "READY" },
      select: { id: true },
    });
    if (ready.length)
      await tx.notification.createMany({
        data: ready.map((t) => ({ workspaceId, taskId: t.id })),
        skipDuplicates: true,
      });
    return { id: campaign.id, total: targets.length, reused: false };
  });
}

function taskFilters(workspaceId: string, params: URLSearchParams) {
  const status = params.get("status");
  const accountId = params.get("accountId");
  const q = (params.get("q") || "").slice(0, 160);
  const where: Prisma.TaskWhereInput = {
    workspaceId,
    ...(params.get("history") === "true" ? {} : { archivedAt: null }),
    ...(status && status !== "ALL" ? { status: status as TaskStatus } : {}),
    ...(params.get("remaining") === "true"
      ? {
          status: {
            in: [...LIVE_STATUSES],
            ...(status && status !== "ALL"
              ? { equals: status as TaskStatus }
              : {}),
          },
        }
      : {}),
    ...(accountId ? { accountId } : {}),
    ...(q
      ? {
          OR: [
            { titleSnapshot: { contains: q, mode: "insensitive" } },
            { group: { name: { contains: q, mode: "insensitive" } } },
            { account: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  if (params.get("target") === "PROFILE") where.groupId = null;
  if (params.get("target") === "GROUP") where.groupId = { not: null };
  if (
    params.get("history") === "true" &&
    !status &&
    params.get("remaining") !== "true"
  )
    where.status = {
      in: ["PUBLISHED", "PENDING_REVIEW", "SKIPPED", "BLOCKED", "CANCELLED"],
    };
  const start = params.get("start");
  const end = params.get("end");
  if (start || end) {
    if (
      (start && !Number.isFinite(Date.parse(start))) ||
      (end && !Number.isFinite(Date.parse(end)))
    )
      throw new AppError(400, "Khoảng thời gian không hợp lệ.");
    where.scheduledAt = {
      ...(start ? { gte: new Date(start) } : {}),
      ...(end ? { lt: new Date(end) } : {}),
    };
  }
  return where;
}

export async function calendarOverview(
  workspaceId: string,
  params: URLSearchParams,
) {
  const start = params.get("start");
  const end = params.get("end");
  const span = start && end ? Date.parse(end) - Date.parse(start) : NaN;
  if (!Number.isFinite(span) || span <= 0 || span > 62 * 86400_000)
    throw new AppError(400, "Chọn khoảng lịch hợp lệ, tối đa 62 ngày.");
  const limit = params.get("view") === "week" ? 8 : 3;
  const rows = await db.task.findMany({
    where: taskFilters(workspaceId, params),
    select: {
      id: true,
      titleSnapshot: true,
      scheduledAt: true,
      status: true,
      account: { select: { name: true } },
      group: { select: { name: true } },
    },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
  });
  const days = new Map<
    string,
    { date: string; total: number; items: typeof rows }
  >();
  const summary: Partial<Record<TaskStatus, number>> = {};
  for (const row of rows) {
    const date = dateKey(row.scheduledAt);
    const day = days.get(date) || { date, total: 0, items: [] };
    day.total++;
    if (day.items.length < limit) day.items.push(row);
    days.set(date, day);
    summary[row.status] = (summary[row.status] || 0) + 1;
  }
  return { days: [...days.values()], total: rows.length, summary };
}

export async function listTasks(workspaceId: string, params: URLSearchParams) {
  const { page, size, skip } = pagination(params);
  const where = taskFilters(workspaceId, params);
  const [items, total, summary] = await Promise.all([
    db.task.findMany({
      where,
      skip,
      take: size,
      include: taskInclude,
      orderBy:
        params.get("history") === "true"
          ? [
              { recordedAt: { sort: "desc", nulls: "last" } },
              { updatedAt: "desc" },
            ]
          : [{ scheduledAt: "asc" }, { id: "asc" }],
    }),
    db.task.count({ where }),
    db.task.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);
  return {
    items: await withAutomaticWait(db, workspaceId, items),
    total,
    page,
    size,
    summary: Object.fromEntries(summary.map((s) => [s.status, s._count._all])),
  };
}
export async function cancelTasks(
  workspaceId: string,
  tasks: { id: string; version: number }[],
  operationId: string,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const unique = [...new Map(tasks.map((t) => [t.id, t])).values()];
    const requestHash = digest(
      unique.slice().sort((a, b) => a.id.localeCompare(b.id)),
    );
    const existingEvents = await tx.taskEvent.findMany({
      where: {
        id: { in: unique.map((t) => `${operationId}:${t.id}`) },
        task: { workspaceId },
      },
    });
    if (
      existingEvents.length === unique.length &&
      existingEvents.every((e) => e.requestHash === requestHash)
    )
      return { cancelled: unique.length, reused: true };
    if (existingEvents.length)
      throw new AppError(
        409,
        "Yêu cầu hủy đã thay đổi. Hãy tải lại danh sách.",
      );
    const current = await tx.task.findMany({
      where: { workspaceId, id: { in: unique.map((t) => t.id) } },
    });
    if (current.length !== unique.length)
      throw new AppError(404, "Có công việc không thuộc không gian của bạn.");
    if (
      current.some(
        (t) =>
          t.executionMode === "AUTOMATIC" &&
          t.status === "IN_PROGRESS" &&
          t.automaticPhase === "SUBMITTING",
      )
    )
      throw new AppError(
        409,
        "Máy đăng đã bắt đầu gửi bài. Đợi kết quả trước khi hủy; thao tác này không thể thu hồi bài đã gửi.",
      );
    if (
      current.some(
        (t) =>
          !LIVE_STATUSES.includes(t.status as (typeof LIVE_STATUSES)[number]) ||
          unique.find((i) => i.id === t.id)?.version !== t.version,
      )
    )
      throw new AppError(
        409,
        "Có công việc đã đổi trạng thái. Hãy tải lại trước khi hủy.",
      );
    await tx.task.updateMany({
      where: { workspaceId, id: { in: current.map((t) => t.id) } },
      data: {
        status: "CANCELLED",
        recordedAt: new Date(),
        note: "Người dùng hủy lịch.",
        version: { increment: 1 },
      },
    });
    await tx.taskEvent.createMany({
      data: current.map((t) => ({
        id: `${operationId}:${t.id}`,
        taskId: t.id,
        requestHash,
        fromStatus: t.status,
        toStatus: "CANCELLED" as const,
        source: "USER",
        note: "Người dùng hủy lịch.",
      })),
    });
    await tx.notification.updateMany({
      where: { workspaceId, taskId: { in: current.map((t) => t.id) } },
      data: { readAt: new Date() },
    });
    return { cancelled: current.length, reused: false };
  });
}
export async function archiveTasks(
  workspaceId: string,
  tasks: { id: string; version: number }[],
  operationId: string,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const unique = [...new Map(tasks.map((task) => [task.id, task])).values()];
    const requestHash = digest({
      action: "archive",
      tasks: unique.slice().sort((a, b) => a.id.localeCompare(b.id)),
    });
    const events = await tx.taskEvent.findMany({
      where: {
        id: { in: unique.map((task) => `${operationId}:${task.id}`) },
        task: { workspaceId },
      },
    });
    if (
      events.length === unique.length &&
      events.every((event) => event.requestHash === requestHash)
    )
      return { archived: unique.length, reused: true };
    if (events.length)
      throw new AppError(
        409,
        "Yêu cầu xóa đã thay đổi. Hãy tải lại danh sách.",
      );
    const current = await tx.task.findMany({
      where: { workspaceId, id: { in: unique.map((task) => task.id) } },
    });
    if (current.length !== unique.length)
      throw new AppError(404, "Có công việc không thuộc không gian của bạn.");
    if (
      current.some(
        (task) =>
          task.executionMode === "AUTOMATIC" && task.status === "IN_PROGRESS",
      )
    )
      throw new AppError(
        409,
        "Máy đăng đang xử lý. Đợi kết quả rồi xóa khỏi lịch; không thể thu hồi bài đang gửi.",
      );
    if (
      current.some(
        (task) =>
          task.archivedAt ||
          task.version !== unique.find((item) => item.id === task.id)!.version,
      )
    )
      throw new AppError(
        409,
        "Có công việc đã thay đổi. Hãy tải lại trước khi xóa.",
      );
    const now = new Date();
    for (const task of current) {
      // Preserve unresolved automatic outcomes so they can still be reviewed in history.
      const needsReview =
        task.status === "BLOCKED" && task.automaticPhase === "NEEDS_REVIEW";
      const cancel =
        LIVE_STATUSES.includes(task.status as (typeof LIVE_STATUSES)[number]) &&
        !needsReview;
      await tx.task.update({
        where: { id: task.id },
        data: {
          archivedAt: now,
          version: { increment: 1 },
          ...(cancel
            ? { status: "CANCELLED", recordedAt: now, resultSource: "USER" }
            : {}),
        },
      });
      await tx.taskEvent.create({
        data: {
          id: `${operationId}:${task.id}`,
          taskId: task.id,
          requestHash,
          fromStatus: task.status,
          toStatus: cancel ? "CANCELLED" : task.status,
          source: "USER",
          note: cancel
            ? "Xóa khỏi lịch và hủy công việc chưa hoàn tất."
            : "Xóa khỏi lịch; giữ nguyên kết quả để tra cứu trong Lịch sử.",
        },
      });
    }
    await tx.notification.updateMany({
      where: {
        workspaceId,
        taskId: { in: current.map((task) => task.id) },
        readAt: null,
      },
      data: { readAt: now },
    });
    return { archived: current.length, reused: false };
  });
}

export async function exportTasks(
  workspaceId: string,
  params: URLSearchParams,
) {
  const query = new URLSearchParams(params);
  query.set("size", "100");
  query.set("page", "1");
  const first = await listTasks(workspaceId, query);
  if (first.total > 10_000)
    throw new AppError(400, "Hãy lọc nhỏ hơn 10.000 công việc trước khi xuất.");
  const tasks = [...first.items];
  for (let page = 2; page <= Math.ceil(first.total / 100); page++) {
    query.set("page", String(page));
    tasks.push(...(await listTasks(workspaceId, query)).items);
  }
  // Prefix spreadsheet formulas before quoting so exported notes cannot execute.
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@\-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const header = [
    "Mã công việc",
    "Tên bài",
    "Tài khoản",
    "Profile",
    "Nơi đăng",
    "Lịch (UTC)",
    "Trạng thái",
    "Ghi nhận (UTC)",
    "Link bài",
    "Ghi chú",
    "Nguồn kết quả",
  ];
  const body = [
    header,
    ...tasks.map((t) => [
      t.id,
      t.titleSnapshot,
      t.account.name,
      t.account.profileName,
      t.group?.name || "Trang cá nhân",
      t.scheduledAt.toISOString(),
      t.status,
      t.recordedAt?.toISOString() || "",
      t.resultUrl || "",
      t.note,
      t.recordedAt
        ? t.resultSource === "DESKTOP"
          ? "Máy đăng ghi nhận"
          : "Người dùng xác nhận"
        : "Chưa xác nhận",
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
  return new Response("\uFEFF" + body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="nhip-dang-lich-su.csv"',
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
    },
  });
}
export async function getTask(workspaceId: string, id: string) {
  const task = assertFound(
    await db.task.findFirst({
      where: { workspaceId, id },
      include: {
        ...taskInclude,
        events: { orderBy: { createdAt: "desc" }, take: 30 },
      },
    }),
  );
  const assets = await db.asset.findMany({
    where: { workspaceId, id: { in: task.assetIds } },
  });
  return {
    ...(await withAutomaticWait(db, workspaceId, [task]))[0],
    assets: task.assetIds.flatMap(
      (id) => assets.find((a) => a.id === id) || [],
    ),
  };
}
export async function taskAction(
  workspaceId: string,
  id: string,
  input: TaskActionInput,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const current = assertFound(
      await tx.task.findFirst({
        where: { workspaceId, id },
        include: { account: true },
      }),
    );
    const requestHash = digest({ id, ...input });
    const previous = await tx.taskEvent.findUnique({
      where: { id: input.operationId },
    });
    if (previous) {
      if (previous.taskId !== id || previous.requestHash !== requestHash)
        throw new AppError(409, "Mã thao tác không còn hợp lệ.");
      return tx.task.findUnique({ where: { id }, include: taskInclude });
    }
    if (input.action === "start" && current.archivedAt)
      throw new AppError(
        409,
        "Công việc đã xóa khỏi lịch, không thể bắt đầu đăng.",
      );
    if (input.action === "start" && current.status === "IN_PROGRESS")
      return current;
    if (current.version !== input.version)
      throw new AppError(
        409,
        "Công việc đã thay đổi ở nơi khác. Hãy tải lại để xem trạng thái mới.",
      );
    if (input.action === "retry") {
      if (
        current.archivedAt ||
        current.executionMode !== "AUTOMATIC" ||
        current.status !== "BLOCKED" ||
        current.automaticPhase !== "SAFE_FAILED"
      )
        throw new AppError(
          409,
          "Chỉ thử lại bài đã xác định chưa gửi. Bài chưa rõ kết quả cần kiểm tra Facebook.",
        );
      const task = await tx.task.update({
        where: { id },
        data: {
          status: "READY",
          automaticPhase: "NONE",
          automaticAttempts: 0,
          nextAttemptAt: null,
          desktopRunId: null,
          desktopLeaseAt: null,
          blockReason: null,
          recordedAt: null,
          resultUrl: null,
          version: { increment: 1 },
          note: "Bạn yêu cầu thử lại bài chưa gửi.",
        },
        include: taskInclude,
      });
      await tx.taskEvent.create({
        data: {
          id: input.operationId,
          taskId: id,
          requestHash,
          fromStatus: current.status,
          toStatus: "READY",
          source: "USER",
          note: "Cấp lại tối đa 3 lượt cho bài đã xác định chưa gửi.",
        },
      });
      await tx.notification.updateMany({
        where: { workspaceId, taskId: id },
        data: { readAt: new Date() },
      });
      return task;
    }
    const to: TaskStatus =
      input.action === "start"
        ? "IN_PROGRESS"
        : input.action === "cancel"
          ? "CANCELLED"
          : input.status!;
    if (to === "PENDING_REVIEW" && !current.groupId)
      throw new AppError(
        400,
        "Chỉ bài gửi vào hội nhóm mới có trạng thái chờ duyệt nhóm.",
      );
    const reviewAutomatic =
      current.status === "BLOCKED" &&
      current.blockReason?.startsWith("AUTO_") &&
      input.action === "record" &&
      ["PUBLISHED", "PENDING_REVIEW", "SKIPPED"].includes(to);
    if (
      current.executionMode === "AUTOMATIC" &&
      current.status === "IN_PROGRESS"
    )
      throw new AppError(
        409,
        "Máy đăng đang xử lý công việc. Đợi kết quả trước khi cập nhật thủ công.",
      );
    if (current.executionMode === "AUTOMATIC" && input.action === "start")
      throw new AppError(
        409,
        "Đây là công việc tự động; kiểm tra máy đăng và phiên Facebook.",
      );
    if (!canTransition(current.status, to) && !reviewAutomatic)
      throw new AppError(
        409,
        "Không thể đổi trạng thái công việc theo thao tác này.",
      );
    if (input.action === "start" && current.scheduledAt > new Date())
      throw new AppError(
        409,
        "Công việc chưa đến giờ. Bạn có thể hủy và lên lịch lại.",
      );
    if (
      ["IN_PROGRESS", "PUBLISHED", "PENDING_REVIEW"].includes(to) &&
      (current.account.status !== "ACTIVE" || current.account.archivedAt) &&
      current.status !== "PENDING_REVIEW"
    )
      throw new AppError(409, "Tài khoản đang tạm dừng hoặc bị hạn chế.");
    const task = await tx.task.update({
      where: { id },
      data: {
        status: to,
        nextAttemptAt: null,
        ...(reviewAutomatic
          ? { automaticPhase: "DONE", blockReason: null }
          : {}),
        version: { increment: 1 },
        ...(to === "IN_PROGRESS"
          ? { startedAt: new Date() }
          : {
              note: input.note,
              resultUrl: input.resultUrl || null,
              recordedAt: new Date(),
              resultSource: "USER",
            }),
        ...(to === "BLOCKED" ? { blockReason: "ACCOUNT_RESTRICTED" } : {}),
      },
      include: taskInclude,
    });
    await tx.taskEvent.create({
      data: {
        id: input.operationId,
        taskId: id,
        requestHash,
        fromStatus: current.status,
        toStatus: to,
        note: input.note,
        source: "USER",
      },
    });
    await tx.notification.updateMany({
      where: { workspaceId, taskId: id, readAt: null },
      data: { readAt: new Date() },
    });
    if (to === "BLOCKED") {
      await tx.facebookAccount.update({
        where: { id: current.accountId },
        data: { status: "RESTRICTED" },
      });
      await updateAccountState(
        tx,
        workspaceId,
        current.accountId,
        "RESTRICTED",
      );
    }
    return task;
  });
}
export async function dashboard(workspaceId: string) {
  const now = new Date();
  const { start, end } = dayBounds(now);
  const visibleTasks = { workspaceId, archivedAt: null };
  const [
    due,
    overdue,
    published,
    pending,
    accountCount,
    groupCount,
    postCount,
    pausedCount,
    queue,
    upcoming,
    notifications,
    recent,
    counts,
    remainingTasks,
  ] = await Promise.all([
    db.task.count({
      where: {
        ...visibleTasks,
        scheduledAt: { lte: now },
        status: { in: ["SCHEDULED", "READY", "IN_PROGRESS"] },
        account: { status: "ACTIVE", archivedAt: null },
      },
    }),
    db.task.count({
      where: {
        ...visibleTasks,
        scheduledAt: { lt: start },
        status: { in: ["SCHEDULED", "READY", "IN_PROGRESS"] },
        account: { status: "ACTIVE", archivedAt: null },
      },
    }),
    db.task.count({
      where: {
        ...visibleTasks,
        status: "PUBLISHED",
        recordedAt: { gte: start, lt: end },
      },
    }),
    db.task.count({ where: { ...visibleTasks, status: "PENDING_REVIEW" } }),
    db.facebookAccount.count({ where: { workspaceId, archivedAt: null } }),
    db.group.count({ where: { workspaceId, archivedAt: null } }),
    db.post.count({ where: { workspaceId, archivedAt: null } }),
    db.facebookAccount.count({
      where: { workspaceId, archivedAt: null, status: { not: "ACTIVE" } },
    }),
    db.task.findMany({
      where: {
        ...visibleTasks,
        scheduledAt: { lte: now },
        status: { in: ["SCHEDULED", "READY", "IN_PROGRESS"] },
        account: { status: "ACTIVE", archivedAt: null },
      },
      take: 6,
      include: taskInclude,
      orderBy: [{ status: "asc" }, { scheduledAt: "asc" }],
    }),
    db.task.findMany({
      where: { ...visibleTasks, scheduledAt: { gt: now }, status: "SCHEDULED" },
      take: 4,
      include: taskInclude,
      orderBy: { scheduledAt: "asc" },
    }),
    db.notification.findMany({
      where: {
        workspaceId,
        readAt: null,
        task: {
          archivedAt: null,
          status: { in: ["READY", "SCHEDULED", "IN_PROGRESS"] },
          account: { status: "ACTIVE", archivedAt: null },
        },
      },
      take: 10,
      include: { task: { include: taskInclude } },
      orderBy: { createdAt: "desc" },
    }),
    db.task.findMany({
      where: {
        ...visibleTasks,
        recordedAt: { gte: new Date(start.getTime() - 6 * 86400_000), lt: end },
        status: { in: ["PUBLISHED", "PENDING_REVIEW", "SKIPPED"] },
      },
      select: { status: true, recordedAt: true },
    }),
    db.task.groupBy({
      by: ["status"],
      where: { ...visibleTasks, scheduledAt: { gte: start, lt: end } },
      _count: { _all: true },
    }),
    db.task.findMany({
      where: {
        ...visibleTasks,
        scheduledAt: { gte: start, lt: end },
        status: { in: [...LIVE_STATUSES] },
      },
      select: {
        id: true,
        titleSnapshot: true,
        scheduledAt: true,
        status: true,
        note: true,
        blockReason: true,
        automaticPhase: true,
        account: { select: { name: true } },
        group: { select: { name: true } },
      },
      take: 6,
      // Enum order puts blocked work first, then work in progress.
      orderBy: [{ status: "desc" }, { scheduledAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const dailyResults = new Map<
    string,
    { published: number; pending: number }
  >();
  for (const task of recent) {
    if (!task.recordedAt) continue;
    const key = dateKey(task.recordedAt);
    const day = dailyResults.get(key) || { published: 0, pending: 0 };
    if (task.status === "PUBLISHED") day.published++;
    if (task.status === "PENDING_REVIEW") day.pending++;
    dailyResults.set(key, day);
  }
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start.getTime() - (6 - i) * 86400_000);
    const key = dateKey(day);
    return {
      date: key,
      published: dailyResults.get(key)?.published || 0,
      pending: dailyResults.get(key)?.pending || 0,
    };
  });
  const progress = {
    date: dateKey(now),
    byStatus: Object.fromEntries(
      STATUSES.map((status) => [
        status,
        counts.find((c) => c.status === status)?._count._all || 0,
      ]),
    ),
    remainingTasks,
    total: counts.reduce((a, c) => a + c._count._all, 0),
    handled: counts
      .filter((c) =>
        ["PUBLISHED", "PENDING_REVIEW", "SKIPPED", "CANCELLED"].includes(
          c.status,
        ),
      )
      .reduce((a, c) => a + c._count._all, 0),
    pending:
      counts.find((c) => c.status === "PENDING_REVIEW")?._count._all || 0,
  };
  return {
    due,
    overdue,
    published,
    pending,
    accountCount,
    groupCount,
    postCount,
    pausedCount,
    queue: await withAutomaticWait(db, workspaceId, queue),
    upcoming: await withAutomaticWait(db, workspaceId, upcoming),
    notifications,
    week,
    progress,
  };
}
