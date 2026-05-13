import { ShippingDeductionMode, type Prisma } from '@prisma/client';

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

function mapShippingModeSnapshot(mode: string | null | undefined) {
  const normalized = mode?.trim().toUpperCase();
  if (normalized === 'FIXED') {
    return ShippingDeductionMode.FIXED;
  }
  if (normalized === 'EXTERNAL_PROVIDER') {
    return ShippingDeductionMode.EXTERNAL_PROVIDER;
  }
  return ShippingDeductionMode.DISABLED;
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
  const activeProfile = await tx.vendorFinancialProfile.findFirst({
    where: {
      vendorId: allocation.assignedVendorId,
      active: true,
    },
  });
  const profileSnapshot = {
    commissionPercentSnapshot: activeProfile?.commissionPercent ?? '10.00',
    commissionVatPercentSnapshot: activeProfile?.commissionVatPercent ?? '0.00',
    deductShippingEnabledSnapshot: activeProfile?.deductShippingEnabled ?? false,
    shippingModeSnapshot: mapShippingModeSnapshot(activeProfile?.shippingMode),
    fixedShippingFeeSnapshot: activeProfile?.fixedShippingFee ?? null,
    financialProfileIdSnapshot: activeProfile?.id ?? null,
  };

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
      ...profileSnapshot,
    },
  });
}

export const __saleLedgerTesting = {
  buildSaleLedgerEntryId,
};
