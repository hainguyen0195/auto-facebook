import { Prisma } from "@prisma/client";
import {
  APIError,
  createAuthEndpoint,
  sensitiveSessionMiddleware,
} from "better-auth/api";
import { verifyPassword } from "better-auth/crypto";
import { z } from "zod";
import { db } from "./db";

export const loginEmailPlugin = {
  id: "login-email",
  endpoints: {
    changeLoginEmail: createAuthEndpoint(
      "/change-login-email",
      {
        method: "POST",
        use: [sensitiveSessionMiddleware],
        body: z.object({
          newEmail: z.string().trim().toLowerCase().max(254).pipe(z.email()),
          currentPassword: z.string().min(1).max(128),
        }),
      },
      async (ctx) => {
        const expectedOrigin = new URL(
          process.env.BETTER_AUTH_URL || "http://localhost:3000",
        ).origin;
        if (ctx.headers?.get("origin") !== expectedOrigin)
          throw new APIError("FORBIDDEN", {
            message: "Nguồn yêu cầu không hợp lệ. Hãy tải lại ứng dụng.",
          });
        const userId = ctx.context.session.user.id;
        try {
          await db.$transaction(async (tx) => {
            // Serialize email changes and revoke every old web session together.
            await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;
            const session = await tx.session.findUnique({
              where: { id: ctx.context.session.session.id },
            });
            if (!session || session.expiresAt <= new Date())
              throw new APIError("UNAUTHORIZED", {
                message: "Vui lòng đăng nhập lại.",
              });
            const credential = await tx.account.findFirst({
              where: { userId, providerId: "credential" },
            });
            if (
              !credential?.password ||
              !(await verifyPassword({
                hash: credential.password,
                password: ctx.body.currentPassword,
              }))
            )
              throw new APIError("BAD_REQUEST", {
                message: "Mật khẩu hiện tại chưa đúng.",
              });
            const user = await tx.user.findUniqueOrThrow({
              where: { id: userId },
            });
            if (user.email.toLowerCase() === ctx.body.newEmail)
              throw new APIError("BAD_REQUEST", {
                message: "Hãy nhập email khác email hiện tại.",
              });
            await tx.user.update({
              where: { id: userId },
              data: { email: ctx.body.newEmail, emailVerified: false },
            });
            await tx.session.deleteMany({ where: { userId } });
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          )
            throw new APIError("CONFLICT", {
              message: "Không thể dùng email này. Hãy chọn email khác.",
            });
          throw error;
        }
        return ctx.json({ status: true });
      },
    ),
  },
};
