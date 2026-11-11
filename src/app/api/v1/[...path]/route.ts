import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { readJson, verifyOrigin, workspaceFor } from "@/lib/security";
import {
  accountSchema,
  groupSchema,
  postSchema,
  scheduleSchema,
  taskActionSchema,
  statusSchema,
  idSchema,
} from "@/lib/schemas";
import * as service from "@/lib/service";
import * as desktop from "@/lib/desktop";
import { connectLocalFacebook } from "@/lib/local-desktop";
import * as interactions from "@/lib/interactions";
import * as autoInteractions from "@/lib/auto-interactions";
import * as postLinks from "@/lib/post-links";
import { inboxForWorkspace } from "@/lib/inbox";
import * as mobilePush from "@/lib/mobile-push";
import { macosRelease, macInstallerArchive } from "@/lib/macos-installer";
import {
  desktopRelease,
  renderWindowsInstaller,
} from "@/lib/windows-installer";
import {
  updateInteractionSettings,
  interactionSettingsSchema,
} from "@/lib/interaction-work";
import { assetResponse, deleteAsset, uploadAsset } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
const importSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
  accountIds: z.array(idSchema).max(100).default([]),
});
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });

async function handler(request: NextRequest, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const { path } = await context.params;
    const [resource, id, action] = path;
    if (
      request.method === "GET" &&
      resource === "health" &&
      path.length === 1
    ) {
      await db.$queryRaw`SELECT 1`;
      return json({ status: "ok", version: "1.0.0" });
    }
    verifyOrigin(request);
    const { workspace, user, session } = await workspaceFor(request);
    const wid = workspace.id;
    const method = request.method;
    const params = request.nextUrl.searchParams;
    if (
      path.length === 4 &&
      resource === "desktop" &&
      id === "connections" &&
      path[3] === "switch" &&
      method === "POST"
    ) {
      const { deviceId } = z
        .object({ deviceId: idSchema })
        .parse(await readJson(request));
      return json(
        await desktop.switchDesktop(wid, idSchema.parse(action), deviceId),
      );
    }
    if (path.length > 3) throw new AppError(404, "Không tìm thấy đường dẫn.");
    if (resource === "push" && path.length === 2) {
      if (method === "GET" && id === "config") {
        const { configured, publicKey } = mobilePush.pushConfig();
        return json({ configured, publicKey });
      }
      if (method === "POST") {
        const body = await readJson(request);
        if (id === "subscribe")
          return json(
            await mobilePush.subscribeMobilePush(
              wid,
              session.id,
              mobilePush.pushSubscriptionSchema.parse(body),
            ),
          );
        const { endpoint } = z
          .object({ endpoint: mobilePush.pushEndpointSchema })
          .parse(body);
        if (id === "status")
          return json(
            await mobilePush.mobilePushStatus(wid, session.id, endpoint),
          );
        if (id === "unsubscribe")
          return json(await mobilePush.unsubscribeMobilePush(wid, endpoint));
        if (id === "test")
          return json(
            await mobilePush.testMobilePush(wid, session.id, endpoint),
          );
      }
    }
    if (method === "GET") {
      if (resource === "auto-interactions" && !id)
        return json(await autoInteractions.autoInteractionStatus(wid));
      if (resource === "inbox" && !id) {
        const inbox = await inboxForWorkspace(wid, params.get("accountId"));
        return json(
          params.get("view") === "summary"
            ? { ...inbox, conversations: [] }
            : inbox,
        );
      }
      if (resource === "published-posts" && !id)
        return json(await postLinks.publishedPosts(wid, params));
      if (resource === "desktop" && !id)
        return json(await desktop.desktopStatus(wid));
      if (resource === "interactions" && !id)
        return json(await interactions.listInteractions(wid, params));
      if (resource === "bootstrap" && !id)
        return json({
          workspace,
          user: { id: user.id, name: user.name, email: user.email },
        });
      if (resource === "dashboard" && !id)
        return json(await service.dashboard(wid));
      if (resource === "calendar" && !id) {
        if (params.get("status") && params.get("status") !== "ALL")
          statusSchema.parse(params.get("status"));
        return json(await service.calendarOverview(wid, params));
      }
      if (resource === "accounts" && !id)
        return json(await service.listAccounts(wid));
      if (resource === "groups" && !id)
        return json(await service.listGroups(wid, params));
      if (resource === "posts" && !id)
        return json(await service.listPosts(wid, params));
      if (resource === "posts" && id && action === "schedules") {
        if (params.get("status")) statusSchema.parse(params.get("status"));
        return json(await service.listPostSchedules(wid, id, params));
      }
      if (resource === "tasks") {
        if (id === "export" && !action) {
          if (params.get("status") && params.get("status") !== "ALL")
            statusSchema.parse(params.get("status"));
          return await service.exportTasks(wid, params);
        }
        if (id && !action) return json(await service.getTask(wid, id));
        if (!id) {
          if (params.get("status") && params.get("status") !== "ALL")
            statusSchema.parse(params.get("status"));
          return json(await service.listTasks(wid, params));
        }
      }
      if (resource === "assets" && id && (!action || action === "download"))
        return await assetResponse(wid, id, action === "download");
    }
    if (method === "POST") {
      if (resource === "assets" && !id)
        return json(await uploadAsset(wid, request), 201);
      const body = await readJson(request);
      if (resource === "desktop") {
        if (id === "installer" && action === "macos") {
          const release = await macosRelease();
          const pairing = await desktop.createPairing(wid, true);
          return json({
            filename: "Cai-Nhip-Dang-Mac.zip",
            encoding: "base64",
            content: Buffer.from(
              await macInstallerArchive({
                ...pairing,
                workspaceId: wid,
                release,
              }),
            ).toString("base64"),
            expiresAt: pairing.expiresAt,
          });
        }
        if (id === "installer" && action === "windows") {
          const release = await desktopRelease();
          const pairing = await desktop.createPairing(wid, true);
          return json({
            filename: "Cai-Nhip-Dang.cmd",
            content: renderWindowsInstaller({
              ...pairing,
              ...release,
              workspaceId: wid,
            }),
            expiresAt: pairing.expiresAt,
          });
        }
        if (id === "connect" && !action) {
          const { accountId } = z.object({ accountId: idSchema }).parse(body);
          return json(await connectLocalFacebook(wid, accountId));
        }
        if (id === "pairing" && !action)
          return json(await desktop.createPairing(wid));
        if (id === "commands" && !action) {
          const data = z
            .object({
              accountId: idSchema,
              deviceId: idSchema,
              kind: z.enum(["LOGIN", "OPEN", "CHECK", "CLOSE"]),
            })
            .parse(body);
          return json(
            await desktop.queueDesktopCommand(
              wid,
              data.accountId,
              data.deviceId,
              data.kind,
            ),
          );
        }
      }
      if (resource === "interactions" && id === "delete-yesterday" && !action) {
        const { date } = interactions.archiveYesterdaySchema.parse(body);
        return json(await interactions.archiveYesterdayInteractions(wid, date));
      }
      if (resource === "interactions" && !id)
        return json(
          await interactions.createInteraction(
            wid,
            interactions.interactionSchema.parse(body),
          ),
          201,
        );
      if (resource === "interactions" && id && action === "open") {
        const item = await db.interaction.findFirst({
          where: {
            workspaceId: wid,
            id,
            archivedAt: null,
            OR: [
              {
                status: "APPROVED",
                executionMode: "MANUAL",
                scheduledAt: { lte: new Date() },
              },
              { status: "NEEDS_REVIEW", executionMode: "AUTOMATIC" },
            ],
            account: { status: "ACTIVE", archivedAt: null },
          },
        });
        if (!item)
          throw new AppError(
            409,
            "Duyệt công việc đến hạn và kiểm tra trạng thái tài khoản trước khi mở.",
          );
        const connection = await db.facebookConnection.findFirst({
          where: {
            workspaceId: wid,
            accountId: item.accountId,
            state: "READY",
          },
        });
        if (!connection)
          throw new AppError(
            409,
            "Đăng nhập và xác nhận đúng Facebook tại mục Máy đăng trước.",
          );
        return json(
          await desktop.queueDesktopCommand(
            wid,
            item.accountId,
            connection.deviceId,
            "OPEN_POST",
            item.postUrl,
          ),
        );
      }
      if (
        resource === "tasks" &&
        ["bulk-cancel", "bulk-archive"].includes(id)
      ) {
        const data = z
          .object({
            tasks: z
              .array(
                z.object({
                  id: idSchema,
                  version: z.number().int().positive(),
                }),
              )
              .min(1)
              .max(100),
            operationId: z.uuid(),
          })
          .parse(body);
        return json(
          await (id === "bulk-archive"
            ? service.archiveTasks(wid, data.tasks, data.operationId)
            : service.cancelTasks(wid, data.tasks, data.operationId)),
        );
      }
      if (resource === "accounts" && !id)
        return json(
          await service.saveAccount(wid, accountSchema.parse(body)),
          201,
        );
      if (resource === "groups") {
        if (id === "import-preview" || id === "import") {
          const data = importSchema.parse(body);
          return json(
            id === "import-preview"
              ? await service.previewImport(wid, data.rows)
              : await service.importGroups(wid, data.rows, data.accountIds),
          );
        }
        if (!id)
          return json(
            await service.saveGroup(wid, groupSchema.parse(body)),
            201,
          );
      }
      if (resource === "posts" && !id)
        return json(await service.savePost(wid, postSchema.parse(body)), 201);
      if (resource === "schedules" && (!id || id === "preview")) {
        const data = scheduleSchema.parse(body);
        return json(
          id === "preview"
            ? await service.previewSchedule(wid, data)
            : await service.createSchedule(wid, data),
          id ? 200 : 201,
        );
      }
      if (resource === "notifications" && id === "read") {
        await db.notification.updateMany({
          where: { workspaceId: wid, readAt: null },
          data: { readAt: new Date() },
        });
        return json({ ok: true });
      }
    }
    if (method === "PATCH" && resource === "tasks" && id && action === "link") {
      return json(
        await postLinks.savePostLink(
          wid,
          id,
          postLinks.postLinkSchema.parse(await readJson(request)),
        ),
      );
    }
    if (
      method === "PATCH" &&
      resource === "accounts" &&
      id &&
      action === "quiet-hours"
    ) {
      const { enabled } = z
        .object({ enabled: z.boolean() })
        .parse(await readJson(request));
      return json(await service.setAccountQuietHours(wid, id, enabled));
    }
    if (method === "PATCH" && resource === "auto-interactions" && !id)
      return json(
        await autoInteractions.saveAutoInteractions(
          wid,
          autoInteractions.autoInteractionSchema.parse(await readJson(request)),
        ),
      );
    if (method === "PATCH" && id && !action) {
      const body = await readJson(request);
      if (resource === "interactions")
        return json(
          await interactions.interactionAction(
            wid,
            id,
            interactions.interactionActionSchema.parse(body),
          ),
        );
      if (resource === "accounts")
        return json(
          await service.saveAccount(wid, accountSchema.parse(body), id),
        );
      if (resource === "groups")
        return json(await service.saveGroup(wid, groupSchema.parse(body), id));
      if (resource === "posts")
        return json(await service.savePost(wid, postSchema.parse(body), id));
      if (resource === "tasks")
        return json(
          await service.taskAction(wid, id, taskActionSchema.parse(body)),
        );
    }
    if (method === "PATCH" && resource === "desktop" && id && action) {
      const body = await readJson(request);
      if (id === "devices")
        return json(
          await desktop.updateDevice(
            wid,
            action,
            z
              .object({ action: z.enum(["pause", "resume", "revoke"]) })
              .parse(body).action,
          ),
        );
      if (id === "connections")
        return json(
          await desktop.updateConnection(
            wid,
            action,
            z
              .object({ action: z.enum(["confirm", "enable", "disable"]) })
              .parse(body).action,
          ),
        );
      if (id === "interaction-settings")
        return json(
          await updateInteractionSettings(
            wid,
            action,
            interactionSettingsSchema.parse(body),
          ),
        );
    }
    if (method === "DELETE" && id && !action) {
      if (resource === "interactions")
        return json(await interactions.archiveInteraction(wid, id));
      if (resource === "accounts")
        return json(await service.archiveAccount(wid, id));
      if (resource === "groups")
        return json(await service.archiveGroup(wid, id));
      if (resource === "posts") return json(await service.archivePost(wid, id));
      if (resource === "assets") return json(await deleteAsset(wid, id));
    }
    throw new AppError(404, "Không tìm thấy đường dẫn.");
  } catch (error) {
    if (error instanceof AppError)
      return json(
        { error: error.message, details: error.details, requestId },
        error.status,
      );
    if (error instanceof ZodError)
      return json(
        {
          error: error.issues[0]?.message || "Dữ liệu không hợp lệ.",
          issues: error.issues,
          requestId,
        },
        400,
      );
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return json(
        { error: "Dữ liệu bị trùng. Hãy kiểm tra lại danh sách.", requestId },
        409,
      );
    console.error(
      JSON.stringify({
        event: "api.error",
        requestId,
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return json(
      {
        error:
          "Không thể xử lý yêu cầu. Dữ liệu đang nhập vẫn được giữ; hãy thử lại.",
        requestId,
      },
      500,
    );
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
