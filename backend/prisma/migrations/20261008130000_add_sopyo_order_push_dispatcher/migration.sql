ALTER TYPE "SopyoOrderPushStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "SopyoOrderPushStatus" ADD VALUE 'SUCCEEDED';
ALTER TYPE "SopyoOrderPushStatus" ADD VALUE 'BLOCKED';
ALTER TYPE "SopyoOrderPushStatus" ADD VALUE 'RECONCILE_REQUIRED';

ALTER TABLE "SopyoOrderPush"
  ADD COLUMN "claimToken" TEXT,
  ADD COLUMN "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "sopyoOrderId" TEXT,
  ADD COLUMN "reasonCode" TEXT,
  ADD COLUMN "httpStatus" INTEGER;
