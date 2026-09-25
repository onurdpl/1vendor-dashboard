CREATE TABLE "FinancialCorrectionZeroNetAcknowledgement" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "resolvedReviewEventId" TEXT NOT NULL,
    "sourceShopifyRefundId" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "acceptedEvidenceSnapshotId" TEXT NOT NULL,
    "incomingConflictEvidenceId" TEXT NOT NULL,
    "acceptedEvidenceHash" TEXT NOT NULL,
    "incomingEvidenceHash" TEXT NOT NULL,
    "acceptedEvidenceVersion" INTEGER NOT NULL,
    "acceptedNormalizationVersion" INTEGER NOT NULL,
    "incomingEvidenceVersion" INTEGER NOT NULL,
    "incomingNormalizationVersion" INTEGER NOT NULL,
    "historicalSaleFinanceLedgerEntryId" TEXT NOT NULL,
    "acceptedRefundFinanceLedgerEntryId" TEXT NOT NULL,
    "commissionPercent" DECIMAL(5,2) NOT NULL,
    "commissionVatPercent" DECIMAL(5,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "acceptedRefundAmountMinor" INTEGER NOT NULL,
    "acceptedCommissionReversalMinor" INTEGER NOT NULL,
    "acceptedCommissionVatReversalMinor" INTEGER NOT NULL,
    "acceptedVendorPayableReversalMinor" INTEGER NOT NULL,
    "correctedRefundAmountMinor" INTEGER NOT NULL,
    "correctedCommissionReversalMinor" INTEGER NOT NULL,
    "correctedCommissionVatReversalMinor" INTEGER NOT NULL,
    "correctedVendorPayableReversalMinor" INTEGER NOT NULL,
    "refundDifferenceMinor" INTEGER NOT NULL,
    "commissionDifferenceMinor" INTEGER NOT NULL,
    "commissionVatDifferenceMinor" INTEGER NOT NULL,
    "vendorPayableDifferenceMinor" INTEGER NOT NULL,
    "economicDirection" TEXT NOT NULL,
    "previewFingerprint" TEXT NOT NULL,
    "acknowledgedByUserId" TEXT NOT NULL,
    "note" TEXT,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialCorrectionZeroNetAcknowledgement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinancialCorrectionZeroNetAcknowledgement_zero_effect_check" CHECK ("vendorPayableDifferenceMinor" = 0 AND "economicDirection" = 'NONE' AND "currency" = 'TRY')
);

CREATE UNIQUE INDEX "ZeroNetAck_review_key" ON "FinancialCorrectionZeroNetAcknowledgement"("reviewId");
CREATE UNIQUE INDEX "ZeroNetAck_event_key" ON "FinancialCorrectionZeroNetAcknowledgement"("resolvedReviewEventId");
CREATE UNIQUE INDEX "ZeroNetAck_accepted_key" ON "FinancialCorrectionZeroNetAcknowledgement"("acceptedEvidenceSnapshotId");
CREATE UNIQUE INDEX "ZeroNetAck_incoming_key" ON "FinancialCorrectionZeroNetAcknowledgement"("incomingConflictEvidenceId");
CREATE UNIQUE INDEX "ZeroNetAck_evidence_pair_key" ON "FinancialCorrectionZeroNetAcknowledgement"("acceptedEvidenceSnapshotId", "incomingConflictEvidenceId");
CREATE INDEX "ZeroNetAck_allocation_idx" ON "FinancialCorrectionZeroNetAcknowledgement"("vendorAllocationId");
CREATE INDEX "ZeroNetAck_vendor_idx" ON "FinancialCorrectionZeroNetAcknowledgement"("vendorId");

ALTER TABLE "FinancialCorrectionZeroNetAcknowledgement" ADD CONSTRAINT "FinancialCorrectionZeroNetAcknowledgement_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "RefundTerminalEvidenceReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionZeroNetAcknowledgement" ADD CONSTRAINT "FinancialCorrectionZeroNetAcknowledgement_resolvedReviewEv_fkey" FOREIGN KEY ("resolvedReviewEventId") REFERENCES "RefundTerminalEvidenceReviewEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionZeroNetAcknowledgement" ADD CONSTRAINT "FinancialCorrectionZeroNetAcknowledgement_acceptedEvidence_fkey" FOREIGN KEY ("acceptedEvidenceSnapshotId") REFERENCES "RefundEvidenceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionZeroNetAcknowledgement" ADD CONSTRAINT "FinancialCorrectionZeroNetAcknowledgement_incomingConflict_fkey" FOREIGN KEY ("incomingConflictEvidenceId") REFERENCES "RefundTerminalConflictEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionZeroNetAcknowledgement" ADD CONSTRAINT "FinancialCorrectionZeroNetAcknowledgement_acknowledgedByUs_fkey" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
