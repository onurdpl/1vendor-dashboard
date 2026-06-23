export type FinanceSummaryDto = {
  grossSales: string;
  refunds: string;
  netRevenue: string;
  platformFee: string;
  commissionVat: string;
  shippingDeductions: string;
  payoutEstimate: string;
  payoutStatus: string;
  pendingReviewBalance: string;
  accruedBalance: string;
  payableBalance: string;
  heldBalance: string;
  refundedBalance: string;
  pendingSettlement: string;
  vendorBalance: string;
  outstandingVendorDebt: string;
  netPayableAfterDebt: string;
};

export type PayoutBatchStatusDto =
  | 'draft'
  | 'review'
  | 'approved'
  | 'cancelled'
  | 'execution_pending'
  | 'paid_placeholder';

export type PayoutBatchSummaryDto = {
  eligibleRowCount: number;
  eligibleNetAmount: string;
  blockedRowCount: number;
  outstandingDebtAmount: string;
  debtOffsetPreviewAmount: string;
  netEligibleAfterDebtOffset: string;
  remainingDebtAfterPreview: string;
  latestBatch: PayoutBatchDto | null;
};

export type VendorDebtHistoryProductDto = {
  title: string | null;
  sku: string | null;
  quantity: number;
};

export type VendorDebtHistoryOffsetDto = {
  id: string;
  createdAt: string;
  payoutBatchId: string | null;
  payoutBatchStatus: string | null;
  offsetAmountMinor: number;
  remainingDebtAfterEventMinor: number;
};

export type VendorDebtHistoryEventDto = {
  id: string;
  createdAt: string;
  type: 'VENDOR_DEBT_CREATED' | 'VENDOR_DEBT_OFFSET' | 'MANUAL_ADJUSTMENT' | 'DEBT_WAIVED' | 'PAYABLE_EARNED' | string;
  label: string;
  vendorId: string;
  vendorName: string | null;
  orderNumber: string | null;
  shopifyOrderId: string | null;
  orderCreatedAt: string | null;
  refundReference: string | null;
  refundRecordId: string | null;
  payoutBatchId: string | null;
  payoutBatchStatus: string | null;
  itemCount: number;
  productCount: number;
  products: VendorDebtHistoryProductDto[];
  amountMinor: number;
  debtAmountMinor: number;
  remainingDebtAfterEventMinor: number;
  sourceReference: string;
  financeLedgerEntryId: string | null;
  calculation: {
    refundMinor: number | null;
    commissionReversalMinor: number | null;
    commissionVatReversalMinor: number | null;
    vendorDebtMinor: number | null;
    debtOffsetMinor: number | null;
    formula: string | null;
  };
  offsetHistory: VendorDebtHistoryOffsetDto[];
};

export type VendorDebtHistoryDto = {
  ok: true;
  writesPerformed: false;
  vendorId: string;
  currency: string;
  summary: {
    outstandingDebtMinor: number;
    totalDebtCreatedMinor: number;
    totalDebtOffsetMinor: number;
    remainingDebtMinor: number;
    lastDebtActivityAt: string | null;
  };
  events: VendorDebtHistoryEventDto[];
};

export type VendorFinancialProfileDto = {
  vendorId: string;
  commissionPercent: string;
  commissionVatPercent: string;
  deductShippingEnabled: boolean;
  shippingMode: 'disabled' | 'fixed' | 'external_provider';
  fixedShippingFee: string | null;
  settlementDelayDays: number;
  settlementFrequencyType: 'WEEKLY' | 'BIWEEKLY';
  weeklySettlementDay: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY';
  autoSettlementDraftEnabled: boolean;
  autoSettlementApproveEnabled: boolean;
  autoSettlementInvoiceEnabled: boolean;
  active: boolean;
  source: 'configured' | 'default';
};

export type PayoutCalculationDto = {
  grossAmount: string;
  commission: string;
  commissionVat: string;
  shippingDeduction: string;
  shippingVatAmount: string;
  shippingDeductionSource: 'none' | 'fixed' | 'external_provider';
  shippingCostProvider: string | null;
  shippingCostSnapshot: string | null;
  shippingCostStatus: 'snapshot' | 'pending_provider_cost' | 'not_applicable';
  refundImpact: string;
  estimatedPayout: string;
  shippingApplied: boolean;
  shippingMode: 'disabled' | 'fixed' | 'external_provider';
  profileSource: 'snapshot' | 'current' | 'default';
  commissionPercent: string;
  commissionVatPercent: string;
};

export type ShippingCostDto = {
  id: string;
  vendorId: string;
  allocationId: string;
  sourceShopifyOrderId: string;
  sourceShopifyFulfillmentId: string | null;
  providerName: string;
  providerReference: string | null;
  shippingCost: string;
  shippingVatAmount: string | null;
  currency: string;
  status: 'pending' | 'confirmed' | 'disputed' | 'ignored';
  sourceType: 'manual' | 'imported' | 'external_provider';
  createdAt: string;
  updatedAt: string;
};

export type ShippingCostInputDto = {
  vendorId: string;
  allocationId?: string;
  financeLedgerEntryId?: string;
  providerName: string;
  providerReference?: string | null;
  shippingCost: number;
  shippingVatAmount?: number | null;
  currency?: string;
  status?: ShippingCostDto['status'];
  sourceType?: ShippingCostDto['sourceType'];
  sourceShopifyFulfillmentId?: string | null;
};

export type SettlementDto = {
  status: 'pending' | 'accruing' | 'payable' | 'partially_refunded' | 'held' | 'settled' | 'disputed';
  payoutReady: boolean;
  eligibleAt: string | null;
  accruedAt: string | null;
  payableAt: string | null;
  settledAt: string | null;
  holdReason: string | null;
  note: string;
  review: {
    approvalId: string;
    approvalStatus: 'draft' | 'approved';
    commissionInvoiceId: string | null;
    commissionInvoiceStatus: string | null;
    invoiceNo: string | null;
    providerUuid: string | null;
  } | null;
};

export type PayoutBatchReferenceDto = {
  id: string;
  status: PayoutBatchStatusDto;
  netAmount: string;
  createdAt: string;
};

export type SettlementRefundAdjustmentReferenceDto = {
  id: string;
  status: 'pending' | 'partially_applied' | 'applied' | 'blocked' | 'cancelled';
  amountMinor: number;
  originalAmountMinor: number;
  appliedAmountMinor: number;
  remainingAmountMinor: number;
  currencyCode: string;
  reason: string;
  originalSettlementApprovalId: string | null;
  originalSettlementApprovalLineId: string | null;
  originalSettlementCommissionInvoiceId: string | null;
  appliedSettlementApprovalId: string | null;
  appliedSettlementApprovalLineId: string | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
  applications?: Array<{
    id: string;
    settlementApprovalId: string;
    settlementApprovalLineId: string;
    amountMinor: number;
    currencyCode: string;
    status: 'active' | 'cancelled';
    createdAt: string;
    updatedAt: string;
  }>;
  events?: Array<{
    id: string;
    eventType: 'created' | 'partially_applied' | 'applied' | 'application_cancelled' | 'adjustment_cancelled';
    createdAt: string;
    metadataJson?: unknown;
  }>;
  references?: {
    orderLabel: string;
    refundLabel: string;
    originalSettlementLabel: string | null;
    originalCommissionInvoiceLabel: string | null;
  };
};

export type FinanceRecordDto = {
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
  payoutCalculation: PayoutCalculationDto | null;
  settlement: SettlementDto;
  payoutBatch: PayoutBatchReferenceDto | null;
  settlementRefundAdjustments: SettlementRefundAdjustmentReferenceDto[];
  splitFinanceSummary: SplitFinanceSummaryDto | null;
};

export type SplitFinanceSummaryDto = {
  splitEventId: string;
  sourceAllocationId: string;
  childAllocationId: string;
  sourceFinanceLedgerEntryId: string | null;
  remainingFinanceLedgerEntryId: string | null;
  childFinanceLedgerEntryId: string | null;
  lineageRole: 'source' | 'child';
  splitReason: string;
  splitCreatedAt: string;
  refundedChildSaleBasis?: boolean;
  refundOffsetStatus?: 'settlement_review_pending' | null;
};

export type ReturnFinanceRecordDto = {
  id: string;
  category: string;
  amount: number;
  status: string;
  date: string;
  settlementRefundAdjustments: SettlementRefundAdjustmentReferenceDto[];
};

export type ReturnFinanceRecordsResponseDto = {
  records: ReturnFinanceRecordDto[];
};

export type FinanceDashboardDto = {
  summary: FinanceSummaryDto;
  profile: VendorFinancialProfileDto;
  payoutBatchSummary: PayoutBatchSummaryDto;
  records: FinanceRecordDto[];
};

export type FinanceDashboardSummaryDto = {
  summary: Pick<FinanceSummaryDto, 'grossSales' | 'refunds' | 'netRevenue' | 'payoutEstimate'>;
};

export type VendorFinancialProfileUpdateDto = {
  commissionPercent?: number;
  commissionVatPercent?: number;
  deductShippingEnabled?: boolean;
  shippingMode?: 'disabled' | 'fixed' | 'external_provider';
  fixedShippingFee?: number | null;
  settlementDelayDays?: number;
  settlementFrequencyType?: 'WEEKLY' | 'BIWEEKLY';
  weeklySettlementDay?: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY';
  autoSettlementDraftEnabled?: boolean;
  autoSettlementApproveEnabled?: boolean;
  autoSettlementInvoiceEnabled?: boolean;
  active?: boolean;
};

export type PayoutBatchLineDto = {
  id: string;
  financeLedgerEntryId: string;
  amountSnapshot: string;
  createdAt: string;
};

export type PayoutBatchDto = {
  id: string;
  vendorId: string;
  status: PayoutBatchStatusDto;
  grossAmount: string;
  commissionAmount: string;
  commissionVatAmount: string;
  shippingDeductionAmount: string;
  refundAmount: string;
  payableBeforeDebtOffset: string;
  outstandingDebtAmount: string;
  debtOffsetAmount: string;
  netAmount: string;
  remainingDebtAmount: string;
  currency: string;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  lineCount: number;
  warning: string | null;
  lines?: PayoutBatchLineDto[];
};

export type PreparePayoutBatchDto = {
  vendorId: string;
};
