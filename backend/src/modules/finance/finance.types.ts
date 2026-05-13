export type FinanceSummaryDto = {
  grossSales: string;
  refunds: string;
  netRevenue: string;
  platformFee: string;
  commissionVat: string;
  shippingDeductions: string;
  payoutEstimate: string;
  payoutStatus: string;
};

export type VendorFinancialProfileDto = {
  vendorId: string;
  commissionPercent: string;
  commissionVatPercent: string;
  deductShippingEnabled: boolean;
  shippingMode: 'disabled' | 'fixed' | 'external_provider';
  fixedShippingFee: string | null;
  active: boolean;
  source: 'configured' | 'default';
};

export type PayoutCalculationDto = {
  grossAmount: string;
  commission: string;
  commissionVat: string;
  shippingDeduction: string;
  refundImpact: string;
  estimatedPayout: string;
  shippingApplied: boolean;
  shippingMode: 'disabled' | 'fixed' | 'external_provider';
  profileSource: 'snapshot' | 'current' | 'default';
  commissionPercent: string;
  commissionVatPercent: string;
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
};

export type FinanceDashboardDto = {
  summary: FinanceSummaryDto;
  profile: VendorFinancialProfileDto;
  records: FinanceRecordDto[];
};

export type VendorFinancialProfileUpdateDto = {
  commissionPercent?: number;
  commissionVatPercent?: number;
  deductShippingEnabled?: boolean;
  shippingMode?: 'disabled' | 'fixed' | 'external_provider';
  fixedShippingFee?: number | null;
  active?: boolean;
};
