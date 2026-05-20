import type {
  FinanceLedgerBalance,
  FinanceLedgerBalanceImpact,
  FinanceLedgerEntry,
  FinanceLedgerLineItemBalance,
  LineItemSaleReservationInput,
  RefundReversalInput,
} from './finance-ledger.types.js';

const ZERO_LINE_ITEM_BALANCE: FinanceLedgerLineItemBalance = Object.freeze({
  grossSalesMinor: 0,
  marketplaceCommissionMinor: 0,
  vendorPayableMinor: 0,
  shippingCostReservedMinor: 0,
  vendorDebtMinor: 0,
  netVendorPositionMinor: 0,
});

function asMinorUnits(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value);
}

function readImpact(impact: FinanceLedgerBalanceImpact, key: keyof FinanceLedgerBalanceImpact) {
  return asMinorUnits(impact[key] ?? 0);
}

function sumNetVendorPosition(input: {
  vendorPayableMinor: number;
  shippingCostReservedMinor: number;
  vendorDebtMinor: number;
}) {
  return input.vendorPayableMinor - input.shippingCostReservedMinor - input.vendorDebtMinor;
}

function cloneImpact(impact: FinanceLedgerBalanceImpact): FinanceLedgerBalanceImpact {
  return Object.freeze({
    grossSalesMinor: readImpact(impact, 'grossSalesMinor'),
    marketplaceCommissionMinor: readImpact(impact, 'marketplaceCommissionMinor'),
    vendorPayableMinor: readImpact(impact, 'vendorPayableMinor'),
    shippingCostReservedMinor: readImpact(impact, 'shippingCostReservedMinor'),
    vendorDebtMinor: readImpact(impact, 'vendorDebtMinor'),
  });
}

export function calculateCommissionMinor(amountMinor: number, commissionBps: number) {
  const normalizedAmount = Math.max(asMinorUnits(amountMinor), 0);
  const normalizedBps = Math.max(asMinorUnits(commissionBps), 0);
  return Math.round((normalizedAmount * normalizedBps) / 10_000);
}

export function freezeLedgerEntry(entry: FinanceLedgerEntry): FinanceLedgerEntry {
  return Object.freeze({
    ...entry,
    amountMinor: asMinorUnits(entry.amountMinor),
    impact: cloneImpact(entry.impact),
    metadata: entry.metadata ? Object.freeze({ ...entry.metadata }) : undefined,
  });
}

export function appendLedgerEntry(
  existingEntries: ReadonlyArray<FinanceLedgerEntry>,
  entry: FinanceLedgerEntry,
): ReadonlyArray<FinanceLedgerEntry> {
  if (existingEntries.some((existing) => existing.id === entry.id)) {
    throw new Error(`Duplicate finance ledger entry id ${entry.id}.`);
  }

  return Object.freeze([...existingEntries.map(freezeLedgerEntry), freezeLedgerEntry(entry)]);
}

export function calculateLedgerBalance(entries: ReadonlyArray<FinanceLedgerEntry>): FinanceLedgerBalance {
  const orderedEntries = [...entries].sort((left, right) => {
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
  const currency = orderedEntries[0]?.currency ?? 'TRY';
  const byLineItem: Record<string, FinanceLedgerLineItemBalance> = {};
  const totals = {
    grossSalesMinor: 0,
    marketplaceCommissionMinor: 0,
    vendorPayableMinor: 0,
    shippingCostReservedMinor: 0,
    vendorDebtMinor: 0,
  };

  for (const entry of orderedEntries) {
    if (entry.currency !== currency) {
      throw new Error('Finance ledger balance calculation requires a single currency.');
    }

    totals.grossSalesMinor += readImpact(entry.impact, 'grossSalesMinor');
    totals.marketplaceCommissionMinor += readImpact(entry.impact, 'marketplaceCommissionMinor');
    totals.vendorPayableMinor += readImpact(entry.impact, 'vendorPayableMinor');
    totals.shippingCostReservedMinor += readImpact(entry.impact, 'shippingCostReservedMinor');
    totals.vendorDebtMinor += readImpact(entry.impact, 'vendorDebtMinor');

    if (entry.lineItemId) {
      const current = byLineItem[entry.lineItemId] ?? ZERO_LINE_ITEM_BALANCE;
      const next = {
        grossSalesMinor: current.grossSalesMinor + readImpact(entry.impact, 'grossSalesMinor'),
        marketplaceCommissionMinor: current.marketplaceCommissionMinor + readImpact(entry.impact, 'marketplaceCommissionMinor'),
        vendorPayableMinor: current.vendorPayableMinor + readImpact(entry.impact, 'vendorPayableMinor'),
        shippingCostReservedMinor: current.shippingCostReservedMinor + readImpact(entry.impact, 'shippingCostReservedMinor'),
        vendorDebtMinor: current.vendorDebtMinor + readImpact(entry.impact, 'vendorDebtMinor'),
      };
      byLineItem[entry.lineItemId] = Object.freeze({
        ...next,
        netVendorPositionMinor: sumNetVendorPosition(next),
      });
    }
  }

  return Object.freeze({
    currency,
    entriesProcessed: orderedEntries.length,
    ...totals,
    netVendorPositionMinor: sumNetVendorPosition(totals),
    byLineItem: Object.freeze(byLineItem),
  });
}

export function buildLineItemSaleReservationEntries(input: LineItemSaleReservationInput): ReadonlyArray<FinanceLedgerEntry> {
  const currency = input.currency ?? 'TRY';
  const sequenceStart = input.sequenceStart ?? 1;
  const grossAmountMinor = Math.max(asMinorUnits(input.grossAmountMinor), 0);
  const commissionMinor = calculateCommissionMinor(grossAmountMinor, input.commissionBps);
  const vendorPayableMinor = Math.max(grossAmountMinor - commissionMinor, 0);
  const base = {
    sourceType: 'shopify_order' as const,
    vendorId: input.vendorId,
    currency,
    occurredAt: input.occurredAt,
    createdAt: input.occurredAt,
    orderId: input.orderId,
    orderNumber: input.orderNumber ?? null,
    lineItemId: input.lineItemId,
    amountMinor: grossAmountMinor,
  };

  return Object.freeze([
    freezeLedgerEntry({
      ...base,
      id: `ledger-${input.vendorId}-${input.orderId}-${input.lineItemId}-order-created`,
      eventType: 'ORDER_CREATED',
      sequence: sequenceStart,
      impact: { grossSalesMinor: grossAmountMinor },
    }),
    freezeLedgerEntry({
      ...base,
      id: `ledger-${input.vendorId}-${input.orderId}-${input.lineItemId}-payment-captured`,
      eventType: 'PAYMENT_CAPTURED',
      sequence: sequenceStart + 1,
      impact: {},
    }),
    freezeLedgerEntry({
      ...base,
      id: `ledger-${input.vendorId}-${input.orderId}-${input.lineItemId}-commission-reserved`,
      eventType: 'MARKETPLACE_COMMISSION_RESERVED',
      sequence: sequenceStart + 2,
      amountMinor: commissionMinor,
      impact: { marketplaceCommissionMinor: commissionMinor },
      metadata: { commissionBps: input.commissionBps },
    }),
    freezeLedgerEntry({
      ...base,
      id: `ledger-${input.vendorId}-${input.orderId}-${input.lineItemId}-vendor-payable-reserved`,
      eventType: 'VENDOR_PAYABLE_RESERVED',
      sequence: sequenceStart + 3,
      amountMinor: vendorPayableMinor,
      impact: { vendorPayableMinor },
      metadata: { commissionBps: input.commissionBps },
    }),
  ]);
}

export function buildRefundReversalEntries(input: RefundReversalInput): ReadonlyArray<FinanceLedgerEntry> {
  const currency = input.currency ?? 'TRY';
  const sequenceStart = input.sequenceStart ?? 1;
  const refundAmountMinor = Math.max(asMinorUnits(input.refundAmountMinor), 0);
  const commissionReversalMinor = calculateCommissionMinor(refundAmountMinor, input.commissionBps);
  const vendorImpactMinor = Math.max(refundAmountMinor - commissionReversalMinor, 0);
  const base = {
    sourceType: 'shopify_refund' as const,
    vendorId: input.vendorId,
    currency,
    occurredAt: input.occurredAt,
    createdAt: input.occurredAt,
    orderId: input.orderId,
    orderNumber: input.orderNumber ?? null,
    lineItemId: input.lineItemId,
    refundId: input.refundId,
  };
  const vendorImpactEvent = input.payoutAlreadyPaid
    ? {
        id: `ledger-${input.vendorId}-${input.refundId}-${input.lineItemId}-vendor-debt-created`,
        eventType: 'VENDOR_DEBT_CREATED' as const,
        amountMinor: vendorImpactMinor,
        impact: { vendorDebtMinor: vendorImpactMinor },
      }
    : {
        id: `ledger-${input.vendorId}-${input.refundId}-${input.lineItemId}-vendor-payable-reversed`,
        eventType: 'VENDOR_PAYABLE_REVERSED' as const,
        amountMinor: vendorImpactMinor,
        impact: { vendorPayableMinor: -vendorImpactMinor },
      };

  return Object.freeze([
    freezeLedgerEntry({
      ...base,
      id: `ledger-${input.vendorId}-${input.refundId}-${input.lineItemId}-refund-approved`,
      eventType: 'REFUND_APPROVED',
      sequence: sequenceStart,
      amountMinor: refundAmountMinor,
      impact: {},
    }),
    freezeLedgerEntry({
      ...base,
      id: `ledger-${input.vendorId}-${input.refundId}-${input.lineItemId}-refund-completed`,
      eventType: 'REFUND_COMPLETED',
      sequence: sequenceStart + 1,
      amountMinor: refundAmountMinor,
      impact: {},
    }),
    freezeLedgerEntry({
      ...base,
      id: `ledger-${input.vendorId}-${input.refundId}-${input.lineItemId}-commission-reversed`,
      eventType: 'COMMISSION_REVERSED',
      sequence: sequenceStart + 2,
      amountMinor: commissionReversalMinor,
      impact: { marketplaceCommissionMinor: -commissionReversalMinor },
      metadata: { commissionBps: input.commissionBps },
    }),
    freezeLedgerEntry({
      ...base,
      ...vendorImpactEvent,
      sequence: sequenceStart + 3,
      metadata: { payoutAlreadyPaid: input.payoutAlreadyPaid },
    }),
  ]);
}
