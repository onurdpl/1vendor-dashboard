ALTER TABLE "SopyoShipmentIntent"
  ADD COLUMN "submissionStartedAt" TIMESTAMP(3),
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "shopifyFulfillmentId" TEXT;

CREATE UNIQUE INDEX "SopyoShipmentIntent_shopifyFulfillmentId_key"
  ON "SopyoShipmentIntent"("shopifyFulfillmentId");

ALTER TABLE "SopyoShipmentIntent" DROP CONSTRAINT "SopyoShipmentIntent_conflict_check";
ALTER TABLE "SopyoShipmentIntent" ADD CONSTRAINT "SopyoShipmentIntent_conflict_check" CHECK (
  ("status" = 'CONFLICT' AND "conflictReasonCode" IN
    ('CARGO_MISMATCH', 'SHOPIFY_PLAN_UNSAFE', 'SHOPIFY_PLAN_CHANGED', 'SHOPIFY_READ_INCOMPLETE',
     'SHOPIFY_CREATE_REJECTED', 'SHOPIFY_RECONCILIATION_AMBIGUOUS')
    AND "conflictObservedAt" IS NOT NULL)
  OR ("status" <> 'CONFLICT' AND "conflictReasonCode" IS NULL AND "conflictObservedAt" IS NULL)
);
ALTER TABLE "SopyoShipmentIntent" ADD CONSTRAINT "SopyoShipmentIntent_submission_check" CHECK (
  (("status" = 'CONFIRMED' OR ("status" = 'CONFLICT' AND "conflictReasonCode" = 'CARGO_MISMATCH'))
    AND "shopifyFulfillmentId" IS NOT NULL
    AND "submissionStartedAt" IS NOT NULL AND "confirmedAt" IS NOT NULL)
  OR ("status" <> 'CONFIRMED' AND "shopifyFulfillmentId" IS NULL AND "confirmedAt" IS NULL)
);
