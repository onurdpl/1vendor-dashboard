ALTER TABLE "FinancialCorrectionAuthority" DROP CONSTRAINT "FinancialCorrectionAuthority_route_check";
ALTER TABLE "FinancialCorrectionAuthority" ADD CONSTRAINT "FinancialCorrectionAuthority_route_check" CHECK (
  "currency" = 'TRY' AND length(trim("reason")) BETWEEN 1 AND 500 AND
  (("economicDirection" = 'VENDOR_DEDUCTION' AND "vendorPayableDifferenceMinor" > 0 AND "applicationRoute" = 'PAID_VENDOR_DEBT') OR
   ("economicDirection" = 'VENDOR_CREDIT' AND "vendorPayableDifferenceMinor" < 0 AND "applicationRoute" = 'PAID_VENDOR_CREDIT'))
);

ALTER TABLE "FinancialCorrectionBaselineClaim" DROP CONSTRAINT "FinancialCorrectionBaselineClaim_type_check";
ALTER TABLE "FinancialCorrectionBaselineClaim" ADD CONSTRAINT "FinancialCorrectionBaselineClaim_type_check" CHECK
  ("consumerType" IN ('zero_net_acknowledgement', 'paid_vendor_debt', 'paid_vendor_credit'));

ALTER TABLE "SettlementApproval" ADD COLUMN "correctionCreditMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PayoutBatch" ADD COLUMN "correctionCreditAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

CREATE TABLE "FinancialCorrectionCredit" (
  "id" TEXT NOT NULL,
  "authorityId" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'TRY',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialCorrectionCredit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialCorrectionCredit_amount_check" CHECK ("amountMinor" > 0 AND "currency" = 'TRY')
);
CREATE UNIQUE INDEX "FinancialCorrectionCredit_authorityId_key" ON "FinancialCorrectionCredit"("authorityId");
CREATE INDEX "FinancialCorrectionCredit_vendorId_currency_createdAt_idx" ON "FinancialCorrectionCredit"("vendorId", "currency", "createdAt");
ALTER TABLE "FinancialCorrectionCredit" ADD CONSTRAINT "FinancialCorrectionCredit_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "FinancialCorrectionAuthority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionCredit" ADD CONSTRAINT "FinancialCorrectionCredit_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FinancialCorrectionCreditSettlementLine" (
  "id" TEXT NOT NULL,
  "creditId" TEXT NOT NULL,
  "settlementApprovalId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "FinancialCorrectionCreditSettlementLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialCorrectionCreditSettlementLine_state_check" CHECK (
    "amountMinor" > 0 AND (("status" = 'ACTIVE' AND "cancelledAt" IS NULL) OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)))
);
CREATE UNIQUE INDEX "FinancialCorrectionCreditSettlementLine_creditId_settlement_key" ON "FinancialCorrectionCreditSettlementLine"("creditId", "settlementApprovalId");
CREATE UNIQUE INDEX "FinancialCorrectionCreditSettlementLine_active_credit_key" ON "FinancialCorrectionCreditSettlementLine"("creditId") WHERE "status" = 'ACTIVE';
CREATE INDEX "FinancialCorrectionCreditSettlementLine_settlementApprovalI_idx" ON "FinancialCorrectionCreditSettlementLine"("settlementApprovalId");
ALTER TABLE "FinancialCorrectionCreditSettlementLine" ADD CONSTRAINT "FinancialCorrectionCreditSettlementLine_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "FinancialCorrectionCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionCreditSettlementLine" ADD CONSTRAINT "FinancialCorrectionCreditSettlementLine_settlementApproval_fkey" FOREIGN KEY ("settlementApprovalId") REFERENCES "SettlementApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FinancialCorrectionCreditPayoutLine" (
  "id" TEXT NOT NULL,
  "settlementCreditLineId" TEXT NOT NULL,
  "payoutBatchId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  CONSTRAINT "FinancialCorrectionCreditPayoutLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancialCorrectionCreditPayoutLine_state_check" CHECK (
    "amountMinor" > 0 AND
    (("status" = 'ACTIVE' AND "cancelledAt" IS NULL AND "paidAt" IS NULL) OR
     ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "paidAt" IS NULL) OR
     ("status" = 'PAID' AND "cancelledAt" IS NULL AND "paidAt" IS NOT NULL)))
);
CREATE UNIQUE INDEX "FinancialCorrectionCreditPayoutLine_settlementCreditLineId__key" ON "FinancialCorrectionCreditPayoutLine"("settlementCreditLineId", "payoutBatchId");
CREATE UNIQUE INDEX "FinancialCorrectionCreditPayoutLine_non_cancelled_source_key" ON "FinancialCorrectionCreditPayoutLine"("settlementCreditLineId") WHERE "status" <> 'CANCELLED';
CREATE INDEX "FinancialCorrectionCreditPayoutLine_payoutBatchId_idx" ON "FinancialCorrectionCreditPayoutLine"("payoutBatchId");
ALTER TABLE "FinancialCorrectionCreditPayoutLine" ADD CONSTRAINT "FinancialCorrectionCreditPayoutLine_settlementCreditLineId_fkey" FOREIGN KEY ("settlementCreditLineId") REFERENCES "FinancialCorrectionCreditSettlementLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialCorrectionCreditPayoutLine" ADD CONSTRAINT "FinancialCorrectionCreditPayoutLine_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "checkFinancialCorrectionEffectDirection"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE direction TEXT;
DECLARE route TEXT;
DECLARE authority_vendor_id TEXT;
DECLARE authority_currency TEXT;
DECLARE authority_difference_minor INTEGER;
BEGIN
  SELECT "economicDirection", "applicationRoute", "vendorId", "currency", "vendorPayableDifferenceMinor"
  INTO direction, route, authority_vendor_id, authority_currency, authority_difference_minor
  FROM "FinancialCorrectionAuthority" WHERE "id" = NEW."authorityId";
  IF direction IS DISTINCT FROM 'VENDOR_CREDIT' OR route IS DISTINCT FROM 'PAID_VENDOR_CREDIT' OR
     authority_vendor_id IS DISTINCT FROM NEW."vendorId" OR authority_currency IS DISTINCT FROM NEW."currency" OR
     authority_difference_minor IS DISTINCT FROM -NEW."amountMinor" THEN
    RAISE EXCEPTION 'Financial correction credit requires VENDOR_CREDIT authority';
  END IF;
  IF EXISTS (SELECT 1 FROM "VendorBalanceEvent" WHERE "financialCorrectionAuthorityId" = NEW."authorityId") THEN
    RAISE EXCEPTION 'Financial correction cannot have both debt and credit effects';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FinancialCorrectionCredit_direction_guard" BEFORE INSERT OR UPDATE ON "FinancialCorrectionCredit"
  FOR EACH ROW EXECUTE FUNCTION "checkFinancialCorrectionEffectDirection"();

CREATE OR REPLACE FUNCTION "checkFinancialCorrectionDebtDirection"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE direction TEXT;
BEGIN
  IF NEW."financialCorrectionAuthorityId" IS NULL THEN RETURN NEW; END IF;
  SELECT "economicDirection" INTO direction FROM "FinancialCorrectionAuthority" WHERE "id" = NEW."financialCorrectionAuthorityId";
  IF direction <> 'VENDOR_DEDUCTION' OR direction IS NULL THEN
    RAISE EXCEPTION 'Financial correction debt requires VENDOR_DEDUCTION authority';
  END IF;
  IF EXISTS (SELECT 1 FROM "FinancialCorrectionCredit" WHERE "authorityId" = NEW."financialCorrectionAuthorityId") THEN
    RAISE EXCEPTION 'Financial correction cannot have both debt and credit effects';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "VendorBalanceEvent_correction_direction_guard" BEFORE INSERT OR UPDATE ON "VendorBalanceEvent"
  FOR EACH ROW EXECUTE FUNCTION "checkFinancialCorrectionDebtDirection"();
