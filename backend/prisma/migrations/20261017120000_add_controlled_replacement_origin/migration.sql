-- Existing rows retain their original provenance; no historical backfill.
ALTER TYPE "SettlementDraftCreationOrigin" ADD VALUE 'CONTROLLED_REPLACEMENT';

-- Only a separately linked, audited replacement can carry this origin.
-- The existing origin-immutability trigger also protects the new enum value.
ALTER TABLE "SettlementApproval"
  ADD CONSTRAINT "SettlementApproval_controlled_replacement_origin_check"
  CHECK (
    "creationOrigin"::text IS DISTINCT FROM 'CONTROLLED_REPLACEMENT'
    OR (
      "replacesSettlementApprovalId" IS NOT NULL
      AND "replacementRequestId" IS NOT NULL
      AND "replacementRequestedBy" IS NOT NULL
      AND "replacementReason" IS NOT NULL
      AND "replacementRequestedAt" IS NOT NULL
      AND "scheduledRunDate" IS NULL
      AND "scheduledPeriodEnd" IS NULL
      AND "scheduledCycleKey" IS NULL
      AND "periodStart" IS NULL
      AND "periodEnd" IS NOT NULL
      AND "sourceSnapshotJson" ? 'lateRefundLedgerIds'
    )
  );
