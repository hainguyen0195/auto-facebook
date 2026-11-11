import type { FacebookConnection } from "@prisma/client";
import type { Tx } from "./service";

// The active connection is a projection; inactive machines keep their own consent.
export async function saveDeviceSession(
  tx: Tx,
  connection: FacebookConnection,
) {
  const data = {
    state: connection.state,
    confirmedIdentityHash: connection.confirmedIdentityHash,
    automationEnabled: connection.automationEnabled,
    interactionEnabled: connection.interactionEnabled,
    interactionDailyLimit: connection.interactionDailyLimit,
    interactionIntervalMinutes: connection.interactionIntervalMinutes,
    checkedAt: connection.checkedAt,
  };
  await tx.facebookDeviceSession.upsert({
    where: {
      accountId_deviceId: {
        accountId: connection.accountId,
        deviceId: connection.deviceId,
      },
    },
    create: {
      accountId: connection.accountId,
      deviceId: connection.deviceId,
      ...data,
    },
    update: data,
  });
}
