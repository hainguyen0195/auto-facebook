CREATE TABLE "MobilePushSubscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "endpointHash" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "vapidPublicKey" TEXT NOT NULL,
    "pendingVersion" INTEGER NOT NULL DEFAULT 0,
    "deliveredVersion" INTEGER NOT NULL DEFAULT 0,
    "hasNew" BOOLEAN NOT NULL DEFAULT false,
    "testRequested" BOOLEAN NOT NULL DEFAULT false,
    "lastTestAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MobilePushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MobilePushSubscription_endpointHash_key" ON "MobilePushSubscription"("endpointHash");
CREATE INDEX "MobilePushSubscription_workspaceId_idx" ON "MobilePushSubscription"("workspaceId");
CREATE INDEX "MobilePushSubscription_sessionId_idx" ON "MobilePushSubscription"("sessionId");
CREATE INDEX "MobilePushSubscription_nextAttemptAt_idx" ON "MobilePushSubscription"("nextAttemptAt");
ALTER TABLE "MobilePushSubscription" ADD CONSTRAINT "MobilePushSubscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MobilePushSubscription" ADD CONSTRAINT "MobilePushSubscription_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
