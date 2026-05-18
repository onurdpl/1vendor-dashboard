import type { VendorId } from '../auth/vendorContext';

export type OrderStatus = 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'On Hold';
export type FulfillmentStatus = 'Pending' | 'Processing' | 'Fulfilled' | 'Partially Fulfilled';
export type ShippingStatus = 'Awaiting Shipment' | 'Label Created' | 'In Transit' | 'Delivered';
export type FulfillmentActionState = 'awaiting_shipment' | 'label_created' | 'shipped' | 'delivered';
export type AllocationStatus = 'active' | 'vendor_blocked' | 'pending_reassignment' | 'reassigned' | 'fulfilled';
export type AllocationBlockReason =
  | 'out_of_stock'
  | 'vendor_cancelled'
  | 'damaged_inventory'
  | 'fulfillment_issue';

export type ShipmentExecution = {
  id: string;
  allocationId: string;
  vendorId: string;
  sourceShopifyOrderId?: string | null;
  sourceShopifyOrderNumber?: string | null;
  sourceShopifyFulfillmentId?: string | null;
  provider: 'hepsijet' | 'kargo_entegrator' | 'mng' | 'yurtici' | 'aras';
  providerShipmentId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  shipmentStatus: 'pending' | 'created' | 'failed' | 'in_transit' | 'delivered' | 'returned' | 'cancelled';
  desi: string;
  cargoIntegrationId?: string | null;
  warehouseId?: string | null;
  shippingCost: string | null;
  shippingVat: string | null;
  currency: string;
  shippingCostLinked: boolean;
  createdAt: string;
  updatedAt: string;
  providerResponseSummary?: {
    httpStatus: number | null;
    ok: boolean | null;
    contentType: string | null;
    parsedBodyType: string | null;
    responseKeys: string[];
    providerError: string | null;
    dryRun: boolean | null;
    disabledGates: string[];
    providerShipmentIdPresent: boolean;
    trackingNumberPresent: boolean;
    labelPresent: boolean;
    statusField: string | null;
    detectedResponseFormat?: string | null;
    responseSnippet?: string | null;
    authHeaderMode?: string | null;
  };
};

export type ShippingProviderDiagnostics = {
  provider: 'hepsijet' | 'kargo_entegrator' | 'mng' | 'yurtici' | 'aras';
  executionReady: boolean;
  shippingExecutionEnabled: boolean;
  providerSelected?: boolean;
  providerEnabled: boolean;
  baseUrlConfigured: boolean;
  apiKeyConfigured: boolean;
  cargoIntegrationIdConfigured?: boolean;
  warehouseIdConfigured?: boolean;
  defaultDesiConfigured?: boolean;
  notificationUrlConfigured?: boolean;
  webhookRouteImplemented?: boolean;
  receiverAddressAvailability?: 'unknown_required';
  dummyKargoSupport?: 'not_implemented';
  statusSyncSupport?: 'not_implemented';
  missing: string[];
  deprecatedEnvFallbacks?: string[];
  warnings?: string[];
};

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
  fulfillmentActionState: FulfillmentActionState;
  fulfillmentActionAvailable: boolean;
  fulfilledAt?: string;
  fulfilledByVendorId?: VendorId;
  shipmentCreatedAt?: string;
  shipmentUpdatedAt?: string;
  fulfillmentStatus: FulfillmentStatus;
  shippingStatus: ShippingStatus;
  trackingNumber?: string;
  carrier?: string;
  trackingUrl?: string;
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
  fulfillmentActionState: FulfillmentActionState;
  fulfillmentActionAvailable: boolean;
  fulfilledAt?: string;
  fulfilledByVendorId?: VendorId;
  shipmentCreatedAt?: string;
  shipmentUpdatedAt?: string;
  shippingStatus: ShippingStatus;
  trackingNumber?: string;
  carrier?: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
};

export type OrderDetail = OrderSummary & {
  shippingAddress: string;
  notes: string;
  lineItems: OrderLineItem[];
  items: OrderLineItem[];
  timeline: Array<{ label: string; at: string }>;
  shipmentExecution?: ShipmentExecution | null;
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
  fulfillmentActionState: FulfillmentActionState;
  fulfillmentActionAvailable: boolean;
  fulfilledAt?: string;
  fulfilledByVendorId?: VendorId;
  shipmentCreatedAt?: string;
  shipmentUpdatedAt?: string;
  fulfillmentStatus: FulfillmentStatus;
  shippingStatus: ShippingStatus;
  trackingNumber?: string;
  carrier?: string;
  trackingUrl?: string;
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

export type ReturnStatus =
  | 'Requested'
  | 'Approved'
  | 'Declined'
  | 'Cancelled'
  | 'Closed'
  | 'Processed'
  | 'Refunded'
  | 'Rejected'
  | 'Pending'
  | 'In Review';

export type ReturnSummary = {
  originalVendorId: VendorId;
  assignedVendorId: VendorId;
  id: string;
  // Compatibility alias for current pages/hooks. Maps to assignedVendorId.
  vendorId: VendorId;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string | number;
  sourceShopifyRefundId: string;
  sourceShopifyReturnId?: string | null;
  sourceType?: 'shopify_refund' | 'shopify_return_request';
  status: ReturnStatus;
  relatedOrderId: string;
  date: string;
  updatedAt?: string;
  customer: string;
  reason: string;
  returnReasonNote?: string | null;
  returnCarrierName?: string | null;
  returnTrackingNumber?: string | null;
  returnTrackingUrl?: string | null;
  vendorReceivedAt?: string | null;
  vendorReviewedAt?: string | null;
  vendorDecision?: 'approved' | 'rejected' | null;
  vendorDecisionReason?: string | null;
  amount: string;
  itemTitle?: string | null;
  displayTitle?: string | null;
  variantTitle?: string | null;
  refundedSkus?: string[];
  refundedItems?: ReturnLineItem[];
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

export type SupportTicketPriority = 'low' | 'normal' | 'high';
export type SupportTicketStatus = 'OPEN' | 'IN_REVIEW' | 'WAITING_FOR_VENDOR' | 'RESOLVED' | 'CLOSED';
export type SupportTicketCategory = 'ORDER' | 'RETURN' | 'REFUND' | 'SHIPMENT' | 'TRACKING' | 'PAYOUT' | 'INVOICE' | 'OTHER';
export type SupportTicketContextType = 'order' | 'return' | 'shipment' | 'general';

export type CreateSupportTicketInput = {
  subject: string;
  message: string;
  priority: SupportTicketPriority;
  category?: SupportTicketCategory;
  contextType: SupportTicketContextType;
  contextId?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
};

export type SupportTicketNote = {
  id: string;
  supportTicketId: string;
  authorUserId: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
};

export type SupportTicketReply = {
  id: string;
  supportTicketId: string;
  authorUserId: string;
  authorName: string;
  authorRole: 'ADMIN' | 'VENDOR';
  message: string;
  createdAt: string;
};

export type SupportTicketSla = {
  isOverdue: boolean;
  dueLabel: string;
  escalationLevel: 'none' | 'due_soon' | 'overdue' | 'escalated';
  dueAt: string | null;
  overdueByHours: number | null;
};

export type SupportTicketContextSummary = {
  route?: string;
  path?: string;
  orderNumber?: string;
  returnNumber?: string;
  status?: string;
  flags?: Record<string, boolean>;
};

export type SupportTicket = {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  createdByRole: string;
  vendorId: VendorId;
  vendorName: string | null;
  subject: string;
  message: string;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  category: SupportTicketCategory;
  assigneeUserId: string | null;
  assigneeName: string | null;
  vendorUnreadCount: number;
  adminUnreadCount: number;
  lastReplyAt: string | null;
  lastReplyByRole: 'ADMIN' | 'VENDOR' | null;
  firstResponseDueAt: string | null;
  nextResponseDueAt: string | null;
  escalatedAt: string | null;
  escalationReason: string | null;
  sla: SupportTicketSla | null;
  contextType: SupportTicketContextType;
  contextId: string | null;
  contextSummary?: SupportTicketContextSummary | null;
  contextSnapshot?: unknown;
  resolvedAt: string | null;
  closedAt: string | null;
  notes?: SupportTicketNote[];
  replies?: SupportTicketReply[];
};

export type SupportAnalyticsKpis = {
  openTickets: number;
  overdueTickets: number;
  avgFirstResponseHours: number | null;
  avgResolutionHours: number | null;
  waitingOnVendor: number;
  resolvedToday: number;
};

export type SupportAnalyticsCategoryInsight = {
  category: SupportTicketCategory;
  ticketCount: number;
  overdueCount: number;
  overduePercent: number;
  avgResolutionHours: number | null;
};

export type SupportAnalyticsVendorInsight = {
  vendorId: VendorId;
  vendorName: string | null;
  ticketCount: number;
  unresolvedCount: number;
  overdueCount: number;
  overduePercent: number;
  avgResolutionHours: number | null;
  needsAttention: boolean;
};

export type SupportAnalyticsSla = {
  overdueTickets: number;
  overduePercent: number;
  avgResponseDelayHours: number | null;
  avgResolutionHours: number | null;
  breachesByCategory: Array<{
    category: SupportTicketCategory;
    overdueCount: number;
  }>;
};

export type SupportAnalyticsAssignmentInsight = {
  assigneeName: string;
  ticketCount: number;
  overdueCount: number;
  avgFirstResponseHours: number | null;
  unassignedOpenTickets: number;
};

export type SupportAnalyticsTrendPoint = {
  date: string;
  created: number;
  resolved: number;
  overdue: number;
};

export type SupportAnalytics = {
  generatedAt: string;
  kpis: SupportAnalyticsKpis;
  categoryInsights: SupportAnalyticsCategoryInsight[];
  vendorInsights: SupportAnalyticsVendorInsight[];
  slaInsights: SupportAnalyticsSla;
  assignmentInsights: SupportAnalyticsAssignmentInsight[];
  trends: SupportAnalyticsTrendPoint[];
};

export type FinanceTransactionStatus = 'Completed' | 'Pending' | 'Reconciled' | 'Failed' | 'Recorded';

export type FinanceSummary = {
  grossSales: string;
  refunds: string;
  netRevenue: string;
  platformFee: string;
  commissionVat?: string;
  shippingDeductions?: string;
  payoutEstimate: string;
  totalRevenue: string;
  availableBalance: string;
  pendingPayouts: string;
  refundsThisMonth: string;
  accruedBalance?: string;
  payableBalance?: string;
  heldBalance?: string;
  refundedBalance?: string;
  pendingSettlement?: string;
};

export type PayoutBatchStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'cancelled'
  | 'execution_pending'
  | 'paid_placeholder';

export type PayoutBatch = {
  id: string;
  vendorId: string;
  status: PayoutBatchStatus;
  grossAmount: string;
  commissionAmount: string;
  commissionVatAmount: string;
  shippingDeductionAmount: string;
  refundAmount: string;
  netAmount: string;
  currency: string;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  lineCount: number;
  warning: string | null;
};

export type InvoiceExecutionReference = {
  id: string;
  provider: 'bizimhesap' | 'parasut' | 'birfatura';
  status: 'pending' | 'created' | 'failed' | 'cancelled' | 'unknown';
  visibilityStatus:
    | 'invoice_missing'
    | 'accounting_sync_pending'
    | 'accounting_synced'
    | 'invoice_linked'
    | 'invoice_visibility_incomplete'
    | 'provider_failed'
    | 'cancelled';
  visibilityLabel: string;
  reconciliationState:
    | 'invoice_missing'
    | 'invoice_pending'
    | 'accounting_sync_pending'
    | 'invoice_linked'
    | 'invoice_visibility_incomplete'
    | 'provider_failed'
    | 'cancelled';
  finalInvoiceState:
    | 'not_requested'
    | 'draft_or_synced'
    | 'finalized_visible'
    | 'visibility_unknown'
    | 'failed'
    | 'cancelled';
  syncSemantics: 'none' | 'draft_accounting_sync' | 'final_invoice_visibility';
  providerCapabilities: {
    supportsDraftSubmission: boolean;
    supportsFinalInvoiceVisibility: boolean;
    supportsPdfLink: boolean;
    supportsStatusSync: boolean;
    note: string;
  };
  providerInvoiceGuid: string | null;
  providerInvoiceNo: string | null;
  providerPdfUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceExecutionResponseSummary = {
  id: string;
  provider: 'bizimhesap' | 'parasut' | 'birfatura';
  status: 'pending' | 'created' | 'failed' | 'cancelled' | 'unknown';
  providerInvoiceGuidPresent: boolean;
  providerInvoiceNoPresent: boolean;
  providerPdfUrlPresent: boolean;
  response: {
    httpStatus: number | null;
    ok: boolean | null;
    contentType: string | null;
    parsedBodyType: string | null;
    bodyKeys: string[];
    nestedBodyKeys: string[];
    providerError: string | null;
    parsedGuidPresent: boolean;
    parsedPdfUrlPresent: boolean;
  } | null;
};

export type PayoutBatchSummary = {
  eligibleRowCount: number;
  eligibleNetAmount: string;
  blockedRowCount: number;
  latestBatch: PayoutBatch | null;
};

export type VendorFinancialProfile = {
  vendorId: string;
  commissionPercent: string;
  commissionVatPercent: string;
  deductShippingEnabled: boolean;
  shippingMode: 'disabled' | 'fixed' | 'external_provider';
  fixedShippingFee: string | null;
  active: boolean;
  source: 'configured' | 'default';
};

export type PayoutCalculation = {
  grossAmount: string;
  commission: string;
  commissionVat: string;
  shippingDeduction: string;
  shippingVatAmount?: string;
  shippingDeductionSource?: 'none' | 'fixed' | 'external_provider';
  shippingCostProvider?: string | null;
  shippingCostSnapshot?: string | null;
  shippingCostStatus?: 'snapshot' | 'pending_provider_cost' | 'not_applicable';
  refundImpact: string;
  estimatedPayout: string;
  shippingApplied: boolean;
  shippingMode: 'disabled' | 'fixed' | 'external_provider';
  profileSource?: 'snapshot' | 'current' | 'default';
  commissionPercent?: string;
  commissionVatPercent?: string;
};

export type FinanceTransaction = {
  id: string;
  date: string;
  description: string;
  counterparty: string;
  category: 'Payout' | 'Refund' | 'Invoice' | 'Adjustment';
  amount: string;
  status: FinanceTransactionStatus;
  shopifyOrderNumber?: string;
  shopifyOrderId?: string;
  shopifyRefundId?: string;
  payoutCalculation?: PayoutCalculation | null;
  settlement?: {
    status: 'pending' | 'accruing' | 'payable' | 'partially_refunded' | 'held' | 'settled' | 'disputed';
    payoutReady: boolean;
    eligibleAt: string | null;
    accruedAt: string | null;
    payableAt: string | null;
    settledAt: string | null;
    holdReason: string | null;
    note: string;
  };
  payoutBatch?: {
    id: string;
    status: PayoutBatchStatus;
    netAmount: string;
    createdAt: string;
  } | null;
  invoiceExecution?: InvoiceExecutionReference | null;
};

export type FinanceDashboard = {
  summary: FinanceSummary;
  profile?: VendorFinancialProfile;
  payoutBatchSummary?: PayoutBatchSummary;
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

export type DashboardPriorityItem = {
  label: string;
  value: string;
  tone: 'severity-normal' | 'severity-attention' | 'severity-warning' | 'severity-critical';
  description?: string;
};

export type DashboardFinanceSnapshot = {
  grossSales: string;
  refunds: string;
  netRevenue: string;
  payoutEstimate: string;
};

export type DashboardDiagnosticsSummary = {
  failedWebhooks: number;
  stuckReceived: number;
  fulfillmentSyncFailures: number;
};

export type DashboardObservabilitySummary = {
  health: 'healthy' | 'warning' | 'degraded' | 'critical';
  retryPressureScore: number;
  deadLetterReady: number;
  failedWebhooks24h: number;
  successRate24h: number;
  reconciliationBacklog: number;
  staleStateCount: number;
  note: string;
};

export type OperationalSignalSeverity = 'info' | 'warning' | 'high' | 'critical';
export type OperationalSignalStatus = 'active' | 'acknowledged' | 'resolved' | 'ignored';
export type OperationalSignalSourceArea =
  | 'payout'
  | 'refund'
  | 'fulfillment'
  | 'diagnostics'
  | 'reconciliation'
  | 'shipping_cost'
  | 'settlement';

export type OperationalSignal = {
  id: string;
  type: string;
  severity: OperationalSignalSeverity;
  sourceArea: OperationalSignalSourceArea;
  vendorId: string | null;
  allocationId: string | null;
  financeLedgerEntryId: string | null;
  payoutBatchId: string | null;
  operationalJobId: string | null;
  title: string;
  description: string;
  suggestedAction: string | null;
  status: OperationalSignalStatus;
  ruleKey: string;
  triggeredAt: string;
  resolvedAt: string | null;
};

export type OperationalSignalsResponse = {
  summary: {
    total: number;
    critical: number;
    high: number;
    warning: number;
    info: number;
  };
  signals: OperationalSignal[];
};

export type NotificationStatus = 'pending' | 'delivered' | 'read' | 'dismissed' | 'skipped' | 'failed';
export type NotificationRecipientRole = 'admin' | 'vendor';
export type NotificationChannel = 'in_app' | 'email_placeholder' | 'slack_placeholder';

export type NotificationIntent = {
  id: string;
  signalId: string | null;
  vendorId: string | null;
  recipientRole: NotificationRecipientRole;
  channel: NotificationChannel;
  status: NotificationStatus;
  title: string;
  message: string;
  severity: OperationalSignalSeverity;
  deliveredAt: string | null;
  readAt: string | null;
  metadata?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type NotificationsResponse = {
  summary: {
    total: number;
    unread: number;
    critical: number;
    high: number;
    warning: number;
  };
  notifications: NotificationIntent[];
};

export type DashboardNotificationSummary = {
  unread: number;
  highPriority: number;
  latest: Array<{
    id: string;
    title: string;
    severity: OperationalSignalSeverity;
    status: NotificationStatus;
  }>;
};

export type DashboardOverview = {
  vendorId: string;
  vendorName: string;
  title: string;
  description: string;
  stats: DashboardStat[];
  recentActivity: string[];
  workspaceStatus: string;
  priorityWork: DashboardPriorityItem[];
  financeSnapshot?: DashboardFinanceSnapshot;
  diagnosticsSummary?: DashboardDiagnosticsSummary;
  observabilitySummary?: DashboardObservabilitySummary;
  notificationSummary?: DashboardNotificationSummary;
  partialDataWarnings?: string[];
};

export type OperationsQueueItemType =
  | 'pending_reassignment'
  | 'vendor_blocked'
  | 'awaiting_shipment'
  | 'refund_attention'
  | 'operational_signal'
  | 'automation_action';
export type OperationsQueueSeverity = 'low' | 'medium' | 'high' | 'critical';

export type OperationsQueueItem = {
  id: string;
  type: OperationsQueueItemType;
  severity: OperationsQueueSeverity;
  title: string;
  description: string;
  vendorId: VendorId;
  vendorName?: string;
  relatedOrderId?: string;
  relatedShopifyOrderId?: string;
  status: string;
  createdAt: string;
  actionLabel?: string;
  actionTo?: string;
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

export type OperationsAttentionItem = {
  id: string;
  type: OperationsAttentionType;
  severity: OperationsAttentionSeverity;
  vendorId: VendorId | string;
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

export type OperationsAttentionSection = {
  key: 'support' | 'shipment' | 'return' | 'finance';
  title: string;
  count: number;
  critical: number;
  warning: number;
  items: OperationsAttentionItem[];
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

export type OperationsRecommendation = {
  id: string;
  type: OperationsRecommendationType;
  severity: OperationsAttentionSeverity;
  title: string;
  description: string;
  recommendedAction: string;
  relatedObjectType: string;
  relatedObjectId: string | null;
  vendor: {
    id: VendorId | string;
    name: string;
  };
  createdFromSignal: string;
  deepLink: string | null;
  vendorVisible: boolean;
  createdAt: string;
};

export type OperationsVendorRisk = {
  vendorId: VendorId | string;
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

export type OperationsActivity = {
  id: string;
  type: OperationsAttentionType;
  severity: OperationsAttentionSeverity;
  vendorId: VendorId | string;
  vendorName: string;
  title: string;
  description: string;
  occurredAt: string;
  destinationPath: string | null;
};

export type OperationsAttentionDashboard = {
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
  queue: OperationsAttentionItem[];
  sections: OperationsAttentionSection[];
  recommendations: OperationsRecommendation[];
  vendorRisks: OperationsVendorRisk[];
  recentActivity: OperationsActivity[];
};
