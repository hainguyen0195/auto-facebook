import { NextResponse, type NextRequest } from "next/server";
import { ZodError, z } from "zod";
import * as desktop from "@/lib/desktop";
import { readJson } from "@/lib/security";
import { AppError } from "@/lib/errors";
import { assetResponse } from "@/lib/media";
import * as interactionWork from "@/lib/interaction-work";
import { desktopPostLinkSchema, saveDesktopPostLink } from "@/lib/post-links";
import {
  desktopInboxTargets,
  inboxReportSchema,
  reportDesktopInbox,
} from "@/lib/inbox";

export const runtime = "nodejs";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function handler(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await context.params;
    if (request.method === "POST" && path.join("/") === "pair") {
      const input = z
        .object({
          code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          name: z.string().trim().min(1).max(100),
        })
        .parse(await readJson(request));
      return json(await desktop.pairDesktop(input.code, input.name));
    }
    const device = await desktop.desktopFor(request);
    if (request.method === "GET" && path.join("/") === "status")
      return json({ id: device.id, workspaceId: device.workspaceId });
    if (request.method === "GET" && path[0] === "assets" && path.length === 2) {
      if (
        !(await desktop.desktopAssetAllowed(
          device.id,
          device.workspaceId,
          path[1],
        ))
      )
        throw new AppError(404, "Không có ảnh cho công việc đang xử lý.");
      return await assetResponse(device.workspaceId, path[1], true);
    }
    if (request.method !== "POST")
      throw new AppError(404, "Không có đường dẫn.");
    const body = await readJson(request);
    if (path.join("/") === "inbox/targets") {
      const { instanceId } = z.object({ instanceId: z.uuid() }).parse(body);
      return json(
        await desktopInboxTargets(device.id, device.workspaceId, instanceId),
      );
    }
    if (path[0] === "inbox" && path.length === 2)
      return json(
        await reportDesktopInbox(
          device.id,
          device.workspaceId,
          path[1],
          inboxReportSchema.parse(body),
        ),
      );
    if (path[0] === "sessions" && path.length === 2)
      return json(
        await desktop.reportDesktopSession(
          device.id,
          device.workspaceId,
          path[1],
          desktop.sessionResultSchema.parse(body),
        ),
      );
    if (path.join("/") === "heartbeat" || path.join("/") === "claim") {
      const { instanceId, supportsInteractions, supportsInbox } = z
        .object({
          instanceId: z.uuid(),
          supportsInteractions: z.boolean().default(false),
          supportsInbox: z.boolean().default(false),
        })
        .parse(body);
      return json(
        path[0] === "heartbeat"
          ? await desktop.heartbeat(
              device.id,
              device.workspaceId,
              instanceId,
              supportsInbox,
            )
          : await desktop.claimDesktopWork(
              device.id,
              device.workspaceId,
              instanceId,
              supportsInteractions,
            ),
      );
    }
    if (path[0] === "commands" && path.length === 2)
      return json(
        await desktop.finishDesktopCommand(
          device.id,
          device.workspaceId,
          path[1],
          desktop.commandResultSchema.parse(body),
        ),
      );
    if (path[0] === "tasks" && path.length === 3) {
      if (path[2] === "link") {
        const data = desktopPostLinkSchema.parse(body);
        return json(
          await saveDesktopPostLink(
            device.id,
            device.workspaceId,
            path[1],
            data,
          ),
        );
      }
      if (path[2] === "arm") {
        const data = z
          .object({ runId: z.uuid(), targetUrl: z.string().url().max(2048) })
          .parse(body);
        return json(
          await desktop.armDesktopPost(
            device.id,
            device.workspaceId,
            path[1],
            data.runId,
            data.targetUrl,
          ),
        );
      }
      if (path[2] === "result")
        return json(
          await desktop.finishDesktopPost(
            device.id,
            device.workspaceId,
            path[1],
            desktop.postResultSchema.parse(body),
          ),
        );
    }
    if (path[0] === "interactions" && path.length === 3) {
      if (path[2] === "arm") {
        const data = z
          .object({ runId: z.uuid(), targetUrl: z.string().url().max(2048) })
          .parse(body);
        return json(
          await interactionWork.armInteraction(
            device.id,
            device.workspaceId,
            path[1],
            data.runId,
            data.targetUrl,
          ),
        );
      }
      if (path[2] === "result")
        return json(
          await interactionWork.finishInteraction(
            device.id,
            device.workspaceId,
            path[1],
            interactionWork.interactionResultSchema.parse(body),
          ),
        );
    }
    throw new AppError(404, "Không có đường dẫn.");
  } catch (error) {
    if (error instanceof AppError)
      return json({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return json({ error: error.issues[0]?.message }, 400);
    console.error(
      JSON.stringify({
        event: "desktop.api.error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return json({ error: "Máy đăng chưa thể xử lý yêu cầu." }, 500);
  }
}
export { handler as GET, handler as POST };
