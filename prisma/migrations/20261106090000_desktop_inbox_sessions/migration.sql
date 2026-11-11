ALTER TABLE "DesktopDevice" ADD COLUMN "supportsInbox" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FacebookConnection" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "expectedIdentityHash" TEXT;
ALTER TABLE "DesktopCommand" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0;
UPDATE "FacebookConnection" SET "expectedIdentityHash" = "confirmedIdentityHash";

CREATE TABLE "FacebookDeviceSession" (
  "accountId" TEXT NOT NULL REFERENCES "FacebookAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "deviceId" TEXT NOT NULL REFERENCES "DesktopDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "state" TEXT NOT NULL,
  "confirmedIdentityHash" TEXT,
  "automationEnabled" BOOLEAN NOT NULL DEFAULT false,
  "interactionEnabled" BOOLEAN NOT NULL DEFAULT false,
  "interactionDailyLimit" INTEGER NOT NULL DEFAULT 10,
  "interactionIntervalMinutes" INTEGER NOT NULL DEFAULT 5,
  "checkedAt" TIMESTAMP(3),
  CONSTRAINT "FacebookDeviceSession_pkey" PRIMARY KEY ("accountId", "deviceId")
);
INSERT INTO "FacebookDeviceSession" ("accountId", "deviceId", "state", "confirmedIdentityHash", "automationEnabled", "interactionEnabled", "interactionDailyLimit", "interactionIntervalMinutes", "checkedAt")
SELECT "accountId", "deviceId", "state", "confirmedIdentityHash", "automationEnabled", "interactionEnabled", "interactionDailyLimit", "interactionIntervalMinutes", "checkedAt" FROM "FacebookConnection";

CREATE TABLE "FacebookInboxSnapshot" (
  "accountId" TEXT NOT NULL REFERENCES "FacebookAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "deviceId" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "identityHash" TEXT NOT NULL,
  "state" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FacebookInboxSnapshot_pkey" PRIMARY KEY ("accountId")
);
