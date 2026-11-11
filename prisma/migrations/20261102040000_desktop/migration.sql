-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "automaticPhase" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "desktopDeviceId" TEXT,
ADD COLUMN     "desktopLeaseAt" TIMESTAMP(3),
ADD COLUMN     "desktopRunId" TEXT,
ADD COLUMN     "executionMode" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "resultSource" TEXT NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "DesktopPairing" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesktopPairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesktopDevice" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "instanceId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesktopDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacebookConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'LOGIN_REQUIRED',
    "identityHash" TEXT,
    "confirmedIdentityHash" TEXT,
    "automationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "message" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacebookConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesktopCommand" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "message" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "DesktopCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "postUrl" TEXT NOT NULL,
    "postKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "reaction" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DesktopPairing_codeHash_key" ON "DesktopPairing"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "DesktopDevice_tokenHash_key" ON "DesktopDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "DesktopDevice_workspaceId_idx" ON "DesktopDevice"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "FacebookConnection_accountId_key" ON "FacebookConnection"("accountId");

-- CreateIndex
CREATE INDEX "FacebookConnection_workspaceId_deviceId_idx" ON "FacebookConnection"("workspaceId", "deviceId");

-- CreateIndex
CREATE INDEX "DesktopCommand_deviceId_state_createdAt_idx" ON "DesktopCommand"("deviceId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "Interaction_workspaceId_status_scheduledAt_idx" ON "Interaction"("workspaceId", "status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Interaction_workspaceId_postKey_key" ON "Interaction"("workspaceId", "postKey");

-- CreateIndex
CREATE INDEX "Task_executionMode_status_scheduledAt_idx" ON "Task"("executionMode", "status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "DesktopPairing" ADD CONSTRAINT "DesktopPairing_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesktopDevice" ADD CONSTRAINT "DesktopDevice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacebookConnection" ADD CONSTRAINT "FacebookConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacebookConnection" ADD CONSTRAINT "FacebookConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FacebookAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacebookConnection" ADD CONSTRAINT "FacebookConnection_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "DesktopDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesktopCommand" ADD CONSTRAINT "DesktopCommand_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesktopCommand" ADD CONSTRAINT "DesktopCommand_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "DesktopDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FacebookAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
