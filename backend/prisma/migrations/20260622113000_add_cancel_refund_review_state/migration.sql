ALTER TABLE "VendorAllocation"
ADD COLUMN "cancelRefundReviewStatus" TEXT,
ADD COLUMN "cancelRefundReviewReason" TEXT,
ADD COLUMN "cancelRefundReviewNote" TEXT,
ADD COLUMN "cancelRefundReviewRequestedAt" TIMESTAMP(3),
ADD COLUMN "cancelRefundReviewRequestedByUserId" TEXT;

CREATE INDEX "VendorAllocation_cancelRefundReviewStatus_idx" ON "VendorAllocation"("cancelRefundReviewStatus");
