import { mkdir, writeFile } from "node:fs/promises";
import { testDatabaseUrl } from "../database";

export const browserPassword = "E2E-only-Password-2026!";
export default async function setup() {
  process.env.DATABASE_URL = testDatabaseUrl("e2e");
  process.env.BETTER_AUTH_URL = "http://localhost:3100";
  const { db } = await import("../../src/lib/db");
  const { createAuth } = await import("../../src/lib/auth");
  await mkdir(".data/e2e", { recursive: true });
  try {
    for (const user of ["owner", "other"]) {
      const email = `e2e-${user}@tests.nhipdang.local`;
      const existing = await db.user.findUnique({
        where: { email },
        include: { workspace: true },
      });
      if (existing?.workspace) {
        await db.task.deleteMany({
          where: { workspaceId: existing.workspace.id },
        });
        await db.postAsset.deleteMany({
          where: { post: { workspaceId: existing.workspace.id } },
        });
      }
      if (existing) await db.user.delete({ where: { id: existing.id } });
      const auth = createAuth(true);
      await auth.api.signUpEmail({
        body: {
          email,
          name: user === "owner" ? "Minh" : "Người dùng khác",
          password: browserPassword,
        },
      });
      const response = await auth.api.signInEmail({
        body: { email, password: browserPassword },
        asResponse: true,
      });
      const cookies = response.headers
        .getSetCookie()
        .filter((raw) => !raw.startsWith("__Secure-"))
        .map((raw) => {
          const first = raw.split(";")[0];
          const i = first.indexOf("=");
          return {
            name: first.slice(0, i),
            value: first.slice(i + 1),
            domain: "localhost",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          };
        });
      await writeFile(
        `.data/e2e/${user}.json`,
        JSON.stringify({ cookies, origins: [] }),
      );
    }
  } finally {
    await db.$disconnect();
  }
}
