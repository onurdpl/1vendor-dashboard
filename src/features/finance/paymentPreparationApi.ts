import { apiClient } from '../../lib/api-client';
import { getFinanceDashboard } from '../../lib/api/finance';
import type { FinanceDashboard, PayoutBatch, PayoutBatchStatus } from '../../lib/api/contracts';

export type { FinanceDashboard, PayoutBatch, PayoutBatchStatus } from '../../lib/api/contracts';

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

export function preparePayoutBatch(vendorId: string) {
  return apiClient.post<PayoutBatch>('/admin/payout-batches/prepare', { vendorId });
}

export function markPayoutBatchReview(batchId: string) {
  return apiClient.post<PayoutBatch>(`/admin/payout-batches/${encodeURIComponent(batchId)}/mark-review`, {});
}

export function cancelPayoutBatch(batchId: string) {
  return apiClient.post<PayoutBatch>(`/admin/payout-batches/${encodeURIComponent(batchId)}/cancel`, {});
}

export function isPaymentBatchStatus(value: string): value is PayoutBatchStatus {
  return ['draft', 'review', 'approved', 'cancelled', 'execution_pending', 'paid_placeholder'].includes(value);
}
