-- CreateEnum
CREATE TYPE "InvoiceExecutionProvider" AS ENUM ('BIZIMHESAP', 'PARASUT', 'BIRFATURA');

-- CreateEnum
CREATE TYPE "InvoiceExecutionStatus" AS ENUM ('PENDING', 'CREATED', 'FAILED', 'CANCELLED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "InvoiceExecution" (
    "id" TEXT NOT NULL,
    "financeLedgerEntryId" TEXT NOT NULL,
    "provider" "InvoiceExecutionProvider" NOT NULL,
    "providerInvoiceGuid" TEXT,
    "providerInvoiceNo" TEXT,
    "providerPdfUrl" TEXT,
    "status" "InvoiceExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "requestSnapshot" JSONB NOT NULL,
    "responseSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceExecution_financeLedgerEntryId_provider_key" ON "InvoiceExecution"("financeLedgerEntryId", "provider");

-- CreateIndex
CREATE INDEX "InvoiceExecution_provider_status_idx" ON "InvoiceExecution"("provider", "status");

-- CreateIndex
CREATE INDEX "InvoiceExecution_createdAt_idx" ON "InvoiceExecution"("createdAt");

-- AddForeignKey
ALTER TABLE "InvoiceExecution" ADD CONSTRAINT "InvoiceExecution_financeLedgerEntryId_fkey" FOREIGN KEY ("financeLedgerEntryId") REFERENCES "FinanceLedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
