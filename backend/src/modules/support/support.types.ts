export type SupportTicketPriority = 'low' | 'normal' | 'high';
export type SupportTicketStatus = 'open' | 'in_progress' | 'resolved';
export type SupportTicketContextType = 'order' | 'return' | 'shipment' | 'general';

export type CreateSupportTicketInput = {
  subject?: unknown;
  message?: unknown;
  priority?: unknown;
  contextType?: unknown;
  contextId?: unknown;
  contextSnapshot?: unknown;
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
  contextType: SupportTicketContextType;
  contextId: string | null;
  contextSnapshot: unknown;
};
