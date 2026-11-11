import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { AppError, assertFound } from "./errors";
import { workspaceTransaction, type Tx } from "./service";
import { saveDeviceSession } from "./device-sessions";
import {
  freshState,
  mergeSnapshot,
  pruneState,
  recordStatus,
  type TrialState,
} from "../inbox-trial/state";
import type { DesktopInboxStatus, InboxData } from "./inbox-types";
import { isRecentInboxConversation } from "./inbox-types";
import { queueInboxPush } from "./mobile-push-queue";

const online = (at: Date | null) => !!at && Date.now() - at.getTime() < 45_000;
const scopeFor = (accountId: string, identity: string) =>
  `${accountId}:${identity}`;
const stateJson = (state: TrialState) =>
  state as unknown as Prisma.InputJsonValue;
const unreadCount = (state: TrialState) =>
  state.conversations.filter(
    (row) => row.unread === true && isRecentInboxConversation(row),
  ).length;
const readState = (
  value: Prisma.JsonValue | undefined,
  scope: string,
): TrialState => {
  const state = value as unknown as TrialState | undefined;
  return state?.version === 1 &&
    state.scope === scope &&
    Array.isArray(state.conversations)
    ? pruneState(state)
    : freshState(scope);
};

export const inboxReportSchema = z
  .object({
    instanceId: z.uuid(),
    generation: z.number().int().nonnegative(),
    identityHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    status: z.enum([
      "STARTING",
      "LOGIN_REQUIRED",
      "CHALLENGE",
      "WRONG_IDENTITY",
      "PIN_REQUIRED",
      "UNSUPPORTED",
      "UNSAFE_VIEW",
      "ONLINE",
      "OFFLINE",
      "STOPPED",
    ]),
    conversations: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          name: z.string().min(1).max(200),
          preview: z.string().max(1000).nullable(),
          unread: z.boolean().nullable(),
          lastMessageAt: z.iso.datetime().nullable().optional(),
        }),
      )
      .max(200)
      .default([]),
  })
  .refine(
    (input) =>
      input.status !== "ONLINE" ||
      (input.conversations.length > 0 && !!input.identityHash),
    {
      message: "Thiếu danh tính hoặc danh sách Messenger đã quan sát.",
    },
  );

async function activeDevice(
  tx: Tx,
  deviceId: string,
  workspaceId: string,
  instanceId: string,
) {
  const device = assertFound(
    await tx.desktopDevice.findFirst({
      where: { id: deviceId, workspaceId, revokedAt: null },
    }),
  );
  if (
    !online(device.lastSeenAt) ||
    device.instanceId !== instanceId ||
    !device.supportsInbox
  )
    throw new AppError(409, "Máy đăng cần cập nhật và kết nối lại.");
  return device;
}

async function busyAccounts(tx: Tx, workspaceId: string) {
  const tasks = await tx.task.findMany({
    where: { workspaceId, executionMode: "AUTOMATIC", status: "IN_PROGRESS" },
    select: { accountId: true },
  });
  const interactions = await tx.interaction.findMany({
    where: { workspaceId, executionMode: "AUTOMATIC", status: "IN_PROGRESS" },
    select: { accountId: true },
  });
  const commands = await tx.desktopCommand.findMany({
    where: { workspaceId, state: { in: ["QUEUED", "RUNNING"] } },
    select: { accountId: true },
  });
  return new Set(
    [...tasks, ...interactions, ...commands].map((row) => row.accountId),
  );
}

export async function desktopInboxTargets(
  deviceId: string,
  workspaceId: string,
  instanceId: string,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const device = await activeDevice(tx, deviceId, workspaceId, instanceId);
    if (device.paused) return [];
    const busy = await busyAccounts(tx, workspaceId);
    const connections = await tx.facebookConnection.findMany({
      where: {
        workspaceId,
        deviceId,
        state: "READY",
        inboxPaused: false,
        account: { archivedAt: null, status: "ACTIVE" },
      },
      include: { account: { include: { inboxSnapshot: true } } },
    });
    return connections
      .filter(
        (c) =>
          c.confirmedIdentityHash && c.identityHash === c.confirmedIdentityHash,
      )
      .map((c) => ({
        accountId: c.accountId,
        generation: c.generation,
        identityHash: c.confirmedIdentityHash!,
        previouslyUnread: readState(
          c.account.inboxSnapshot?.state,
          scopeFor(c.accountId, c.confirmedIdentityHash!),
        )
          .conversations.filter(
            (row) => row.unread === true && isRecentInboxConversation(row),
          )
          .map((row) => row.id),
        busy: busy.has(c.accountId),
      }));
  });
}

export async function reportDesktopInbox(
  deviceId: string,
  workspaceId: string,
  accountId: string,
  input: z.infer<typeof inboxReportSchema>,
) {
  return workspaceTransaction(workspaceId, async (tx) => {
    const device = await activeDevice(
      tx,
      deviceId,
      workspaceId,
      input.instanceId,
    );
    if (device.paused) return { ok: true, stale: true };
    const connection = await tx.facebookConnection.findFirst({
      where: {
        workspaceId,
        accountId,
        deviceId,
        generation: input.generation,
        inboxPaused: false,
        account: { archivedAt: null, status: "ACTIVE" },
      },
    });
    if (
      !connection ||
      connection.state !== "READY" ||
      !connection.confirmedIdentityHash
    )
      return { ok: true, stale: true };
    if ((await busyAccounts(tx, workspaceId)).has(accountId))
      return { ok: true, stale: true };
    if (
      input.status === "ONLINE" &&
      input.identityHash !== connection.confirmedIdentityHash
    )
      throw new AppError(
        409,
        "Danh tính Facebook không khớp phiên đã xác nhận.",
      );
    const scope = scopeFor(accountId, connection.confirmedIdentityHash);
    const previous = await tx.facebookInboxSnapshot.findUnique({
      where: { accountId },
    });
    let state = readState(previous?.state, scope);
    const previousUnread =
      state.unreadWindowCount ??
      state.conversations.filter((row) => row.unread === true).length;
    state =
      input.status === "ONLINE"
        ? mergeSnapshot(state, input.conversations)
        : recordStatus(state, input.status, "");
    state.conversations = state.conversations
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
      .slice(0, 1000);
    const recentIds = new Set(
      state.conversations
        .filter((row) => isRecentInboxConversation(row))
        .map((row) => row.id),
    );
    const hasNew = state.events.some(
      (event) =>
        recentIds.has(event.conversationId) &&
        (event.kind === "UNREAD_FOUND" || event.kind === "PREVIEW_CHANGED"),
    );
    const unread = unreadCount(state);
    state.unreadWindowCount = unread;
    if (input.status === "ONLINE" && (hasNew || unread !== previousUnread))
      await queueInboxPush(tx, workspaceId, hasNew || unread > previousUnread);
    state.events = [];
    state.fingerprints = [];
    await tx.facebookInboxSnapshot.upsert({
      where: { accountId },
      create: {
        accountId,
        deviceId,
        generation: input.generation,
        identityHash: connection.confirmedIdentityHash,
        state: stateJson(state),
      },
      update: {
        deviceId,
        generation: input.generation,
        identityHash: connection.confirmedIdentityHash,
        state: stateJson(state),
      },
    });
    if (
      ["LOGIN_REQUIRED", "CHALLENGE", "WRONG_IDENTITY"].includes(input.status)
    ) {
      const updated = await tx.facebookConnection.update({
        where: { accountId },
        data: {
          state: input.status,
          automationEnabled: false,
          interactionEnabled: false,
          identityHash: null,
          confirmedIdentityHash: null,
        },
      });
      await saveDeviceSession(tx, updated);
    }
    return { ok: true };
  });
}

export async function inboxForWorkspace(
  workspaceId: string,
  accountId?: string | null,
): Promise<InboxData> {
  return workspaceTransaction(workspaceId, async (tx) => {
    const accounts = await tx.facebookAccount.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      include: {
        connection: { include: { device: true } },
        inboxSnapshot: true,
      },
    });
    if (accountId && !accounts.some((a) => a.id === accountId))
      throw new AppError(404, "Không có tài khoản trong không gian này.");
    const busy = await busyAccounts(tx, workspaceId);
    const results: InboxData[] = accounts.map((account) => {
      const c = account.connection;
      const device = c?.device;
      const identity = c?.expectedIdentityHash || c?.confirmedIdentityHash;
      const snapshot = account.inboxSnapshot;
      const state =
        snapshot && identity && snapshot.identityHash === identity
          ? readState(snapshot.state, scopeFor(account.id, identity))
          : null;
      const current =
        !!c &&
        snapshot?.deviceId === c.deviceId &&
        snapshot?.generation === c.generation;
      let status: DesktopInboxStatus = "NOT_CONFIGURED";
      if (c && device) {
        if (
          device.revokedAt ||
          device.paused ||
          c.inboxPaused ||
          account.status !== "ACTIVE" ||
          c.state === "DISCONNECTED"
        )
          status = "STOPPED";
        else if (!online(device.lastSeenAt)) status = "OFFLINE";
        else if (!device.supportsInbox) status = "UPDATE_REQUIRED";
        else if (c.state === "CHECKING") status = "STARTING";
        else if (
          ["LOGIN_REQUIRED", "CHALLENGE", "WRONG_IDENTITY"].includes(c.state)
        )
          status = c.state as DesktopInboxStatus;
        else if (
          c.state !== "READY" ||
          !c.confirmedIdentityHash ||
          c.identityHash !== c.confirmedIdentityHash
        )
          status = "UNCONFIRMED";
        else if (busy.has(account.id)) status = "BUSY";
        else status = current && state ? state.status : "STARTING";
      }
      const age = state?.lastSuccessAt
        ? Date.now() - Date.parse(state.lastSuccessAt)
        : Infinity;
      const fresh = status === "ONLINE" && current && age >= 0 && age < 90_000;
      if (status === "ONLINE" && !fresh) status = "OFFLINE";
      return {
        configured: !!c,
        account: { id: account.id, name: account.name, color: account.color },
        source: device
          ? {
              id: device.id,
              name: device.name,
              online: !device.revokedAt && online(device.lastSeenAt),
            }
          : null,
        status,
        checkedAt: current ? (state?.checkedAt ?? null) : null,
        lastSuccessAt: state?.lastSuccessAt ?? null,
        fresh,
        partial: true,
        conversations: (state?.conversations ?? []).filter((row) =>
          isRecentInboxConversation(row),
        ),
      };
    });
    const selected =
      results.find((r) => r.account?.id === accountId) ||
      results.find((r) => r.configured) ||
      results[0];
    return {
      ...(selected || {
        configured: false,
        account: null,
        source: null,
        status: "NOT_CONFIGURED",
        checkedAt: null,
        lastSuccessAt: null,
        fresh: false,
        partial: true,
        conversations: [],
      }),
      accounts: results.map((r) => ({
        ...r.account!,
        status: r.status,
        fresh: r.fresh,
        unreadCount: r.fresh
          ? r.conversations.filter((c) => c.unread === true).length
          : 0,
        lastKnownUnreadCount: r.conversations.filter((c) => c.unread === true)
          .length,
        lastSuccessAt: r.lastSuccessAt,
      })),
    };
  });
}

export async function pruneInboxSnapshots() {
  const snapshots = await db.facebookInboxSnapshot.findMany({
    select: { accountId: true, account: { select: { workspaceId: true } } },
  });
  for (const snapshot of snapshots) {
    await workspaceTransaction(snapshot.account.workspaceId, async (tx) => {
      const current = await tx.facebookInboxSnapshot.findUnique({
        where: { accountId: snapshot.accountId },
      });
      if (!current) return;
      const previous = current.state as unknown as TrialState;
      const before =
        previous.unreadWindowCount ??
        previous.conversations.filter((row) => row.unread === true).length;
      const state = pruneState(previous);
      state.unreadWindowCount = unreadCount(state);
      await tx.facebookInboxSnapshot.update({
        where: { accountId: snapshot.accountId },
        data: { state: stateJson(state) },
      });
      if (before !== state.unreadWindowCount)
        await queueInboxPush(tx, snapshot.account.workspaceId, false);
    });
  }
}
