import type { FinanceRecordDto } from './finance.types.js';
import type { FinanceTransaction } from './finance-presentation-contract.js';

const DEFAULT_CURRENCY = 'TRY';
export function formatCurrency(amount: string | number | null | undefined, currency = DEFAULT_CURRENCY) {
  const value = Number(amount ?? 0);
  const safeValue = Number.isFinite(value) ? value : 0;
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : DEFAULT_CURRENCY;

  try {
    return safeValue.toLocaleString('en-US', {
      style: 'currency',
      currency: safeCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return safeValue.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}


function mapTransactionCategory(type: string): FinanceTransaction['category'] {
  const normalized = type.trim().toLowerCase();
  if (normalized === 'refund') {
    return 'Refund';
  }
  if (normalized === 'payout') {
    return 'Payout';
  }
  if (normalized === 'fee' || normalized === 'adjustment') {
    return 'Adjustment';
  }
  return 'Invoice';
}

function mapTransactionStatus(status: string): FinanceTransaction['status'] {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'paid' || normalized === 'completed') {
    return 'Completed';
  }
  if (normalized === 'approved' || normalized === 'reconciled') {
    return 'Reconciled';
  }
  if (normalized === 'hold' || normalized === 'recorded' || normalized === 'synced') {
    return 'Recorded';
  }
  if (normalized === 'failed' || normalized === 'error') {
    return 'Failed';
  }
  return 'Pending';
}

function mapRecordStatusLabel(status: string): FinanceTransaction['status'] {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'processed' || normalized === 'settled' || normalized === 'completed' || normalized === 'posted') {
    return 'Completed';
  }
  if (normalized === 'hold' || normalized === 'recorded' || normalized === 'synced') {
    return 'Recorded';
  }
  if (normalized === 'verified' || normalized === 'reconciled') {
    return 'Reconciled';
  }
  if (normalized === 'failed' || normalized === 'error') {
    return 'Failed';
  }
  return mapTransactionStatus(status);
}


export function mapFinanceRecords(records: FinanceRecordDto[]): FinanceTransaction[] {
  return records.map((record) => ({
      id: record.id,
      date: record.createdAt,
      description:
        record.description ??
        `Backend ${record.type} record${record.relatedOrderId ? ` for order ${record.relatedOrderId}` : ''}`,
      counterparty: record.relatedRefundId ?? record.relatedReturnId ?? record.relatedOrderId ?? 'Platform ledger',
      category: mapTransactionCategory(record.type),
      amount: formatCurrency(record.amount),
      status: mapRecordStatusLabel(record.status),
      payoutStatus: record.payoutStatus ?? record.status,
      shopifyOrderNumber: record.relatedOrderNumber ?? undefined,
      shopifyOrderId: record.relatedOrderId ?? undefined,
      shopifyRefundId: record.relatedRefundId ?? undefined,
      settlement: record.settlement,
      settlementRefundAdjustments: record.settlementRefundAdjustments ?? [],
      splitFinanceSummary: record.splitFinanceSummary ?? null,
      payoutBatch: record.payoutBatch
        ? {
            ...record.payoutBatch,
            netAmount: formatCurrency(record.payoutBatch.netAmount),
          }
        : null,
      payoutCalculation: record.payoutCalculation
        ? {
            grossAmount: formatCurrency(record.payoutCalculation.grossAmount),
            commission: formatCurrency(record.payoutCalculation.commission),
            commissionVat: formatCurrency(record.payoutCalculation.commissionVat),
            shippingDeduction: formatCurrency(record.payoutCalculation.shippingDeduction),
            shippingVatAmount: record.payoutCalculation.shippingVatAmount
              ? formatCurrency(record.payoutCalculation.shippingVatAmount)
              : undefined,
            shippingDeductionSource: record.payoutCalculation.shippingDeductionSource,
            shippingCostProvider: record.payoutCalculation.shippingCostProvider,
            shippingCostSnapshot: record.payoutCalculation.shippingCostSnapshot
              ? formatCurrency(record.payoutCalculation.shippingCostSnapshot)
              : record.payoutCalculation.shippingCostSnapshot,
            shippingCostStatus: record.payoutCalculation.shippingCostStatus,
            refundImpact: formatCurrency(record.payoutCalculation.refundImpact),
            estimatedPayout: formatCurrency(record.payoutCalculation.estimatedPayout),
            shippingApplied: record.payoutCalculation.shippingApplied,
            shippingMode: record.payoutCalculation.shippingMode,
            profileSource: record.payoutCalculation.profileSource,
            commissionPercent: record.payoutCalculation.commissionPercent,
            commissionVatPercent: record.payoutCalculation.commissionVatPercent,
          }
        : null,
    }));
}
