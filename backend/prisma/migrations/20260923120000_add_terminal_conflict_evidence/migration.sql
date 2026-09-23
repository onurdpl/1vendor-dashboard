-- CreateTable
CREATE TABLE "RefundTerminalConflictEvidence" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "sourceShopifyRefundId" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "economicVendorId" TEXT NOT NULL,
    "historicalSaleFinanceLedgerEntryId" TEXT NOT NULL,
    "supersededSaleLedgerIdsJson" JSONB NOT NULL,
    "refundTotalAmount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "normalizedEvidenceJson" JSONB NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "hashAlgorithm" TEXT NOT NULL,
    "evidenceVersion" INTEGER NOT NULL,
    "normalizationVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundTerminalConflictEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefundTerminalConflictEvidence_reviewId_key" ON "RefundTerminalConflictEvidence"("reviewId");
CREATE INDEX "RefundTerminalConflictEvidence_sourceShopifyRefundId_idx" ON "RefundTerminalConflictEvidence"("sourceShopifyRefundId");
CREATE INDEX "RefundTerminalConflictEvidence_sourceShopifyOrderId_idx" ON "RefundTerminalConflictEvidence"("sourceShopifyOrderId");
CREATE INDEX "RefundTerminalConflictEvidence_vendorAllocationId_idx" ON "RefundTerminalConflictEvidence"("vendorAllocationId");
CREATE INDEX "RefundTerminalConflictEvidence_economicVendorId_idx" ON "RefundTerminalConflictEvidence"("economicVendorId");
CREATE INDEX "RefundTerminalConflictEvidence_historicalSaleFinanceLedg_idx" ON "RefundTerminalConflictEvidence"("historicalSaleFinanceLedgerEntryId");
CREATE INDEX "RefundTerminalConflictEvidence_evidenceHash_idx" ON "RefundTerminalConflictEvidence"("evidenceHash");

-- AddForeignKey
ALTER TABLE "RefundTerminalConflictEvidence" ADD CONSTRAINT "RefundTerminalConflictEvidence_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "RefundTerminalEvidenceReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundTerminalConflictEvidence" ADD CONSTRAINT "RefundTerminalConflictEvidence_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundTerminalConflictEvidence" ADD CONSTRAINT "RefundTerminalConflictEvidence_economicVendorId_fkey" FOREIGN KEY ("economicVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundTerminalConflictEvidence" ADD CONSTRAINT "RefundTerminalConflictEvidence_historicalSaleFinanceL_fkey" FOREIGN KEY ("historicalSaleFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
