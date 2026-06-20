-- Phase 4C.1: scheduled settlement cycle identity.
-- Scheduled approvals created after this migration receive a deterministic vendor/runDate key.
-- Historical scheduled approvals are not backfilled because their exact run date is not reliably stored.
ALTER TABLE "SettlementApproval"
ADD COLUMN "scheduledRunDate" TIMESTAMP(3),
ADD COLUMN "scheduledPeriodEnd" TIMESTAMP(3),
ADD COLUMN "scheduledCycleKey" TEXT;

CREATE UNIQUE INDEX "SettlementApproval_scheduledCycleKey_key" ON "SettlementApproval"("scheduledCycleKey");
CREATE INDEX "SettlementApproval_vendorId_scheduledCycleKey_idx" ON "SettlementApproval"("vendorId", "scheduledCycleKey");
