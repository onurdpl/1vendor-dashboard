import { apiClient } from '../../lib/api-client';
import type { FinanceDashboard, FinanceTransaction } from '../../lib/api/contracts';

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
    relatedReturnId: string | null;
    relatedRefundId: string | null;
    createdAt: string;
  }>;
};

function formatMoney(amount: string) {
  const value = Number(amount ?? 0);
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
  if (normalized === 'hold' || normalized === 'failed') {
    return 'Failed';
  }
  return 'Pending';
}

export async function getFinanceDashboard(): Promise<FinanceDashboard> {
  const response = await apiClient.get<FinanceDashboardDto>('/finance');
  const grossSales = formatMoney(response.summary.grossSales);
  const refunds = formatMoney(response.summary.refunds);
  const netRevenue = formatMoney(response.summary.netRevenue);
  const platformFee = formatMoney(response.summary.platformFee);
  const payoutEstimate = formatMoney(response.summary.payoutEstimate);

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
      amount: formatMoney(record.amount),
      status: mapTransactionStatus(record.status),
    })),
  };
}
