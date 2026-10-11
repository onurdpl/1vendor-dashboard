-- Phase 1 records exact future payout-offset authority; no existing money is changed.
CREATE TYPE "PayoutOffsetSourceType" AS ENUM ('REFUND_ADJUSTMENT', 'VENDOR_DEBT');
CREATE TYPE "PayoutOffsetClaimStatus" AS ENUM ('RESERVED', 'FINALIZED', 'RELEASED');
CREATE TYPE "PayoutOffsetClaimEventType" AS ENUM ('RESERVED', 'FINALIZED', 'RELEASED');

CREATE UNIQUE INDEX "SettlementApproval_id_vendorId_currency_key"
  ON "SettlementApproval"("id", "vendorId", "currency");
CREATE UNIQUE INDEX "SettlementRefundAdjustment_id_vendorId_currencyCode_key"
  ON "SettlementRefundAdjustment"("id", "vendorId", "currencyCode");
CREATE UNIQUE INDEX "PayoutBatch_id_vendorId_currency_key"
  ON "PayoutBatch"("id", "vendorId", "currency");
CREATE UNIQUE INDEX "VendorBalanceEvent_id_vendorId_currency_type_key"
  ON "VendorBalanceEvent"("id", "vendorId", "currency", "type");

CREATE TABLE "PayoutOffsetClaim" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "payoutBatchId" TEXT NOT NULL,
  "settlementApprovalId" TEXT NOT NULL,
  "sourceType" "PayoutOffsetSourceType" NOT NULL,
  "settlementRefundAdjustmentId" TEXT,
  "vendorDebtOriginEventId" TEXT,
  "vendorDebtOriginEventType" "VendorBalanceEventType",
  "reservedAmountMinor" INTEGER NOT NULL,
  "status" "PayoutOffsetClaimStatus" NOT NULL DEFAULT 'RESERVED',
  "idempotencyKey" TEXT NOT NULL,
  "reservedBy" TEXT NOT NULL,
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizedBy" TEXT,
  "finalizedAt" TIMESTAMP(3),
  "releasedBy" TEXT,
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "PayoutOffsetClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayoutOffsetClaim_positive_amount_check" CHECK ("reservedAmountMinor" > 0),
  CONSTRAINT "PayoutOffsetClaim_identity_check" CHECK (
    BTRIM("currency") <> '' AND BTRIM("idempotencyKey") <> '' AND BTRIM("reservedBy") <> '' AND
    (("sourceType" = 'REFUND_ADJUSTMENT' AND "settlementRefundAdjustmentId" IS NOT NULL AND
      "vendorDebtOriginEventId" IS NULL AND "vendorDebtOriginEventType" IS NULL) OR
     ("sourceType" = 'VENDOR_DEBT' AND "settlementRefundAdjustmentId" IS NULL AND
      "vendorDebtOriginEventId" IS NOT NULL AND "vendorDebtOriginEventType" = 'VENDOR_DEBT_CREATED'))
  ),
  CONSTRAINT "PayoutOffsetClaim_lifecycle_check" CHECK (
    ("status" = 'RESERVED' AND "finalizedBy" IS NULL AND "finalizedAt" IS NULL AND "releasedBy" IS NULL AND "releasedAt" IS NULL) OR
    ("status" = 'FINALIZED' AND "finalizedBy" IS NOT NULL AND BTRIM("finalizedBy") <> '' AND "finalizedAt" IS NOT NULL AND "releasedBy" IS NULL AND "releasedAt" IS NULL) OR
    ("status" = 'RELEASED' AND "releasedBy" IS NOT NULL AND BTRIM("releasedBy") <> '' AND "releasedAt" IS NOT NULL AND "finalizedBy" IS NULL AND "finalizedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "PayoutOffsetClaim_idempotencyKey_key" ON "PayoutOffsetClaim"("idempotencyKey");
CREATE UNIQUE INDEX "PayoutOffsetClaim_payoutBatchId_settlementApprovalId_settlementRefundAdjustmentId_key"
  ON "PayoutOffsetClaim"("payoutBatchId", "settlementApprovalId", "settlementRefundAdjustmentId");
CREATE UNIQUE INDEX "PayoutOffsetClaim_payoutBatchId_settlementApprovalId_vendorDebtOriginEventId_key"
  ON "PayoutOffsetClaim"("payoutBatchId", "settlementApprovalId", "vendorDebtOriginEventId");
CREATE INDEX "PayoutOffsetClaim_vendorId_currency_status_idx" ON "PayoutOffsetClaim"("vendorId", "currency", "status");
CREATE INDEX "PayoutOffsetClaim_settlementRefundAdjustmentId_status_idx" ON "PayoutOffsetClaim"("settlementRefundAdjustmentId", "status");
CREATE INDEX "PayoutOffsetClaim_vendorDebtOriginEventId_status_idx" ON "PayoutOffsetClaim"("vendorDebtOriginEventId", "status");

ALTER TABLE "PayoutOffsetClaim" ADD CONSTRAINT "PayoutOffsetClaim_payoutBatch_fkey"
  FOREIGN KEY ("payoutBatchId", "vendorId", "currency") REFERENCES "PayoutBatch"("id", "vendorId", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayoutOffsetClaim" ADD CONSTRAINT "PayoutOffsetClaim_settlementApproval_fkey"
  FOREIGN KEY ("settlementApprovalId", "vendorId", "currency") REFERENCES "SettlementApproval"("id", "vendorId", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayoutOffsetClaim" ADD CONSTRAINT "PayoutOffsetClaim_settlementRefundAdjustment_fkey"
  FOREIGN KEY ("settlementRefundAdjustmentId", "vendorId", "currency") REFERENCES "SettlementRefundAdjustment"("id", "vendorId", "currencyCode") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayoutOffsetClaim" ADD CONSTRAINT "PayoutOffsetClaim_vendorDebtOriginEvent_fkey"
  FOREIGN KEY ("vendorDebtOriginEventId", "vendorId", "currency", "vendorDebtOriginEventType") REFERENCES "VendorBalanceEvent"("id", "vendorId", "currency", "type") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PayoutOffsetClaimEvent" (
  "id" TEXT NOT NULL,
  "payoutOffsetClaimId" TEXT NOT NULL,
  "eventType" "PayoutOffsetClaimEventType" NOT NULL,
  "actorId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evidenceJson" JSONB,
  CONSTRAINT "PayoutOffsetClaimEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayoutOffsetClaimEvent_actor_check" CHECK (BTRIM("actorId") <> '')
);
CREATE INDEX "PayoutOffsetClaimEvent_payoutOffsetClaimId_occurredAt_idx"
  ON "PayoutOffsetClaimEvent"("payoutOffsetClaimId", "occurredAt");
ALTER TABLE "PayoutOffsetClaimEvent" ADD CONSTRAINT "PayoutOffsetClaimEvent_payoutOffsetClaim_fkey"
  FOREIGN KEY ("payoutOffsetClaimId") REFERENCES "PayoutOffsetClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "payout_offset_claim_audit_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payout offset claim history cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (OLD."id", OLD."vendorId", OLD."currency", OLD."payoutBatchId", OLD."settlementApprovalId",
        OLD."sourceType", OLD."settlementRefundAdjustmentId", OLD."vendorDebtOriginEventId",
        OLD."vendorDebtOriginEventType", OLD."reservedAmountMinor", OLD."idempotencyKey", OLD."reservedBy", OLD."reservedAt")
       IS DISTINCT FROM
       (NEW."id", NEW."vendorId", NEW."currency", NEW."payoutBatchId", NEW."settlementApprovalId",
        NEW."sourceType", NEW."settlementRefundAdjustmentId", NEW."vendorDebtOriginEventId",
        NEW."vendorDebtOriginEventType", NEW."reservedAmountMinor", NEW."idempotencyKey", NEW."reservedBy", NEW."reservedAt") THEN
      RAISE EXCEPTION 'Payout offset claim identity and reserved amount are immutable';
    END IF;
    IF OLD."status" <> 'RESERVED' OR NEW."status" = OLD."status" THEN
      RAISE EXCEPTION 'Payout offset claim has no valid lifecycle transition';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PayoutOffsetClaim_audit_guard"
  BEFORE UPDATE OR DELETE ON "PayoutOffsetClaim"
  FOR EACH ROW EXECUTE FUNCTION "payout_offset_claim_audit_guard"();

CREATE FUNCTION "payout_offset_claim_append_event"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "PayoutOffsetClaimEvent"("id", "payoutOffsetClaimId", "eventType", "actorId", "occurredAt")
  VALUES (md5(NEW."id" || NEW."status"::text || clock_timestamp()::text), NEW."id",
    NEW."status"::text::"PayoutOffsetClaimEventType",
    CASE NEW."status" WHEN 'RESERVED' THEN NEW."reservedBy" WHEN 'FINALIZED' THEN NEW."finalizedBy" ELSE NEW."releasedBy" END,
    CASE NEW."status" WHEN 'RESERVED' THEN NEW."reservedAt" WHEN 'FINALIZED' THEN NEW."finalizedAt" ELSE NEW."releasedAt" END);
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PayoutOffsetClaim_append_event"
  AFTER INSERT OR UPDATE ON "PayoutOffsetClaim"
  FOR EACH ROW EXECUTE FUNCTION "payout_offset_claim_append_event"();

CREATE FUNCTION "payout_offset_claim_event_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Payout offset claim audit events are immutable';
END;
$$;
CREATE TRIGGER "PayoutOffsetClaimEvent_immutable"
  BEFORE UPDATE OR DELETE ON "PayoutOffsetClaimEvent"
  FOR EACH ROW EXECUTE FUNCTION "payout_offset_claim_event_immutable"();
