CREATE TABLE "FinancialCorrectionBaselineClaim" (
    "id" TEXT NOT NULL,
    "acceptedEvidenceSnapshotId" TEXT NOT NULL,
    "consumerType" TEXT NOT NULL,
    "consumerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinancialCorrectionBaselineClaim_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinancialCorrectionBaselineClaim_type_check" CHECK ("consumerType" IN ('zero_net_acknowledgement', 'paid_vendor_debt'))
);

CREATE UNIQUE INDEX "FinancialCorrectionBaselineClaim_accepted_key" ON "FinancialCorrectionBaselineClaim"("acceptedEvidenceSnapshotId");
CREATE UNIQUE INDEX "FinancialCorrectionBaselineClaim_consumer_key" ON "FinancialCorrectionBaselineClaim"("consumerId");
ALTER TABLE "FinancialCorrectionBaselineClaim" ADD CONSTRAINT "FinancialCorrectionBaselineClaim_accepted_fkey" FOREIGN KEY ("acceptedEvidenceSnapshotId") REFERENCES "RefundEvidenceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FinancialCorrectionAuthority" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "resolvedReviewEventId" TEXT NOT NULL,
    "acceptedEvidenceSnapshotId" TEXT NOT NULL,
    "incomingConflictEvidenceId" TEXT NOT NULL,
    "sourceShopifyRefundId" TEXT NOT NULL,
    "sourceShopifyOrderId" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "historicalSaleFinanceLedgerEntryId" TEXT NOT NULL,
    "acceptedRefundFinanceLedgerEntryId" TEXT NOT NULL,
    "acceptedEvidenceHash" TEXT NOT NULL,
    "incomingEvidenceHash" TEXT NOT NULL,
    "acceptedEvidenceVersion" INTEGER NOT NULL,
    "acceptedNormalizationVersion" INTEGER NOT NULL,
    "incomingEvidenceVersion" INTEGER NOT NULL,
    "incomingNormalizationVersion" INTEGER NOT NULL,
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
    "historicalPayoutBatchId" TEXT NOT NULL,
    "historicalPayoutPaidAt" TIMESTAMP(3) NOT NULL,
    "applicationRoute" TEXT NOT NULL,
    "authorizedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinancialCorrectionAuthority_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinancialCorrectionAuthority_route_check" CHECK ("currency" = 'TRY' AND "economicDirection" = 'VENDOR_DEDUCTION' AND "vendorPayableDifferenceMinor" > 0 AND "applicationRoute" = 'PAID_VENDOR_DEBT' AND length(trim("reason")) BETWEEN 1 AND 500)
);

CREATE UNIQUE INDEX "FinancialCorrectionAuthority_review_key" ON "FinancialCorrectionAuthority"("reviewId");
CREATE UNIQUE INDEX "FinancialCorrectionAuthority_event_key" ON "FinancialCorrectionAuthority"("resolvedReviewEventId");
CREATE UNIQUE INDEX "FinancialCorrectionAuthority_accepted_key" ON "FinancialCorrectionAuthority"("acceptedEvidenceSnapshotId");
CREATE UNIQUE INDEX "FinancialCorrectionAuthority_incoming_key" ON "FinancialCorrectionAuthority"("incomingConflictEvidenceId");
CREATE UNIQUE INDEX "FinancialCorrectionAuthority_pair_key" ON "FinancialCorrectionAuthority"("acceptedEvidenceSnapshotId", "incomingConflictEvidenceId");
CREATE INDEX "FinancialCorrectionAuthority_vendor_applied_idx" ON "FinancialCorrectionAuthority"("vendorId", "appliedAt");
ALTER TABLE "FinancialCorrectionAuthority" ADD CONSTRAINT "FinancialCorrectionAuthority_review_fkey" FOREIGN KEY ("reviewId") REFERENCES "RefundTerminalEvidenceReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionAuthority" ADD CONSTRAINT "FinancialCorrectionAuthority_event_fkey" FOREIGN KEY ("resolvedReviewEventId") REFERENCES "RefundTerminalEvidenceReviewEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionAuthority" ADD CONSTRAINT "FinancialCorrectionAuthority_accepted_fkey" FOREIGN KEY ("acceptedEvidenceSnapshotId") REFERENCES "RefundEvidenceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionAuthority" ADD CONSTRAINT "FinancialCorrectionAuthority_incoming_fkey" FOREIGN KEY ("incomingConflictEvidenceId") REFERENCES "RefundTerminalConflictEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionAuthority" ADD CONSTRAINT "FinancialCorrectionAuthority_actor_fkey" FOREIGN KEY ("authorizedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionAuthority" ADD CONSTRAINT "FinancialCorrectionAuthority_payout_fkey" FOREIGN KEY ("historicalPayoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VendorBalanceEvent" ADD COLUMN "financialCorrectionAuthorityId" TEXT;
CREATE UNIQUE INDEX "VendorBalanceEvent_financialCorrectionAuthorityId_key" ON "VendorBalanceEvent"("financialCorrectionAuthorityId");
ALTER TABLE "VendorBalanceEvent" ADD CONSTRAINT "VendorBalanceEvent_correction_authority_fkey" FOREIGN KEY ("financialCorrectionAuthorityId") REFERENCES "FinancialCorrectionAuthority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorBalanceEvent" ADD CONSTRAINT "VendorBalanceEvent_correction_source_check" CHECK (
    "sourceType" <> 'financial_correction' OR
    ("financialCorrectionAuthorityId" IS NOT NULL AND "sourceId" = "financialCorrectionAuthorityId" AND "type" = 'VENDOR_DEBT_CREATED' AND "amountMinor" < 0 AND "currency" = 'TRY')
);
