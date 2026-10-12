ALTER TABLE "PayoutBatch"
  ADD COLUMN "eftExecutedAt" TIMESTAMP(3),
  ADD COLUMN "eftDeclaredAt" TEXT,
  ADD COLUMN "eftAttestedAt" TIMESTAMP(3),
  ADD COLUMN "eftAttestedByUserId" TEXT;

ALTER TABLE "PayoutBatch" ADD CONSTRAINT "PayoutBatch_eft_attestation_complete_check"
  CHECK (
    ("eftExecutedAt" IS NULL AND "eftDeclaredAt" IS NULL AND
     "eftAttestedAt" IS NULL AND "eftAttestedByUserId" IS NULL)
    OR
    ("eftExecutedAt" IS NOT NULL AND "eftDeclaredAt" IS NOT NULL AND
     "eftAttestedAt" IS NOT NULL AND "eftAttestedByUserId" IS NOT NULL AND
     "eftExecutedAt" <= "eftAttestedAt" AND "status" = 'PAID')
  );

CREATE FUNCTION "protectPayoutEftAttestation"() RETURNS trigger AS $$
BEGIN
  IF OLD."eftAttestedAt" IS NOT NULL AND
     (NEW."eftExecutedAt" IS DISTINCT FROM OLD."eftExecutedAt" OR
      NEW."eftDeclaredAt" IS DISTINCT FROM OLD."eftDeclaredAt" OR
      NEW."eftAttestedAt" IS DISTINCT FROM OLD."eftAttestedAt" OR
      NEW."eftAttestedByUserId" IS DISTINCT FROM OLD."eftAttestedByUserId") THEN
    RAISE EXCEPTION 'Payout EFT attestation is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PayoutBatch_eft_attestation_immutable"
  BEFORE UPDATE ON "PayoutBatch"
  FOR EACH ROW EXECUTE FUNCTION "protectPayoutEftAttestation"();
