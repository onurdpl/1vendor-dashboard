CREATE TYPE "SettlementAutoApprovalAttemptOutcome" AS ENUM (
  'STARTED', 'APPROVED', 'BLOCKED', 'TECHNICAL_FAILURE', 'UNKNOWN'
);

CREATE TABLE "SettlementAutoApprovalAttempt" (
  "id" TEXT NOT NULL,
  "settlementApprovalId" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL DEFAULT 'system:settlement_auto_approval',
  "outcome" "SettlementAutoApprovalAttemptOutcome" NOT NULL DEFAULT 'STARTED',
  "reasonCode" TEXT,
  "reasonDetail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "SettlementAutoApprovalAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementAutoApprovalAttempt_actor_check"
    CHECK ("actorId" = 'system:settlement_auto_approval'),
  CONSTRAINT "SettlementAutoApprovalAttempt_completion_check"
    CHECK (("outcome" IN ('STARTED', 'UNKNOWN') AND "completedAt" IS NULL)
        OR ("outcome" IN ('APPROVED', 'BLOCKED', 'TECHNICAL_FAILURE') AND "completedAt" IS NOT NULL))
);

CREATE TABLE "SettlementAutoApprovalAttemptEvent" (
  "id" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "outcome" "SettlementAutoApprovalAttemptOutcome" NOT NULL,
  "reasonCode" TEXT,
  "reasonDetail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementAutoApprovalAttemptEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SettlementApproval" ADD COLUMN "successfulAutoApprovalAttemptId" TEXT;

CREATE UNIQUE INDEX "SettlementAutoApprovalAttempt_id_settlementApprovalId_vendorId_key"
  ON "SettlementAutoApprovalAttempt"("id", "settlementApprovalId", "vendorId");
CREATE INDEX "SettlementAutoApprovalAttempt_settlementApprovalId_createdAt_idx"
  ON "SettlementAutoApprovalAttempt"("settlementApprovalId", "createdAt");
CREATE INDEX "SettlementAutoApprovalAttempt_vendorId_outcome_createdAt_idx"
  ON "SettlementAutoApprovalAttempt"("vendorId", "outcome", "createdAt");
CREATE INDEX "SettlementAutoApprovalAttemptEvent_attemptId_createdAt_idx"
  ON "SettlementAutoApprovalAttemptEvent"("attemptId", "createdAt");
CREATE UNIQUE INDEX "SettlementApproval_successfulAutoApprovalAttemptId_key"
  ON "SettlementApproval"("successfulAutoApprovalAttemptId");
CREATE UNIQUE INDEX "SettlementApproval_successfulAutoApprovalAttemptId_id_vendorId_key"
  ON "SettlementApproval"("successfulAutoApprovalAttemptId", "id", "vendorId");
CREATE UNIQUE INDEX "SettlementAutoApprovalAttempt_one_success_per_settlement_key"
  ON "SettlementAutoApprovalAttempt"("settlementApprovalId") WHERE "outcome" = 'APPROVED';

ALTER TABLE "SettlementAutoApprovalAttempt"
  ADD CONSTRAINT "SettlementAutoApprovalAttempt_settlementApprovalId_vendorId_fkey"
  FOREIGN KEY ("settlementApprovalId", "vendorId") REFERENCES "SettlementApproval"("id", "vendorId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementAutoApprovalAttemptEvent"
  ADD CONSTRAINT "SettlementAutoApprovalAttemptEvent_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "SettlementAutoApprovalAttempt"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementApproval"
  ADD CONSTRAINT "SettlementApproval_successfulAutoApprovalAttemptId_id_vendorId_fkey"
  FOREIGN KEY ("successfulAutoApprovalAttemptId", "id", "vendorId")
  REFERENCES "SettlementAutoApprovalAttempt"("id", "settlementApprovalId", "vendorId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION settlement_auto_approval_attempt_guard() RETURNS trigger AS $$
DECLARE linked RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Automatic approval attempt history cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."id", NEW."settlementApprovalId", NEW."vendorId", NEW."actorId", NEW."createdAt")
      IS DISTINCT FROM (OLD."id", OLD."settlementApprovalId", OLD."vendorId", OLD."actorId", OLD."createdAt") THEN
    RAISE EXCEPTION 'Automatic approval attempt identity is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."outcome" = 'APPROVED' AND NEW."outcome" <> 'APPROVED' THEN
    RAISE EXCEPTION 'Successful automatic approval evidence is immutable';
  END IF;
  IF NEW."outcome" = 'APPROVED' THEN
    SELECT "status", "approvedBy", "approvedAt", "successfulAutoApprovalAttemptId"
      INTO linked FROM "SettlementApproval" WHERE "id" = NEW."settlementApprovalId";
    IF linked."status" <> 'APPROVED' OR linked."approvedBy" <> 'system:settlement_auto_approval'
       OR linked."approvedAt" IS NULL OR linked."successfulAutoApprovalAttemptId" IS DISTINCT FROM NEW."id" THEN
      RAISE EXCEPTION 'Successful attempt requires its exact committed system approval';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER settlement_auto_approval_attempt_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON "SettlementAutoApprovalAttempt"
  FOR EACH ROW EXECUTE FUNCTION settlement_auto_approval_attempt_guard();

CREATE FUNCTION settlement_auto_approval_link_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."successfulAutoApprovalAttemptId" IS NOT NULL AND
     NEW."successfulAutoApprovalAttemptId" IS DISTINCT FROM OLD."successfulAutoApprovalAttemptId" THEN
    RAISE EXCEPTION 'Successful automatic approval link is immutable';
  END IF;
  IF NEW."successfulAutoApprovalAttemptId" IS NOT NULL AND
     (NEW."approvedBy" IS DISTINCT FROM 'system:settlement_auto_approval' OR NEW."approvedAt" IS NULL OR
      NEW."status" NOT IN ('APPROVED', 'CANCELLED')) THEN
    RAISE EXCEPTION 'Automatic approval link requires system approval authority';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER settlement_auto_approval_link_guard_trigger
  BEFORE UPDATE ON "SettlementApproval"
  FOR EACH ROW EXECUTE FUNCTION settlement_auto_approval_link_guard();

CREATE FUNCTION settlement_auto_approval_attempt_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Automatic approval attempt events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER settlement_auto_approval_attempt_event_immutable_trigger
  BEFORE UPDATE OR DELETE ON "SettlementAutoApprovalAttemptEvent"
  FOR EACH ROW EXECUTE FUNCTION settlement_auto_approval_attempt_event_immutable();
