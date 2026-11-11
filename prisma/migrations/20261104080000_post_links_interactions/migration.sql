ALTER TABLE "FacebookConnection"
ADD COLUMN "interactionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "interactionDailyLimit" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "interactionIntervalMinutes" INTEGER NOT NULL DEFAULT 5;

ALTER TABLE "Interaction"
ADD COLUMN "sourceTaskId" TEXT,
ADD COLUMN "executionMode" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "phase" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN "desktopDeviceId" TEXT,
ADD COLUMN "runId" TEXT,
ADD COLUMN "leaseAt" TIMESTAMP(3),
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN "resultSource" TEXT NOT NULL DEFAULT 'USER',
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Interaction_sourceTaskId_status_idx" ON "Interaction"("sourceTaskId", "status");
CREATE INDEX "Interaction_desktopDeviceId_status_idx" ON "Interaction"("desktopDeviceId", "status");
CREATE TABLE "InteractionEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "interactionId" TEXT NOT NULL,
  "runId" TEXT,
  "fromStatus" TEXT NOT NULL,
  "toStatus" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InteractionEvent_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "Interaction"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "InteractionEvent_interactionId_createdAt_idx" ON "InteractionEvent"("interactionId", "createdAt");
