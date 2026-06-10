-- CreateEnum
CREATE TYPE "SettlementApprovalStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SettlementApprovalLineType" AS ENUM ('SALE', 'REFUND');

-- CreateTable
CREATE TABLE "SettlementApproval" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "vendorId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "status" "SettlementApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "grossSalesMinor" INTEGER NOT NULL,
    "refundTotalMinor" INTEGER NOT NULL,
    "commissionMinor" INTEGER NOT NULL,
    "commissionVatMinor" INTEGER NOT NULL,
    "netPayableMinor" INTEGER NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "sourceSnapshotJson" JSONB NOT NULL,

    CONSTRAINT "SettlementApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementApprovalLine" (
    "id" TEXT NOT NULL,
    "settlementApprovalId" TEXT NOT NULL,
    "financeLedgerEntryId" TEXT NOT NULL,
    "lineType" "SettlementApprovalLineType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "commissionMinor" INTEGER NOT NULL,
    "commissionVatMinor" INTEGER NOT NULL,
    "payableImpactMinor" INTEGER NOT NULL,
    "sourceSnapshotJson" JSONB NOT NULL,

    CONSTRAINT "SettlementApprovalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementApproval_vendorId_status_idx" ON "SettlementApproval"("vendorId", "status");

-- CreateIndex
CREATE INDEX "SettlementApproval_periodStart_periodEnd_idx" ON "SettlementApproval"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "SettlementApproval_createdAt_idx" ON "SettlementApproval"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementApprovalLine_settlementApprovalId_financeLedgerEntry_key" ON "SettlementApprovalLine"("settlementApprovalId", "financeLedgerEntryId");

-- CreateIndex
CREATE INDEX "SettlementApprovalLine_financeLedgerEntryId_idx" ON "SettlementApprovalLine"("financeLedgerEntryId");

-- CreateIndex
CREATE INDEX "SettlementApprovalLine_lineType_idx" ON "SettlementApprovalLine"("lineType");

-- AddForeignKey
ALTER TABLE "SettlementApproval" ADD CONSTRAINT "SettlementApproval_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementApprovalLine" ADD CONSTRAINT "SettlementApprovalLine_settlementApprovalId_fkey" FOREIGN KEY ("settlementApprovalId") REFERENCES "SettlementApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementApprovalLine" ADD CONSTRAINT "SettlementApprovalLine_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
