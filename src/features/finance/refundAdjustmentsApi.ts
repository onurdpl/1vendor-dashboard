import { apiClient } from '../../lib/api-client';

export type RefundAdjustmentStatus = 'pending' | 'partially_applied' | 'applied' | 'blocked' | 'cancelled';

export type RefundAdjustmentApplication = {
  id: string;
  settlementApprovalId: string;
  settlementApprovalLineId: string;
  amountMinor: number;
  currencyCode: string;
  status: 'active' | 'cancelled';
  createdAt: string;
  updatedAt: string;
};

export type RefundAdjustmentEvent = {
  id: string;
  eventType: 'created' | 'partially_applied' | 'applied' | 'application_cancelled' | 'adjustment_cancelled';
  createdAt: string;
  metadataJson?: unknown;
};

export type RefundAdjustmentRecord = {
  id: string;
  refundRecordId: string;
  refundFinanceLedgerEntryId: string;
  vendorId: string;
  originalOrderId: string;
  originalSettlementApprovalId: string | null;
  originalSettlementApprovalLineId: string | null;
  originalSettlementCommissionInvoiceId: string | null;
  status: RefundAdjustmentStatus;
  amountMinor: number;
  originalAmountMinor: number;
  appliedAmountMinor: number;
  remainingAmountMinor: number;
  currencyCode: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  appliedSettlementApprovalId: string | null;
  appliedSettlementApprovalLineId: string | null;
  blockedReason: string | null;
  createdBy: string | null;
  applications: RefundAdjustmentApplication[];
  events: RefundAdjustmentEvent[];
  references?: {
    orderLabel: string;
    refundLabel: string;
    originalSettlementLabel: string | null;
    originalCommissionInvoiceLabel: string | null;
  };
};

export type RefundAdjustmentsListResponse = {
  ok: true;
  writesPerformed: false;
  count: number;
  statuses: Partial<Record<RefundAdjustmentStatus, number>>;
  records: RefundAdjustmentRecord[];
};

export function listRefundAdjustments(input: { vendorId?: string | null; signal?: AbortSignal } = {}) {
  const params = new URLSearchParams();
  if (input.vendorId?.trim()) {
    params.set('vendorId', input.vendorId.trim());
  }
  const query = params.toString();
  return apiClient.get<RefundAdjustmentsListResponse>(
    `/admin/finance/refund-adjustments${query ? `?${query}` : ''}`,
    { signal: input.signal },
  );
}
