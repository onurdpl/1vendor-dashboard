import { apiClient } from '../../lib/api-client';
import type { CreateSupportTicketInput, SupportTicket, SupportTicketNote, SupportTicketStatus } from '../../lib/api/contracts';

export async function createSupportTicket(input: CreateSupportTicketInput): Promise<SupportTicket> {
  return apiClient.post<SupportTicket>('/support/tickets', input);
}

export async function listAdminSupportTickets(): Promise<SupportTicket[]> {
  return apiClient.get<SupportTicket[]>('/admin/support/tickets');
}

export async function listVendorSupportTickets(): Promise<SupportTicket[]> {
  return apiClient.get<SupportTicket[]>('/support/tickets');
}

export async function getAdminSupportTicket(ticketId: string): Promise<SupportTicket> {
  return apiClient.get<SupportTicket>(`/admin/support/tickets/${ticketId}`);
}

export async function getVendorSupportTicket(ticketId: string): Promise<SupportTicket> {
  return apiClient.get<SupportTicket>(`/support/tickets/${ticketId}`);
}

export async function updateAdminSupportTicketStatus(ticketId: string, status: SupportTicketStatus): Promise<SupportTicket> {
  return apiClient.post<SupportTicket>(`/admin/support/tickets/${ticketId}/status`, { status });
}

export async function addAdminSupportTicketNote(ticketId: string, content: string): Promise<SupportTicketNote> {
  return apiClient.post<SupportTicketNote>(`/admin/support/tickets/${ticketId}/notes`, { content });
}
