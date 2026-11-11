import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { db } from "./db";
import { AppError, assertFound } from "./errors";
import { workspaceTransaction } from "./service";

const MAX_FILE = 10 * 1024 * 1024;
export const mediaDir = () =>
  path.resolve(
    /* turbopackIgnore: true */ process.env.MEDIA_DIR || ".data/media",
  );

async function boundedBody(request: Request) {
  const limit = MAX_FILE + 128 * 1024;
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw new AppError(413, "Mỗi ảnh tối đa 10 MB.");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "Chưa có ảnh được gửi lên.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new AppError(413, "Mỗi ảnh tối đa 10 MB.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function uploadAsset(workspaceId: string, request: Request) {
  const body = await boundedBody(request);
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(body), {
      headers: { "content-type": request.headers.get("content-type") || "" },
    }).formData();
  } catch {
    throw new AppError(400, "Không đọc được file tải lên.");
  }
  const file = form.get("file");
  if (!(file instanceof File) || !file.size || file.size > MAX_FILE)
    throw new AppError(400, "Chọn một ảnh JPG, PNG hoặc WebP, tối đa 10 MB.");
  let output: Buffer;
  let alpha = false;
  try {
    const image = sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: 40_000_000,
      animated: false,
    });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format || ""))
      throw new Error("unsupported");
    alpha = !!metadata.hasAlpha;
    const resized = image.rotate().resize({
      width: 2400,
      height: 2400,
      fit: "inside",
      withoutEnlargement: true,
    });
    output = await (
      alpha
        ? resized.png({ compressionLevel: 8 })
        : resized.jpeg({ quality: 92, mozjpeg: true })
    ).toBuffer();
  } catch {
    throw new AppError(
      400,
      "Ảnh không hợp lệ hoặc quá lớn để xử lý. Hãy dùng JPG, PNG hoặc WebP dưới 40 megapixel.",
    );
  }
  if (output.length > MAX_FILE)
    throw new AppError(
      413,
      "Ảnh sau xử lý vượt 10 MB. Hãy giảm kích thước ảnh.",
    );
  const extension = alpha ? "png" : "jpg";
  const storageKey = `${randomUUID()}.${extension}`;
  const originalName = `${
    file.name
      .split(/[\\/]/)
      .pop()!
      .replace(/\.[^.]*$/, "")
      .replace(/[\x00-\x1f]/g, "")
      .slice(0, 160) || "anh"
  }.${extension}`;
  await mkdir(mediaDir(), { recursive: true });
  const filePath = path.join(
    /* turbopackIgnore: true */ mediaDir(),
    storageKey,
  );
  await writeFile(filePath, output, { flag: "wx" });
  try {
    return await workspaceTransaction(workspaceId, async (tx) => {
      const used = await tx.asset.aggregate({
        where: { workspaceId },
        _sum: { size: true },
        _count: { _all: true },
      });
      if (
        (used._sum.size || 0) + output.length > 500 * 1024 * 1024 ||
        used._count._all >= 1000
      )
        throw new AppError(
          409,
          "Thư viện đã đạt giới hạn 500 MB hoặc 1.000 ảnh. Hãy liên hệ quản trị viên.",
        );
      return tx.asset.create({
        data: {
          workspaceId,
          storageKey,
          originalName,
          size: output.length,
          mime: alpha ? "image/png" : "image/jpeg",
        },
      });
    });
  } catch (e) {
    await unlink(filePath).catch(() => {});
    throw e;
  }
}
export async function assetResponse(
  workspaceId: string,
  id: string,
  download: boolean,
) {
  const asset = assertFound(
    await db.asset.findFirst({ where: { workspaceId, id } }),
  );
  let body: Buffer;
  try {
    body = await readFile(
      /* turbopackIgnore: true */ path.join(
        /* turbopackIgnore: true */ mediaDir(),
        asset.storageKey,
      ),
    );
  } catch {
    throw new AppError(
      404,
      "File ảnh không còn trên ổ lưu trữ. Hãy liên hệ quản trị viên.",
    );
  }
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": asset.mime,
      "Content-Length": String(body.length),
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="image.${asset.mime === "image/png" ? "png" : "jpg"}"; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
    },
  });
}
export async function deleteAsset(workspaceId: string, id: string) {
  const asset = await workspaceTransaction(workspaceId, async (tx) => {
    const asset = assertFound(
      await tx.asset.findFirst({
        where: { workspaceId, id },
        include: { _count: { select: { posts: true } } },
      }),
    );
    const used = await tx.task.count({
      where: { workspaceId, assetIds: { has: id } },
    });
    if (asset._count.posts || used)
      throw new AppError(
        409,
        "Ảnh đang gắn với bài viết hoặc lịch sử đăng, cần được giữ lại.",
      );
    await tx.asset.delete({ where: { id } });
    return asset;
  });
  await unlink(
    path.join(/* turbopackIgnore: true */ mediaDir(), asset.storageKey),
  ).catch(() => {});
  return { ok: true };
}
