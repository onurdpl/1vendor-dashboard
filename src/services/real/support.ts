import { apiClient } from '../../lib/api-client';
import type { CreateSupportTicketInput, SupportAnalytics, SupportTicket, SupportTicketNote, SupportTicketStatus } from '../../lib/api/contracts';

export async function createSupportTicket(input: CreateSupportTicketInput): Promise<SupportTicket> {
  return apiClient.post<SupportTicket>('/support/tickets', input);
}

export async function listAdminSupportTickets(options: { signal?: AbortSignal } = {}): Promise<SupportTicket[]> {
  return apiClient.get<SupportTicket[]>('/admin/support/tickets', { signal: options.signal });
}

export async function getAdminSupportAnalytics(options: { signal?: AbortSignal } = {}): Promise<SupportAnalytics> {
  return apiClient.get<SupportAnalytics>('/admin/support/analytics', { signal: options.signal });
}

export async function listVendorSupportTickets(options: { signal?: AbortSignal } = {}): Promise<SupportTicket[]> {
  return apiClient.get<SupportTicket[]>('/support/tickets', { signal: options.signal });
}

export async function getAdminSupportTicket(ticketId: string, options: { signal?: AbortSignal } = {}): Promise<SupportTicket> {
  return apiClient.get<SupportTicket>(`/admin/support/tickets/${ticketId}`, { signal: options.signal });
}

export async function getVendorSupportTicket(ticketId: string, options: { signal?: AbortSignal } = {}): Promise<SupportTicket> {
  return apiClient.get<SupportTicket>(`/support/tickets/${ticketId}`, { signal: options.signal });
}

export async function updateAdminSupportTicketStatus(ticketId: string, status: SupportTicketStatus): Promise<SupportTicket> {
  return apiClient.post<SupportTicket>(`/admin/support/tickets/${ticketId}/status`, { status });
}

export async function addAdminSupportTicketNote(ticketId: string, content: string): Promise<SupportTicketNote> {
  return apiClient.post<SupportTicketNote>(`/admin/support/tickets/${ticketId}/notes`, { content });
}

export async function addAdminSupportTicketReply(ticketId: string, message: string, status?: SupportTicketStatus): Promise<SupportTicket> {
  return apiClient.post<SupportTicket>(`/admin/support/tickets/${ticketId}/replies`, { message, status });
}

export async function addVendorSupportTicketReply(ticketId: string, message: string): Promise<SupportTicket> {
  return apiClient.post<SupportTicket>(`/support/tickets/${ticketId}/replies`, { message });
}

export async function escalateVendorSupportTicket(ticketId: string): Promise<SupportTicket> {
  return apiClient.post<SupportTicket>(`/support/tickets/${ticketId}/escalate`, {});
}

export async function assignAdminSupportTicketToSelf(ticketId: string): Promise<SupportTicket> {
  return apiClient.post<SupportTicket>(`/admin/support/tickets/${ticketId}/assign-self`, {});
}

export async function unassignAdminSupportTicket(ticketId: string): Promise<SupportTicket> {
  return apiClient.post<SupportTicket>(`/admin/support/tickets/${ticketId}/unassign`, {});
}
