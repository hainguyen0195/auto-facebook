import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAuth } from "../src/lib/auth";
import { db } from "../src/lib/db";

const args = process.argv.slice(2);
function arg(key: string) {
  const i = args.indexOf(`--${key}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  const email = arg("email") || (await rl.question("Email: "));
  const name = arg("name") || (await rl.question("Name: "));
  const password =
    process.env.NEW_USER_PASSWORD || randomBytes(18).toString("base64url");
  if (!email || !name || password.length < 12)
    throw new Error(
      "Email, name and a password of at least 12 characters are required.",
    );
  const result = await createAuth(true).api.signUpEmail({
    body: { email, name, password },
  });
  if (!result.user?.id) throw new Error("Could not create user.");
  if (args.includes("--save-local")) {
    if (process.env.NODE_ENV === "production")
      throw new Error("--save-local is only available for local development.");
    const destination = path.resolve(".data/local-access.txt");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(
      destination,
      `Nhịp Đăng - local access\nURL: ${process.env.BETTER_AUTH_URL}\nEmail: ${email}\nPassword: ${password}\n\nKeep this file private.\n`,
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      "User created. Credentials are in .data/local-access.txt (gitignored).",
    );
  } else {
    console.log(`User created: ${email}`);
    if (!process.env.NEW_USER_PASSWORD)
      console.log(`Generated password (keep private): ${password}`);
  }
} finally {
  rl.close();
  await db.$disconnect();
}
