-- CreateEnum
CREATE TYPE "SettlementCommissionInvoiceProvider" AS ENUM ('LOGO_ISBASI');

-- CreateEnum
CREATE TYPE "SettlementCommissionInvoiceStatus" AS ENUM ('PENDING', 'CREATED', 'FAILED', 'CANCELLED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "SettlementCommissionInvoice" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settlementApprovalId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "provider" "SettlementCommissionInvoiceProvider" NOT NULL,
    "status" "SettlementCommissionInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "providerInvoiceId" TEXT,
    "providerUuid" TEXT,
    "providerEttn" TEXT,
    "invoiceNo" TEXT,
    "documentStatus" TEXT,
    "documentContentType" TEXT,
    "documentSize" INTEGER,
    "documentFetchedAt" TIMESTAMP(3),
    "documentSnapshotJson" JSONB,
    "requestSnapshotJson" JSONB,
    "responseSnapshotJson" JSONB,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "failedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetriedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "SettlementCommissionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementCommissionInvoice_settlementApprovalId_idx" ON "SettlementCommissionInvoice"("settlementApprovalId");

-- CreateIndex
CREATE INDEX "SettlementCommissionInvoice_vendorId_idx" ON "SettlementCommissionInvoice"("vendorId");

-- CreateIndex
CREATE INDEX "SettlementCommissionInvoice_provider_idx" ON "SettlementCommissionInvoice"("provider");

-- CreateIndex
CREATE INDEX "SettlementCommissionInvoice_status_idx" ON "SettlementCommissionInvoice"("status");

-- CreateIndex
CREATE INDEX "SettlementCommissionInvoice_providerUuid_idx" ON "SettlementCommissionInvoice"("providerUuid");

-- CreateIndex
CREATE INDEX "SettlementCommissionInvoice_invoiceNo_idx" ON "SettlementCommissionInvoice"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementCommissionInvoice_active_settlement_provider_key"
    ON "SettlementCommissionInvoice"("settlementApprovalId", "provider")
    WHERE "status" <> 'CANCELLED';

-- AddForeignKey
ALTER TABLE "SettlementCommissionInvoice" ADD CONSTRAINT "SettlementCommissionInvoice_settlementApprovalId_fkey" FOREIGN KEY ("settlementApprovalId") REFERENCES "SettlementApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementCommissionInvoice" ADD CONSTRAINT "SettlementCommissionInvoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
