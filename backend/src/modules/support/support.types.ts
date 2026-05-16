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
  contextSnapshot: unknown;
  resolvedAt: string | null;
  closedAt: string | null;
  notes?: SupportTicketNoteDto[];
  replies?: SupportTicketReplyDto[];
};
