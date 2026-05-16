ALTER TABLE "ReturnRecord" ADD COLUMN "vendorReceivedAt" TIMESTAMP(3);
ALTER TABLE "ReturnRecord" ADD COLUMN "vendorReviewedAt" TIMESTAMP(3);
ALTER TABLE "ReturnRecord" ADD COLUMN "vendorDecision" TEXT;
ALTER TABLE "ReturnRecord" ADD COLUMN "vendorDecisionReason" TEXT;
