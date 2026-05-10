export type OrderStatus = 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'On Hold';

export type OrderSummary = {
  id: string;
  status: OrderStatus;
  date: string;
  customer: string;
  amount: string;
  channel: string;
};

export type OrderLineItem = {
  name: string;
  quantity: number;
  price: string;
};

export type OrderDetail = OrderSummary & {
  shippingAddress: string;
  notes: string;
  items: OrderLineItem[];
  timeline: Array<{ label: string; at: string }>;
};

export type ReturnStatus = 'Pending' | 'Approved' | 'Rejected' | 'Refunded' | 'In Review';

export type ReturnSummary = {
  id: string;
  status: ReturnStatus;
  relatedOrderId: string;
  date: string;
  customer: string;
  reason: string;
  amount: string;
};

export type ReturnLineItem = {
  name: string;
  quantity: number;
  condition: 'New' | 'Opened' | 'Damaged';
};

export type ReturnDetail = ReturnSummary & {
  resolution: string;
  refundMethod: string;
  processedBy: string;
  items: ReturnLineItem[];
  timeline: Array<{ label: string; at: string }>;
};

export type FinanceTransactionStatus = 'Completed' | 'Pending' | 'Reconciled' | 'Failed';

export type FinanceSummary = {
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
