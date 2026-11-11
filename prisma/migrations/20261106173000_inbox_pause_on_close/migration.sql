ALTER TABLE "FacebookConnection" ADD COLUMN "inboxPaused" BOOLEAN NOT NULL DEFAULT false;

-- Respect windows already closed before this update.
UPDATE "FacebookConnection" AS c
SET "inboxPaused" = true
FROM (
  SELECT DISTINCT ON ("accountId") "accountId", "deviceId", "generation", "kind"
  FROM "DesktopCommand"
  WHERE "state" = 'SUCCEEDED'
  ORDER BY "accountId", "createdAt" DESC, "id" DESC
) AS latest
WHERE latest."accountId" = c."accountId"
  AND latest."deviceId" = c."deviceId"
  AND latest."generation" = c."generation"
  AND latest."kind" = 'CLOSE';
