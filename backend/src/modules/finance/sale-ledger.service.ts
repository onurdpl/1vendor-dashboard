import { SettlementStatus, ShippingDeductionMode, type Prisma } from '@prisma/client';

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

function isFulfilledForSettlement(allocation: {
  fulfillmentStatus?: string | null;
  shippingStatus?: string | null;
  fulfillment?: { fulfilledAt: Date | null } | null;
}) {
  const lifecycle = [allocation.fulfillmentStatus, allocation.shippingStatus]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return Boolean(
    allocation.fulfillment?.fulfilledAt ||
      lifecycle.includes('fulfilled') ||
      lifecycle.includes('shipped') ||
      lifecycle.includes('in transit') ||
      lifecycle.includes('delivered'),
  );
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
      fulfillment: true,
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
  const confirmedShippingCost = await tx.shipmentShippingCost.findFirst({
    where: {
      vendorId: allocation.assignedVendorId,
      allocationId: allocation.id,
      status: 'CONFIRMED',
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });
  const profileSnapshot = {
    commissionPercentSnapshot: activeProfile?.commissionPercent ?? '10.00',
    commissionVatPercentSnapshot: activeProfile?.commissionVatPercent ?? '0.00',
    deductShippingEnabledSnapshot: activeProfile?.deductShippingEnabled ?? false,
    shippingModeSnapshot: mapShippingModeSnapshot(activeProfile?.shippingMode),
    fixedShippingFeeSnapshot: activeProfile?.fixedShippingFee ?? null,
    shippingCostSnapshot: confirmedShippingCost?.shippingCost ?? null,
    shippingVatAmountSnapshot: confirmedShippingCost?.shippingVatAmount ?? null,
    shippingCostSourceSnapshot: confirmedShippingCost?.sourceType ?? null,
    shippingCostProviderSnapshot: confirmedShippingCost?.providerName ?? null,
    shippingCostIdSnapshot: confirmedShippingCost?.id ?? null,
    financialProfileIdSnapshot: activeProfile?.id ?? null,
  };
  const fulfilled = isFulfilledForSettlement(allocation);
  const payableAt = fulfilled ? allocation.fulfillment?.fulfilledAt ?? allocation.updatedAt : null;
  const settlementFields = {
    settlementStatus: fulfilled ? SettlementStatus.PAYABLE : SettlementStatus.ACCRUING,
    accruedAt: allocation.createdAt,
    payableAt,
    settlementEligibleAt: payableAt,
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
      ...settlementFields,
    },
  });
}

export const __saleLedgerTesting = {
  buildSaleLedgerEntryId,
};
