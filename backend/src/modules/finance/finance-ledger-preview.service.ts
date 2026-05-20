import { prisma } from '../../db/prisma.js';
import {
  buildLineItemSaleReservationEntries,
  buildRefundReversalEntries,
  calculateLedgerBalance,
  freezeLedgerEntry,
} from './finance-ledger.js';
import type { FinanceLedgerEntry } from './finance-ledger.types.js';
import type {
  FinanceLedgerPreviewBuildResult,
  FinanceLedgerPreviewDto,
  FinanceLedgerPreviewEntryDto,
  FinanceLedgerPreviewInput,
} from './finance-ledger-preview.types.js';

function toMinorUnits(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 100);
}

function fromMinorUnits(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return (value / 100).toFixed(2);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toBps(percent: unknown) {
  const numeric = Number(percent);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.round(numeric * 100);
}

function sortEntries(entries: ReadonlyArray<FinanceLedgerEntry>) {
  return [...entries].sort((left, right) => {
    const occurred = left.occurredAt.localeCompare(right.occurredAt);
    if (occurred !== 0) {
      return occurred;
    }
    const sequence = left.sequence - right.sequence;
    if (sequence !== 0) {
      return sequence;
    }
    return left.id.localeCompare(right.id);
  });
}

function mapPreviewEntry(entry: FinanceLedgerEntry): FinanceLedgerPreviewEntryDto {
  return {
    id: entry.id,
    eventType: entry.eventType,
    sourceType: entry.sourceType,
    lineItemId: entry.lineItemId ?? null,
    returnId: entry.returnId ?? null,
    refundId: entry.refundId ?? null,
    amount: fromMinorUnits(entry.amountMinor) ?? '0.00',
    currency: entry.currency,
    occurredAt: entry.occurredAt,
    impact: {
      grossSales: fromMinorUnits(entry.impact.grossSalesMinor),
      marketplaceCommission: fromMinorUnits(entry.impact.marketplaceCommissionMinor),
      vendorPayable: fromMinorUnits(entry.impact.vendorPayableMinor),
      shippingCostReserved: fromMinorUnits(entry.impact.shippingCostReservedMinor),
      vendorDebt: fromMinorUnits(entry.impact.vendorDebtMinor),
    },
  };
}

function buildReturnCreatedEntry(input: FinanceLedgerPreviewInput, returnRecord: NonNullable<FinanceLedgerPreviewInput['returnRecords']>[number], sequence: number): FinanceLedgerEntry {
  return freezeLedgerEntry({
    id: `ledger-preview-${input.vendorId}-${input.allocationId}-${returnRecord.id}-return-created`,
    eventType: 'RETURN_CREATED',
    sourceType: 'shopify_return',
    vendorId: input.vendorId,
    currency: input.currency ?? 'TRY',
    occurredAt: returnRecord.createdAt,
    createdAt: returnRecord.createdAt,
    sequence,
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    lineItemId: returnRecord.sourceLineItemId ?? null,
    returnId: returnRecord.id,
    amountMinor: 0,
    impact: {},
    metadata: {
      status: returnRecord.status,
    },
  });
}

function buildShippingCostEntry(input: FinanceLedgerPreviewInput, sequence: number): FinanceLedgerEntry | null {
  if (!input.shippingCost) {
    return null;
  }

  const amountMinor = toMinorUnits(input.shippingCost.amount);
  return freezeLedgerEntry({
    id: `ledger-preview-${input.vendorId}-${input.allocationId}-${input.shippingCost.id}-shipping-cost-reserved`,
    eventType: 'SHIPPING_COST_RESERVED',
    sourceType: 'system',
    vendorId: input.vendorId,
    currency: input.shippingCost.currency || input.currency || 'TRY',
    occurredAt: input.shippingCost.updatedAt,
    createdAt: input.shippingCost.updatedAt,
    sequence,
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    amountMinor,
    impact: {
      shippingCostReservedMinor: amountMinor,
    },
    metadata: {
      providerName: input.shippingCost.providerName,
    },
  });
}

function resolveRefundLineAmount(
  refundRecord: NonNullable<FinanceLedgerPreviewInput['refundRecords']>[number],
  lineItemId: string,
) {
  const matchingLine = refundRecord.lineItems?.find((line) => line.sourceLineItemId === lineItemId);
  return matchingLine ? matchingLine.subtotal : refundRecord.amount;
}

export function buildFinanceLedgerPreview(input: FinanceLedgerPreviewInput): FinanceLedgerPreviewBuildResult {
  const currency = input.currency ?? input.shippingCost?.currency ?? 'TRY';
  const entries: FinanceLedgerEntry[] = [];
  const unknowns = new Set<string>();
  const assumptions = new Set<string>();
  const commissionKnown = typeof input.commissionBps === 'number' && Number.isFinite(input.commissionBps);

  if (!commissionKnown) {
    unknowns.add('commission_rate');
    unknowns.add('vendor_payable');
  }
  if (!input.shippingCost) {
    unknowns.add('shipping_cost');
  }
  assumptions.add('Preview is read-only and does not mutate payouts, refunds, Shopify, invoices, or balances.');

  let sequence = 1;
  for (const lineItem of input.lineItems) {
    if (commissionKnown) {
      entries.push(
        ...buildLineItemSaleReservationEntries({
          vendorId: input.vendorId,
          orderId: input.orderId,
          orderNumber: input.orderNumber,
          lineItemId: lineItem.id,
          grossAmountMinor: toMinorUnits(lineItem.lineAmount),
          commissionBps: input.commissionBps ?? 0,
          currency,
          occurredAt: input.createdAt,
          sequenceStart: sequence,
        }),
      );
      sequence += 4;
      continue;
    }

    entries.push(
      freezeLedgerEntry({
        id: `ledger-preview-${input.vendorId}-${input.orderId}-${lineItem.id}-order-created`,
        eventType: 'ORDER_CREATED',
        sourceType: 'shopify_order',
        vendorId: input.vendorId,
        currency,
        occurredAt: input.createdAt,
        createdAt: input.createdAt,
        sequence,
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        lineItemId: lineItem.id,
        amountMinor: toMinorUnits(lineItem.lineAmount),
        impact: {
          grossSalesMinor: toMinorUnits(lineItem.lineAmount),
        },
      }),
      freezeLedgerEntry({
        id: `ledger-preview-${input.vendorId}-${input.orderId}-${lineItem.id}-payment-captured`,
        eventType: 'PAYMENT_CAPTURED',
        sourceType: 'shopify_order',
        vendorId: input.vendorId,
        currency,
        occurredAt: input.createdAt,
        createdAt: input.createdAt,
        sequence: sequence + 1,
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        lineItemId: lineItem.id,
        amountMinor: toMinorUnits(lineItem.lineAmount),
        impact: {},
      }),
    );
    sequence += 2;
  }

  for (const returnRecord of input.returnRecords ?? []) {
    entries.push(buildReturnCreatedEntry(input, returnRecord, sequence));
    sequence += 1;
  }

  if (commissionKnown) {
    for (const refundRecord of input.refundRecords ?? []) {
      const targetLineItemIds = refundRecord.lineItems?.length
        ? refundRecord.lineItems.map((line) => line.sourceLineItemId)
        : input.lineItems.map((line) => line.id);
      for (const lineItemId of targetLineItemIds) {
        entries.push(
          ...buildRefundReversalEntries({
            vendorId: input.vendorId,
            orderId: input.orderId,
            orderNumber: input.orderNumber,
            lineItemId,
            refundId: refundRecord.sourceShopifyRefundId || refundRecord.id,
            refundAmountMinor: toMinorUnits(resolveRefundLineAmount(refundRecord, lineItemId)),
            commissionBps: input.commissionBps ?? 0,
            payoutAlreadyPaid: input.payoutAlreadyPaid === true,
            currency,
            occurredAt: refundRecord.createdAt,
            sequenceStart: sequence,
          }),
        );
        sequence += 4;
      }
    }
  } else if ((input.refundRecords ?? []).length > 0) {
    unknowns.add('refund_reversal_amount');
  }

  const shippingCostEntry = buildShippingCostEntry(input, sequence);
  if (shippingCostEntry) {
    entries.push(shippingCostEntry);
  }

  const orderedEntries = sortEntries(entries);
  const balance = calculateLedgerBalance(orderedEntries);
  const preview: FinanceLedgerPreviewDto = {
    status: unknowns.size > 0 ? 'partial' : 'ready',
    currency: balance.currency,
    entries: orderedEntries.map(mapPreviewEntry),
    balance: {
      grossSales: fromMinorUnits(balance.grossSalesMinor) ?? '0.00',
      marketplaceCommission: fromMinorUnits(balance.marketplaceCommissionMinor) ?? '0.00',
      vendorPayable: fromMinorUnits(balance.vendorPayableMinor) ?? '0.00',
      shippingCostReserved: fromMinorUnits(balance.shippingCostReservedMinor) ?? '0.00',
      vendorDebt: fromMinorUnits(balance.vendorDebtMinor) ?? '0.00',
      netVendorPosition: fromMinorUnits(balance.netVendorPositionMinor) ?? '0.00',
    },
    unknowns: [...unknowns].sort(),
    assumptions: [...assumptions].sort(),
    sourceFields: {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      allocationId: input.allocationId,
      vendorId: input.vendorId,
      lineItemCount: input.lineItems.length,
      returnCount: input.returnRecords?.length ?? 0,
      refundCount: input.refundRecords?.length ?? 0,
      commissionProfile: commissionKnown ? 'configured' : 'unknown',
      shippingCost: input.shippingCost?.source ?? 'unknown',
      payoutAlreadyPaid: input.payoutAlreadyPaid === true,
    },
  };

  return {
    preview,
    balance,
    entries: Object.freeze(orderedEntries),
  };
}

export async function getFinanceLedgerPreviewForAllocation(vendorId: string, allocationId: string): Promise<FinanceLedgerPreviewDto | null> {
  const allocation = await prisma.vendorAllocation.findFirst({
    where: {
      id: allocationId,
      assignedVendorId: vendorId,
    },
    include: {
      order: true,
      lineItems: {
        include: {
          shopifyOrderLineItem: true,
        },
      },
      returnRecords: true,
      refundRecords: {
        include: {
          lineItems: true,
        },
      },
      financeEntries: {
        include: {
          payoutBatchLines: {
            include: {
              payoutBatch: true,
            },
          },
        },
      },
    },
  });

  if (!allocation) {
    return null;
  }

  const [profile, shippingCost, shipmentExecution] = await Promise.all([
    prisma.vendorFinancialProfile.findFirst({
      where: {
        vendorId,
        active: true,
      },
    }),
    prisma.shipmentShippingCost.findFirst({
      where: {
        vendorId,
        allocationId,
        status: 'CONFIRMED',
      },
      orderBy: {
        updatedAt: 'desc',
      },
    }),
    prisma.shipmentExecution.findFirst({
      where: {
        vendorId,
        allocationId,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    }),
  ]);
  const payoutAlreadyPaid = allocation.financeEntries.some((entry) =>
    entry.payoutBatchLines.some((line) => line.payoutBatch.status === 'PAID_PLACEHOLDER'),
  );

  return buildFinanceLedgerPreview({
    allocationId: allocation.id,
    vendorId,
    orderId: allocation.order.sourceShopifyOrderId,
    orderNumber: allocation.order.sourceShopifyOrderNumber,
    currency: shippingCost?.currency ?? 'TRY',
    createdAt: allocation.createdAt.toISOString(),
    lineItems: allocation.lineItems.map((lineItem) => ({
      id: lineItem.shopifyOrderLineItem.sourceLineItemId || lineItem.id,
      lineAmount: toNumber(lineItem.lineAmount),
    })),
    returnRecords: allocation.returnRecords.map((returnRecord) => ({
      id: returnRecord.sourceShopifyReturnId ?? returnRecord.id,
      status: returnRecord.status,
      createdAt: (returnRecord.requestCreatedAt ?? returnRecord.createdAt).toISOString(),
      sourceLineItemId: returnRecord.sourceShopifyLineItemId,
    })),
    refundRecords: allocation.refundRecords.map((refundRecord) => ({
      id: refundRecord.id,
      sourceShopifyRefundId: refundRecord.sourceShopifyRefundId,
      amount: toNumber(refundRecord.amount),
      status: refundRecord.status,
      createdAt: refundRecord.createdAt.toISOString(),
      lineItems: refundRecord.lineItems.map((lineItem) => ({
        sourceLineItemId: lineItem.sourceLineItemId,
        subtotal: toNumber(lineItem.subtotal),
      })),
    })),
    commissionBps: profile ? toBps(profile.commissionPercent) : null,
    shippingCost: shippingCost
      ? {
          id: shippingCost.id,
          amount: toNumber(shippingCost.shippingCost) + toNumber(shippingCost.shippingVatAmount),
          currency: shippingCost.currency,
          providerName: shippingCost.providerName,
          source: 'confirmed',
          updatedAt: shippingCost.updatedAt.toISOString(),
        }
      : shipmentExecution?.shippingCost !== null && shipmentExecution?.shippingCost !== undefined
        ? {
            id: shipmentExecution.id,
            amount: toNumber(shipmentExecution.shippingCost) + toNumber(shipmentExecution.shippingVat),
            currency: shipmentExecution.currency,
            providerName: shipmentExecution.provider,
            source: 'provider_snapshot',
            updatedAt: shipmentExecution.updatedAt.toISOString(),
          }
      : null,
    payoutAlreadyPaid,
  }).preview;
}
