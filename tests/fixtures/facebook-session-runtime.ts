import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FacebookDesktop } from "../../src/desktop/facebook";
import {
  facebookBrowserProfilePath,
  localDesktopRoot,
} from "../../src/desktop/profiles";

const root = await mkdtemp(path.join(tmpdir(), "nhipdang-session-"));
const profile = (accountId: string) =>
  facebookBrowserProfilePath(root, "workspace", accountId);
const fixtureUrl = "https://nhipdang-session.invalid/";
let desktop = new FacebookDesktop(profile);
try {
  // Simulate a profile from the old local launcher, without using real Facebook credentials.
  const legacyProfile = path.join(
    localDesktopRoot(root, "workspace"),
    "profiles",
    "workspace",
    createHash("sha256").update("account").digest("hex"),
  );
  await mkdir(legacyProfile, { recursive: true });
  const { context, page } = await desktop.open("account");
  assert.equal(realpathSync(profile("account")), realpathSync(legacyProfile));
  await context.route("**/*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Facebook session fixture</title><p>Saved session</p>",
    }),
  );
  await context.addCookies([
    {
      name: "c_user",
      value: "12345",
      domain: ".facebook.com",
      path: "/",
      secure: true,
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
    {
      name: "xs",
      value: "fixture-session",
      domain: ".facebook.com",
      path: "/",
      secure: true,
      httpOnly: true,
    },
  ]);
  // Restored tabs may load before routing is installed; never visit real Facebook with fixture cookies.
  await page.goto(fixtureUrl);
  const first = await desktop.check("account", false);
  assert.equal(first.state, "READY");
  await desktop.close();

  // A fresh instance reproduces restarting the actual desktop process.
  desktop = new FacebookDesktop(profile);
  const reopened = await desktop.open("account");
  await reopened.context.route("**/*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Facebook session fixture</title><p>Restored session</p>",
    }),
  );
  await reopened.page.goto(fixtureUrl);
  const second = await desktop.check("account", false);
  assert.equal(second.state, "READY");
  assert.equal(second.identityHash, first.identityHash);
  const cookies = await reopened.context.cookies("https://www.facebook.com/");
  assert(
    cookies.some(
      (cookie) => cookie.name === "xs" && cookie.value === "fixture-session",
    ),
    "session cookies must survive a restart",
  );
  await reopened.page.goto(`${fixtureUrl}checkpoint`);
  assert.equal((await desktop.check("account", false)).state, "CHALLENGE");
  await reopened.context.clearCookies();
  await reopened.page.goto(fixtureUrl);
  assert.equal((await desktop.check("account", false)).state, "LOGIN_REQUIRED");
  process.stdout.write(
    JSON.stringify({
      restored: true,
      sessionCookieRestored: true,
      challengeDetected: true,
      logoutDetected: true,
    }),
  );
} finally {
  await desktop.close();
  await rm(root, { recursive: true, force: true });
}
