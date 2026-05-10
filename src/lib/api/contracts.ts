import type { VendorId } from '../auth/vendorContext';

export type OrderStatus = 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'On Hold';
export type FulfillmentStatus = 'Pending' | 'Processing' | 'Fulfilled' | 'Partially Fulfilled';
export type ShippingStatus = 'Awaiting Shipment' | 'Label Created' | 'In Transit' | 'Delivered';
export type AllocationStatus = 'active' | 'vendor_blocked' | 'pending_reassignment' | 'reassigned' | 'fulfilled';
export type AllocationBlockReason =
  | 'out_of_stock'
  | 'vendor_cancelled'
  | 'damaged_inventory'
  | 'fulfillment_issue';

export type AssignmentHistoryAction = 'assigned' | 'vendor_blocked' | 'reassignment_requested' | 'reassigned';

export type AssignmentHistoryEntry = {
  action: AssignmentHistoryAction;
  fromVendorId: VendorId | null;
  toVendorId: VendorId;
  reason?: string;
  actorName: string;
  actorRole: 'admin' | 'vendor' | 'support' | 'finance' | 'system';
  createdAt: string;
};

export type OrderSummary = {
  originalVendorId: VendorId;
  assignedVendorId: VendorId;
  id: string;
  // Compatibility alias for current pages/hooks. Maps to assignedVendorId.
  vendorId: VendorId;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string | number;
  status: OrderStatus;
  allocationStatus: AllocationStatus;
  cancellationReason?: AllocationBlockReason;
  reassignmentRequired: boolean;
  assignmentBlockedAt?: string;
  assignmentHistory: AssignmentHistoryEntry[];
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
  originalVendorId: VendorId;
  assignedVendorId: VendorId;
  id: string;
  sku: string;
  variantTitle: string;
  name: string;
  quantity: number;
  price: string;
  // Compatibility alias for current pages/hooks. Maps to assignedVendorId.
  vendorId: VendorId;
  fulfillmentStatus: FulfillmentStatus;
  allocationStatus: AllocationStatus;
  cancellationReason?: AllocationBlockReason;
  reassignmentRequired: boolean;
  assignmentBlockedAt?: string;
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

export type VendorAllocationSummary = {
  originalVendorId: VendorId;
  assignedVendorId: VendorId;
  vendorId: VendorId;
  vendorName: string;
  allocationOrderId: string;
  status: OrderStatus;
  allocationStatus: AllocationStatus;
  cancellationReason?: AllocationBlockReason;
  reassignmentRequired: boolean;
  assignmentBlockedAt?: string;
  reassignmentCandidateVendorIds: VendorId[];
  reassignmentNote?: string;
  reassignedAt?: string;
  reassignedBy?: string;
  assignmentHistory: AssignmentHistoryEntry[];
  fulfillmentStatus: FulfillmentStatus;
  shippingStatus: ShippingStatus;
  trackingNumber?: string;
  carrier?: string;
  estimatedDelivery?: string;
  allocationTotal: string;
  lineItems: OrderLineItem[];
  refundedItems: ReturnLineItem[];
  refundTotal: string;
};

export type ShopifyOrderBreakdown = {
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string | number;
  customer: string;
  createdAt: string;
  allocations: VendorAllocationSummary[];
};

export type ReturnStatus = 'Pending' | 'Approved' | 'Rejected' | 'Refunded' | 'In Review';

export type ReturnSummary = {
  originalVendorId: VendorId;
  assignedVendorId: VendorId;
  id: string;
  // Compatibility alias for current pages/hooks. Maps to assignedVendorId.
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
  originalVendorId: VendorId;
  assignedVendorId: VendorId;
  id: string;
  sku: string;
  variantTitle: string;
  name: string;
  quantity: number;
  condition: 'New' | 'Opened' | 'Damaged';
  refundAmount: string;
  // Compatibility alias for current pages/hooks. Maps to assignedVendorId.
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
