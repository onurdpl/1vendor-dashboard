ALTER TABLE "PayoutBatch"
  ADD COLUMN "r1OffsetTotalMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "eftAmountMinor" INTEGER;

ALTER TABLE "PayoutBatch" ADD CONSTRAINT "PayoutBatch_r1_offset_nonnegative_check"
  CHECK ("r1OffsetTotalMinor" >= 0);

ALTER TABLE "PayoutBatch" ADD CONSTRAINT "PayoutBatch_r1_eft_amount_check"
  CHECK ("eftAmountMinor" IS NULL OR
    ("eftAmountMinor" > 0 AND "r1OffsetTotalMinor" > 0 AND
     "status" = 'PAID' AND "eftAttestedAt" IS NOT NULL AND
     "eftAmountMinor" = ("netAmount" * 100)::INTEGER));

CREATE OR REPLACE FUNCTION "protectPayoutEftAttestation"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'PAID' AND OLD."r1OffsetTotalMinor" > 0 AND
     (NEW."status" IS DISTINCT FROM OLD."status" OR
      NEW."paidAt" IS DISTINCT FROM OLD."paidAt" OR
      NEW."netAmount" IS DISTINCT FROM OLD."netAmount" OR
      NEW."r1OffsetTotalMinor" IS DISTINCT FROM OLD."r1OffsetTotalMinor") THEN
    RAISE EXCEPTION 'Paid R1 payout monetary history is immutable';
  END IF;
  IF OLD."eftAttestedAt" IS NOT NULL AND
     (NEW."eftExecutedAt" IS DISTINCT FROM OLD."eftExecutedAt" OR
      NEW."eftDeclaredAt" IS DISTINCT FROM OLD."eftDeclaredAt" OR
      NEW."eftAttestedAt" IS DISTINCT FROM OLD."eftAttestedAt" OR
      NEW."eftAttestedByUserId" IS DISTINCT FROM OLD."eftAttestedByUserId" OR
      NEW."eftAmountMinor" IS DISTINCT FROM OLD."eftAmountMinor") THEN
    RAISE EXCEPTION 'Payout EFT attestation is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE "PayoutR1MissedRefundReconciliation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "payoutBatchId" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "refundFinanceLedgerEntryId" TEXT NOT NULL,
  "settlementRefundAdjustmentId" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL,
  "eftExecutedAt" TIMESTAMP(3) NOT NULL,
  "outstandingAmountMinor" INTEGER NOT NULL,
  "recordedBy" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayoutR1MissedRefundReconciliation_amount_check"
    CHECK ("outstandingAmountMinor" >= 0 AND BTRIM("recordedBy") <> ''),
  CONSTRAINT "PayoutR1MissedRefundReconciliation_payoutBatch_fkey"
    FOREIGN KEY ("payoutBatchId", "vendorId", "currency")
    REFERENCES "PayoutBatch"("id", "vendorId", "currency") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayoutR1MissedRefundReconciliation_refundLedger_fkey"
    FOREIGN KEY ("refundFinanceLedgerEntryId")
    REFERENCES "FinanceLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayoutR1MissedRefundReconciliation_adjustment_fkey"
    FOREIGN KEY ("settlementRefundAdjustmentId", "vendorId", "currency")
    REFERENCES "SettlementRefundAdjustment"("id", "vendorId", "currencyCode") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PayoutR1MissedRefundReconciliation_batch_refund_key"
  ON "PayoutR1MissedRefundReconciliation"("payoutBatchId", "refundFinanceLedgerEntryId");
CREATE INDEX "PayoutR1MissedRefundReconciliation_vendor_currency_recorded_idx"
  ON "PayoutR1MissedRefundReconciliation"("vendorId", "currency", "recordedAt");

CREATE FUNCTION "protectR1MissedRefundReconciliation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'R1 missed refund reconciliation is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PayoutR1MissedRefundReconciliation_immutable"
  BEFORE UPDATE OR DELETE ON "PayoutR1MissedRefundReconciliation"
  FOR EACH ROW EXECUTE FUNCTION "protectR1MissedRefundReconciliation"();

CREATE TABLE "PayoutR1ReviewCancellationAttestation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "payoutBatchId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "confirmedEftNotSent" BOOLEAN NOT NULL,
  "frozenNetMinor" INTEGER NOT NULL,
  "frozenOffsetMinor" INTEGER NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayoutR1ReviewCancellationAttestation_proof_check"
    CHECK ("confirmedEftNotSent" AND BTRIM("reason") <> '' AND
      "frozenNetMinor" >= 0 AND "frozenOffsetMinor" > 0),
  CONSTRAINT "PayoutR1ReviewCancellationAttestation_payoutBatch_fkey"
    FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayoutR1ReviewCancellationAttestation_actorUser_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PayoutR1ReviewCancellationAttestation_payoutBatch_key"
  ON "PayoutR1ReviewCancellationAttestation"("payoutBatchId");
CREATE TRIGGER "PayoutR1ReviewCancellationAttestation_immutable"
  BEFORE UPDATE OR DELETE ON "PayoutR1ReviewCancellationAttestation"
  FOR EACH ROW EXECUTE FUNCTION "protectR1MissedRefundReconciliation"();
