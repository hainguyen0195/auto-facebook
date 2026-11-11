import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { AppError, assertFound } from "./errors";
import { workspaceTransaction, type Tx } from "./service";
import { dayBounds } from "./utils";
import { isQuietHour } from "./task-policy";
import { localDesktopAvailable } from "./desktop-host";
import { saveDeviceSession } from "./device-sessions";
import { windowsInstallerAvailable } from "./windows-installer";
import { macosInstallerAvailable } from "./macos-installer";
import { claimInteraction, recoverInteractions } from "./interaction-work";
import {
  AUTOMATIC_ATTEMPT_MS,
  automaticFailureState,
} from "./automatic-policy";

const fingerprint = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const online = (at: Date | null) => !!at && Date.now() - at.getTime() < 45_000;
export const AUTOMATIC_LEASE_MS = 5 * 60_000;
const DESKTOP_COMMAND_TIMEOUT_MS = 2 * 60_000;

async function expireDesktopCommands(tx: Tx, workspaceId: string, now: Date) {
  await tx.desktopCommand.updateMany({
    where: {
      workspaceId,
      state: "QUEUED",
      OR: [
        {
          createdAt: {
            lt: new Date(now.getTime() - DESKTOP_COMMAND_TIMEOUT_MS),
          },
        },
        { device: { lastSeenAt: null } },
        { device: { lastSeenAt: { lt: new Date(now.getTime() - 45_000) } } },
        { device: { revokedAt: { not: null } } },
      ],
    },
    data: {
      state: "FAILED",
      message:
        "Máy đăng mất kết nối hoặc chưa nhận yêu cầu kịp thời. Yêu cầu đã kết thúc; hãy kết nối lại rồi thử lại.",
      finishedAt: now,
    },
  });
  await tx.desktopCommand.updateMany({
    where: {
      workspaceId,
      state: "RUNNING",
      startedAt: { lt: new Date(now.getTime() - DESKTOP_COMMAND_TIMEOUT_MS) },
    },
    data: {
      state: "FAILED",
      message:
        "Máy đăng chưa xác nhận kết quả và yêu cầu đã quá hạn. Hãy kiểm tra cửa sổ Facebook rồi thử lại.",
      finishedAt: now,
    },
  });
}

export async function createPairing(workspaceId: string, installation = false) {
  const code = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (installation ? 15 : 5) * 60_000);
  await workspaceTransaction(workspaceId, async (tx) => {
    await tx.desktopPairing.deleteMany({ where: { workspaceId } });
    await tx.desktopPairing.create({
      data: { workspaceId, codeHash: fingerprint(code), expiresAt },
    });
  });
  return {
    code,
    expiresAt,
    server: new URL(process.env.BETTER_AUTH_URL || "http://localhost:3000")
      .origin,
  };
}

export async function pairDesktop(code: string, name: string) {
  const pairing = assertFound(
    await db.desktopPairing.findUnique({
      where: { codeHash: fingerprint(code) },
    }),
    "Mã kết nối không hợp lệ hoặc đã hết hạn.",
  );
  return workspaceTransaction(pairing.workspaceId, async (tx) => {
    const current = await tx.desktopPairing.findUnique({
      where: { id: pairing.id },
    });
    if (!current || current.usedAt || current.expiresAt <= new Date())
      throw new AppError(401, "Mã kết nối không hợp lệ hoặc đã hết hạn.");
    const token = randomBytes(32).toString("base64url");
    const device = await tx.desktopDevice.create({
      data: {
        workspaceId: pairing.workspaceId,
        name,
        tokenHash: fingerprint(token),
      },
    });
    await tx.desktopPairing.update({
      where: { id: pairing.id },
      data: { usedAt: new Date() },
    });
    return { token, deviceId: device.id, workspaceId: device.workspaceId };
  });
}

export async function desktopFor(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) throw new AppError(401, "Thiếu khóa kết nối máy đăng.");
  const device = await db.desktopDevice.findUnique({
    where: { tokenHash: fingerprint(token) },
  });
  if (!device || device.revokedAt)
    throw new AppError(401, "Máy đăng đã ngắt kết nối.");
  return device;
}
export async function desktopStatus(workspaceId: string) {
  await workspaceTransaction(workspaceId, (tx) =>
    expireDesktopCommands(tx, workspaceId, new Date()),
  );
  const devices = await db.desktopDevice.findMany({
    where: { workspaceId, revokedAt: null },
    select: {
      id: true,
      name: true,
      paused: true,
      lastSeenAt: true,
      supportsInbox: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const connections = await db.facebookConnection.findMany({
    where: { workspaceId },
    select: {
      id: true,
      accountId: true,
      deviceId: true,
      generation: true,
      state: true,
      automationEnabled: true,
      interactionEnabled: true,
      interactionDailyLimit: true,
      interactionIntervalMinutes: true,
      checkedAt: true,
      message: true,
    },
  });
  const commands = await db.desktopCommand.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      id: true,
      accountId: true,
      kind: true,
      state: true,
      message: true,
      createdAt: true,
    },
  });
  const reviews = await db.task.groupBy({
    by: ["accountId"],
    where: {
      workspaceId,
      executionMode: "AUTOMATIC",
      status: "BLOCKED",
      automaticPhase: "NEEDS_REVIEW",
      archivedAt: null,
    },
    _count: { _all: true },
  });
  return {
    localConnectAvailable: localDesktopAvailable(),
    windowsInstallerAvailable: windowsInstallerAvailable(),
    macosInstallerAvailable: macosInstallerAvailable(),
    devices: devices.map((d) => ({ ...d, online: online(d.lastSeenAt) })),
    connections: connections.map((connection) => ({
      ...connection,
      reviewRequired:
        reviews.find((review) => review.accountId === connection.accountId)
          ?._count._all || 0,
    })),
    commands,
  };
}
export async function updateDevice(
  workspaceId: string,
  id: string,
  action: "pause" | "resume" | "revoke",
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    assertFound(
      await tx.desktopDevice.findFirst({
        where: { id, workspaceId, revokedAt: null },
      }),
    );
    await tx.desktopDevice.update({
      where: { id },
      data:
        action === "revoke"
          ? { revokedAt: new Date(), paused: true }
          : { paused: action === "pause" },
    });
    if (action === "revoke")
      await tx.desktopCommand.updateMany({
        where: {
          workspaceId,
          deviceId: id,
          state: { in: ["QUEUED", "RUNNING"] },
        },
        data: {
          state: "FAILED",
          message: "Máy đăng đã ngắt kết nối.",
          finishedAt: new Date(),
        },
      });
    if (action === "revoke")
      await tx.facebookConnection.updateMany({
        where: { deviceId: id, workspaceId },
        data: {
          automationEnabled: false,
          interactionEnabled: false,
          state: "DISCONNECTED",
          confirmedIdentityHash: null,
        },
      });
    return { ok: true };
  });
}
export async function queueDesktopCommand(
  workspaceId: string,
  accountId: string,
  deviceId: string,
  kind: "LOGIN" | "OPEN" | "CHECK" | "CLOSE" | "OPEN_POST",
  targetUrl?: string,
  switching = false,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    await expireDesktopCommands(tx, workspaceId, new Date());
    assertFound(
      await tx.facebookAccount.findFirst({
        where: { id: accountId, workspaceId, archivedAt: null },
      }),
    );
    const device = assertFound(
      await tx.desktopDevice.findFirst({
        where: { id: deviceId, workspaceId, revokedAt: null },
      }),
    );
    if (!online(device.lastSeenAt))
      throw new AppError(409, "Hãy bật máy đăng trước khi mở Facebook.");
    if (switching && !device.supportsInbox)
      throw new AppError(
        409,
        "Cập nhật và khởi động lại máy đăng trước khi chuyển máy.",
      );
    if (
      await tx.interaction.count({
        where: {
          workspaceId,
          accountId,
          status: "IN_PROGRESS",
          executionMode: "AUTOMATIC",
        },
      })
    )
      throw new AppError(
        409,
        "Tài khoản đang tương tác; đợi hoàn tất trước khi mở profile.",
      );
    if (
      await tx.task.count({
        where: {
          workspaceId,
          accountId,
          executionMode: "AUTOMATIC",
          status: "IN_PROGRESS",
        },
      })
    )
      throw new AppError(
        409,
        "Tài khoản đang thực hiện bài đăng. Đợi hoàn tất rồi mở profile.",
      );
    const existing = await tx.facebookConnection.findUnique({
      where: { accountId },
    });
    if (existing && existing.deviceId !== deviceId && !device.supportsInbox)
      throw new AppError(
        409,
        "Cập nhật và khởi động lại máy đăng trước khi chuyển máy.",
      );
    const pending = await tx.desktopCommand.findFirst({
      where: { workspaceId, accountId, state: { in: ["QUEUED", "RUNNING"] } },
    });
    if (pending) {
      if (pending.deviceId !== deviceId || pending.kind !== kind)
        throw new AppError(
          409,
          "Tài khoản đang xử lý yêu cầu khác. Hãy đợi hoàn tất.",
        );
      return pending;
    }
    if (existing && existing.deviceId !== deviceId && kind !== "LOGIN")
      throw new AppError(409, "Profile thuộc máy đăng khác.");
    if (kind === "LOGIN" && (!existing || existing.deviceId !== deviceId)) {
      if (existing) await saveDeviceSession(tx, existing);
      const saved = await tx.facebookDeviceSession.findUnique({
        where: { accountId_deviceId: { accountId, deviceId } },
      });
      await tx.facebookConnection.upsert({
        where: { accountId },
        create: { workspaceId, accountId, deviceId },
        update: {
          deviceId,
          generation: { increment: 1 },
          state: "CHECKING",
          automationEnabled: saved?.automationEnabled ?? false,
          interactionEnabled: saved?.interactionEnabled ?? false,
          interactionDailyLimit: saved?.interactionDailyLimit ?? 10,
          interactionIntervalMinutes: saved?.interactionIntervalMinutes ?? 5,
          confirmedIdentityHash: saved?.confirmedIdentityHash ?? null,
          identityHash: null,
          checkedAt: null,
          expectedIdentityHash:
            existing?.expectedIdentityHash ?? existing?.confirmedIdentityHash,
          message: "Đang kiểm tra phiên Facebook trên máy được chọn.",
        },
      });
    } else if (kind !== "LOGIN" && !existing)
      throw new AppError(409, "Mở Facebook và đăng nhập tài khoản trước.");
    if (kind === "OPEN_POST") {
      const url = new URL(targetUrl || "");
      if (url.protocol !== "https:" || url.hostname !== "www.facebook.com")
        throw new AppError(400, "Đích phải là Facebook.");
      await tx.facebookConnection.update({
        where: { accountId },
        data: { automationEnabled: false, interactionEnabled: false },
      });
    }
    const active = await tx.facebookConnection.findUniqueOrThrow({
      where: { accountId },
    });
    return tx.desktopCommand.create({
      data: {
        workspaceId,
        accountId,
        deviceId,
        kind,
        generation: active.generation,
        targetUrl: kind === "OPEN_POST" ? targetUrl : null,
      },
    });
  });
}

export function switchDesktop(
  workspaceId: string,
  accountId: string,
  deviceId: string,
) {
  return queueDesktopCommand(
    workspaceId,
    accountId,
    deviceId,
    "LOGIN",
    undefined,
    true,
  );
}
export async function updateConnection(
  workspaceId: string,
  accountId: string,
  action: "confirm" | "enable" | "disable",
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const connection = assertFound(
      await tx.facebookConnection.findFirst({
        where: { workspaceId, accountId },
        include: { device: true },
      }),
    );
    if (action !== "disable") {
      if (connection.device.revokedAt || !online(connection.device.lastSeenAt))
        throw new AppError(409, "Máy đăng chưa trực tuyến.");
      if (
        !connection.identityHash ||
        !connection.checkedAt ||
        Date.now() - connection.checkedAt.getTime() > 5 * 60_000
      )
        throw new AppError(409, "Kiểm tra phiên Facebook trước khi xác nhận.");
      if (action === "confirm" && connection.state !== "UNCONFIRMED")
        throw new AppError(409, "Phiên chưa sẵn sàng để xác nhận.");
      if (
        action === "confirm" &&
        connection.expectedIdentityHash &&
        connection.identityHash !== connection.expectedIdentityHash
      )
        throw new AppError(
          409,
          "Phiên Facebook không khớp tài khoản đã xác nhận trên máy trước.",
        );
      if (
        action === "enable" &&
        (connection.state !== "READY" ||
          connection.identityHash !== connection.confirmedIdentityHash)
      )
        throw new AppError(409, "Bạn cần xác nhận đúng tài khoản trước.");
    }
    const updated = await tx.facebookConnection.update({
      where: { id: connection.id },
      data:
        action === "confirm"
          ? {
              state: "READY",
              confirmedIdentityHash: connection.identityHash,
              expectedIdentityHash: connection.identityHash,
              message: "Bạn đã xác nhận đúng tài khoản trong cửa sổ Facebook.",
            }
          : { automationEnabled: action === "enable" },
    });
    await saveDeviceSession(tx, updated);
    return updated;
  });
}

export async function heartbeat(
  deviceId: string,
  workspaceId: string,
  instanceId: string,
  supportsInbox = false,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const device = assertFound(
      await tx.desktopDevice.findFirst({
        where: { id: deviceId, workspaceId, revokedAt: null },
      }),
    );
    if (
      online(device.lastSeenAt) &&
      device.instanceId &&
      device.instanceId !== instanceId
    )
      throw new AppError(409, "Máy đăng này đang chạy ở tiến trình khác.");
    await tx.desktopDevice.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date(), instanceId, supportsInbox },
    });
    await recoverStaleTasks(tx, workspaceId, new Date());
    await recoverInteractions(tx, workspaceId, new Date());
    await expireDesktopCommands(tx, workspaceId, new Date());
    return { paused: device.paused };
  });
}

export async function claimDesktopWork(
  deviceId: string,
  workspaceId: string,
  instanceId: string,
  supportsInteractions = false,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const device = assertFound(
      await tx.desktopDevice.findFirst({
        where: { id: deviceId, workspaceId, revokedAt: null },
      }),
    );
    if (device.instanceId !== instanceId || !online(device.lastSeenAt))
      throw new AppError(409, "Máy đăng cần gửi trạng thái kết nối trước.");
    if (
      await tx.interaction.count({
        where: {
          workspaceId,
          desktopDeviceId: deviceId,
          status: "IN_PROGRESS",
          executionMode: "AUTOMATIC",
        },
      })
    )
      return null;
    await expireDesktopCommands(tx, workspaceId, new Date());
    const command = await tx.desktopCommand.findFirst({
      where: { deviceId, workspaceId, state: "QUEUED" },
      orderBy: { createdAt: "asc" },
    });
    if (command) {
      const connection = await tx.facebookConnection.findFirst({
        where: {
          accountId: command.accountId,
          workspaceId,
          deviceId,
          generation: command.generation,
        },
      });
      if (!connection) {
        await tx.desktopCommand.update({
          where: { id: command.id },
          data: {
            state: "FAILED",
            finishedAt: new Date(),
            message: "Kết nối đã chuyển sang máy hoặc phiên khác.",
          },
        });
        return null;
      }
      const account = await tx.facebookAccount.findFirst({
        where: { id: command.accountId, workspaceId, archivedAt: null },
      });
      if (!account) {
        await tx.desktopCommand.update({
          where: { id: command.id },
          data: { state: "FAILED", message: "Tài khoản đã lưu trữ." },
        });
        return null;
      }
      const runId = randomUUID();
      await tx.desktopCommand.update({
        where: { id: command.id },
        data: { state: "RUNNING", runId, startedAt: new Date() },
      });
      return {
        type: "COMMAND" as const,
        id: command.id,
        runId,
        kind: command.kind,
        generation: command.generation,
        targetUrl: command.targetUrl,
        account: { id: account.id, name: account.name, url: account.url },
      };
    }
    if (
      device.paused ||
      (await tx.task.count({
        where: {
          workspaceId,
          desktopDeviceId: deviceId,
          status: "IN_PROGRESS",
          executionMode: "AUTOMATIC",
        },
      }))
    )
      return null;
    const connections = await tx.facebookConnection.findMany({
      where: { workspaceId, deviceId, state: "READY", automationEnabled: true },
    });
    const unresolved = await tx.task.findMany({
      where: {
        workspaceId,
        executionMode: "AUTOMATIC",
        status: "BLOCKED",
        automaticPhase: "NEEDS_REVIEW",
        archivedAt: null,
      },
      select: { accountId: true },
      distinct: ["accountId"],
    });
    const tasks = await tx.task.findMany({
      where: {
        workspaceId,
        executionMode: "AUTOMATIC",
        status: { in: ["SCHEDULED", "READY"] },
        archivedAt: null,
        scheduledAt: { lte: new Date() },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        accountId: {
          in: connections
            .filter(
              (connection) =>
                !unresolved.some(
                  (task) => task.accountId === connection.accountId,
                ),
            )
            .map((c) => c.accountId),
        },
        account: { status: "ACTIVE", archivedAt: null },
      },
      include: { account: true, group: true },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: 50,
    });
    for (const task of tasks) {
      const connection = connections.find(
        (c) => c.accountId === task.accountId,
      )!;
      if (
        !connection.confirmedIdentityHash ||
        connection.identityHash !== connection.confirmedIdentityHash ||
        task.group?.archivedAt
      )
        continue;
      const now = new Date();
      const hour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Bangkok",
          hour: "2-digit",
          hourCycle: "h23",
        }).format(now),
      );
      if (
        isQuietHour(
          hour,
          task.account.quietStart,
          task.account.quietEnd,
          task.account.quietHoursEnabled,
        )
      )
        continue;
      const bounds = dayBounds(now);
      const today = await tx.task.count({
        where: {
          workspaceId,
          accountId: task.accountId,
          id: { not: task.id },
          startedAt: { gte: bounds.start, lt: bounds.end },
          status: { notIn: ["CANCELLED", "SKIPPED"] },
        },
      });
      if (today >= task.account.dailyLimit) continue;
      if (
        task.account.postIntervalMinutes > 0 &&
        (await tx.task.count({
          where: {
            workspaceId,
            accountId: task.accountId,
            id: { not: task.id },
            startedAt: {
              gte: new Date(
                now.getTime() - task.account.postIntervalMinutes * 60_000,
              ),
            },
            status: { notIn: ["CANCELLED", "SKIPPED"] },
          },
        }))
      )
        continue;
      if (
        task.group &&
        task.group.minIntervalMinutes > 0 &&
        (await tx.task.count({
          where: {
            workspaceId,
            groupId: task.groupId,
            id: { not: task.id },
            startedAt: {
              gte: new Date(
                now.getTime() - task.group.minIntervalMinutes * 60_000,
              ),
            },
            status: { notIn: ["CANCELLED", "SKIPPED"] },
          },
        }))
      )
        continue;
      const assets = await tx.asset.findMany({
        where: { workspaceId, id: { in: task.assetIds } },
        select: { id: true, mime: true },
      });
      if (assets.length !== task.assetIds.length) continue;
      const runId = randomUUID();
      await tx.task.update({
        where: { id: task.id },
        data: {
          status: "IN_PROGRESS",
          desktopDeviceId: deviceId,
          desktopRunId: runId,
          desktopLeaseAt: now,
          startedAt: now,
          automaticPhase: "PREPARING",
          automaticAttempts: { increment: 1 },
          nextAttemptAt: null,
          version: { increment: 1 },
        },
      });
      await tx.taskEvent.create({
        data: {
          id: randomUUID(),
          taskId: task.id,
          requestHash: runId,
          fromStatus: task.status,
          toStatus: "IN_PROGRESS",
          source: "DESKTOP",
          note: "Máy đăng bắt đầu chuẩn bị bài.",
        },
      });
      return {
        type: "POST" as const,
        id: task.id,
        runId,
        attemptDeadlineAt: new Date(
          now.getTime() + AUTOMATIC_ATTEMPT_MS,
        ).toISOString(),
        account: {
          id: task.account.id,
          name: task.account.name,
          url: task.account.url,
        },
        targetUrl: task.group?.url || task.account.url,
        group: !!task.groupId,
        content: task.contentSnapshot,
        assets: task.assetIds.map((id) => assets.find((a) => a.id === id)!),
        identityHash: connection.confirmedIdentityHash,
      };
    }
    return supportsInteractions &&
      process.env.NHIPDANG_AUTOMATIC_INTERACTIONS !== "0"
      ? claimInteraction(tx, deviceId, workspaceId)
      : null;
  });
}

export const commandResultSchema = z
  .object({
    runId: z.uuid(),
    generation: z.number().int().nonnegative().optional(),
    state: z.enum([
      "OPENED",
      "READY",
      "LOGIN_REQUIRED",
      "CHALLENGE",
      "FAILED",
      "CLOSED",
    ]),
    identityHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    message: z.string().max(1000).default(""),
  })
  .refine((input) => input.state !== "READY" || !!input.identityHash, {
    message: "Thiếu danh tính phiên Facebook.",
  });
export const sessionResultSchema = z
  .object({
    instanceId: z.uuid(),
    generation: z.number().int().nonnegative().optional(),
    state: z.enum(["READY", "LOGIN_REQUIRED", "CHALLENGE"]),
    identityHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    message: z.string().max(1000),
  })
  .refine((input) => input.state !== "READY" || !!input.identityHash, {
    message: "Thiếu danh tính phiên Facebook.",
  });

export async function reportDesktopSession(
  deviceId: string,
  workspaceId: string,
  accountId: string,
  input: z.infer<typeof sessionResultSchema>,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const device = assertFound(
      await tx.desktopDevice.findFirst({
        where: { id: deviceId, workspaceId, revokedAt: null },
      }),
    );
    if (!online(device.lastSeenAt) || device.instanceId !== input.instanceId)
      throw new AppError(
        409,
        "Máy đăng cần kết nối lại trước khi kiểm tra phiên.",
      );
    const connection = await tx.facebookConnection.findFirst({
      where: {
        workspaceId,
        deviceId,
        accountId,
        account: { archivedAt: null },
      },
    });
    if (!connection) return { ok: true, stale: true };
    // A late login observation must not overwrite a confirmation or disconnection.
    if (
      (input.generation ?? 0) !== connection.generation ||
      !["CHECKING", "LOGIN_REQUIRED", "CHALLENGE"].includes(connection.state)
    )
      return { ok: true, stale: true };
    await applySessionResult(tx, connection, input);
    return { ok: true };
  });
}

export async function finishDesktopCommand(
  deviceId: string,
  workspaceId: string,
  id: string,
  input: z.infer<typeof commandResultSchema>,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const command = assertFound(
      await tx.desktopCommand.findFirst({
        where: { id, deviceId, workspaceId, runId: input.runId },
      }),
    );
    if (command.state !== "RUNNING") return { ok: true };
    const connection = await tx.facebookConnection.findFirst({
      where: {
        workspaceId,
        deviceId,
        accountId: command.accountId,
        generation: command.generation,
      },
    });
    if (!connection || (input.generation ?? 0) !== command.generation)
      return { ok: true, stale: true };
    if (input.state !== "FAILED") {
      await tx.facebookConnection.update({
        where: { id: connection.id },
        data: { inboxPaused: input.state === "CLOSED" },
      });
    }
    if (connection && !["OPENED", "CLOSED", "FAILED"].includes(input.state)) {
      await applySessionResult(tx, connection, input);
    } else if (input.state === "FAILED" && connection.state === "CHECKING") {
      await tx.facebookConnection.update({
        where: { id: connection.id },
        data: { message: input.message },
      });
    }
    await tx.desktopCommand.update({
      where: { id },
      data: {
        state: input.state === "FAILED" ? "FAILED" : "SUCCEEDED",
        message: input.message,
        finishedAt: new Date(),
      },
    });
    return { ok: true };
  });
}

async function applySessionResult(
  tx: Tx,
  connection: import("@prisma/client").FacebookConnection,
  input: { state: string; identityHash?: string; message: string },
) {
  const ready = input.state === "READY" && !!input.identityHash;
  const wrong =
    ready &&
    !!connection.expectedIdentityHash &&
    input.identityHash !== connection.expectedIdentityHash;
  const same =
    ready && !wrong && input.identityHash === connection.confirmedIdentityHash;
  const updated = await tx.facebookConnection.update({
    where: { id: connection.id },
    data: {
      state: wrong
        ? "WRONG_IDENTITY"
        : ready
          ? same
            ? "READY"
            : "UNCONFIRMED"
          : input.state,
      identityHash: ready ? input.identityHash : null,
      confirmedIdentityHash: same ? connection.confirmedIdentityHash : null,
      automationEnabled: same ? connection.automationEnabled : false,
      interactionEnabled: same ? connection.interactionEnabled : false,
      checkedAt: new Date(),
      message: wrong
        ? "Facebook không khớp tài khoản đã xác nhận. Chuyển về đúng tài khoản rồi kiểm tra lại."
        : same
          ? "Đã khôi phục phiên Facebook đúng tài khoản đã xác nhận."
          : input.message,
    },
  });
  await saveDeviceSession(tx, updated);
}

export async function armDesktopPost(
  deviceId: string,
  workspaceId: string,
  id: string,
  runId: string,
  targetUrl: string,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const task = assertFound(
      await tx.task.findFirst({
        where: {
          id,
          workspaceId,
          desktopDeviceId: deviceId,
          desktopRunId: runId,
          executionMode: "AUTOMATIC",
        },
        include: { account: true, group: true },
      }),
    );
    const device = await tx.desktopDevice.findUniqueOrThrow({
      where: { id: deviceId },
    });
    const connection = await tx.facebookConnection.findUnique({
      where: { accountId: task.accountId },
    });
    if (
      await tx.interaction.count({
        where: {
          workspaceId,
          desktopDeviceId: deviceId,
          status: "IN_PROGRESS",
          executionMode: "AUTOMATIC",
        },
      })
    )
      throw new AppError(
        409,
        "Máy đang tương tác; không được đăng bài đồng thời.",
      );
    if (targetUrl !== (task.group?.url || task.account.url))
      throw new AppError(
        409,
        "Địa chỉ nơi đăng đã thay đổi. Công việc dừng trước khi gửi.",
      );
    if (
      task.status !== "IN_PROGRESS" ||
      !!task.archivedAt ||
      task.automaticPhase !== "PREPARING" ||
      !task.startedAt ||
      Date.now() >= task.startedAt.getTime() + AUTOMATIC_ATTEMPT_MS ||
      !task.desktopLeaseAt ||
      Date.now() - task.desktopLeaseAt.getTime() >= AUTOMATIC_LEASE_MS ||
      device.paused ||
      device.revokedAt ||
      !online(device.lastSeenAt) ||
      task.account.status !== "ACTIVE" ||
      task.account.archivedAt ||
      task.group?.archivedAt ||
      !connection?.automationEnabled ||
      connection.deviceId !== deviceId ||
      connection.state !== "READY" ||
      !connection.confirmedIdentityHash ||
      connection.identityHash !== connection.confirmedIdentityHash
    )
      throw new AppError(
        409,
        "Công việc hoặc tài khoản đã tạm dừng; không được bấm đăng.",
      );
    if (
      await tx.task.count({
        where: {
          workspaceId,
          accountId: task.accountId,
          executionMode: "AUTOMATIC",
          status: "BLOCKED",
          automaticPhase: "NEEDS_REVIEW",
          archivedAt: null,
        },
      })
    )
      throw new AppError(
        409,
        "Có công việc cần kiểm tra kết quả trước khi gửi bài tiếp theo.",
      );
    const now = new Date();
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(now),
    );
    if (
      isQuietHour(
        hour,
        task.account.quietStart,
        task.account.quietEnd,
        task.account.quietHoursEnabled,
      )
    )
      throw new AppError(409, "Đã đến giờ nghỉ trước khi gửi bài.");
    const bounds = dayBounds(now);
    const count = await tx.task.count({
      where: {
        workspaceId,
        accountId: task.accountId,
        id: { not: id },
        startedAt: { gte: bounds.start, lt: bounds.end },
        status: { notIn: ["CANCELLED", "SKIPPED"] },
      },
    });
    if (count >= task.account.dailyLimit)
      throw new AppError(
        409,
        "Mức công việc/ngày đã thay đổi trước khi gửi bài.",
      );
    if (
      task.account.postIntervalMinutes > 0 &&
      (await tx.task.count({
        where: {
          workspaceId,
          accountId: task.accountId,
          id: { not: id },
          startedAt: {
            gte: new Date(
              now.getTime() - task.account.postIntervalMinutes * 60_000,
            ),
          },
          status: { notIn: ["CANCELLED", "SKIPPED"] },
        },
      }))
    )
      throw new AppError(
        409,
        "Chưa đủ khoảng cách giữa các bài của tài khoản trước khi gửi.",
      );
    await tx.task.update({
      where: { id },
      data: { automaticPhase: "SUBMITTING", desktopLeaseAt: new Date() },
    });
    return { allowed: true };
  });
}
export const postResultSchema = z.object({
  runId: z.uuid(),
  outcome: z.enum([
    "PUBLISHED",
    "PENDING_REVIEW",
    "LOGIN_REQUIRED",
    "CHALLENGE",
    "UNCERTAIN",
    "FAILED",
  ]),
  message: z.string().max(2000),
  resultUrl: z.string().url().max(2048).optional(),
  failure: z
    .object({
      stage: z.string().min(1).max(120),
      submitAttempted: z.boolean(),
      code: z.enum(["TIMEOUT", "NETWORK", "OTHER"]),
    })
    .optional(),
});
export async function finishDesktopPost(
  deviceId: string,
  workspaceId: string,
  id: string,
  input: z.infer<typeof postResultSchema>,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const task = assertFound(
      await tx.task.findFirst({
        where: {
          id,
          workspaceId,
          executionMode: "AUTOMATIC",
        },
      }),
    );
    if (
      task.desktopDeviceId !== deviceId ||
      task.desktopRunId !== input.runId ||
      task.status !== "IN_PROGRESS"
    )
      return { ok: true, stale: true };
    if (
      ["PUBLISHED", "PENDING_REVIEW"].includes(input.outcome) &&
      task.automaticPhase !== "SUBMITTING"
    )
      throw new AppError(409, "Chưa có bước gửi bài được cấp quyền.");
    if (input.outcome === "PENDING_REVIEW" && !task.groupId)
      throw new AppError(
        400,
        "Trang cá nhân không có trạng thái chờ duyệt nhóm.",
      );
    const success =
      input.outcome === "PUBLISHED" || input.outcome === "PENDING_REVIEW";
    const safeFailure =
      input.outcome === "FAILED" &&
      input.failure?.submitAttempted === false &&
      task.automaticPhase === "PREPARING";
    const retryState = safeFailure
      ? automaticFailureState(
          Math.max(1, task.automaticAttempts),
          input.failure!.code !== "OTHER",
        )
      : null;
    const status = retryState
      ? retryState.status
      : success
        ? (input.outcome as "PUBLISHED" | "PENDING_REVIEW")
        : "BLOCKED";
    const resultUrl = input.resultUrl ? new URL(input.resultUrl) : null;
    if (
      resultUrl &&
      (resultUrl.protocol !== "https:" ||
        !["facebook.com", "www.facebook.com"].includes(resultUrl.hostname))
    )
      throw new AppError(400, "Link kết quả phải là Facebook.");
    await tx.task.update({
      where: { id },
      data: {
        status,
        blockReason: success ? null : `AUTO_${input.outcome}`,
        automaticPhase:
          retryState?.automaticPhase ?? (success ? "DONE" : "NEEDS_REVIEW"),
        nextAttemptAt: retryState?.nextAttemptAt ?? null,
        resultSource: "DESKTOP",
        recordedAt: success ? new Date() : null,
        resultUrl: resultUrl?.toString(),
        note: input.message,
        version: { increment: 1 },
      },
    });
    await tx.taskEvent.create({
      data: {
        id: randomUUID(),
        taskId: id,
        requestHash: input.runId,
        fromStatus: "IN_PROGRESS",
        toStatus: status,
        source: "DESKTOP",
        note: input.failure
          ? `Lượt ${task.automaticAttempts}/3 · ${input.failure.stage} [${input.failure.code}] · ${input.message}${retryState?.nextAttemptAt ? ` · Thử lại sớm nhất ${retryState.nextAttemptAt.toISOString()}` : ""}`
          : input.message,
      },
    });
    await tx.facebookConnection.updateMany({
      where: { workspaceId, accountId: task.accountId, deviceId },
      data: {
        ...(["LOGIN_REQUIRED", "CHALLENGE"].includes(input.outcome)
          ? { automationEnabled: false, interactionEnabled: false }
          : {}),
        ...(["LOGIN_REQUIRED", "CHALLENGE"].includes(input.outcome)
          ? { state: input.outcome, confirmedIdentityHash: null }
          : {}),
        message: input.message,
      },
    });
    await tx.notification.updateMany({
      where: { taskId: id, workspaceId },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });
}

export async function desktopAssetAllowed(
  deviceId: string,
  workspaceId: string,
  assetId: string,
) {
  return !!(await db.task.findFirst({
    where: {
      workspaceId,
      desktopDeviceId: deviceId,
      executionMode: "AUTOMATIC",
      status: "IN_PROGRESS",
      assetIds: { has: assetId },
    },
    select: { id: true },
  }));
}

async function recoverStaleTasks(tx: Tx, workspaceId: string, now: Date) {
  const stale = await tx.task.findMany({
    where: {
      workspaceId,
      executionMode: "AUTOMATIC",
      status: "IN_PROGRESS",
      desktopLeaseAt: { lt: new Date(now.getTime() - AUTOMATIC_LEASE_MS) },
    },
  });
  for (const task of stale) {
    const safe = task.automaticPhase === "PREPARING";
    const retryState = safe
      ? automaticFailureState(Math.max(1, task.automaticAttempts), true, now)
      : null;
    const note = safe
      ? "Máy đăng bị gián đoạn trước khi cấp quyền gửi. Chưa gửi bài; áp dụng giới hạn thử lại."
      : "Máy đăng mất kết nối khi đang xử lý. Kiểm tra Facebook trước khi tạo lịch mới.";
    await tx.task.update({
      where: { id: task.id },
      data: {
        status: retryState?.status ?? "BLOCKED",
        blockReason: "AUTO_INTERRUPTED",
        automaticPhase: retryState?.automaticPhase ?? "NEEDS_REVIEW",
        nextAttemptAt: retryState?.nextAttemptAt ?? null,
        automaticAttempts: Math.max(1, task.automaticAttempts),
        version: { increment: 1 },
        note,
      },
    });
    await tx.facebookConnection.updateMany({
      where: { workspaceId, accountId: task.accountId },
      data: {
        message: safe
          ? note
          : "Máy đăng bị gián đoạn. Lựa chọn tự đăng được giữ; kiểm tra công việc đang dở trước khi tiếp tục.",
      },
    });
    await tx.taskEvent.create({
      data: {
        id: randomUUID(),
        taskId: task.id,
        requestHash: "lease-expired",
        fromStatus: "IN_PROGRESS",
        toStatus: retryState?.status ?? "BLOCKED",
        source: "DESKTOP",
        note,
      },
    });
  }
  return stale.length;
}

export async function recoverDesktopWork(now = new Date()) {
  const postWorkspaces = await db.task.findMany({
    where: {
      executionMode: "AUTOMATIC",
      status: "IN_PROGRESS",
      desktopLeaseAt: { lt: new Date(now.getTime() - AUTOMATIC_LEASE_MS) },
    },
    distinct: ["workspaceId"],
    select: { workspaceId: true },
  });
  let recovered = 0;
  const interactionWorkspaces = await db.interaction.findMany({
    where: {
      executionMode: "AUTOMATIC",
      status: "IN_PROGRESS",
      leaseAt: { lt: new Date(now.getTime() - AUTOMATIC_LEASE_MS) },
    },
    distinct: ["workspaceId"],
    select: { workspaceId: true },
  });
  const workspaces = [
    ...new Map(
      [...postWorkspaces, ...interactionWorkspaces].map((w) => [
        w.workspaceId,
        w,
      ]),
    ).values(),
  ];
  for (const { workspaceId } of workspaces)
    recovered += await workspaceTransaction(
      workspaceId,
      async (tx) =>
        (await recoverStaleTasks(tx, workspaceId, now)) +
        (await recoverInteractions(tx, workspaceId, now)),
    );
  return recovered;
}
