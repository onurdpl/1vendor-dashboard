import { runtimeServices } from '../../services/runtime-services';
import type { CreateSupportTicketInput, SupportAnalytics, SupportTicket, SupportTicketNote, SupportTicketStatus } from './contracts';

export async function createSupportTicket(input: CreateSupportTicketInput): Promise<SupportTicket> {
  return runtimeServices.support.create(input);
}

export async function listAdminSupportTickets(options: { signal?: AbortSignal } = {}): Promise<SupportTicket[]> {
  return runtimeServices.support.listAdmin({ signal: options.signal });
}

export async function getAdminSupportAnalytics(options: { signal?: AbortSignal } = {}): Promise<SupportAnalytics> {
  return runtimeServices.support.analytics({ signal: options.signal });
}

export async function listVendorSupportTickets(options: { signal?: AbortSignal } = {}): Promise<SupportTicket[]> {
  return runtimeServices.support.listVendor({ signal: options.signal });
}

export async function getAdminSupportTicket(ticketId: string, options: { signal?: AbortSignal } = {}): Promise<SupportTicket> {
  return runtimeServices.support.detailAdmin(ticketId, { signal: options.signal });
}

export async function getVendorSupportTicket(ticketId: string, options: { signal?: AbortSignal } = {}): Promise<SupportTicket> {
  return runtimeServices.support.detailVendor(ticketId, { signal: options.signal });
}

export async function updateAdminSupportTicketStatus(ticketId: string, status: SupportTicketStatus): Promise<SupportTicket> {
  return runtimeServices.support.updateStatus(ticketId, status);
}

export async function addAdminSupportTicketNote(ticketId: string, content: string): Promise<SupportTicketNote> {
  return runtimeServices.support.addNote(ticketId, content);
}

export async function addAdminSupportTicketReply(ticketId: string, message: string, status?: SupportTicketStatus): Promise<SupportTicket> {
  return runtimeServices.support.addAdminReply(ticketId, message, status);
}

export async function addVendorSupportTicketReply(ticketId: string, message: string): Promise<SupportTicket> {
  return runtimeServices.support.addVendorReply(ticketId, message);
}

export async function escalateVendorSupportTicket(ticketId: string): Promise<SupportTicket> {
  return runtimeServices.support.escalateVendor(ticketId);
}

export async function assignAdminSupportTicketToSelf(ticketId: string): Promise<SupportTicket> {
  return runtimeServices.support.assignToSelf(ticketId);
}

export async function unassignAdminSupportTicket(ticketId: string): Promise<SupportTicket> {
  return runtimeServices.support.unassign(ticketId);
}
