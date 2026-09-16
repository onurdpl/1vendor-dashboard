-- CreateEnum
CREATE TYPE "RefundTerminalEvidenceReviewStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "RefundTerminalEvidenceReviewEventType" AS ENUM ('DETECTED', 'ACKNOWLEDGED', 'RESOLVED', 'REOPENED');

-- CreateTable
CREATE TABLE "RefundEvidenceSnapshot" (
    "id" TEXT NOT NULL,
    "sourceShopifyRefundId" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "refundRecordId" TEXT NOT NULL,
    "refundFinanceLedgerEntryId" TEXT NOT NULL,
    "historicalEconomicVendorId" TEXT NOT NULL,
    "historicalSaleFinanceLedgerEntryId" TEXT NOT NULL,
    "monetaryClassification" TEXT NOT NULL,
    "refundTotalAmount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "normalizedTransactionsJson" JSONB NOT NULL,
    "normalizedRefundLinesJson" JSONB NOT NULL,
    "normalizedOwnershipJson" JSONB NOT NULL,
    "normalizedEvidenceJson" JSONB NOT NULL,
    "supersededSaleLedgerIdsJson" JSONB NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "hashAlgorithm" TEXT NOT NULL,
    "evidenceVersion" INTEGER NOT NULL,
    "normalizationVersion" INTEGER NOT NULL,
    "evidenceSource" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundEvidenceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundTerminalEvidenceReview" (
    "id" TEXT NOT NULL,
    "sourceShopifyRefundId" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "terminalRefundFinanceLedgerEntryId" TEXT NOT NULL,
    "refundRecordId" TEXT,
    "economicVendorId" TEXT NOT NULL,
    "storedEvidenceSnapshotId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "conflictCategory" TEXT NOT NULL,
    "storedEvidenceHash" TEXT,
    "incomingEvidenceHash" TEXT,
    "storedEvidenceSummaryJson" JSONB,
    "incomingEvidenceSummaryJson" JSONB,
    "conflictSummaryJson" JSONB NOT NULL,
    "sourceContextJson" JSONB,
    "status" "RefundTerminalEvidenceReviewStatus" NOT NULL DEFAULT 'ACTIVE',
    "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundTerminalEvidenceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundTerminalEvidenceReviewEvent" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "eventType" "RefundTerminalEvidenceReviewEventType" NOT NULL,
    "actorUserId" TEXT,
    "note" TEXT,
    "sourceContextJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundTerminalEvidenceReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefundEvidenceSnapshot_refundRecordId_key" ON "RefundEvidenceSnapshot"("refundRecordId");
CREATE UNIQUE INDEX "RefundEvidenceSnapshot_refundFinanceLedgerEntryId_key" ON "RefundEvidenceSnapshot"("refundFinanceLedgerEntryId");
CREATE INDEX "RefundEvidenceSnapshot_sourceShopifyOrderId_idx" ON "RefundEvidenceSnapshot"("sourceShopifyOrderId");
CREATE INDEX "RefundEvidenceSnapshot_vendorAllocationId_idx" ON "RefundEvidenceSnapshot"("vendorAllocationId");
CREATE INDEX "RefundEvidenceSnapshot_historicalEconomicVendorId_idx" ON "RefundEvidenceSnapshot"("historicalEconomicVendorId");
CREATE INDEX "RefundEvidenceSnapshot_evidenceHash_idx" ON "RefundEvidenceSnapshot"("evidenceHash");
CREATE UNIQUE INDEX "RefundEvidenceSnapshot_sourceShopifyRefundId_vendorAllocati_key" ON "RefundEvidenceSnapshot"("sourceShopifyRefundId", "vendorAllocationId");
CREATE UNIQUE INDEX "RefundTerminalEvidenceReview_dedupeKey_key" ON "RefundTerminalEvidenceReview"("dedupeKey");
CREATE INDEX "RefundTerminalEvidenceReview_status_idx" ON "RefundTerminalEvidenceReview"("status");
CREATE INDEX "RefundTerminalEvidenceReview_vendorAllocationId_idx" ON "RefundTerminalEvidenceReview"("vendorAllocationId");
CREATE INDEX "RefundTerminalEvidenceReview_terminalRefundFinanceLedgerEnt_idx" ON "RefundTerminalEvidenceReview"("terminalRefundFinanceLedgerEntryId");
CREATE INDEX "RefundTerminalEvidenceReview_sourceShopifyRefundId_idx" ON "RefundTerminalEvidenceReview"("sourceShopifyRefundId");
CREATE INDEX "RefundTerminalEvidenceReview_firstObservedAt_idx" ON "RefundTerminalEvidenceReview"("firstObservedAt");
CREATE INDEX "RefundTerminalEvidenceReviewEvent_reviewId_createdAt_idx" ON "RefundTerminalEvidenceReviewEvent"("reviewId", "createdAt");
CREATE INDEX "RefundTerminalEvidenceReviewEvent_eventType_createdAt_idx" ON "RefundTerminalEvidenceReviewEvent"("eventType", "createdAt");

-- AddForeignKey
ALTER TABLE "RefundEvidenceSnapshot" ADD CONSTRAINT "RefundEvidenceSnapshot_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundEvidenceSnapshot" ADD CONSTRAINT "RefundEvidenceSnapshot_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES "RefundRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundEvidenceSnapshot" ADD CONSTRAINT "RefundEvidenceSnapshot_refundFinanceLedgerEntryId_fkey" FOREIGN KEY ("refundFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundEvidenceSnapshot" ADD CONSTRAINT "RefundEvidenceSnapshot_historicalEconomicVendorId_fkey" FOREIGN KEY ("historicalEconomicVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundEvidenceSnapshot" ADD CONSTRAINT "RefundEvidenceSnapshot_historicalSaleFinanceLedgerEntryId_fkey" FOREIGN KEY ("historicalSaleFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundTerminalEvidenceReview" ADD CONSTRAINT "RefundTerminalEvidenceReview_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundTerminalEvidenceReview" ADD CONSTRAINT "RefundTerminalEvidenceReview_terminalRefundFinanceLedgerEn_fkey" FOREIGN KEY ("terminalRefundFinanceLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundTerminalEvidenceReview" ADD CONSTRAINT "RefundTerminalEvidenceReview_refundRecordId_fkey" FOREIGN KEY ("refundRecordId") REFERENCES "RefundRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundTerminalEvidenceReview" ADD CONSTRAINT "RefundTerminalEvidenceReview_economicVendorId_fkey" FOREIGN KEY ("economicVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundTerminalEvidenceReview" ADD CONSTRAINT "RefundTerminalEvidenceReview_storedEvidenceSnapshotId_fkey" FOREIGN KEY ("storedEvidenceSnapshotId") REFERENCES "RefundEvidenceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundTerminalEvidenceReviewEvent" ADD CONSTRAINT "RefundTerminalEvidenceReviewEvent_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "RefundTerminalEvidenceReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundTerminalEvidenceReviewEvent" ADD CONSTRAINT "RefundTerminalEvidenceReviewEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
