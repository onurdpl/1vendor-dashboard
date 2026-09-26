ALTER TABLE "FinancialCorrectionAuthority" DROP CONSTRAINT "FinancialCorrectionAuthority_route_check";
ALTER TABLE "FinancialCorrectionAuthority" ADD CONSTRAINT "FinancialCorrectionAuthority_route_check" CHECK (
  "currency" = 'TRY' AND length(trim("reason")) BETWEEN 1 AND 500 AND
  (
    ("economicDirection" = 'VENDOR_DEDUCTION' AND "vendorPayableDifferenceMinor" > 0 AND
     "applicationRoute" = 'PAID_VENDOR_DEBT' AND "historicalPayoutBatchId" IS NOT NULL AND "historicalPayoutPaidAt" IS NOT NULL AND
     "historicalApprovedSettlementId" IS NULL AND "historicalApprovedSettlementAt" IS NULL AND "historicalApprovedSettlementNetMinor" IS NULL)
    OR ("economicDirection" = 'VENDOR_CREDIT' AND "vendorPayableDifferenceMinor" < 0 AND
     "applicationRoute" = 'PAID_VENDOR_CREDIT' AND "historicalPayoutBatchId" IS NOT NULL AND "historicalPayoutPaidAt" IS NOT NULL AND
     "historicalApprovedSettlementId" IS NULL AND "historicalApprovedSettlementAt" IS NULL AND "historicalApprovedSettlementNetMinor" IS NULL)
    OR ("economicDirection" = 'VENDOR_CREDIT' AND "vendorPayableDifferenceMinor" < 0 AND
     "applicationRoute" = 'BEFORE_SETTLEMENT_VENDOR_CREDIT' AND "historicalPayoutBatchId" IS NULL AND "historicalPayoutPaidAt" IS NULL AND
     "historicalApprovedSettlementId" IS NULL AND "historicalApprovedSettlementAt" IS NULL AND "historicalApprovedSettlementNetMinor" IS NULL)
    OR ("economicDirection" = 'VENDOR_DEDUCTION' AND "vendorPayableDifferenceMinor" > 0 AND
     "applicationRoute" = 'BEFORE_SETTLEMENT_VENDOR_DEDUCTION' AND "historicalPayoutBatchId" IS NULL AND "historicalPayoutPaidAt" IS NULL AND
     "historicalApprovedSettlementId" IS NULL AND "historicalApprovedSettlementAt" IS NULL AND "historicalApprovedSettlementNetMinor" IS NULL)
    OR ("economicDirection" = 'VENDOR_CREDIT' AND "vendorPayableDifferenceMinor" < 0 AND
     "applicationRoute" = 'APPROVED_SETTLEMENT_VENDOR_CREDIT' AND "historicalPayoutBatchId" IS NULL AND "historicalPayoutPaidAt" IS NULL AND
     "historicalApprovedSettlementId" IS NOT NULL AND "historicalApprovedSettlementAt" IS NOT NULL AND "historicalApprovedSettlementNetMinor" IS NOT NULL)
    OR ("economicDirection" = 'VENDOR_DEDUCTION' AND "vendorPayableDifferenceMinor" > 0 AND
     "applicationRoute" = 'APPROVED_SETTLEMENT_VENDOR_DEDUCTION' AND "historicalPayoutBatchId" IS NULL AND "historicalPayoutPaidAt" IS NULL AND
     "historicalApprovedSettlementId" IS NOT NULL AND "historicalApprovedSettlementAt" IS NOT NULL AND "historicalApprovedSettlementNetMinor" IS NOT NULL)
  )
);

ALTER TABLE "FinancialCorrectionBaselineClaim" DROP CONSTRAINT "FinancialCorrectionBaselineClaim_type_check";
ALTER TABLE "FinancialCorrectionBaselineClaim" ADD CONSTRAINT "FinancialCorrectionBaselineClaim_type_check" CHECK
  ("consumerType" IN ('zero_net_acknowledgement', 'paid_vendor_debt', 'paid_vendor_credit',
    'before_settlement_vendor_credit', 'before_settlement_vendor_deduction',
    'approved_settlement_vendor_credit', 'approved_settlement_vendor_deduction'));

CREATE OR REPLACE FUNCTION "checkFinancialCorrectionDeductionDirection"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE authority_route TEXT;
DECLARE authority_direction TEXT;
DECLARE authority_vendor TEXT;
DECLARE authority_currency TEXT;
DECLARE authority_delta INTEGER;
BEGIN
  SELECT "applicationRoute", "economicDirection", "vendorId", "currency", "vendorPayableDifferenceMinor"
    INTO authority_route, authority_direction, authority_vendor, authority_currency, authority_delta
    FROM "FinancialCorrectionAuthority" WHERE "id" = NEW."authorityId";
  IF authority_route NOT IN ('BEFORE_SETTLEMENT_VENDOR_DEDUCTION', 'APPROVED_SETTLEMENT_VENDOR_DEDUCTION') OR
     authority_direction IS DISTINCT FROM 'VENDOR_DEDUCTION' OR
     authority_vendor IS DISTINCT FROM NEW."vendorId" OR
     authority_currency IS DISTINCT FROM NEW."currency" OR
     authority_delta IS DISTINCT FROM NEW."amountMinor" THEN
    RAISE EXCEPTION 'Financial correction deduction requires matching deduction authority';
  END IF;
  IF EXISTS (SELECT 1 FROM "VendorBalanceEvent" WHERE "financialCorrectionAuthorityId" = NEW."authorityId") OR
     EXISTS (SELECT 1 FROM "FinancialCorrectionCredit" WHERE "authorityId" = NEW."authorityId") THEN
    RAISE EXCEPTION 'Financial correction cannot have multiple economic effects';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE "FinancialCorrectionApprovedDeductionCoverage" (
  "id" TEXT NOT NULL,
  "deductionId" TEXT NOT NULL,
  "settlementApprovalId" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'TRY',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "FinancialCorrectionApprovedDeductionCoverage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialCorrectionApprovedDeductionCoverage_state_check" CHECK (
    "amountMinor" > 0 AND "currency" = 'TRY' AND
    (("status" = 'ACTIVE' AND "releasedAt" IS NULL) OR
     ("status" = 'RELEASED' AND "releasedAt" IS NOT NULL)))
);
CREATE UNIQUE INDEX "FinancialCorrectionApprovedDeductionCoverage_deductionId_key"
  ON "FinancialCorrectionApprovedDeductionCoverage"("deductionId");
CREATE INDEX "FinancialCorrectionApprovedDeductionCoverage_approval_status_idx"
  ON "FinancialCorrectionApprovedDeductionCoverage"("settlementApprovalId", "status");
CREATE INDEX "FinancialCorrectionApprovedDeductionCoverage_vendor_currency_status_idx"
  ON "FinancialCorrectionApprovedDeductionCoverage"("vendorId", "currency", "status");
ALTER TABLE "FinancialCorrectionApprovedDeductionCoverage" ADD CONSTRAINT "FinancialCorrectionApprovedDeductionCoverage_deductionId_fkey"
  FOREIGN KEY ("deductionId") REFERENCES "FinancialCorrectionDeduction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionApprovedDeductionCoverage" ADD CONSTRAINT "FinancialCorrectionApprovedDeductionCoverage_settlementApprovalId_fkey"
  FOREIGN KEY ("settlementApprovalId") REFERENCES "SettlementApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionApprovedDeductionCoverage" ADD CONSTRAINT "FinancialCorrectionApprovedDeductionCoverage_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "checkApprovedDeductionCoverage"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_vendor TEXT;
DECLARE source_currency TEXT;
DECLARE source_amount INTEGER;
DECLARE source_route TEXT;
DECLARE source_approval TEXT;
DECLARE approval_vendor TEXT;
DECLARE approval_currency TEXT;
BEGIN
  SELECT d."vendorId", d."currency", d."amountMinor", a."applicationRoute", a."historicalApprovedSettlementId"
    INTO source_vendor, source_currency, source_amount, source_route, source_approval
    FROM "FinancialCorrectionDeduction" d JOIN "FinancialCorrectionAuthority" a ON a."id" = d."authorityId"
    WHERE d."id" = NEW."deductionId";
  SELECT "vendorId", "currency" INTO approval_vendor, approval_currency
    FROM "SettlementApproval" WHERE "id" = NEW."settlementApprovalId";
  IF source_route IS DISTINCT FROM 'APPROVED_SETTLEMENT_VENDOR_DEDUCTION' OR
     source_approval IS DISTINCT FROM NEW."settlementApprovalId" OR
     source_vendor IS DISTINCT FROM NEW."vendorId" OR source_currency IS DISTINCT FROM NEW."currency" OR
     source_amount IS DISTINCT FROM NEW."amountMinor" OR
     approval_vendor IS DISTINCT FROM NEW."vendorId" OR approval_currency IS DISTINCT FROM NEW."currency" THEN
    RAISE EXCEPTION 'Approved deduction coverage must match its source and origin approval';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FinancialCorrectionApprovedDeductionCoverage_source_guard"
  BEFORE INSERT OR UPDATE ON "FinancialCorrectionApprovedDeductionCoverage"
  FOR EACH ROW EXECUTE FUNCTION "checkApprovedDeductionCoverage"();

CREATE TABLE "FinancialCorrectionApprovedDeductionPayoutLine" (
  "id" TEXT NOT NULL,
  "coverageId" TEXT NOT NULL,
  "payoutBatchId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  CONSTRAINT "FinancialCorrectionApprovedDeductionPayoutLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialCorrectionApprovedDeductionPayoutLine_state_check" CHECK (
    "amountMinor" > 0 AND
    (("status" = 'ACTIVE' AND "cancelledAt" IS NULL AND "paidAt" IS NULL) OR
     ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "paidAt" IS NULL) OR
     ("status" = 'PAID' AND "cancelledAt" IS NULL AND "paidAt" IS NOT NULL)))
);
CREATE UNIQUE INDEX "FinancialCorrectionApprovedDeductionPayoutLine_source_batch_key"
  ON "FinancialCorrectionApprovedDeductionPayoutLine"("coverageId", "payoutBatchId");
CREATE UNIQUE INDEX "FinancialCorrectionApprovedDeductionPayoutLine_non_cancelled_source_key"
  ON "FinancialCorrectionApprovedDeductionPayoutLine"("coverageId") WHERE "status" <> 'CANCELLED';
CREATE INDEX "FinancialCorrectionApprovedDeductionPayoutLine_batch_idx"
  ON "FinancialCorrectionApprovedDeductionPayoutLine"("payoutBatchId");
ALTER TABLE "FinancialCorrectionApprovedDeductionPayoutLine" ADD CONSTRAINT "FinancialCorrectionApprovedDeductionPayoutLine_coverageId_fkey"
  FOREIGN KEY ("coverageId") REFERENCES "FinancialCorrectionApprovedDeductionCoverage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionApprovedDeductionPayoutLine" ADD CONSTRAINT "FinancialCorrectionApprovedDeductionPayoutLine_payoutBatchId_fkey"
  FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
