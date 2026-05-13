-- CreateEnum
CREATE TYPE "AutomationActionStatus" AS ENUM ('PENDING', 'SUGGESTED', 'EXECUTED', 'SKIPPED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AutomationExecutionMode" AS ENUM ('MANUAL', 'ASSISTED', 'AUTO_SAFE');

-- CreateEnum
CREATE TYPE "AutomationActionType" AS ENUM ('SUGGEST_REPLAY_WEBHOOK', 'SUGGEST_RECONCILIATION', 'SUGGEST_PAYOUT_BATCH_REVIEW', 'SUGGEST_SHIPPING_COST_ATTACHMENT', 'SUGGEST_STALE_FULFILLMENT_REVIEW', 'SUGGEST_PAYOUT_REVIEW', 'SUGGEST_NEGATIVE_PAYOUT_INVESTIGATION', 'SUGGEST_DEAD_LETTER_INVESTIGATION', 'AUTO_CREATE_RECONCILIATION_CANDIDATE', 'AUTO_GENERATE_REMINDER_NOTIFICATION', 'AUTO_PRIORITIZE_STALE_QUEUE_ITEM');

-- CreateTable
CREATE TABLE "AutomationAction" (
    "id" TEXT NOT NULL,
    "signalId" TEXT,
    "type" "AutomationActionType" NOT NULL,
    "status" "AutomationActionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "executionMode" "AutomationExecutionMode" NOT NULL DEFAULT 'MANUAL',
    "vendorId" TEXT,
    "allocationId" TEXT,
    "financeLedgerEntryId" TEXT,
    "payoutBatchId" TEXT,
    "operationalJobId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "resultSummary" TEXT,
    "executedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationAction_status_type_idx" ON "AutomationAction"("status", "type");

-- CreateIndex
CREATE INDEX "AutomationAction_vendorId_status_idx" ON "AutomationAction"("vendorId", "status");

-- CreateIndex
CREATE INDEX "AutomationAction_signalId_idx" ON "AutomationAction"("signalId");

-- CreateIndex
CREATE INDEX "AutomationAction_createdAt_idx" ON "AutomationAction"("createdAt");

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "OperationalSignal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "VendorAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_operationalJobId_fkey" FOREIGN KEY ("operationalJobId") REFERENCES "OperationalJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
