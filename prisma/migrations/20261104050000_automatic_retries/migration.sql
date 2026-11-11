ALTER TABLE "Task" ADD COLUMN "automaticAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX "Task_executionMode_status_nextAttemptAt_idx" ON "Task"("executionMode", "status", "nextAttemptAt");
