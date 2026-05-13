import type { Prisma } from '@prisma/client';

type FinanceLedgerTransaction = Prisma.TransactionClient;

function toAmountString(value: number) {
  return value.toFixed(2);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildSaleLedgerEntryId(vendorId: string, sourceShopifyOrderId: string) {
  return `fin-${vendorId}-sale-${sourceShopifyOrderId}`;
}

export async function upsertSaleLedgerForAllocation(
  tx: FinanceLedgerTransaction,
  allocationId: string,
) {
  const allocation = await tx.vendorAllocation.findUnique({
    where: {
      id: allocationId,
    },
    include: {
      order: true,
      lineItems: true,
    },
  });

  if (!allocation) {
    throw new Error(`Cannot create sale ledger entry for missing allocation ${allocationId}.`);
  }

  const amount = allocation.lineItems.reduce((sum, lineItem) => sum + toNumber(lineItem.lineAmount), 0);
  const ledgerId = buildSaleLedgerEntryId(allocation.assignedVendorId, allocation.order.sourceShopifyOrderId);

  return tx.financeLedgerEntry.upsert({
    where: {
      id: ledgerId,
    },
    update: {
      vendorAllocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
      entryType: 'sale',
      amount: toAmountString(amount),
      payoutStatus: 'PENDING',
      description: `Allocated sale for Shopify order ${allocation.order.sourceShopifyOrderNumber}`,
    },
    create: {
      id: ledgerId,
      vendorAllocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
      entryType: 'sale',
      amount: toAmountString(amount),
      payoutStatus: 'PENDING',
      description: `Allocated sale for Shopify order ${allocation.order.sourceShopifyOrderNumber}`,
    },
  });
}

export const __saleLedgerTesting = {
  buildSaleLedgerEntryId,
};
