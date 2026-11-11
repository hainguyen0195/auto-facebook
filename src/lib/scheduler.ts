import { db } from "./db";
import { workspaceTransaction } from "./service";

export async function scanReminders(now = new Date()) {
  const workspaces = await db.task.findMany({
    where: {
      scheduledAt: { lte: now },
      status: "SCHEDULED",
      archivedAt: null,
      account: { status: "ACTIVE", archivedAt: null },
    },
    distinct: ["workspaceId"],
    select: { workspaceId: true },
  });
  let processed = 0;
  for (const { workspaceId } of workspaces) {
    processed += await workspaceTransaction(workspaceId, async (tx) => {
      const tasks = await tx.task.findMany({
        where: {
          workspaceId,
          scheduledAt: { lte: now },
          status: "SCHEDULED",
          archivedAt: null,
          account: { status: "ACTIVE", archivedAt: null },
        },
        take: 500,
        select: { id: true },
      });
      if (!tasks.length) return 0;
      await tx.task.updateMany({
        where: {
          workspaceId,
          id: { in: tasks.map((t) => t.id) },
          status: "SCHEDULED",
        },
        data: { status: "READY", version: { increment: 1 } },
      });
      await tx.notification.createMany({
        data: tasks.map((t) => ({ workspaceId, taskId: t.id })),
        skipDuplicates: true,
      });
      return tasks.length;
    });
  }
  return processed;
}
