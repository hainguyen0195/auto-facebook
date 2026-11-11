import "dotenv/config";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "./db";
import { loginEmailPlugin } from "./login-email";

export function createAuth(allowSignUp = false) {
  return betterAuth({
    appName: "Nhịp Đăng",
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    secret: process.env.BETTER_AUTH_SECRET,
    database: prismaAdapter(db, { provider: "postgresql" }),
    plugins: [loginEmailPlugin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowSignUp,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    trustedOrigins: [process.env.BETTER_AUTH_URL || "http://localhost:3000"],
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/change-login-email": { window: 60, max: 5 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await db.workspace.upsert({
              where: { ownerId: user.id },
              update: {},
              create: {
                ownerId: user.id,
                name: `Góc bán hàng của ${user.name}`,
              },
            });
          },
        },
      },
    },
  });
}
export const auth = createAuth();
