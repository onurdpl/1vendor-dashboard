ALTER TABLE "FinancialCorrectionAuthority" DROP CONSTRAINT "FinancialCorrectionAuthority_route_check";
ALTER TABLE "FinancialCorrectionAuthority" ADD CONSTRAINT "FinancialCorrectionAuthority_route_check" CHECK (
  "currency" = 'TRY' AND length(trim("reason")) BETWEEN 1 AND 500 AND
  (
    ("economicDirection" = 'VENDOR_DEDUCTION' AND "vendorPayableDifferenceMinor" > 0 AND
     "applicationRoute" = 'PAID_VENDOR_DEBT' AND "historicalPayoutBatchId" IS NOT NULL AND "historicalPayoutPaidAt" IS NOT NULL)
    OR
    ("economicDirection" = 'VENDOR_CREDIT' AND "vendorPayableDifferenceMinor" < 0 AND
     "applicationRoute" = 'PAID_VENDOR_CREDIT' AND "historicalPayoutBatchId" IS NOT NULL AND "historicalPayoutPaidAt" IS NOT NULL)
    OR
    ("economicDirection" = 'VENDOR_CREDIT' AND "vendorPayableDifferenceMinor" < 0 AND
     "applicationRoute" = 'BEFORE_SETTLEMENT_VENDOR_CREDIT' AND "historicalPayoutBatchId" IS NULL AND "historicalPayoutPaidAt" IS NULL)
    OR
    ("economicDirection" = 'VENDOR_DEDUCTION' AND "vendorPayableDifferenceMinor" > 0 AND
     "applicationRoute" = 'BEFORE_SETTLEMENT_VENDOR_DEDUCTION' AND "historicalPayoutBatchId" IS NULL AND "historicalPayoutPaidAt" IS NULL)
  )
);

ALTER TABLE "FinancialCorrectionBaselineClaim" DROP CONSTRAINT "FinancialCorrectionBaselineClaim_type_check";
ALTER TABLE "FinancialCorrectionBaselineClaim" ADD CONSTRAINT "FinancialCorrectionBaselineClaim_type_check" CHECK
  ("consumerType" IN ('zero_net_acknowledgement', 'paid_vendor_debt', 'paid_vendor_credit',
    'before_settlement_vendor_credit', 'before_settlement_vendor_deduction'));

ALTER TABLE "SettlementApproval" ADD COLUMN "correctionDeductionMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PayoutBatch" ADD COLUMN "correctionDeductionAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

CREATE TABLE "FinancialCorrectionDeduction" (
  "id" TEXT NOT NULL,
  "authorityId" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'TRY',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialCorrectionDeduction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialCorrectionDeduction_amount_check" CHECK ("amountMinor" > 0 AND "currency" = 'TRY')
);
CREATE UNIQUE INDEX "FinancialCorrectionDeduction_authorityId_key" ON "FinancialCorrectionDeduction"("authorityId");
CREATE INDEX "FinancialCorrectionDeduction_vendorId_currency_createdAt_idx" ON "FinancialCorrectionDeduction"("vendorId", "currency", "createdAt");
ALTER TABLE "FinancialCorrectionDeduction" ADD CONSTRAINT "FinancialCorrectionDeduction_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "FinancialCorrectionAuthority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionDeduction" ADD CONSTRAINT "FinancialCorrectionDeduction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FinancialCorrectionDeductionSettlementLine" (
  "id" TEXT NOT NULL,
  "deductionId" TEXT NOT NULL,
  "settlementApprovalId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "FinancialCorrectionDeductionSettlementLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialCorrectionDeductionSettlementLine_state_check" CHECK (
    "amountMinor" > 0 AND (("status" = 'ACTIVE' AND "cancelledAt" IS NULL) OR
      ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)))
);
CREATE UNIQUE INDEX "FinancialCorrectionDeductionSettlementLine_source_settlement_ke" ON "FinancialCorrectionDeductionSettlementLine"("deductionId", "settlementApprovalId");
CREATE UNIQUE INDEX "FinancialCorrectionDeductionSettlementLine_active_source_key" ON "FinancialCorrectionDeductionSettlementLine"("deductionId") WHERE "status" = 'ACTIVE';
CREATE INDEX "FinancialCorrectionDeductionSettlementLine_settlement_idx" ON "FinancialCorrectionDeductionSettlementLine"("settlementApprovalId");
ALTER TABLE "FinancialCorrectionDeductionSettlementLine" ADD CONSTRAINT "FinancialCorrectionDeductionSettlementLine_source_fkey" FOREIGN KEY ("deductionId") REFERENCES "FinancialCorrectionDeduction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionDeductionSettlementLine" ADD CONSTRAINT "FinancialCorrectionDeductionSettlementLine_settlement_fkey" FOREIGN KEY ("settlementApprovalId") REFERENCES "SettlementApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FinancialCorrectionDeductionPayoutLine" (
  "id" TEXT NOT NULL,
  "settlementDeductionLineId" TEXT NOT NULL,
  "payoutBatchId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  CONSTRAINT "FinancialCorrectionDeductionPayoutLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialCorrectionDeductionPayoutLine_state_check" CHECK (
    "amountMinor" > 0 AND
    (("status" = 'ACTIVE' AND "cancelledAt" IS NULL AND "paidAt" IS NULL) OR
     ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "paidAt" IS NULL) OR
     ("status" = 'PAID' AND "cancelledAt" IS NULL AND "paidAt" IS NOT NULL)))
);
CREATE UNIQUE INDEX "FinancialCorrectionDeductionPayoutLine_source_batch_key" ON "FinancialCorrectionDeductionPayoutLine"("settlementDeductionLineId", "payoutBatchId");
CREATE UNIQUE INDEX "FinancialCorrectionDeductionPayoutLine_non_cancelled_source_key" ON "FinancialCorrectionDeductionPayoutLine"("settlementDeductionLineId") WHERE "status" <> 'CANCELLED';
CREATE INDEX "FinancialCorrectionDeductionPayoutLine_batch_idx" ON "FinancialCorrectionDeductionPayoutLine"("payoutBatchId");
ALTER TABLE "FinancialCorrectionDeductionPayoutLine" ADD CONSTRAINT "FinancialCorrectionDeductionPayoutLine_source_fkey" FOREIGN KEY ("settlementDeductionLineId") REFERENCES "FinancialCorrectionDeductionSettlementLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionDeductionPayoutLine" ADD CONSTRAINT "FinancialCorrectionDeductionPayoutLine_batch_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "checkFinancialCorrectionDeductionDirection"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE authority_route TEXT;
DECLARE authority_direction TEXT;
DECLARE authority_vendor TEXT;
DECLARE authority_currency TEXT;
DECLARE authority_delta INTEGER;
BEGIN
  SELECT "applicationRoute", "economicDirection", "vendorId", "currency", "vendorPayableDifferenceMinor"
    INTO authority_route, authority_direction, authority_vendor, authority_currency, authority_delta
    FROM "FinancialCorrectionAuthority" WHERE "id" = NEW."authorityId";
  IF authority_route IS DISTINCT FROM 'BEFORE_SETTLEMENT_VENDOR_DEDUCTION' OR
     authority_direction IS DISTINCT FROM 'VENDOR_DEDUCTION' OR
     authority_vendor IS DISTINCT FROM NEW."vendorId" OR
     authority_currency IS DISTINCT FROM NEW."currency" OR
     authority_delta IS DISTINCT FROM NEW."amountMinor" THEN
    RAISE EXCEPTION 'Financial correction deduction requires matching before-settlement authority';
  END IF;
  IF EXISTS (SELECT 1 FROM "VendorBalanceEvent" WHERE "financialCorrectionAuthorityId" = NEW."authorityId") OR
     EXISTS (SELECT 1 FROM "FinancialCorrectionCredit" WHERE "authorityId" = NEW."authorityId") THEN
    RAISE EXCEPTION 'Financial correction cannot have multiple economic effects';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FinancialCorrectionDeduction_direction_guard" BEFORE INSERT OR UPDATE ON "FinancialCorrectionDeduction"
  FOR EACH ROW EXECUTE FUNCTION "checkFinancialCorrectionDeductionDirection"();

CREATE OR REPLACE FUNCTION "checkFinancialCorrectionDebtDirection"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE direction TEXT;
DECLARE route TEXT;
BEGIN
  IF NEW."financialCorrectionAuthorityId" IS NULL THEN RETURN NEW; END IF;
  SELECT "economicDirection", "applicationRoute" INTO direction, route FROM "FinancialCorrectionAuthority" WHERE "id" = NEW."financialCorrectionAuthorityId";
  IF direction IS DISTINCT FROM 'VENDOR_DEDUCTION' OR route IS DISTINCT FROM 'PAID_VENDOR_DEBT' THEN
    RAISE EXCEPTION 'Financial correction debt requires PAID_VENDOR_DEBT authority';
  END IF;
  IF EXISTS (SELECT 1 FROM "FinancialCorrectionCredit" WHERE "authorityId" = NEW."financialCorrectionAuthorityId") OR
     EXISTS (SELECT 1 FROM "FinancialCorrectionDeduction" WHERE "authorityId" = NEW."financialCorrectionAuthorityId") THEN
    RAISE EXCEPTION 'Financial correction cannot have multiple economic effects';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "checkFinancialCorrectionEffectDirection"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE direction TEXT;
DECLARE route TEXT;
DECLARE authority_vendor_id TEXT;
DECLARE authority_currency TEXT;
DECLARE authority_difference_minor INTEGER;
DECLARE payout_id TEXT;
DECLARE payout_paid_at TIMESTAMP(3);
BEGIN
  SELECT "economicDirection", "applicationRoute", "vendorId", "currency", "vendorPayableDifferenceMinor",
         "historicalPayoutBatchId", "historicalPayoutPaidAt"
  INTO direction, route, authority_vendor_id, authority_currency, authority_difference_minor,
       payout_id, payout_paid_at
  FROM "FinancialCorrectionAuthority" WHERE "id" = NEW."authorityId";
  IF direction IS DISTINCT FROM 'VENDOR_CREDIT' OR
     NOT ((route = 'PAID_VENDOR_CREDIT' AND payout_id IS NOT NULL AND payout_paid_at IS NOT NULL) OR
          (route = 'BEFORE_SETTLEMENT_VENDOR_CREDIT' AND payout_id IS NULL AND payout_paid_at IS NULL)) OR
     authority_vendor_id IS DISTINCT FROM NEW."vendorId" OR authority_currency IS DISTINCT FROM NEW."currency" OR
     authority_difference_minor IS DISTINCT FROM -NEW."amountMinor" THEN
    RAISE EXCEPTION 'Financial correction credit requires eligible VENDOR_CREDIT authority';
  END IF;
  IF EXISTS (SELECT 1 FROM "VendorBalanceEvent" WHERE "financialCorrectionAuthorityId" = NEW."authorityId") OR
     EXISTS (SELECT 1 FROM "FinancialCorrectionDeduction" WHERE "authorityId" = NEW."authorityId") THEN
    RAISE EXCEPTION 'Financial correction cannot have multiple economic effects';
  END IF;
  RETURN NEW;
END;
$$;
