import { apiClient } from '../../lib/api-client';
import { getFinanceDashboard } from '../../lib/api/finance';
import type { FinanceDashboard, PayoutBatch, PayoutBatchStatus } from '../../lib/api/contracts';

export type { FinanceDashboard, PayoutBatch, PayoutBatchStatus } from '../../lib/api/contracts';

export type PayoutOffsetObligations = {
  vendorId: string;
  currency: string;
  status: 'VERIFIED' | 'BLOCKED' | 'UNKNOWN';
  outstandingRefundAmount: string | null;
  outstandingDebtAmount: string | null;
  reservedRefundAmount: string | null;
  reservedDebtAmount: string | null;
  availableAfterReservationsRefundAmount: string | null;
  availableAfterReservationsDebtAmount: string | null;
  reasons: string[];
  writesPerformed: false;
};

export function getR1PayoutStatus(signal?: AbortSignal) {
  return apiClient.get<{ enabled: boolean }>('/admin/finance/r1-payout-status', { signal });
}

export function getAdminPayoutOffsetObligations(vendorId: string, signal?: AbortSignal) {
  return apiClient.get<PayoutOffsetObligations>(
    `/admin/finance/r1-payout-obligations/${encodeURIComponent(vendorId)}`, { signal },
  );
}

export function listPayoutBatches(input: { vendorId?: string | null; signal?: AbortSignal } = {}) {
  const params = new URLSearchParams();
  if (input.vendorId?.trim()) {
    params.set('vendorId', input.vendorId.trim());
  }
  const query = params.toString();
  return apiClient.get<PayoutBatch[]>(`/admin/payout-batches${query ? `?${query}` : ''}`, {
    signal: input.signal,
  });
}

export function getPaymentPreparationReadiness(input: { vendorId?: string | null; signal?: AbortSignal } = {}) {
  const vendorId = input.vendorId?.trim();
  if (!vendorId) {
    return Promise.resolve(null as FinanceDashboard | null);
  }
  return getFinanceDashboard({ vendorId, signal: input.signal });
}

export function preparePayoutBatch(vendorId: string, requestId?: string) {
  return apiClient.post<PayoutBatch>('/admin/payout-batches/prepare', { vendorId, ...(requestId ? { requestId } : {}) });
}

export function markPayoutBatchReview(batchId: string) {
  return apiClient.post<PayoutBatch>(`/admin/payout-batches/${encodeURIComponent(batchId)}/mark-review`, {});
}

export function markPayoutBatchPaid(
  batchId: string,
  input: { eftDeclaredAt?: string | null; eftAmountMinor?: number; paymentReference?: string | null; internalNote?: string | null } = {},
) {
  const paymentReference = input.paymentReference?.trim();
  const internalNote = input.internalNote?.trim();
  return apiClient.post<PayoutBatch>(`/admin/payout-batches/${encodeURIComponent(batchId)}/mark-paid`, {
    paidAt: new Date().toISOString(),
    ...(input.eftDeclaredAt ? { eftDeclaredAt: input.eftDeclaredAt } : {}),
    ...(input.eftAmountMinor !== undefined ? { eftAmountMinor: input.eftAmountMinor } : {}),
    ...(paymentReference ? { paymentReference } : {}),
    ...(internalNote ? { internalNote } : {}),
  });
}

export function cancelR1ReviewPayout(batchId: string, reason: string) {
  return apiClient.post<PayoutBatch>(`/admin/payout-batches/${encodeURIComponent(batchId)}/r1-cancel-review`, {
    reason, confirmEftNotSent: true,
  });
}

export function completeR1CashlessPayout(batchId: string, reason: string) {
  return apiClient.post<PayoutBatch>(`/admin/payout-batches/${encodeURIComponent(batchId)}/r1-complete-cashless`, {
    reason, confirmCashlessCompletion: true, confirmEftNotSent: true,
  });
}

export function cancelPayoutBatch(batchId: string) {
  return apiClient.post<PayoutBatch>(`/admin/payout-batches/${encodeURIComponent(batchId)}/cancel`, {});
}

export function isPaymentBatchStatus(value: string): value is PayoutBatchStatus {
  return ['draft', 'review', 'approved', 'cancelled', 'execution_pending', 'paid', 'paid_placeholder'].includes(value);
}
