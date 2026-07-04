-- AlterEnum
ALTER TYPE "PayoutBatchStatus" ADD VALUE 'PAID';

-- AlterEnum
ALTER TYPE "FinanceEventType" ADD VALUE 'PAYOUT_PAID';

-- AlterTable
ALTER TABLE "PayoutBatch"
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "paidByUserId" TEXT,
  ADD COLUMN "paymentReference" TEXT,
  ADD COLUMN "internalNote" TEXT;
