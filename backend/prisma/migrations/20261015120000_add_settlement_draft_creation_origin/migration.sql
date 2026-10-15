CREATE TYPE "SettlementDraftCreationOrigin" AS ENUM (
  'AUTONOMOUS_SCHEDULER',
  'ADMIN_SCHEDULED',
  'ADMIN_MANUAL'
);

ALTER TABLE "SettlementApproval"
  ADD COLUMN "creationOrigin" "SettlementDraftCreationOrigin";

-- A scheduler claim must be attached to a complete scheduled-cycle row at INSERT.
-- The application additionally verifies the exact UTC cycle key and cutoff.
ALTER TABLE "SettlementApproval"
  ADD CONSTRAINT "SettlementApproval_autonomous_origin_schedule_check"
  CHECK (
    "creationOrigin" IS DISTINCT FROM 'AUTONOMOUS_SCHEDULER'::"SettlementDraftCreationOrigin"
    OR (
      "scheduledRunDate" IS NOT NULL
      AND "scheduledPeriodEnd" IS NOT NULL
      AND "scheduledCycleKey" IS NOT NULL
      AND "periodEnd" IS NOT NULL
    )
  );

CREATE FUNCTION "protectSettlementDraftCreationOrigin"()
RETURNS trigger AS $$
BEGIN
  IF NEW."creationOrigin" IS DISTINCT FROM OLD."creationOrigin" THEN
    RAISE EXCEPTION 'Settlement DRAFT creation origin is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SettlementApproval_creationOrigin_immutable"
BEFORE UPDATE ON "SettlementApproval"
FOR EACH ROW EXECUTE FUNCTION "protectSettlementDraftCreationOrigin"();
