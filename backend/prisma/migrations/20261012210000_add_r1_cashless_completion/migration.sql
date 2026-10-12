CREATE TABLE "PayoutR1CashlessCompletion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "payoutBatchId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "confirmedNoEft" BOOLEAN NOT NULL,
  "confirmedNetMinor" INTEGER NOT NULL,
  "finalizedOffsetMinor" INTEGER NOT NULL,
  "claimIdsJson" JSONB NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayoutR1CashlessCompletion_proof_check"
    CHECK ("confirmedNoEft" AND "confirmedNetMinor" = 0 AND
      "finalizedOffsetMinor" > 0 AND BTRIM("reason") <> ''),
  CONSTRAINT "PayoutR1CashlessCompletion_payoutBatch_fkey"
    FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayoutR1CashlessCompletion_actorUser_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PayoutR1CashlessCompletion_payoutBatchId_key"
  ON "PayoutR1CashlessCompletion"("payoutBatchId");
CREATE TRIGGER "PayoutR1CashlessCompletion_immutable"
  BEFORE UPDATE OR DELETE ON "PayoutR1CashlessCompletion"
  FOR EACH ROW EXECUTE FUNCTION "protectR1MissedRefundReconciliation"();

ALTER TABLE "PayoutBatch" ADD CONSTRAINT "PayoutBatch_r1_cashless_non_eft_check"
  CHECK ("status" <> 'CASHLESS_COMPLETED' OR
    ("netAmount" = 0 AND "r1OffsetTotalMinor" > 0 AND
     "paidAt" IS NULL AND "paidByUserId" IS NULL AND
     "eftExecutedAt" IS NULL AND "eftDeclaredAt" IS NULL AND
     "eftAttestedAt" IS NULL AND "eftAttestedByUserId" IS NULL AND
     "eftAmountMinor" IS NULL AND "paymentReference" IS NULL));

CREATE FUNCTION "protectR1CashlessPayout"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'CASHLESS_COMPLETED' THEN
    IF NEW."status" IS DISTINCT FROM OLD."status" OR
       NEW."netAmount" IS DISTINCT FROM OLD."netAmount" OR
       NEW."r1OffsetTotalMinor" IS DISTINCT FROM OLD."r1OffsetTotalMinor" OR
       NEW."paidAt" IS DISTINCT FROM OLD."paidAt" OR
       NEW."eftExecutedAt" IS DISTINCT FROM OLD."eftExecutedAt" THEN
      RAISE EXCEPTION 'Cashless R1 payout history is immutable';
    END IF;
  ELSIF NEW."status" = 'CASHLESS_COMPLETED' THEN
    IF OLD."status" <> 'REVIEW' OR NOT EXISTS (
      SELECT 1 FROM "PayoutR1CashlessCompletion" c
      WHERE c."payoutBatchId" = NEW."id" AND
        c."finalizedOffsetMinor" = NEW."r1OffsetTotalMinor"
    ) OR EXISTS (
      SELECT 1 FROM "PayoutOffsetClaim" c
      WHERE c."payoutBatchId" = NEW."id" AND c."status" <> 'FINALIZED'
    ) THEN
      RAISE EXCEPTION 'Cashless R1 payout requires reviewed, audited finalized claims';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PayoutBatch_r1_cashless_guard"
  BEFORE UPDATE ON "PayoutBatch"
  FOR EACH ROW EXECUTE FUNCTION "protectR1CashlessPayout"();
