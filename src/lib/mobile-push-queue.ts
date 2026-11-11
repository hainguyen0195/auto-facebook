import type { Tx } from "./service";

export async function queueInboxPush(
  tx: Tx,
  workspaceId: string,
  hasNew: boolean,
) {
  await tx.mobilePushSubscription.updateMany({
    where: { workspaceId, session: { expiresAt: { gt: new Date() } } },
    data: {
      pendingVersion: { increment: 1 },
      nextAttemptAt: new Date(),
      ...(hasNew ? { hasNew: true } : {}),
    },
  });
}
