// Structural presentation evidence shared by the backend search and the frontend.
// Financial authority remains in the ledger and settlement services.
export type FinanceTransaction = {
  id: string;
  date: string;
  description: string;
  counterparty: string;
  category: 'Payout' | 'Refund' | 'Invoice' | 'Adjustment';
  amount: string;
  status: 'Completed' | 'Pending' | 'Reconciled' | 'Failed' | 'Recorded';
  payoutStatus?: string;
  shopifyOrderNumber?: string;
  shopifyOrderId?: string;
  shopifyRefundId?: string;
  payoutCalculation?: {
    grossAmount: string; commission: string; commissionVat: string;
    shippingDeduction: string; shippingVatAmount?: string;
    shippingDeductionSource?: 'none' | 'fixed' | 'external_provider';
    shippingCostProvider?: string | null; shippingCostSnapshot?: string | null;
    shippingCostStatus?: 'snapshot' | 'pending_provider_cost' | 'not_applicable';
    refundImpact: string; estimatedPayout: string; shippingApplied: boolean;
    shippingMode: 'disabled' | 'fixed' | 'external_provider';
    profileSource?: 'snapshot' | 'current' | 'default';
    commissionPercent?: string; commissionVatPercent?: string;
  } | null;
  settlement?: {
    status: 'pending' | 'accruing' | 'payable' | 'partially_refunded' | 'held' | 'settled' | 'disputed' | 'cashless_completed';
    payoutReady: boolean; eligibleAt: string | null; accruedAt: string | null;
    payableAt: string | null; settledAt: string | null; holdReason: string | null; note: string;
    review?: { approvalId: string; approvalStatus: 'draft' | 'approved'; commissionInvoiceId: string | null;
      commissionInvoiceStatus: string | null; invoiceNo: string | null; providerUuid: string | null } | null;
  };
  payoutBatch?: {
    id: string;
    status: 'draft' | 'review' | 'approved' | 'cancelled' | 'execution_pending' | 'paid' | 'paid_placeholder' | 'cashless_completed';
    netAmount: string; r1OffsetAmount?: string; r1ApprovedPayable?: string | null;
    createdAt: string; paidAt?: string | null; paymentReference?: string | null;
  } | null;
  settlementRefundAdjustments?: Array<{
    id: string; refundRecordId?: string; originalOrderId?: string;
    status: 'pending' | 'partially_applied' | 'applied' | 'blocked' | 'cancelled';
    amountMinor: number; originalAmountMinor: number; appliedAmountMinor: number;
    remainingAmountMinor: number; currencyCode: string; reason: string;
    originalSettlementApprovalId: string | null; originalSettlementApprovalLineId: string | null;
    originalSettlementCommissionInvoiceId: string | null; appliedSettlementApprovalId: string | null;
    appliedSettlementApprovalLineId: string | null; blockedReason: string | null;
    createdAt: string; updatedAt: string;
    applications?: Array<{ id: string; settlementApprovalId: string; settlementApprovalLineId: string;
      amountMinor: number; currencyCode: string; status: 'active' | 'cancelled'; createdAt: string; updatedAt: string }>;
    events?: Array<{ id: string; eventType: 'created' | 'partially_applied' | 'applied' | 'application_cancelled' | 'adjustment_cancelled';
      createdAt: string; metadataJson?: unknown }>;
    references?: { orderLabel: string; refundLabel: string; originalSettlementLabel: string | null;
      originalCommissionInvoiceLabel: string | null };
  }>;
  splitFinanceSummary?: {
    splitEventId: string; sourceAllocationId: string; childAllocationId: string;
    sourceFinanceLedgerEntryId: string | null; remainingFinanceLedgerEntryId: string | null;
    childFinanceLedgerEntryId: string | null; lineageRole: 'source' | 'child';
    splitReason: string; splitCreatedAt: string; refundedChildSaleBasis?: boolean;
    refundOffsetStatus?: 'settlement_review_pending' | null;
  } | null;
};

export type FinanceDashboard = {
  summary: { outstandingVendorDebt?: string };
  payoutBatchSummary?: { blockedRowCount?: number; eligibleRowCount?: number; outstandingDebtAmount?: string };
};
