import type { FinanceLedgerBalance, FinanceLedgerEntry } from './finance-ledger.types.js';

export type FinanceLedgerPreviewEntryDto = {
  id: string;
  eventType: FinanceLedgerEntry['eventType'];
  sourceType: FinanceLedgerEntry['sourceType'];
  lineItemId: string | null;
  returnId: string | null;
  refundId: string | null;
  amount: string;
  currency: string;
  occurredAt: string;
  impact: {
    grossSales: string | null;
    marketplaceCommission: string | null;
    vendorPayable: string | null;
    shippingCostReserved: string | null;
    vendorDebt: string | null;
  };
};

export type FinanceLedgerPreviewDto = {
  status: 'ready' | 'partial';
  currency: string;
  entries: FinanceLedgerPreviewEntryDto[];
  balance: {
    grossSales: string;
    marketplaceCommission: string;
    vendorPayable: string;
    shippingCostReserved: string;
    vendorDebt: string;
    netVendorPosition: string;
  };
  unknowns: string[];
  assumptions: string[];
  sourceFields: {
    orderId: string;
    orderNumber: string;
    allocationId: string;
    vendorId: string;
    lineItemCount: number;
    returnCount: number;
    refundCount: number;
    commissionProfile: 'configured' | 'unknown';
    shippingCost: 'confirmed' | 'provider_snapshot' | 'unknown';
    payoutAlreadyPaid: boolean;
  };
};

export type FinanceLedgerPreviewInput = {
  allocationId: string;
  vendorId: string;
  orderId: string;
  orderNumber: string;
  currency?: string;
  createdAt: string;
  lineItems: Array<{
    id: string;
    lineAmount: number;
  }>;
  returnRecords?: Array<{
    id: string;
    status: string;
    createdAt: string;
    sourceLineItemId?: string | null;
  }>;
  refundRecords?: Array<{
    id: string;
    sourceShopifyRefundId: string;
    amount: number;
    status: string;
    createdAt: string;
    lineItems?: Array<{
      sourceLineItemId: string;
      subtotal: number;
    }>;
  }>;
  commissionBps?: number | null;
  shippingCost?: {
    id: string;
    amount: number;
    currency: string;
    providerName: string;
    source: 'confirmed' | 'provider_snapshot';
    updatedAt: string;
  } | null;
  payoutAlreadyPaid?: boolean;
};

export type FinanceLedgerPreviewBuildResult = {
  preview: FinanceLedgerPreviewDto;
  balance: FinanceLedgerBalance;
  entries: ReadonlyArray<FinanceLedgerEntry>;
};
