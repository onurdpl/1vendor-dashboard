-- CreateEnum
CREATE TYPE "OperationalSignalSeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "OperationalSignalStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "OperationalSignalSourceArea" AS ENUM ('PAYOUT', 'REFUND', 'FULFILLMENT', 'DIAGNOSTICS', 'RECONCILIATION', 'SHIPPING_COST', 'SETTLEMENT');

-- CreateTable
CREATE TABLE "OperationalSignal" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "OperationalSignalSeverity" NOT NULL,
    "sourceArea" "OperationalSignalSourceArea" NOT NULL,
    "vendorId" TEXT,
    "allocationId" TEXT,
    "financeLedgerEntryId" TEXT,
    "payoutBatchId" TEXT,
    "operationalJobId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "suggestedAction" TEXT,
    "status" "OperationalSignalStatus" NOT NULL DEFAULT 'ACTIVE',
    "ruleKey" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationalSignal_status_severity_idx" ON "OperationalSignal"("status", "severity");

-- CreateIndex
CREATE INDEX "OperationalSignal_vendorId_status_idx" ON "OperationalSignal"("vendorId", "status");

-- CreateIndex
CREATE INDEX "OperationalSignal_sourceArea_status_idx" ON "OperationalSignal"("sourceArea", "status");

-- CreateIndex
CREATE INDEX "OperationalSignal_ruleKey_idx" ON "OperationalSignal"("ruleKey");

-- CreateIndex
CREATE INDEX "OperationalSignal_triggeredAt_idx" ON "OperationalSignal"("triggeredAt");

-- AddForeignKey
ALTER TABLE "OperationalSignal" ADD CONSTRAINT "OperationalSignal_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalSignal" ADD CONSTRAINT "OperationalSignal_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "VendorAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalSignal" ADD CONSTRAINT "OperationalSignal_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalSignal" ADD CONSTRAINT "OperationalSignal_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalSignal" ADD CONSTRAINT "OperationalSignal_operationalJobId_fkey" FOREIGN KEY ("operationalJobId") REFERENCES "OperationalJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
