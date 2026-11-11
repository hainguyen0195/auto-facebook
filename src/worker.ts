import "dotenv/config";
import { PgBoss } from "pg-boss";
import { scanReminders } from "./lib/scheduler";
import { db } from "./lib/db";
import { recoverDesktopWork } from "./lib/desktop";
import { pruneInboxSnapshots } from "./lib/inbox";
import { flushMobilePush } from "./lib/mobile-push";
import { scanAutoInteractions } from "./lib/auto-interactions";

let pushTimer: ReturnType<typeof setInterval> | undefined;
let pushRun: Promise<unknown> | undefined;
function scanPush() {
  if (pushRun) return;
  pushRun = flushMobilePush()
    .catch(() => {
      console.error(JSON.stringify({ event: "mobile-push.scan-error" }));
    })
    .finally(() => {
      pushRun = undefined;
    });
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL,
  application_name: "nhipdang-worker",
});
boss.on("error", (error) =>
  console.error(
    JSON.stringify({ event: "worker.error", message: error.message }),
  ),
);
async function main() {
  await boss.start();
  await boss.createQueue("reminders.scan", {
    retryLimit: 3,
    retryDelay: 15,
    expireInSeconds: 120,
  });
  await boss.work("reminders.scan", async () => {
    const processed = await scanReminders();
    await recoverDesktopWork();
    await scanAutoInteractions();
    await pruneInboxSnapshots();
    if (processed)
      console.log(JSON.stringify({ event: "reminders.ready", processed }));
  });
  await boss.schedule(
    "reminders.scan",
    "* * * * *",
    {},
    { tz: "Asia/Bangkok" },
  );
  await scanReminders();
  await recoverDesktopWork();
  await scanAutoInteractions();
  await pruneInboxSnapshots();
  scanPush();
  pushTimer = setInterval(scanPush, 5_000);
  console.log(
    JSON.stringify({
      event: "worker.ready",
      message:
        "Reminders and inbox push notifications. No Facebook publishing.",
    }),
  );
}
async function stop() {
  clearInterval(pushTimer);
  await pushRun;
  await boss.stop({ graceful: true, timeout: 15_000 });
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
main().catch(async (error) => {
  console.error(
    JSON.stringify({ event: "worker.fatal", message: error.message }),
  );
  await db.$disconnect();
  process.exit(1);
});
