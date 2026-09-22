CREATE TYPE "LegacyRefundFinanceReviewStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED');
CREATE TYPE "LegacyRefundFinanceReviewEventType" AS ENUM ('DETECTED', 'ACKNOWLEDGED', 'RESOLVED', 'REOPENED');
CREATE TYPE "LegacyRefundFinanceResolutionOutcome" AS ENUM ('NO_CORRECTION_NEEDED', 'CORRECTION_REQUIRED', 'INSUFFICIENT_EVIDENCE');
CREATE TYPE "LegacyRefundFinanceAttribution" AS ENUM ('EXACT', 'AMBIGUOUS');
CREATE TYPE "LegacyRefundFinanceArtifactType" AS ENUM ('REFUND_LEDGER', 'SETTLEMENT_REFUND_ADJUSTMENT', 'VENDOR_DEBT_EVENT', 'FINANCE_EVENT');

CREATE TABLE "LegacyRefundFinanceReview" (
  "id" TEXT NOT NULL,
  "caseKey" TEXT NOT NULL,
  "status" "LegacyRefundFinanceReviewStatus" NOT NULL DEFAULT 'ACTIVE',
  "resolutionOutcome" "LegacyRefundFinanceResolutionOutcome",
  "attribution" "LegacyRefundFinanceAttribution" NOT NULL,
  "sourceShopifyRefundId" TEXT,
  "sourceShopifyOrderId" TEXT,
  "vendorAllocationId" TEXT,
  "observedVendorId" TEXT,
  "firstObservedAt" TIMESTAMP(3) NOT NULL,
  "lastObservedAt" TIMESTAMP(3) NOT NULL,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "projectionFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LegacyRefundFinanceReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegacyRefundFinanceReviewSource" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "artifactType" "LegacyRefundFinanceArtifactType" NOT NULL,
  "artifactId" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "sourceState" TEXT,
  "recordedAmount" DECIMAL(10,2),
  "recordedAmountMinor" INTEGER,
  "currency" TEXT,
  "voidedAt" TIMESTAMP(3),
  "supersededByLedgerId" TEXT,
  "sourceFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LegacyRefundFinanceReviewSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegacyRefundFinanceReviewEvent" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "eventType" "LegacyRefundFinanceReviewEventType" NOT NULL,
  "actorUserId" TEXT,
  "note" TEXT,
  "resolutionOutcome" "LegacyRefundFinanceResolutionOutcome",
  "sourceContextJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacyRefundFinanceReviewEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegacyRefundFinanceReview_caseKey_key" ON "LegacyRefundFinanceReview"("caseKey");
CREATE INDEX "LegacyRefundFinanceReview_status_idx" ON "LegacyRefundFinanceReview"("status");
CREATE INDEX "LegacyRefundFinanceReview_resolutionOutcome_idx" ON "LegacyRefundFinanceReview"("resolutionOutcome");
CREATE INDEX "LegacyRefundFinanceReview_attribution_idx" ON "LegacyRefundFinanceReview"("attribution");
CREATE INDEX "LegacyRefundFinanceReview_observedVendorId_idx" ON "LegacyRefundFinanceReview"("observedVendorId");
CREATE INDEX "LegacyRefundFinanceReview_vendorAllocationId_idx" ON "LegacyRefundFinanceReview"("vendorAllocationId");
CREATE INDEX "LegacyRefundFinanceReview_lastObservedAt_idx" ON "LegacyRefundFinanceReview"("lastObservedAt");
CREATE UNIQUE INDEX "LegacyRefundFinanceReviewSource_artifactType_artifactId_key" ON "LegacyRefundFinanceReviewSource"("artifactType", "artifactId");
CREATE INDEX "LegacyRefundFinanceReviewSource_reviewId_observedAt_idx" ON "LegacyRefundFinanceReviewSource"("reviewId", "observedAt");
CREATE INDEX "LegacyRefundFinanceReviewEvent_reviewId_createdAt_idx" ON "LegacyRefundFinanceReviewEvent"("reviewId", "createdAt");
CREATE INDEX "LegacyRefundFinanceReviewEvent_eventType_createdAt_idx" ON "LegacyRefundFinanceReviewEvent"("eventType", "createdAt");

ALTER TABLE "LegacyRefundFinanceReview" ADD CONSTRAINT "LegacyRefundFinanceReview_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LegacyRefundFinanceReview" ADD CONSTRAINT "LegacyRefundFinanceReview_observedVendorId_fkey" FOREIGN KEY ("observedVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LegacyRefundFinanceReviewSource" ADD CONSTRAINT "LegacyRefundFinanceReviewSource_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "LegacyRefundFinanceReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegacyRefundFinanceReviewEvent" ADD CONSTRAINT "LegacyRefundFinanceReviewEvent_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "LegacyRefundFinanceReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegacyRefundFinanceReviewEvent" ADD CONSTRAINT "LegacyRefundFinanceReviewEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
