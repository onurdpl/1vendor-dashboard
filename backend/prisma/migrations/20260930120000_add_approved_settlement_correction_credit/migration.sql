ALTER TABLE "FinancialCorrectionAuthority"
  ADD COLUMN "historicalApprovedSettlementId" TEXT,
  ADD COLUMN "historicalApprovedSettlementAt" TIMESTAMP(3),
  ADD COLUMN "historicalApprovedSettlementNetMinor" INTEGER;

ALTER TABLE "FinancialCorrectionAuthority"
  ADD CONSTRAINT "FinancialCorrectionAuthority_approved_settlement_fkey"
  FOREIGN KEY ("historicalApprovedSettlementId") REFERENCES "SettlementApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "FinancialCorrectionAuthority_approved_settlement_idx"
  ON "FinancialCorrectionAuthority"("historicalApprovedSettlementId");

ALTER TABLE "FinancialCorrectionAuthority" DROP CONSTRAINT "FinancialCorrectionAuthority_route_check";
ALTER TABLE "FinancialCorrectionAuthority" ADD CONSTRAINT "FinancialCorrectionAuthority_route_check" CHECK (
  "currency" = 'TRY' AND length(trim("reason")) BETWEEN 1 AND 500 AND
  (
    ("economicDirection" = 'VENDOR_DEDUCTION' AND "vendorPayableDifferenceMinor" > 0 AND
     "applicationRoute" = 'PAID_VENDOR_DEBT' AND "historicalPayoutBatchId" IS NOT NULL AND "historicalPayoutPaidAt" IS NOT NULL AND
     "historicalApprovedSettlementId" IS NULL AND "historicalApprovedSettlementAt" IS NULL AND "historicalApprovedSettlementNetMinor" IS NULL)
    OR
    ("economicDirection" = 'VENDOR_CREDIT' AND "vendorPayableDifferenceMinor" < 0 AND
     "applicationRoute" = 'PAID_VENDOR_CREDIT' AND "historicalPayoutBatchId" IS NOT NULL AND "historicalPayoutPaidAt" IS NOT NULL AND
     "historicalApprovedSettlementId" IS NULL AND "historicalApprovedSettlementAt" IS NULL AND "historicalApprovedSettlementNetMinor" IS NULL)
    OR
    ("economicDirection" = 'VENDOR_CREDIT' AND "vendorPayableDifferenceMinor" < 0 AND
     "applicationRoute" = 'BEFORE_SETTLEMENT_VENDOR_CREDIT' AND "historicalPayoutBatchId" IS NULL AND "historicalPayoutPaidAt" IS NULL AND
     "historicalApprovedSettlementId" IS NULL AND "historicalApprovedSettlementAt" IS NULL AND "historicalApprovedSettlementNetMinor" IS NULL)
    OR
    ("economicDirection" = 'VENDOR_DEDUCTION' AND "vendorPayableDifferenceMinor" > 0 AND
     "applicationRoute" = 'BEFORE_SETTLEMENT_VENDOR_DEDUCTION' AND "historicalPayoutBatchId" IS NULL AND "historicalPayoutPaidAt" IS NULL AND
     "historicalApprovedSettlementId" IS NULL AND "historicalApprovedSettlementAt" IS NULL AND "historicalApprovedSettlementNetMinor" IS NULL)
    OR
    ("economicDirection" = 'VENDOR_CREDIT' AND "vendorPayableDifferenceMinor" < 0 AND
     "applicationRoute" = 'APPROVED_SETTLEMENT_VENDOR_CREDIT' AND "historicalPayoutBatchId" IS NULL AND "historicalPayoutPaidAt" IS NULL AND
     "historicalApprovedSettlementId" IS NOT NULL AND "historicalApprovedSettlementAt" IS NOT NULL AND "historicalApprovedSettlementNetMinor" IS NOT NULL)
  )
);

ALTER TABLE "FinancialCorrectionBaselineClaim" DROP CONSTRAINT "FinancialCorrectionBaselineClaim_type_check";
ALTER TABLE "FinancialCorrectionBaselineClaim" ADD CONSTRAINT "FinancialCorrectionBaselineClaim_type_check" CHECK
  ("consumerType" IN ('zero_net_acknowledgement', 'paid_vendor_debt', 'paid_vendor_credit',
    'before_settlement_vendor_credit', 'before_settlement_vendor_deduction', 'approved_settlement_vendor_credit'));

CREATE OR REPLACE FUNCTION "checkFinancialCorrectionEffectDirection"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE direction TEXT;
DECLARE route TEXT;
DECLARE authority_vendor_id TEXT;
DECLARE authority_currency TEXT;
DECLARE authority_difference_minor INTEGER;
DECLARE payout_id TEXT;
DECLARE payout_paid_at TIMESTAMP(3);
DECLARE approval_id TEXT;
BEGIN
  SELECT "economicDirection", "applicationRoute", "vendorId", "currency", "vendorPayableDifferenceMinor",
         "historicalPayoutBatchId", "historicalPayoutPaidAt", "historicalApprovedSettlementId"
  INTO direction, route, authority_vendor_id, authority_currency, authority_difference_minor,
       payout_id, payout_paid_at, approval_id
  FROM "FinancialCorrectionAuthority" WHERE "id" = NEW."authorityId";
  IF direction IS DISTINCT FROM 'VENDOR_CREDIT' OR
     NOT ((route = 'PAID_VENDOR_CREDIT' AND payout_id IS NOT NULL AND payout_paid_at IS NOT NULL AND approval_id IS NULL) OR
          (route = 'BEFORE_SETTLEMENT_VENDOR_CREDIT' AND payout_id IS NULL AND payout_paid_at IS NULL AND approval_id IS NULL) OR
          (route = 'APPROVED_SETTLEMENT_VENDOR_CREDIT' AND payout_id IS NULL AND payout_paid_at IS NULL AND approval_id IS NOT NULL)) OR
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
