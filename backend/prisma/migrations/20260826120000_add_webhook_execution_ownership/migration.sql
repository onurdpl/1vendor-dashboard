ALTER TABLE "WebhookEvent"
ADD COLUMN "sourceShopifyOrderId" TEXT,
ADD COLUMN "executionAvailableAt" TIMESTAMP(3),
ADD COLUMN "executionAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "executionMaxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "processingGeneration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "processingLeaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "WebhookEvent_topic_status_executionAvailableAt_receivedAt_idx"
ON "WebhookEvent"("topic", "status", "executionAvailableAt", "receivedAt");

CREATE INDEX "WebhookEvent_topic_status_processingLeaseExpiresAt_idx"
ON "WebhookEvent"("topic", "status", "processingLeaseExpiresAt");

CREATE INDEX "WebhookEvent_topic_sourceShopifyOrderId_status_idx"
ON "WebhookEvent"("topic", "sourceShopifyOrderId", "status");
