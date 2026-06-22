import { apiClient } from '../../lib/api-client';
import type {
  FinanceDashboard,
  FinanceDashboardSummary,
  FinanceTransaction,
  VendorDebtHistory,
  PayoutBatch,
  ReturnFinanceRecordsResponse,
  SettlementScheduleAutoDraftJobResponse,
  SettlementScheduleAutoDraftJobStatusResponse,
  SettlementScheduleCreateDraftsResponse,
  SettlementScheduleDryRunResponse,
  FinanceIntegrityAlertAcknowledgeResult,
  EconomicTransferRetryResult,
  FinanceIntegrityAlertRescanResult,
  FinanceIntegrityAlertResolveResult,
  TransferRecoveryDiagnostics,
  VendorFinancialProfile,
} from '../../lib/api/contracts';
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
    pendingReviewBalance?: string;
    accruedBalance?: string;
    payableBalance?: string;
    heldBalance?: string;
    refundedBalance?: string;
    pendingSettlement?: string;
    vendorBalance?: string;
    outstandingVendorDebt?: string;
    netPayableAfterDebt?: string;
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
    settlementRefundAdjustments?: FinanceTransaction['settlementRefundAdjustments'];
  }>;
};

type FinanceDashboardSummaryDto = {
  summary: Pick<FinanceDashboardDto['summary'], 'grossSales' | 'refunds' | 'netRevenue' | 'payoutEstimate'>;
};

type ReturnFinanceRecordsResponseDto = {
  records: Array<{
    id: string;
    category: string;
    amount: number;
    status: string;
    date: string;
    settlementRefundAdjustments?: FinanceTransaction['settlementRefundAdjustments'];
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

function readVendorRequestOptions(options: { vendorId?: string | null; signal?: AbortSignal; headers?: HeadersInit } = {}) {
  const requestOptions: { vendorId?: string; signal?: AbortSignal; headers?: HeadersInit } = {};
  if (options.vendorId) requestOptions.vendorId = options.vendorId;
  if (options.signal) requestOptions.signal = options.signal;
  if (options.headers) requestOptions.headers = options.headers;
  return Object.keys(requestOptions).length > 0 ? requestOptions : undefined;
}

export async function getFinanceDashboard(options: { limit?: number; offset?: number; vendorId?: string | null; signal?: AbortSignal; headers?: HeadersInit } = {}): Promise<FinanceDashboard> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  const path = `/finance${params.size ? `?${params.toString()}` : ''}`;
  const requestOptions = readVendorRequestOptions(options);
  const response = await (requestOptions
    ? apiClient.get<FinanceDashboardDto>(path, requestOptions)
    : apiClient.get<FinanceDashboardDto>(path));
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
      pendingPayouts: response.summary.pendingReviewBalance
        ? formatCurrency(response.summary.pendingReviewBalance)
        : payoutEstimate,
      refundsThisMonth: refunds,
      accruedBalance: response.summary.accruedBalance ? formatCurrency(response.summary.accruedBalance) : undefined,
      payableBalance: response.summary.payableBalance ? formatCurrency(response.summary.payableBalance) : undefined,
      heldBalance: response.summary.heldBalance ? formatCurrency(response.summary.heldBalance) : undefined,
      refundedBalance: response.summary.refundedBalance ? formatCurrency(response.summary.refundedBalance) : undefined,
      pendingSettlement: response.summary.pendingSettlement ? formatCurrency(response.summary.pendingSettlement) : undefined,
      vendorBalance: response.summary.vendorBalance ? formatCurrency(response.summary.vendorBalance) : undefined,
      outstandingVendorDebt: response.summary.outstandingVendorDebt
        ? formatCurrency(response.summary.outstandingVendorDebt)
        : undefined,
      netPayableAfterDebt: response.summary.netPayableAfterDebt
        ? formatCurrency(response.summary.netPayableAfterDebt)
        : undefined,
    },
    profile: response.profile,
    payoutBatchSummary: response.payoutBatchSummary
      ? {
          ...response.payoutBatchSummary,
          eligibleNetAmount: formatCurrency(response.payoutBatchSummary.eligibleNetAmount),
          outstandingDebtAmount: response.payoutBatchSummary.outstandingDebtAmount
            ? formatCurrency(response.payoutBatchSummary.outstandingDebtAmount)
            : undefined,
          debtOffsetPreviewAmount: response.payoutBatchSummary.debtOffsetPreviewAmount
            ? formatCurrency(response.payoutBatchSummary.debtOffsetPreviewAmount)
            : undefined,
          netEligibleAfterDebtOffset: response.payoutBatchSummary.netEligibleAfterDebtOffset
            ? formatCurrency(response.payoutBatchSummary.netEligibleAfterDebtOffset)
            : undefined,
          remainingDebtAfterPreview: response.payoutBatchSummary.remainingDebtAfterPreview
            ? formatCurrency(response.payoutBatchSummary.remainingDebtAfterPreview)
            : undefined,
          latestBatch: response.payoutBatchSummary.latestBatch
            ? {
                ...response.payoutBatchSummary.latestBatch,
                grossAmount: formatCurrency(response.payoutBatchSummary.latestBatch.grossAmount),
                commissionAmount: formatCurrency(response.payoutBatchSummary.latestBatch.commissionAmount),
                commissionVatAmount: formatCurrency(response.payoutBatchSummary.latestBatch.commissionVatAmount),
                shippingDeductionAmount: formatCurrency(response.payoutBatchSummary.latestBatch.shippingDeductionAmount),
                refundAmount: formatCurrency(response.payoutBatchSummary.latestBatch.refundAmount),
                payableBeforeDebtOffset: response.payoutBatchSummary.latestBatch.payableBeforeDebtOffset
                  ? formatCurrency(response.payoutBatchSummary.latestBatch.payableBeforeDebtOffset)
                  : undefined,
                outstandingDebtAmount: response.payoutBatchSummary.latestBatch.outstandingDebtAmount
                  ? formatCurrency(response.payoutBatchSummary.latestBatch.outstandingDebtAmount)
                  : undefined,
                debtOffsetAmount: response.payoutBatchSummary.latestBatch.debtOffsetAmount
                  ? formatCurrency(response.payoutBatchSummary.latestBatch.debtOffsetAmount)
                  : undefined,
                netAmount: formatCurrency(response.payoutBatchSummary.latestBatch.netAmount),
                remainingDebtAmount: response.payoutBatchSummary.latestBatch.remainingDebtAmount
                  ? formatCurrency(response.payoutBatchSummary.latestBatch.remainingDebtAmount)
                  : undefined,
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
      settlementRefundAdjustments: record.settlementRefundAdjustments ?? [],
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

export async function getFinanceSummary(options: { vendorId?: string | null; signal?: AbortSignal; headers?: HeadersInit } = {}): Promise<FinanceDashboardSummary> {
  const requestOptions = readVendorRequestOptions(options);
  const response = await (requestOptions
    ? apiClient.get<FinanceDashboardSummaryDto>('/finance/summary', requestOptions)
    : apiClient.get<FinanceDashboardSummaryDto>('/finance/summary'));

  return {
    summary: {
      grossSales: formatCurrency(response.summary.grossSales),
      refunds: formatCurrency(response.summary.refunds),
      netRevenue: formatCurrency(response.summary.netRevenue),
      payoutEstimate: formatCurrency(response.summary.payoutEstimate),
    },
  };
}

export async function getFinanceProfile(options: { vendorId?: string | null; signal?: AbortSignal; headers?: HeadersInit } = {}): Promise<VendorFinancialProfile> {
  const requestOptions = readVendorRequestOptions(options);
  return requestOptions
    ? apiClient.get<VendorFinancialProfile>('/finance/profile', requestOptions)
    : apiClient.get<VendorFinancialProfile>('/finance/profile');
}

export async function getVendorDebtHistory(options: { vendorId?: string | null; signal?: AbortSignal; headers?: HeadersInit } = {}): Promise<VendorDebtHistory> {
  const requestOptions = readVendorRequestOptions(options);
  return requestOptions
    ? apiClient.get<VendorDebtHistory>('/finance/vendor-debt-history', requestOptions)
    : apiClient.get<VendorDebtHistory>('/finance/vendor-debt-history');
}

export async function getReturnFinanceRecords(options: {
  shopifyRefundId?: string | null;
  shopifyOrderNumber?: string | number | null;
  vendorId?: string | null;
  signal?: AbortSignal;
  headers?: HeadersInit;
} = {}): Promise<ReturnFinanceRecordsResponse> {
  const params = new URLSearchParams();
  if (options.shopifyRefundId) params.set('shopifyRefundId', String(options.shopifyRefundId));
  if (options.shopifyOrderNumber) params.set('shopifyOrderNumber', String(options.shopifyOrderNumber));
  const path = `/finance/return-records${params.size ? `?${params.toString()}` : ''}`;
  const requestOptions = readVendorRequestOptions(options);
  const response = await (requestOptions
    ? apiClient.get<ReturnFinanceRecordsResponseDto>(path, requestOptions)
    : apiClient.get<ReturnFinanceRecordsResponseDto>(path));

  return {
    records: response.records.map((record) => ({
      id: record.id,
      category: mapTransactionCategory(record.category),
      amount: formatCurrency(record.amount),
      status: mapRecordStatusLabel(record.status),
      date: record.date,
      settlementRefundAdjustments: record.settlementRefundAdjustments ?? [],
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
    settlementDelayDays: number;
    settlementFrequencyType: VendorFinancialProfile['settlementFrequencyType'];
    weeklySettlementDay: VendorFinancialProfile['weeklySettlementDay'];
    autoSettlementDraftEnabled: boolean;
    autoSettlementApproveEnabled: boolean;
    autoSettlementInvoiceEnabled: boolean;
  },
): Promise<VendorFinancialProfile> {
  return apiClient.put<VendorFinancialProfile>(`/admin/vendors/${encodeURIComponent(vendorId)}/financial-profile`, input);
}

export async function getSettlementScheduleDryRun(options: {
  runDate?: string | null;
  vendorId?: string | null;
  limit?: number | null;
  signal?: AbortSignal;
  headers?: HeadersInit;
} = {}): Promise<SettlementScheduleDryRunResponse> {
  const params = new URLSearchParams();
  if (options.runDate) params.set('runDate', options.runDate);
  if (options.vendorId) params.set('vendorId', options.vendorId);
  if (options.limit) params.set('limit', String(options.limit));
  const path = `/admin/finance/settlement-schedules/dry-run${params.size ? `?${params.toString()}` : ''}`;
  return apiClient.get<SettlementScheduleDryRunResponse>(path, {
    skipVendorContext: true,
    signal: options.signal,
    headers: options.headers,
  });
}

export function createSettlementScheduleDrafts(input: {
  runDate?: string | null;
  vendorId?: string | null;
  limit?: number | null;
  confirmAutoSettlementDrafts: true;
}): Promise<SettlementScheduleCreateDraftsResponse> {
  return apiClient.post<SettlementScheduleCreateDraftsResponse>(
    '/admin/finance/settlement-schedules/create-drafts',
    input,
    { skipVendorContext: true },
  );
}

export function getSettlementScheduleAutoDraftJobStatus(options: {
  signal?: AbortSignal;
  headers?: HeadersInit;
} = {}): Promise<SettlementScheduleAutoDraftJobStatusResponse> {
  return apiClient.get<SettlementScheduleAutoDraftJobStatusResponse>(
    '/admin/finance/settlement-schedules/auto-draft-job-status',
    {
      skipVendorContext: true,
      signal: options.signal,
      headers: options.headers,
    },
  );
}

export function runSettlementScheduleAutoDraftJob(input: {
  runDate?: string | null;
  confirmScheduledSettlementAutoDraftJob: true;
}): Promise<SettlementScheduleAutoDraftJobResponse> {
  return apiClient.post<SettlementScheduleAutoDraftJobResponse>(
    '/admin/finance/settlement-schedules/run-auto-draft-job',
    input,
    { skipVendorContext: true },
  );
}

export function acknowledgeFinanceIntegrityAlert(
  alertId: string,
  input: { note: string },
): Promise<FinanceIntegrityAlertAcknowledgeResult> {
  return apiClient.post<FinanceIntegrityAlertAcknowledgeResult>(
    `/admin/finance-integrity/alerts/${encodeURIComponent(alertId)}/acknowledge`,
    input,
    { skipVendorContext: true },
  );
}

export function rescanFinanceIntegrityAlert(
  alertId: string,
  input: { dryRun?: boolean } = {},
): Promise<FinanceIntegrityAlertRescanResult> {
  return apiClient.post<FinanceIntegrityAlertRescanResult>(
    `/admin/finance-integrity/alerts/${encodeURIComponent(alertId)}/rescan`,
    input,
    { skipVendorContext: true },
  );
}

export function resolveFinanceIntegrityAlert(
  alertId: string,
  input: { note: string; confirmResolve: true },
): Promise<FinanceIntegrityAlertResolveResult> {
  return apiClient.post<FinanceIntegrityAlertResolveResult>(
    `/admin/finance-integrity/alerts/${encodeURIComponent(alertId)}/resolve`,
    input,
    { skipVendorContext: true },
  );
}

export function getTransferRecoveryDiagnostics(
  transferId: string,
  options: { signal?: AbortSignal; headers?: HeadersInit } = {},
): Promise<TransferRecoveryDiagnostics> {
  return apiClient.get<TransferRecoveryDiagnostics>(
    `/admin/finance-integrity/transfers/${encodeURIComponent(transferId)}/diagnostics`,
    {
      skipVendorContext: true,
      signal: options.signal,
      headers: options.headers,
    },
  );
}

export function retryEconomicTransfer(
  transferId: string,
  input: { note: string; confirmRetry: true },
): Promise<EconomicTransferRetryResult> {
  return apiClient.post<EconomicTransferRetryResult>(
    `/admin/finance-integrity/transfers/${encodeURIComponent(transferId)}/retry`,
    input,
    { skipVendorContext: true },
  );
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
