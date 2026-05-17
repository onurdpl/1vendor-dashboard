import type { SupportTicket } from './api/contracts';

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
  href?: string;
  status?: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'attention';
  visibility?: OperationalVisibility;
};

export function normalizeOperationalOrderNumber(value: string | number | null | undefined) {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }
  return text.replace(/^#+/, '').trim().toLowerCase();
}

export function sameOperationalOrderNumber(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
) {
  const normalizedLeft = normalizeOperationalOrderNumber(left);
  const normalizedRight = normalizeOperationalOrderNumber(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
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

export function supportTicketMatchesOrder(
  ticket: SupportTicket,
  orderId: string | null | undefined,
  orderNumber: string | number | null | undefined,
) {
  if (ticket.contextType === 'order' && ticket.contextId && orderId && ticket.contextId === orderId) {
    return true;
  }

  const snapshotOrderNumber =
    getSnapshotString(ticket.contextSnapshot, 'orderNumber') ??
    getSnapshotString(ticket.contextSnapshot, 'sourceShopifyOrderNumber');

  return sameOperationalOrderNumber(snapshotOrderNumber, orderNumber);
}

export function supportTicketMatchesReturn(ticket: SupportTicket, returnId: string | null | undefined) {
  return Boolean(ticket.contextType === 'return' && ticket.contextId && returnId && ticket.contextId === returnId);
}

export function supportTicketMatchesFinance(
  ticket: SupportTicket,
  financeLedgerEntryId: string | null | undefined,
  orderNumber?: string | number | null,
  refundId?: string | null,
) {
  const snapshotFinanceId =
    getSnapshotString(ticket.contextSnapshot, 'financeLedgerEntryId') ??
    getSnapshotString(ticket.contextSnapshot, 'financeRecordId') ??
    getSnapshotString(ticket.contextSnapshot, 'ledgerEntryId');
  const snapshotRefundId =
    getSnapshotString(ticket.contextSnapshot, 'refundId') ??
    getSnapshotString(ticket.contextSnapshot, 'shopifyRefundId') ??
    getSnapshotString(ticket.contextSnapshot, 'sourceShopifyRefundId');
  const snapshotOrderNumber =
    getSnapshotString(ticket.contextSnapshot, 'orderNumber') ??
    getSnapshotString(ticket.contextSnapshot, 'sourceShopifyOrderNumber');

  return Boolean(
    (financeLedgerEntryId && snapshotFinanceId === financeLedgerEntryId) ||
      (refundId && snapshotRefundId === refundId) ||
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
