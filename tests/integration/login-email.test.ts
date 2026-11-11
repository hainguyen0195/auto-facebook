import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createAuth } from "../../src/lib/auth";
import { db } from "../../src/lib/db";

const auth = createAuth(true);
const run = randomUUID();
const email = `email-owner-${run}@tests.nhipdang.local`;
const otherEmail = `email-other-${run}@tests.nhipdang.local`;
const newEmail = `email-new-${run}@tests.nhipdang.local`;
const password = "Email-test-password-2026!";
const origin = "http://localhost:3000";
let ownerId = "";
let otherId = "";
let workspaceId = "";
let cookie = "";
let secondCookie = "";
let requestNumber = 0;

async function login(address: string) {
  return auth.api.signInEmail({
    body: { email: address, password },
    asResponse: true,
  });
}
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((raw) => raw.split(";")[0])
    .join("; ");
}
function change(body: unknown, session = cookie, requestOrigin = origin) {
  return auth.handler(
    new Request(`${origin}/api/auth/change-login-email`, {
      method: "POST",
      headers: {
        cookie: session,
        origin: requestOrigin,
        "content-type": "application/json",
        "x-forwarded-for": `192.0.2.${++requestNumber}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  ownerId = (
    await auth.api.signUpEmail({
      body: { email, name: "Email owner", password },
    })
  ).user.id;
  otherId = (
    await auth.api.signUpEmail({
      body: { email: otherEmail, name: "Other", password },
    })
  ).user.id;
  workspaceId = (await db.workspace.findUniqueOrThrow({ where: { ownerId } }))
    .id;
  cookie = cookies(await login(email));
  secondCookie = cookies(await login(email));
});
afterAll(async () => {
  await db.user.deleteMany({
    where: { id: { in: [ownerId, otherId].filter(Boolean) } },
  });
  await db.$disconnect();
});

it("rejects anonymous and cross-origin email changes", async () => {
  expect(
    (await change({ newEmail, currentPassword: password }, "")).status,
  ).toBe(401);
  expect(
    (
      await change(
        { newEmail, currentPassword: password },
        cookie,
        "https://other.invalid",
      )
    ).status,
  ).toBe(403);
  expect(
    (await change({ newEmail, currentPassword: password }, cookie, "")).status,
  ).toBe(403);
});

it("rejects an incorrect password without changing email or revoking sessions", async () => {
  const sessionCount = await db.session.count({ where: { userId: ownerId } });
  const response = await change({
    newEmail,
    currentPassword: "Wrong-password-2026!",
  });
  expect(response.status).toBe(400);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: ownerId } })).email,
  ).toBe(email);
  expect(await db.session.count({ where: { userId: ownerId } })).toBe(
    sessionCount,
  );
});

it("rejects duplicate and invalid emails without losing access", async () => {
  expect(
    (await change({ newEmail: otherEmail, currentPassword: password })).status,
  ).toBe(409);
  expect(
    (await change({ newEmail: "invalid", currentPassword: password })).status,
  ).toBe(400);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: ownerId } })).email,
  ).toBe(email);
});

it("normalizes email, preserves the workspace, invalidates both sessions and permits the new login", async () => {
  const response = await change({
    newEmail: `  ${newEmail.toUpperCase()}  `,
    currentPassword: password,
  });
  expect(response.status).toBe(200);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: ownerId } })).email,
  ).toBe(newEmail);
  expect(
    (await db.workspace.findUniqueOrThrow({ where: { ownerId } })).id,
  ).toBe(workspaceId);
  expect(await db.session.count({ where: { userId: ownerId } })).toBe(0);
  for (const value of [cookie, secondCookie]) {
    expect(
      await auth.api.getSession({ headers: new Headers({ cookie: value }) }),
    ).toBeNull();
  }
  expect((await login(email)).status).toBe(401);
  expect((await login(newEmail)).status).toBe(200);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: otherId } })).email,
  ).toBe(otherEmail);
});

it("limits repeated password attempts", async () => {
  const session = cookies(await login(otherEmail));
  const results = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    results.push(
      (
        await auth.handler(
          new Request(`${origin}/api/auth/change-login-email`, {
            method: "POST",
            headers: {
              cookie: session,
              origin,
              "content-type": "application/json",
              "x-forwarded-for": "192.0.2.218",
            },
            body: JSON.stringify({
              newEmail: `limit-${run}@tests.nhipdang.local`,
              currentPassword: "wrong",
            }),
          }),
        )
      ).status,
    );
  }
  expect(results.at(-1)).toBe(429);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: otherId } })).email,
  ).toBe(otherEmail);
});
