ALTER TABLE "Task" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Task_workspaceId_archivedAt_scheduledAt_idx" ON "Task"("workspaceId", "archivedAt", "scheduledAt");
