ALTER TABLE "FinancialCorrectionAuthority"
  ADD COLUMN "historicalReviewPayoutGrossMinor" INTEGER,
  ADD COLUMN "historicalReviewPayoutNetMinor" INTEGER,
  ADD COLUMN "historicalReviewPayoutDebtOffsetMinor" INTEGER,
  ADD COLUMN "historicalReviewPayoutSourceFingerprint" TEXT,
  ADD COLUMN "historicalReviewPayoutCancelledAt" TIMESTAMP(3),
  ADD COLUMN "reviewEftNotSentConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "reviewEftNotSentConfirmationVersion" TEXT,
  ADD COLUMN "reviewPayoutObservedStatus" TEXT;

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
    OR ("economicDirection" = 'VENDOR_CREDIT' AND "vendorPayableDifferenceMinor" < 0 AND
     "applicationRoute" = 'DRAFT_PAYOUT_VENDOR_CREDIT' AND "historicalPayoutBatchId" IS NOT NULL AND "historicalPayoutPaidAt" IS NULL AND
     "historicalApprovedSettlementId" IS NOT NULL AND "historicalApprovedSettlementAt" IS NOT NULL AND "historicalApprovedSettlementNetMinor" IS NOT NULL AND
     "historicalDraftPayoutGrossMinor" IS NOT NULL AND "historicalDraftPayoutNetMinor" IS NOT NULL AND
     "historicalDraftPayoutDebtOffsetMinor" IS NOT NULL AND "historicalDraftPayoutSourceFingerprint" IS NOT NULL AND
     "historicalDraftPayoutCancelledAt" IS NOT NULL)
    OR ("economicDirection" = 'VENDOR_DEDUCTION' AND "vendorPayableDifferenceMinor" > 0 AND
     "applicationRoute" = 'DRAFT_PAYOUT_VENDOR_DEDUCTION' AND "historicalPayoutBatchId" IS NOT NULL AND "historicalPayoutPaidAt" IS NULL AND
     "historicalApprovedSettlementId" IS NOT NULL AND "historicalApprovedSettlementAt" IS NOT NULL AND "historicalApprovedSettlementNetMinor" IS NOT NULL AND
     "historicalDraftPayoutGrossMinor" IS NOT NULL AND "historicalDraftPayoutNetMinor" IS NOT NULL AND
     "historicalDraftPayoutDebtOffsetMinor" IS NOT NULL AND "historicalDraftPayoutSourceFingerprint" IS NOT NULL AND
     "historicalDraftPayoutCancelledAt" IS NOT NULL)
    OR ("economicDirection" = 'VENDOR_CREDIT' AND "vendorPayableDifferenceMinor" < 0 AND
     "applicationRoute" = 'REVIEW_PAYOUT_VENDOR_CREDIT' AND "historicalPayoutBatchId" IS NOT NULL AND "historicalPayoutPaidAt" IS NULL AND
     "historicalApprovedSettlementId" IS NOT NULL AND "historicalApprovedSettlementAt" IS NOT NULL AND "historicalApprovedSettlementNetMinor" IS NOT NULL AND
     "historicalReviewPayoutGrossMinor" IS NOT NULL AND "historicalReviewPayoutNetMinor" IS NOT NULL AND
     "historicalReviewPayoutDebtOffsetMinor" IS NOT NULL AND "historicalReviewPayoutSourceFingerprint" IS NOT NULL AND
     "historicalReviewPayoutCancelledAt" IS NOT NULL AND "reviewEftNotSentConfirmedAt" IS NOT NULL AND
     "reviewEftNotSentConfirmationVersion" = 'review-eft-not-sent-v1' AND "reviewPayoutObservedStatus" = 'REVIEW')
    OR ("economicDirection" = 'VENDOR_DEDUCTION' AND "vendorPayableDifferenceMinor" > 0 AND
     "applicationRoute" = 'REVIEW_PAYOUT_VENDOR_DEDUCTION' AND "historicalPayoutBatchId" IS NOT NULL AND "historicalPayoutPaidAt" IS NULL AND
     "historicalApprovedSettlementId" IS NOT NULL AND "historicalApprovedSettlementAt" IS NOT NULL AND "historicalApprovedSettlementNetMinor" IS NOT NULL AND
     "historicalReviewPayoutGrossMinor" IS NOT NULL AND "historicalReviewPayoutNetMinor" IS NOT NULL AND
     "historicalReviewPayoutDebtOffsetMinor" IS NOT NULL AND "historicalReviewPayoutSourceFingerprint" IS NOT NULL AND
     "historicalReviewPayoutCancelledAt" IS NOT NULL AND "reviewEftNotSentConfirmedAt" IS NOT NULL AND
     "reviewEftNotSentConfirmationVersion" = 'review-eft-not-sent-v1' AND "reviewPayoutObservedStatus" = 'REVIEW')
  )
);

ALTER TABLE "FinancialCorrectionBaselineClaim" DROP CONSTRAINT "FinancialCorrectionBaselineClaim_type_check";
ALTER TABLE "FinancialCorrectionBaselineClaim" ADD CONSTRAINT "FinancialCorrectionBaselineClaim_type_check" CHECK
  ("consumerType" IN ('zero_net_acknowledgement', 'paid_vendor_debt', 'paid_vendor_credit',
    'before_settlement_vendor_credit', 'before_settlement_vendor_deduction',
    'approved_settlement_vendor_credit', 'approved_settlement_vendor_deduction',
    'draft_payout_vendor_credit', 'draft_payout_vendor_deduction',
    'review_payout_vendor_credit', 'review_payout_vendor_deduction'));

CREATE OR REPLACE FUNCTION "checkFinancialCorrectionEffectDirection"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE direction TEXT; route TEXT; authority_vendor_id TEXT; authority_currency TEXT;
DECLARE authority_difference_minor INTEGER; payout_id TEXT; payout_paid_at TIMESTAMP(3); approval_id TEXT;
BEGIN
  SELECT "economicDirection", "applicationRoute", "vendorId", "currency", "vendorPayableDifferenceMinor",
         "historicalPayoutBatchId", "historicalPayoutPaidAt", "historicalApprovedSettlementId"
  INTO direction, route, authority_vendor_id, authority_currency, authority_difference_minor,
       payout_id, payout_paid_at, approval_id
  FROM "FinancialCorrectionAuthority" WHERE "id" = NEW."authorityId";
  IF direction IS DISTINCT FROM 'VENDOR_CREDIT' OR
     NOT ((route = 'PAID_VENDOR_CREDIT' AND payout_id IS NOT NULL AND payout_paid_at IS NOT NULL AND approval_id IS NULL) OR
          (route = 'BEFORE_SETTLEMENT_VENDOR_CREDIT' AND payout_id IS NULL AND payout_paid_at IS NULL AND approval_id IS NULL) OR
          (route = 'APPROVED_SETTLEMENT_VENDOR_CREDIT' AND payout_id IS NULL AND payout_paid_at IS NULL AND approval_id IS NOT NULL) OR
          (route IN ('DRAFT_PAYOUT_VENDOR_CREDIT', 'REVIEW_PAYOUT_VENDOR_CREDIT') AND payout_id IS NOT NULL AND payout_paid_at IS NULL AND approval_id IS NOT NULL)) OR
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

CREATE OR REPLACE FUNCTION "checkFinancialCorrectionDeductionDirection"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE authority_route TEXT; authority_direction TEXT; authority_vendor TEXT;
DECLARE authority_currency TEXT; authority_delta INTEGER;
BEGIN
  SELECT "applicationRoute", "economicDirection", "vendorId", "currency", "vendorPayableDifferenceMinor"
    INTO authority_route, authority_direction, authority_vendor, authority_currency, authority_delta
    FROM "FinancialCorrectionAuthority" WHERE "id" = NEW."authorityId";
  IF authority_route NOT IN ('BEFORE_SETTLEMENT_VENDOR_DEDUCTION', 'APPROVED_SETTLEMENT_VENDOR_DEDUCTION', 'DRAFT_PAYOUT_VENDOR_DEDUCTION', 'REVIEW_PAYOUT_VENDOR_DEDUCTION') OR
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

CREATE OR REPLACE FUNCTION "checkApprovedDeductionCoverage"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_vendor TEXT; source_currency TEXT; source_amount INTEGER;
DECLARE source_route TEXT; source_approval TEXT; approval_vendor TEXT; approval_currency TEXT;
BEGIN
  SELECT d."vendorId", d."currency", d."amountMinor", a."applicationRoute", a."historicalApprovedSettlementId"
    INTO source_vendor, source_currency, source_amount, source_route, source_approval
    FROM "FinancialCorrectionDeduction" d JOIN "FinancialCorrectionAuthority" a ON a."id" = d."authorityId"
    WHERE d."id" = NEW."deductionId";
  SELECT "vendorId", "currency" INTO approval_vendor, approval_currency
    FROM "SettlementApproval" WHERE "id" = NEW."settlementApprovalId";
  IF source_route NOT IN ('APPROVED_SETTLEMENT_VENDOR_DEDUCTION', 'DRAFT_PAYOUT_VENDOR_DEDUCTION', 'REVIEW_PAYOUT_VENDOR_DEDUCTION') OR
     source_approval IS DISTINCT FROM NEW."settlementApprovalId" OR
     source_vendor IS DISTINCT FROM NEW."vendorId" OR source_currency IS DISTINCT FROM NEW."currency" OR
     source_amount IS DISTINCT FROM NEW."amountMinor" OR
     approval_vendor IS DISTINCT FROM NEW."vendorId" OR approval_currency IS DISTINCT FROM NEW."currency" THEN
    RAISE EXCEPTION 'Approved deduction coverage must match its source and origin approval';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE "FinancialCorrectionAuthority" ADD CONSTRAINT "FinancialCorrectionAuthority_review_attestation_check" CHECK (
  ("applicationRoute" IN ('REVIEW_PAYOUT_VENDOR_CREDIT', 'REVIEW_PAYOUT_VENDOR_DEDUCTION')) OR
  ("historicalReviewPayoutGrossMinor" IS NULL AND "historicalReviewPayoutNetMinor" IS NULL AND
   "historicalReviewPayoutDebtOffsetMinor" IS NULL AND "historicalReviewPayoutSourceFingerprint" IS NULL AND
   "historicalReviewPayoutCancelledAt" IS NULL AND "reviewEftNotSentConfirmedAt" IS NULL AND
   "reviewEftNotSentConfirmationVersion" IS NULL AND "reviewPayoutObservedStatus" IS NULL)
);
