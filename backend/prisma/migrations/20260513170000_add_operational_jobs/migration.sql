-- CreateEnum
CREATE TYPE "OperationalJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRY_SCHEDULED', 'DEAD_LETTER_READY');

-- CreateEnum
CREATE TYPE "OperationalJobType" AS ENUM ('WEBHOOK_PROCESSING', 'RECONCILIATION', 'REPLAY', 'RECOVERY', 'FULFILLMENT_SYNC', 'REFUND_SYNC', 'RETURN_SYNC');

-- CreateTable
CREATE TABLE "OperationalJob" (
    "id" TEXT NOT NULL,
    "jobType" "OperationalJobType" NOT NULL,
    "status" "OperationalJobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "payloadRef" TEXT,
    "webhookEventId" TEXT,
    "sourceShopifyOrderId" TEXT,
    "vendorAllocationId" TEXT,
    "refundRecordId" TEXT,
    "returnRecordId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationalJob_status_scheduledAt_idx" ON "OperationalJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "OperationalJob_jobType_idx" ON "OperationalJob"("jobType");

-- CreateIndex
CREATE INDEX "OperationalJob_webhookEventId_idx" ON "OperationalJob"("webhookEventId");

-- CreateIndex
CREATE INDEX "OperationalJob_vendorAllocationId_idx" ON "OperationalJob"("vendorAllocationId");

-- CreateIndex
CREATE INDEX "OperationalJob_sourceShopifyOrderId_idx" ON "OperationalJob"("sourceShopifyOrderId");

-- AddForeignKey
ALTER TABLE "OperationalJob" ADD CONSTRAINT "OperationalJob_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "WebhookEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalJob" ADD CONSTRAINT "OperationalJob_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalJob" ADD CONSTRAINT "OperationalJob_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES "RefundRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalJob" ADD CONSTRAINT "OperationalJob_returnRecordId_fkey" FOREIGN KEY ("returnRecordId") REFERENCES "ReturnRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
