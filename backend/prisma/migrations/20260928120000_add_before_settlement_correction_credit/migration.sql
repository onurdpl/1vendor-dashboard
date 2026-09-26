ALTER TABLE "FinancialCorrectionAuthority" ALTER COLUMN "historicalPayoutBatchId" DROP NOT NULL;
ALTER TABLE "FinancialCorrectionAuthority" ALTER COLUMN "historicalPayoutPaidAt" DROP NOT NULL;

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
  )
);

ALTER TABLE "FinancialCorrectionBaselineClaim" DROP CONSTRAINT "FinancialCorrectionBaselineClaim_type_check";
ALTER TABLE "FinancialCorrectionBaselineClaim" ADD CONSTRAINT "FinancialCorrectionBaselineClaim_type_check" CHECK
  ("consumerType" IN ('zero_net_acknowledgement', 'paid_vendor_debt', 'paid_vendor_credit', 'before_settlement_vendor_credit'));

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
  IF EXISTS (SELECT 1 FROM "VendorBalanceEvent" WHERE "financialCorrectionAuthorityId" = NEW."authorityId") THEN
    RAISE EXCEPTION 'Financial correction cannot have both debt and credit effects';
  END IF;
  RETURN NEW;
END;
$$;
