-- Phase 4C: scheduled settlement auto-draft job run ledger.
-- This table is an idempotency/audit record only; settlement draft creation still uses existing approval services.
CREATE TYPE "SettlementScheduleJobRunStatus" AS ENUM ('PROCESSING', 'DRY_RUN', 'COMPLETED', 'BLOCKED', 'FAILED');

CREATE TABLE "SettlementScheduleJobRun" (
    "id" TEXT NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL,
    "status" "SettlementScheduleJobRunStatus" NOT NULL DEFAULT 'PROCESSING',
    "writesPerformed" BOOLEAN NOT NULL DEFAULT false,
    "createdDraftCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "metadataJson" JSONB,

    CONSTRAINT "SettlementScheduleJobRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SettlementScheduleJobRun_runDate_key" ON "SettlementScheduleJobRun"("runDate");
CREATE INDEX "SettlementScheduleJobRun_status_startedAt_idx" ON "SettlementScheduleJobRun"("status", "startedAt");
CREATE INDEX "SettlementScheduleJobRun_finishedAt_idx" ON "SettlementScheduleJobRun"("finishedAt");
