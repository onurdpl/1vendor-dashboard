import { runtimeServices } from '../../services/runtime-services';
import type { CreateSupportTicketInput, SupportTicket } from './contracts';

export async function createSupportTicket(input: CreateSupportTicketInput): Promise<SupportTicket> {
  return runtimeServices.support.create(input);
}

export async function listAdminSupportTickets(): Promise<SupportTicket[]> {
  return runtimeServices.support.listAdmin();
}
