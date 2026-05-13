import { apiClient } from '../../lib/api-client';
import type { FinanceDashboard, FinanceTransaction, PayoutBatch, VendorFinancialProfile } from '../../lib/api/contracts';
import { formatCurrency } from './formatting';

type FinanceDashboardDto = {
  summary: {
    grossSales: string;
    refunds: string;
    netRevenue: string;
    platformFee: string;
    commissionVat?: string;
    shippingDeductions?: string;
    payoutEstimate: string;
    payoutStatus: string;
    accruedBalance?: string;
    payableBalance?: string;
    heldBalance?: string;
    refundedBalance?: string;
    pendingSettlement?: string;
  };
  profile?: VendorFinancialProfile;
  payoutBatchSummary?: FinanceDashboard['payoutBatchSummary'];
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
    payoutCalculation?: FinanceTransaction['payoutCalculation'];
    settlement?: FinanceTransaction['settlement'];
    payoutBatch?: FinanceTransaction['payoutBatch'];
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

export async function getFinanceDashboard(options: { limit?: number; offset?: number } = {}): Promise<FinanceDashboard> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  const response = await apiClient.get<FinanceDashboardDto>(`/finance${params.size ? `?${params.toString()}` : ''}`);
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
      commissionVat: response.summary.commissionVat ? formatCurrency(response.summary.commissionVat) : undefined,
      shippingDeductions: response.summary.shippingDeductions
        ? formatCurrency(response.summary.shippingDeductions)
        : undefined,
      payoutEstimate,
      totalRevenue: grossSales,
      availableBalance: payoutEstimate,
      pendingPayouts: payoutEstimate,
      refundsThisMonth: refunds,
      accruedBalance: response.summary.accruedBalance ? formatCurrency(response.summary.accruedBalance) : undefined,
      payableBalance: response.summary.payableBalance ? formatCurrency(response.summary.payableBalance) : undefined,
      heldBalance: response.summary.heldBalance ? formatCurrency(response.summary.heldBalance) : undefined,
      refundedBalance: response.summary.refundedBalance ? formatCurrency(response.summary.refundedBalance) : undefined,
      pendingSettlement: response.summary.pendingSettlement ? formatCurrency(response.summary.pendingSettlement) : undefined,
    },
    profile: response.profile,
    payoutBatchSummary: response.payoutBatchSummary
      ? {
          ...response.payoutBatchSummary,
          eligibleNetAmount: formatCurrency(response.payoutBatchSummary.eligibleNetAmount),
          latestBatch: response.payoutBatchSummary.latestBatch
            ? {
                ...response.payoutBatchSummary.latestBatch,
                grossAmount: formatCurrency(response.payoutBatchSummary.latestBatch.grossAmount),
                commissionAmount: formatCurrency(response.payoutBatchSummary.latestBatch.commissionAmount),
                commissionVatAmount: formatCurrency(response.payoutBatchSummary.latestBatch.commissionVatAmount),
                shippingDeductionAmount: formatCurrency(response.payoutBatchSummary.latestBatch.shippingDeductionAmount),
                refundAmount: formatCurrency(response.payoutBatchSummary.latestBatch.refundAmount),
                netAmount: formatCurrency(response.payoutBatchSummary.latestBatch.netAmount),
              }
            : null,
        }
      : undefined,
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
      settlement: record.settlement,
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
    })),
  };
}

export async function updateVendorFinancialProfile(
  vendorId: string,
  input: {
    commissionPercent: number;
    commissionVatPercent: number;
    deductShippingEnabled: boolean;
    shippingMode: VendorFinancialProfile['shippingMode'];
    fixedShippingFee: number | null;
  },
): Promise<VendorFinancialProfile> {
  return apiClient.put<VendorFinancialProfile>(`/admin/vendors/${encodeURIComponent(vendorId)}/financial-profile`, input);
}

export function preparePayoutBatch(vendorId: string): Promise<PayoutBatch> {
  return apiClient.post<PayoutBatch>('/admin/payout-batches/prepare', { vendorId });
}

export function attachShippingCost(input: {
  vendorId: string;
  financeLedgerEntryId: string;
  providerName: string;
  providerReference: string | null;
  shippingCost: number;
  shippingVatAmount: number | null;
  status: 'pending' | 'confirmed' | 'disputed' | 'ignored';
  sourceType: 'manual' | 'imported' | 'external_provider';
}) {
  return apiClient.post('/admin/shipping-costs', input);
}
