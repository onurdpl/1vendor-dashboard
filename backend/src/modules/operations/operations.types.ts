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

export type OperationsAttentionSeverity = 'info' | 'warning' | 'critical';

export type OperationsAttentionType =
  | 'support'
  | 'shipment'
  | 'return'
  | 'finance'
  | 'vendor_risk'
  | 'operational_signal'
  | 'automation';

export type OperationsAttentionItemDto = {
  id: string;
  type: OperationsAttentionType;
  severity: OperationsAttentionSeverity;
  vendorId: string;
  vendorName: string;
  objectType: string;
  objectReference: string;
  objectId: string | null;
  status: string;
  ageHours: number;
  title: string;
  description: string;
  recommendedAction: string;
  destinationPath: string | null;
  createdAt: string;
};

export type OperationsVendorRiskDto = {
  vendorId: string;
  vendorName: string;
  riskLevel: OperationsAttentionSeverity;
  totalAttentionItems: number;
  criticalItems: number;
  warningItems: number;
  supportItems: number;
  shipmentItems: number;
  returnItems: number;
  financeItems: number;
  drivers: string[];
};

export type OperationsActivityDto = {
  id: string;
  type: OperationsAttentionType;
  severity: OperationsAttentionSeverity;
  vendorId: string;
  vendorName: string;
  title: string;
  description: string;
  occurredAt: string;
  destinationPath: string | null;
};

export type OperationsAttentionSectionDto = {
  key: 'support' | 'shipment' | 'return' | 'finance';
  title: string;
  count: number;
  critical: number;
  warning: number;
  items: OperationsAttentionItemDto[];
};

export type OperationsRecommendationType =
  | 'support_escalation'
  | 'support_assignment'
  | 'shipment_tracking'
  | 'shipment_stale'
  | 'return_review'
  | 'return_refund'
  | 'finance_review'
  | 'invoice_retry'
  | 'vendor_risk'
  | 'automation_review';

export type OperationsRecommendationDto = {
  id: string;
  type: OperationsRecommendationType;
  severity: OperationsAttentionSeverity;
  title: string;
  description: string;
  recommendedAction: string;
  relatedObjectType: string;
  relatedObjectId: string | null;
  vendor: {
    id: string;
    name: string;
  };
  createdFromSignal: string;
  deepLink: string | null;
  vendorVisible: boolean;
  createdAt: string;
};

export type OperationsAttentionDashboardDto = {
  generatedAt: string;
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    overdueSupport: number;
    shipmentIssues: number;
    returnBacklog: number;
    financeReview: number;
    vendorRisks: number;
  };
  queue: OperationsAttentionItemDto[];
  sections: OperationsAttentionSectionDto[];
  recommendations: OperationsRecommendationDto[];
  vendorRisks: OperationsVendorRiskDto[];
  recentActivity: OperationsActivityDto[];
};
