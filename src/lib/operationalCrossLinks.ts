import type { SupportTicket } from './api/contracts';
import { normalizeOrderNumber, sameNormalizedIdentifier, sameOrderNumber, sameShopifyIdentifier } from './shopifyIdentifiers';

export type OperationalAudience = 'admin' | 'vendor';
export type OperationalVisibility = 'all' | 'admin';

export type OperationalEventInput = {
  id: string;
  title: string;
  description?: string;
  at?: string | null;
  status?: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'attention';
  href?: string;
  visibility?: OperationalVisibility;
};

export type OperationalLinkInput = {
  id: string;
  eyebrow?: string;
  title: string;
  description?: string;
  actionLabel?: string;
  href?: string;
  status?: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'attention';
  visibility?: OperationalVisibility;
};

export type OperationalMatchOptions = {
  audience?: OperationalAudience;
  currentVendorId?: string | null;
};

function ticketMatchesAudience(ticket: SupportTicket, options: OperationalMatchOptions = {}) {
  if (options.audience !== 'vendor') {
    return true;
  }

  return Boolean(options.currentVendorId && ticket.vendorId === options.currentVendorId);
}

export function normalizeOperationalOrderNumber(value: string | number | null | undefined) {
  return normalizeOrderNumber(value);
}

export function sameOperationalOrderNumber(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
) {
  return sameOrderNumber(left, right);
}

export function getSnapshotString(snapshot: unknown, key: string) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null;
  }

  const value = (snapshot as Record<string, unknown>)[key];
  if (value === null || value === undefined || typeof value === 'object') {
    return null;
  }

  return String(value);
}

function getTicketContextString(ticket: SupportTicket, key: 'orderNumber' | 'returnNumber' | 'status') {
  const value = ticket.contextSummary?.[key];
  if (value !== null && value !== undefined) {
    return String(value);
  }

  return getSnapshotString(ticket.contextSnapshot, key);
}

export function supportTicketMatchesOrder(
  ticket: SupportTicket,
  orderId: string | null | undefined,
  orderNumber: string | number | null | undefined,
  options: OperationalMatchOptions = {},
) {
  if (!ticketMatchesAudience(ticket, options)) {
    return false;
  }

  if (ticket.contextType === 'order' && ticket.contextId && orderId && ticket.contextId === orderId) {
    return true;
  }

  const snapshotOrderNumber =
    getTicketContextString(ticket, 'orderNumber') ??
    getSnapshotString(ticket.contextSnapshot, 'sourceShopifyOrderNumber');

  return sameOperationalOrderNumber(snapshotOrderNumber, orderNumber);
}

export function supportTicketMatchesReturn(
  ticket: SupportTicket,
  returnId: string | null | undefined,
  options: OperationalMatchOptions = {},
) {
  if (!ticketMatchesAudience(ticket, options)) {
    return false;
  }

  return Boolean(ticket.contextType === 'return' && ticket.contextId && returnId && ticket.contextId === returnId);
}

export function supportTicketMatchesFinance(
  ticket: SupportTicket,
  financeLedgerEntryId: string | null | undefined,
  orderNumber?: string | number | null,
  refundId?: string | null,
  options: OperationalMatchOptions = {},
) {
  if (!ticketMatchesAudience(ticket, options)) {
    return false;
  }

  const snapshotFinanceId =
    getSnapshotString(ticket.contextSnapshot, 'financeLedgerEntryId') ??
    getSnapshotString(ticket.contextSnapshot, 'financeRecordId') ??
    getSnapshotString(ticket.contextSnapshot, 'ledgerEntryId');
  const snapshotRefundId =
    getSnapshotString(ticket.contextSnapshot, 'refundId') ??
    getSnapshotString(ticket.contextSnapshot, 'shopifyRefundId') ??
    getSnapshotString(ticket.contextSnapshot, 'sourceShopifyRefundId');
  const snapshotOrderNumber =
    getTicketContextString(ticket, 'orderNumber') ??
    getSnapshotString(ticket.contextSnapshot, 'sourceShopifyOrderNumber');

  return Boolean(
    (financeLedgerEntryId && sameNormalizedIdentifier(snapshotFinanceId, financeLedgerEntryId)) ||
      (refundId && sameShopifyIdentifier(snapshotRefundId, refundId)) ||
      sameOperationalOrderNumber(snapshotOrderNumber, orderNumber),
  );
}

export function filterOperationalEvents(events: OperationalEventInput[], audience: OperationalAudience) {
  return events
    .filter((event) => Boolean(event.title))
    .filter((event) => audience === 'admin' || event.visibility !== 'admin')
    .sort((left, right) => {
      const leftTime = left.at ? new Date(left.at).getTime() : Number.POSITIVE_INFINITY;
      const rightTime = right.at ? new Date(right.at).getTime() : Number.POSITIVE_INFINITY;
      return leftTime - rightTime;
    });
}

export function filterOperationalLinks(links: OperationalLinkInput[], audience: OperationalAudience) {
  return links
    .filter((link) => Boolean(link.title))
    .filter((link) => audience === 'admin' || link.visibility !== 'admin');
}
