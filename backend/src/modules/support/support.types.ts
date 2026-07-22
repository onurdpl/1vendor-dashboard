export type SupportTicketPriority = 'low' | 'normal' | 'high';
export type SupportTicketStatus = 'OPEN' | 'IN_REVIEW' | 'WAITING_FOR_VENDOR' | 'RESOLVED' | 'CLOSED';
export type SupportTicketCategory = 'ORDER' | 'RETURN' | 'REFUND' | 'SHIPMENT' | 'TRACKING' | 'PAYOUT' | 'INVOICE' | 'OTHER';
export type SupportTicketContextType = 'order' | 'return' | 'shipment' | 'general';

export type CreateSupportTicketInput = {
  subject?: unknown;
  message?: unknown;
  priority?: unknown;
  category?: unknown;
  contextType?: unknown;
  contextId?: unknown;
  contextSnapshot?: unknown;
};

export type SupportTicketFilters = {
  status?: unknown;
  category?: unknown;
  priority?: unknown;
  unresolvedOnly?: unknown;
  search?: unknown;
  attention?: unknown;
  limit?: unknown;
  offset?: unknown;
};

export type UpdateSupportTicketStatusInput = {
  status?: unknown;
};

export type AddSupportTicketNoteInput = {
  content?: unknown;
};

export type AddSupportTicketReplyInput = {
  message?: unknown;
  status?: unknown;
};

export type SupportTicketNoteDto = {
  id: string;
  supportTicketId: string;
  authorUserId: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
};

export type SupportTicketReplyDto = {
  id: string;
  supportTicketId: string;
  authorUserId: string;
  authorName: string;
  authorRole: 'ADMIN' | 'VENDOR';
  message: string;
  createdAt: string;
};

export type SupportTicketEscalationLevel = 'none' | 'due_soon' | 'overdue' | 'escalated';

export type SupportTicketSlaDto = {
  isOverdue: boolean;
  dueLabel: string;
  escalationLevel: SupportTicketEscalationLevel;
  dueAt: string | null;
  overdueByHours: number | null;
};

export type SupportTicketContextSummaryDto = {
  route?: string;
  path?: string;
  orderNumber?: string;
  returnNumber?: string;
  status?: string;
  flags?: Record<string, boolean>;
};

export type SupportTicketDto = {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  createdByRole: string;
  vendorId: string;
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
  sla: SupportTicketSlaDto | null;
  contextType: SupportTicketContextType;
  contextId: string | null;
  contextSummary: SupportTicketContextSummaryDto | null;
  contextSnapshot?: unknown;
  resolvedAt: string | null;
  closedAt: string | null;
  notes?: SupportTicketNoteDto[];
  replies?: SupportTicketReplyDto[];
};

export type SupportAttentionSeverityDto = 'info' | 'warning' | 'critical';

export type SupportAttentionTicketDto = {
  id: string;
  ticketReference: string;
  subject: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  category: SupportTicketCategory;
  vendorId: string;
  vendorName: string | null;
  relatedOrderReference: string | null;
  contextType: SupportTicketContextType;
  contextId: string | null;
  sla: SupportTicketSlaDto;
  severity: SupportAttentionSeverityDto;
  createdAt: string;
  updatedAt: string;
  waitingSince: string;
  ageHours: number;
  destinationPath: string;
};

export type SupportAttentionTicketsPageDto = {
  generatedAt: string;
  total: number;
  limit: number;
  offset: number;
  sort: 'updatedAt_asc_id_asc';
  items: SupportAttentionTicketDto[];
};

export type SupportAnalyticsKpisDto = {
  openTickets: number;
  overdueTickets: number;
  avgFirstResponseHours: number | null;
  avgResolutionHours: number | null;
  waitingOnVendor: number;
  resolvedToday: number;
};

export type SupportAnalyticsCategoryInsightDto = {
  category: SupportTicketCategory;
  ticketCount: number;
  overdueCount: number;
  overduePercent: number;
  avgResolutionHours: number | null;
};

export type SupportAnalyticsVendorInsightDto = {
  vendorId: string;
  vendorName: string | null;
  ticketCount: number;
  unresolvedCount: number;
  overdueCount: number;
  overduePercent: number;
  avgResolutionHours: number | null;
  needsAttention: boolean;
};

export type SupportAnalyticsAssignmentInsightDto = {
  assigneeName: string;
  ticketCount: number;
  overdueCount: number;
  avgFirstResponseHours: number | null;
  unassignedOpenTickets: number;
};

export type SupportAnalyticsTrendPointDto = {
  date: string;
  created: number;
  resolved: number;
  overdue: number;
};

export type SupportAnalyticsSlaDto = {
  overdueTickets: number;
  overduePercent: number;
  avgResponseDelayHours: number | null;
  avgResolutionHours: number | null;
  breachesByCategory: Array<{
    category: SupportTicketCategory;
    overdueCount: number;
  }>;
};

export type SupportAnalyticsDto = {
  generatedAt: string;
  kpis: SupportAnalyticsKpisDto;
  categoryInsights: SupportAnalyticsCategoryInsightDto[];
  vendorInsights: SupportAnalyticsVendorInsightDto[];
  slaInsights: SupportAnalyticsSlaDto;
  assignmentInsights: SupportAnalyticsAssignmentInsightDto[];
  trends: SupportAnalyticsTrendPointDto[];
};
