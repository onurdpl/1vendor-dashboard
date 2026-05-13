import { apiClient } from '../../lib/api-client';
import type { FinanceDashboard, FinanceTransaction } from '../../lib/api/contracts';
import { formatCurrency } from './formatting';

type FinanceDashboardDto = {
  summary: {
    grossSales: string;
    refunds: string;
    netRevenue: string;
    platformFee: string;
    payoutEstimate: string;
    payoutStatus: string;
  };
  records: Array<{
    id: string;
    type: string;
    amount: string;
    status: string;
    description: string | null;
    relatedOrderId: string | null;
    relatedOrderNumber: string | null;
    relatedReturnId: string | null;
    relatedRefundId: string | null;
    createdAt: string;
  }>;
};

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

export const __financeStatusMapping = {
  mapTransactionStatus,
  mapRecordStatusLabel,
};

export async function getFinanceDashboard(): Promise<FinanceDashboard> {
  const response = await apiClient.get<FinanceDashboardDto>('/finance');
  const grossSales = formatCurrency(response.summary.grossSales);
  const refunds = formatCurrency(response.summary.refunds);
  const netRevenue = formatCurrency(response.summary.netRevenue);
  const platformFee = formatCurrency(response.summary.platformFee);
  const payoutEstimate = formatCurrency(response.summary.payoutEstimate);

  return {
    summary: {
      grossSales,
      refunds,
      netRevenue,
      platformFee,
      payoutEstimate,
      totalRevenue: grossSales,
      availableBalance: payoutEstimate,
      pendingPayouts: payoutEstimate,
      refundsThisMonth: refunds,
    },
    transactions: response.records.map((record) => ({
      id: record.id,
      date: record.createdAt,
      description:
        record.description ??
        `Backend ${record.type} record${record.relatedOrderId ? ` for order ${record.relatedOrderId}` : ''}`,
      counterparty: record.relatedRefundId ?? record.relatedReturnId ?? record.relatedOrderId ?? 'Platform ledger',
      category: mapTransactionCategory(record.type),
      amount: formatCurrency(record.amount),
      status: mapRecordStatusLabel(record.status),
      shopifyOrderNumber: record.relatedOrderNumber ?? undefined,
      shopifyOrderId: record.relatedOrderId ?? undefined,
      shopifyRefundId: record.relatedRefundId ?? undefined,
    })),
  };
}
