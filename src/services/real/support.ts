import { apiClient } from '../../lib/api-client';
import type { CreateSupportTicketInput, SupportTicket } from '../../lib/api/contracts';

export async function createSupportTicket(input: CreateSupportTicketInput): Promise<SupportTicket> {
  return apiClient.post<SupportTicket>('/support/tickets', input);
}

export async function listAdminSupportTickets(): Promise<SupportTicket[]> {
  return apiClient.get<SupportTicket[]>('/admin/support/tickets');
}
