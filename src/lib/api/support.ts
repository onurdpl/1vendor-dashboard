import { runtimeServices } from '../../services/runtime-services';
import type { CreateSupportTicketInput, SupportTicket, SupportTicketNote, SupportTicketStatus } from './contracts';

export async function createSupportTicket(input: CreateSupportTicketInput): Promise<SupportTicket> {
  return runtimeServices.support.create(input);
}

export async function listAdminSupportTickets(): Promise<SupportTicket[]> {
  return runtimeServices.support.listAdmin();
}

export async function listVendorSupportTickets(): Promise<SupportTicket[]> {
  return runtimeServices.support.listVendor();
}

export async function getAdminSupportTicket(ticketId: string): Promise<SupportTicket> {
  return runtimeServices.support.detailAdmin(ticketId);
}

export async function getVendorSupportTicket(ticketId: string): Promise<SupportTicket> {
  return runtimeServices.support.detailVendor(ticketId);
}

export async function updateAdminSupportTicketStatus(ticketId: string, status: SupportTicketStatus): Promise<SupportTicket> {
  return runtimeServices.support.updateStatus(ticketId, status);
}

export async function addAdminSupportTicketNote(ticketId: string, content: string): Promise<SupportTicketNote> {
  return runtimeServices.support.addNote(ticketId, content);
}
