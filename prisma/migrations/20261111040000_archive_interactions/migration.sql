ALTER TABLE "Interaction" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Interaction_workspaceId_archivedAt_scheduledAt_idx"
ON "Interaction"("workspaceId", "archivedAt", "scheduledAt");
