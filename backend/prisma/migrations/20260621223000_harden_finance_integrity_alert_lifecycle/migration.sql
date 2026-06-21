-- R5.1 finance integrity alert lifecycle hardening.
-- Nullable-first audit/readiness fields only; existing alerts remain unchanged.
ALTER TABLE "FinanceIntegrityAlert"
ADD COLUMN "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN "acknowledgedByUserId" TEXT,
ADD COLUMN "acknowledgmentNote" TEXT,
ADD COLUMN "resolutionValidationJson" JSONB,
ADD COLUMN "resolutionType" TEXT;

ALTER TABLE "FinanceIntegrityAlert"
ADD CONSTRAINT "FinanceIntegrityAlert_acknowledgedByUserId_fkey"
FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
