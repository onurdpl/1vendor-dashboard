export type FinanceSummaryDto = {
  grossSales: string;
  refunds: string;
  netRevenue: string;
  platformFee: string;
  payoutEstimate: string;
  payoutStatus: string;
};

export type FinanceRecordDto = {
  id: string;
  type: string;
  amount: string;
  status: string;
  description: string | null;
  relatedOrderId: string | null;
  relatedReturnId: string | null;
  relatedRefundId: string | null;
  createdAt: string;
};

export type FinanceDashboardDto = {
  summary: FinanceSummaryDto;
  records: FinanceRecordDto[];
};
