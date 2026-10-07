CREATE TYPE "SopyoDeliveredSyncStatus" AS ENUM (
  'SUBMISSION_PENDING', 'CONFIRMED', 'REJECTED', 'OUTCOME_UNKNOWN'
);

ALTER TABLE "SopyoShipmentIntent"
  ADD COLUMN "deliveredSyncStatus" "SopyoDeliveredSyncStatus",
  ADD COLUMN "deliveredSubmissionStartedAt" TIMESTAMP(3),
  ADD COLUMN "deliveredConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "deliveredRejectedAt" TIMESTAMP(3),
  ADD COLUMN "deliveredRejectReasonCode" TEXT;

CREATE INDEX "SopyoShipmentIntent_deliveredSyncStatus_createdAt_idx"
  ON "SopyoShipmentIntent"("deliveredSyncStatus", "createdAt");

ALTER TABLE "SopyoShipmentIntent"
  ADD CONSTRAINT "SopyoShipmentIntent_delivered_sync_check" CHECK (
    ("deliveredSyncStatus" IS NULL AND "deliveredSubmissionStartedAt" IS NULL
      AND "deliveredConfirmedAt" IS NULL AND "deliveredRejectedAt" IS NULL
      AND "deliveredRejectReasonCode" IS NULL)
    OR ("deliveredSyncStatus" = 'SUBMISSION_PENDING'
      AND "deliveredSubmissionStartedAt" IS NOT NULL AND "deliveredConfirmedAt" IS NULL
      AND "deliveredRejectedAt" IS NULL AND "deliveredRejectReasonCode" IS NULL)
    OR ("deliveredSyncStatus" = 'OUTCOME_UNKNOWN'
      AND "deliveredSubmissionStartedAt" IS NOT NULL AND "deliveredConfirmedAt" IS NULL
      AND "deliveredRejectedAt" IS NULL AND "deliveredRejectReasonCode" IS NULL)
    OR ("deliveredSyncStatus" = 'CONFIRMED' AND "deliveredConfirmedAt" IS NOT NULL
      AND "deliveredRejectedAt" IS NULL AND "deliveredRejectReasonCode" IS NULL)
    OR ("deliveredSyncStatus" = 'REJECTED'
      AND "deliveredSubmissionStartedAt" IS NOT NULL AND "deliveredConfirmedAt" IS NULL
      AND "deliveredRejectedAt" IS NOT NULL
      AND "deliveredRejectReasonCode" = 'SHOPIFY_USER_ERROR')
  );
