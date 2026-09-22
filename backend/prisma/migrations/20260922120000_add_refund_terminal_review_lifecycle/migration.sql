CREATE TYPE "RefundTerminalEvidenceResolutionOutcome" AS ENUM (
  'NO_CORRECTION_NEEDED',
  'CORRECTION_REQUIRED',
  'INSUFFICIENT_EVIDENCE'
);

ALTER TABLE "RefundTerminalEvidenceReview"
ADD COLUMN "resolutionOutcome" "RefundTerminalEvidenceResolutionOutcome";

ALTER TABLE "RefundTerminalEvidenceReviewEvent"
ADD COLUMN "resolutionOutcome" "RefundTerminalEvidenceResolutionOutcome";
