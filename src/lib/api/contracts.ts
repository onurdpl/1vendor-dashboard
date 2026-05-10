import type { VendorId } from '../auth/vendorContext';

export type OrderStatus = 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'On Hold';
export type FulfillmentStatus = 'Pending' | 'Processing' | 'Fulfilled' | 'Partially Fulfilled';
export type ShippingStatus = 'Awaiting Shipment' | 'Label Created' | 'In Transit' | 'Delivered';

export type OrderSummary = {
  id: string;
  vendorId: VendorId;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string | number;
  status: OrderStatus;
  fulfillmentStatus: FulfillmentStatus;
  shippingStatus: ShippingStatus;
  trackingNumber?: string;
  carrier?: string;
  estimatedDelivery?: string;
  date: string;
  customer: string;
  amount: string;
  channel: string;
};

export type OrderLineItem = {
  id: string;
  sku: string;
  variantTitle: string;
  name: string;
  quantity: number;
  price: string;
  vendorId: VendorId;
  fulfillmentStatus: FulfillmentStatus;
  shippingStatus: ShippingStatus;
  trackingNumber?: string;
  carrier?: string;
  estimatedDelivery?: string;
};

export type OrderDetail = OrderSummary & {
  shippingAddress: string;
  notes: string;
  lineItems: OrderLineItem[];
  items: OrderLineItem[];
  timeline: Array<{ label: string; at: string }>;
};

export type ReturnStatus = 'Pending' | 'Approved' | 'Rejected' | 'Refunded' | 'In Review';

export type ReturnSummary = {
  id: string;
  vendorId: VendorId;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string | number;
  sourceShopifyRefundId: string;
  status: ReturnStatus;
  relatedOrderId: string;
  date: string;
  customer: string;
  reason: string;
  amount: string;
};

export type ReturnLineItem = {
  id: string;
  sku: string;
  variantTitle: string;
  name: string;
  quantity: number;
  condition: 'New' | 'Opened' | 'Damaged';
  refundAmount: string;
  vendorId: VendorId;
};

export type ReturnDetail = ReturnSummary & {
  resolution: string;
  refundMethod: string;
  processedBy: string;
  refundedItems: ReturnLineItem[];
  items: ReturnLineItem[];
  timeline: Array<{ label: string; at: string }>;
};

export type FinanceTransactionStatus = 'Completed' | 'Pending' | 'Reconciled' | 'Failed';

export type FinanceSummary = {
  grossSales: string;
  refunds: string;
  netRevenue: string;
  platformFee: string;
  payoutEstimate: string;
  totalRevenue: string;
  availableBalance: string;
  pendingPayouts: string;
  refundsThisMonth: string;
};

export type FinanceTransaction = {
  id: string;
  date: string;
  description: string;
  counterparty: string;
  category: 'Payout' | 'Refund' | 'Invoice' | 'Adjustment';
  amount: string;
  status: FinanceTransactionStatus;
};

export type FinanceDashboard = {
  summary: FinanceSummary;
  transactions: FinanceTransaction[];
};

export type AutomationAlertType = 'Info' | 'Warning' | 'Critical';
export type AutomationAlertStatus = 'New' | 'In Progress' | 'Resolved';

export type AutomationAlert = {
  id: string;
  type: AutomationAlertType;
  message: string;
  status: AutomationAlertStatus;
  timestamp: string;
  source: string;
};

export type AutomationSuggestion = {
  title: string;
  description: string;
  actionLabel: string;
};

export type AutomationDashboard = {
  alerts: AutomationAlert[];
  suggestions: AutomationSuggestion[];
};

export type DashboardStat = {
  label: string;
  value: string;
};

export type DashboardOverview = {
  vendorId: string;
  vendorName: string;
  title: string;
  description: string;
  stats: DashboardStat[];
  recentActivity: string[];
  workspaceStatus: string;
};
