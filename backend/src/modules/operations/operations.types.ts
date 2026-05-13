export type OperationsQueueItemType =
  | 'pending_reassignment'
  | 'vendor_blocked'
  | 'awaiting_shipment'
  | 'refund_attention'
  | 'operational_signal'
  | 'automation_action';

export type OperationsQueueSeverity = 'critical' | 'warning' | 'attention' | 'normal';

export type OperationsQueueItemDto = {
  id: string;
  type: OperationsQueueItemType;
  severity: OperationsQueueSeverity;
  title: string;
  description: string;
  vendorId: string;
  vendorName: string;
  relatedOrderId: string | null;
  relatedShopifyOrderId: string | null;
  relatedReturnId: string | null;
  relatedRefundId: string | null;
  status: string;
  createdAt: string;
  actionLabel: string;
  destinationPath: string | null;
};

export type OperationsQueueSummaryDto = {
  total: number;
  critical: number;
  warning: number;
  attention: number;
  normal: number;
  pendingReassignment: number;
  vendorBlocked: number;
  awaitingShipment: number;
  refundAttention: number;
  operationalSignals: number;
  automationActions: number;
};

export type OperationsQueueDashboardDto = {
  summary: OperationsQueueSummaryDto;
  items: OperationsQueueItemDto[];
};
