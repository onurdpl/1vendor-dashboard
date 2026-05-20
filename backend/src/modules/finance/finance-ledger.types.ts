export type FinanceLedgerEventType =
  | 'ORDER_CREATED'
  | 'PAYMENT_CAPTURED'
  | 'MARKETPLACE_COMMISSION_RESERVED'
  | 'VENDOR_PAYABLE_RESERVED'
  | 'SHIPPING_COST_RESERVED'
  | 'RETURN_CREATED'
  | 'REFUND_APPROVED'
  | 'REFUND_COMPLETED'
  | 'COMMISSION_REVERSED'
  | 'VENDOR_PAYABLE_REVERSED'
  | 'VENDOR_DEBT_CREATED'
  | 'MANUAL_ADJUSTMENT';

export type FinanceLedgerSourceType = 'shopify_order' | 'shopify_return' | 'shopify_refund' | 'manual' | 'system';

export type FinanceLedgerBalanceImpact = Readonly<{
  grossSalesMinor?: number;
  marketplaceCommissionMinor?: number;
  vendorPayableMinor?: number;
  shippingCostReservedMinor?: number;
  vendorDebtMinor?: number;
}>;

export type FinanceLedgerEntry = Readonly<{
  id: string;
  eventType: FinanceLedgerEventType;
  sourceType: FinanceLedgerSourceType;
  vendorId: string;
  currency: string;
  occurredAt: string;
  createdAt: string;
  sequence: number;
  orderId?: string | null;
  orderNumber?: string | null;
  lineItemId?: string | null;
  returnId?: string | null;
  refundId?: string | null;
  payoutBatchId?: string | null;
  reversalOfEntryId?: string | null;
  amountMinor: number;
  impact: FinanceLedgerBalanceImpact;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type FinanceLedgerBalance = Readonly<{
  currency: string;
  entriesProcessed: number;
  grossSalesMinor: number;
  marketplaceCommissionMinor: number;
  vendorPayableMinor: number;
  shippingCostReservedMinor: number;
  vendorDebtMinor: number;
  netVendorPositionMinor: number;
  byLineItem: Readonly<Record<string, FinanceLedgerLineItemBalance>>;
}>;

export type FinanceLedgerLineItemBalance = Readonly<{
  grossSalesMinor: number;
  marketplaceCommissionMinor: number;
  vendorPayableMinor: number;
  shippingCostReservedMinor: number;
  vendorDebtMinor: number;
  netVendorPositionMinor: number;
}>;

export type LineItemSaleReservationInput = Readonly<{
  vendorId: string;
  orderId: string;
  orderNumber?: string | null;
  lineItemId: string;
  grossAmountMinor: number;
  commissionBps: number;
  currency?: string;
  occurredAt: string;
  sequenceStart?: number;
}>;

export type RefundReversalInput = Readonly<{
  vendorId: string;
  orderId: string;
  orderNumber?: string | null;
  lineItemId: string;
  refundId: string;
  refundAmountMinor: number;
  commissionBps: number;
  payoutAlreadyPaid: boolean;
  currency?: string;
  occurredAt: string;
  sequenceStart?: number;
}>;
