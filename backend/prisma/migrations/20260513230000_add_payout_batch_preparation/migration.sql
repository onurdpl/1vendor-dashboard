-- CreateEnum
CREATE TYPE "PayoutBatchStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'CANCELLED', 'EXECUTION_PENDING', 'PAID_PLACEHOLDER');

-- CreateTable
CREATE TABLE "PayoutBatch" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "PayoutBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "grossAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "commissionAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "commissionVatAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "shippingDeductionAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "refundAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "netAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutBatchLine" (
    "id" TEXT NOT NULL,
    "payoutBatchId" TEXT NOT NULL,
    "financeLedgerEntryId" TEXT NOT NULL,
    "amountSnapshot" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutBatchLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayoutBatch_vendorId_status_idx" ON "PayoutBatch"("vendorId", "status");

-- CreateIndex
CREATE INDEX "PayoutBatch_createdAt_idx" ON "PayoutBatch"("createdAt");

-- CreateIndex
CREATE INDEX "PayoutBatchLine_financeLedgerEntryId_idx" ON "PayoutBatchLine"("financeLedgerEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutBatchLine_payoutBatchId_financeLedgerEntryId_key" ON "PayoutBatchLine"("payoutBatchId", "financeLedgerEntryId");

-- AddForeignKey
ALTER TABLE "PayoutBatch" ADD CONSTRAINT "PayoutBatch_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBatchLine" ADD CONSTRAINT "PayoutBatchLine_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBatchLine" ADD CONSTRAINT "PayoutBatchLine_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
