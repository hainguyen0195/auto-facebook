import type { NextRequest } from "next/server";
import { auth } from "./auth";
import { db } from "./db";
import { AppError } from "./errors";

export async function workspaceFor(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    throw new AppError(
      401,
      "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
    );
  const workspace = await db.workspace.upsert({
    where: { ownerId: session.user.id },
    update: {},
    create: {
      ownerId: session.user.id,
      name: `Góc bán hàng của ${session.user.name}`,
    },
  });
  return { workspace, user: session.user, session: session.session };
}
export function verifyOrigin(request: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const expected = new URL(
    process.env.BETTER_AUTH_URL || "http://localhost:3000",
  ).origin;
  if (request.headers.get("origin") !== expected)
    throw new AppError(
      403,
      "Nguồn yêu cầu không hợp lệ. Hãy tải lại ứng dụng.",
    );
}
export async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError(415, "Yêu cầu cần dữ liệu JSON.");
  if (Number(request.headers.get("content-length") || 0) > 1024 * 1024)
    throw new AppError(413, "Dữ liệu quá lớn.");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "Thiếu dữ liệu.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024 * 1024) {
      await reader.cancel();
      throw new AppError(413, "Dữ liệu quá lớn.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "Dữ liệu JSON không hợp lệ.");
  }
}
