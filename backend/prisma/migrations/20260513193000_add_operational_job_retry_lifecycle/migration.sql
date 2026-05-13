-- AlterEnum
ALTER TYPE "OperationalJobStatus" ADD VALUE 'RETRYING';
ALTER TYPE "OperationalJobStatus" ADD VALUE 'PERMANENTLY_FAILED';

-- AlterTable
ALTER TABLE "OperationalJob"
  ADD COLUMN "nextRetryAt" TIMESTAMP(3),
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "retryBackoffMs" INTEGER,
  ADD COLUMN "failureCategory" TEXT,
  ADD COLUMN "escalationReason" TEXT;

-- CreateIndex
CREATE INDEX "OperationalJob_status_nextRetryAt_idx" ON "OperationalJob"("status", "nextRetryAt");
