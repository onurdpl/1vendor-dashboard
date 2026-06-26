CREATE TABLE "CanonicalReconciliationRun" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "lookbackDays" INTEGER NOT NULL,
    "orderLimit" INTEGER NOT NULL,
    "ordersScanned" INTEGER NOT NULL DEFAULT 0,
    "repairOpportunities" INTEGER NOT NULL DEFAULT 0,
    "wouldRepairOrders" INTEGER NOT NULL DEFAULT 0,
    "wouldRepairFulfillment" INTEGER NOT NULL DEFAULT 0,
    "wouldRepairRefunds" INTEGER NOT NULL DEFAULT 0,
    "wouldRepairReturns" INTEGER NOT NULL DEFAULT 0,
    "wouldRepairCancellations" INTEGER NOT NULL DEFAULT 0,
    "wouldCreateSignals" INTEGER NOT NULL DEFAULT 0,
    "wouldRepairLedgers" INTEGER NOT NULL DEFAULT 0,
    "wouldRepairFinanceEvents" INTEGER NOT NULL DEFAULT 0,
    "errorsJson" JSONB,
    "perOrderDetailsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CanonicalReconciliationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CanonicalReconciliationRun_startedAt_idx" ON "CanonicalReconciliationRun"("startedAt");
CREATE INDEX "CanonicalReconciliationRun_mode_status_idx" ON "CanonicalReconciliationRun"("mode", "status");
