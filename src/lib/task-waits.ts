import type { Prisma } from "@prisma/client";
import { dayBounds } from "./utils";

type WaitingTask = {
  id: string;
  executionMode: string;
  status: string;
  accountId: string;
  account: { postIntervalMinutes: number; dailyLimit: number };
  groupId: string | null;
  group: { minIntervalMinutes: number } | null;
  nextAttemptAt?: Date | null;
  startedAt?: Date | null;
};

export async function withAutomaticWait<T extends WaitingTask>(
  client: Pick<Prisma.TransactionClient, "task">,
  workspaceId: string,
  tasks: T[],
  now = new Date(),
) {
  const pending = tasks.filter(
    (task) =>
      task.executionMode === "AUTOMATIC" &&
      ["SCHEDULED", "READY"].includes(task.status),
  );
  const intervals = new Map(
    pending
      .filter(
        (task) =>
          task.groupId && task.group && task.group.minIntervalMinutes > 0,
      )
      .map((task) => [task.groupId!, task.group!.minIntervalMinutes]),
  );
  // Match the desktop's interval rule, including unfinished manual attempts.
  const recent = intervals.size
    ? await client.task.groupBy({
        by: ["groupId"],
        where: {
          workspaceId,
          groupId: { in: [...intervals.keys()] },
          id: { notIn: pending.map((task) => task.id) },
          startedAt: {
            gte: new Date(
              now.getTime() - Math.max(...intervals.values()) * 60_000,
            ),
          },
          status: { notIn: ["CANCELLED", "SKIPPED"] },
        },
        _max: { startedAt: true },
      })
    : [];
  const waits = new Map(
    recent.flatMap((row) => {
      const minutes = intervals.get(row.groupId!)!;
      const startedAt = row._max.startedAt;
      if (!startedAt) return [];
      const until = new Date(startedAt.getTime() + minutes * 60_000);
      return until > now
        ? ([
            [
              row.groupId!,
              { reason: "GROUP_INTERVAL" as const, minutes, until },
            ],
          ] as const)
        : [];
    }),
  );
  const accountIntervals = new Map(
    pending
      .filter((task) => task.account.postIntervalMinutes > 0)
      .map((task) => [task.accountId, task.account.postIntervalMinutes]),
  );
  const accountRecent = accountIntervals.size
    ? await client.task.groupBy({
        by: ["accountId"],
        where: {
          workspaceId,
          accountId: { in: [...accountIntervals.keys()] },
          id: { notIn: pending.map((task) => task.id) },
          startedAt: {
            gte: new Date(
              now.getTime() - Math.max(...accountIntervals.values()) * 60_000,
            ),
          },
          status: { notIn: ["CANCELLED", "SKIPPED"] },
        },
        _max: { startedAt: true },
      })
    : [];
  const accountWaits = new Map(
    accountRecent.flatMap((row) => {
      const minutes = accountIntervals.get(row.accountId)!;
      if (!row._max.startedAt) return [];
      const until = new Date(row._max.startedAt.getTime() + minutes * 60_000);
      return until > now
        ? ([
            [
              row.accountId,
              { reason: "ACCOUNT_INTERVAL" as const, minutes, until },
            ],
          ] as const)
        : [];
    }),
  );
  const pendingIds = new Set(pending.map((task) => task.id));
  const bounds = dayBounds(now);
  const dailyCounts = pending.length
    ? await client.task.groupBy({
        by: ["accountId"],
        where: {
          workspaceId,
          accountId: { in: [...new Set(pending.map((t) => t.accountId))] },
          startedAt: { gte: bounds.start, lt: bounds.end },
          status: { notIn: ["CANCELLED", "SKIPPED"] },
        },
        _count: { _all: true },
      })
    : [];
  const counts = new Map(
    dailyCounts.map((row) => [row.accountId, row._count._all]),
  );
  // A retry excludes its own previous attempt, just like desktop claiming.
  const otherDailyAttempts = (task: T) =>
    (counts.get(task.accountId) || 0) -
    Number(
      !!task.startedAt &&
        task.startedAt >= bounds.start &&
        task.startedAt < bounds.end,
    );
  const unresolved = pending.length
    ? await client.task.findMany({
        where: {
          workspaceId,
          accountId: {
            in: [...new Set(pending.map((t) => t.accountId))],
          },
          archivedAt: null,
          status: "BLOCKED",
          executionMode: "AUTOMATIC",
          automaticPhase: "NEEDS_REVIEW",
        },
        select: { accountId: true },
        distinct: ["accountId"],
      })
    : [];
  return tasks.map((task) => ({
    ...task,
    automaticHold:
      pendingIds.has(task.id) &&
      unresolved.some((t) => t.accountId === task.accountId)
        ? "Tài khoản đang chờ kiểm tra kết quả một bài trước. Mở bài Cần kiểm tra để ghi nhận kết quả."
        : pendingIds.has(task.id) &&
            otherDailyAttempts(task) >= task.account.dailyLimit
          ? `Đã dùng ${otherDailyAttempts(task)}/${task.account.dailyLimit} lượt đăng hôm nay. Tài khoản sẽ tiếp tục từ ngày mai khi hết giờ nghỉ và máy đăng sẵn sàng.`
          : null,
    automaticWait: pendingIds.has(task.id)
      ? [
          waits.get(task.groupId!),
          accountWaits.get(task.accountId),
          ...pending.flatMap((other) => {
            if (other.id === task.id || !other.startedAt) return [];
            const accountMinutes =
              other.accountId === task.accountId
                ? task.account.postIntervalMinutes
                : 0;
            const groupMinutes =
              task.groupId && other.groupId === task.groupId
                ? task.group?.minIntervalMinutes || 0
                : 0;
            const minutes = Math.max(accountMinutes, groupMinutes);
            if (!minutes) return [];
            const until = new Date(
              other.startedAt.getTime() + minutes * 60_000,
            );
            return until > now
              ? [
                  {
                    reason:
                      groupMinutes >= accountMinutes
                        ? ("GROUP_INTERVAL" as const)
                        : ("ACCOUNT_INTERVAL" as const),
                    minutes,
                    until,
                  },
                ]
              : [];
          }),
          task.nextAttemptAt && task.nextAttemptAt > now
            ? {
                reason: "RETRY_BACKOFF" as const,
                minutes: Math.ceil(
                  (task.nextAttemptAt.getTime() - now.getTime()) / 60_000,
                ),
                until: task.nextAttemptAt,
              }
            : null,
        ]
          .filter((wait) => !!wait)
          .sort((a, b) => b.until.getTime() - a.until.getTime())[0] || null
      : null,
  }));
}
