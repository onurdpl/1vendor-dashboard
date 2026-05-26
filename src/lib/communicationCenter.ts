import type {
  FinanceDashboard,
  FinanceTransaction,
  OrderSummary,
  OperationsAttentionSeverity,
  ReturnSummary,
  SupportTicket,
} from './api/contracts';
import { formatShopifyOrderNumber } from './formatOrderDisplay';
import { getSafeTimestamp, safeArray, safeStatusLabel } from '../services/real/formatting';

export type CommunicationEventType =
  | 'support_reply'
  | 'support_status_change'
  | 'return_update'
  | 'refund_processed'
  | 'payout_update'
  | 'shipment_issue'
  | 'tracking_required'
  | 'operational_recommendation'
  | 'finance_review_request';

export type CommunicationFilter = 'all' | 'unread' | 'action' | 'support' | 'returns' | 'finance' | 'shipments' | 'resolved';

export type CommunicationPriority = 'informational' | 'requires_action' | 'overdue_response' | 'critical_operational_issue';

export type CommunicationEvent = {
  id: string;
  type: CommunicationEventType;
  title: string;
  summary: string;
  timestamp: string;
  severity: OperationsAttentionSeverity;
  priority: CommunicationPriority;
  relatedObjectType: 'support' | 'order' | 'return' | 'finance';
  relatedObjectId: string;
  relatedLabel: string;
  href: string;
  unread: boolean;
  requiresAction: boolean;
  resolved: boolean;
  context: Array<{ label: string; value: string }>;
};

export type CommunicationFeedInput = {
  supportTickets: SupportTicket[];
  orders: OrderSummary[];
  returns: ReturnSummary[];
  finance: FinanceDashboard | null | undefined;
};

function getStatusLabel(value: string | null | undefined) {
  return safeStatusLabel(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function orderLabel(value: string | number | null | undefined) {
  return value ? formatShopifyOrderNumber(value) : 'Unknown order';
}

function getSupportHref(ticket: SupportTicket) {
  return `/support/${encodeURIComponent(ticket.id)}`;
}

function getReturnHref(returnRequest: ReturnSummary) {
  return `/returns/${encodeURIComponent(returnRequest.id)}`;
}

function getFinanceHref(record: FinanceTransaction) {
  return `/finance?ledgerId=${encodeURIComponent(record.id)}`;
}

function getOrderHref(order: OrderSummary) {
  return `/orders/${encodeURIComponent(order.id)}`;
}

function getSupportContext(ticket: SupportTicket) {
  const entries: CommunicationEvent['context'] = [
    { label: 'Status', value: getStatusLabel(ticket.status) },
    { label: 'Priority', value: getStatusLabel(ticket.priority) },
  ];

  if (ticket.contextSummary?.orderNumber) {
    entries.push({ label: 'Order', value: orderLabel(ticket.contextSummary.orderNumber) });
  }
  if (ticket.contextSummary?.returnNumber) {
    entries.push({ label: 'Return', value: ticket.contextSummary.returnNumber });
  }

  return entries;
}

export function buildVendorCommunicationFeed(input: CommunicationFeedInput): CommunicationEvent[] {
  const supportTickets = safeArray<SupportTicket>(input.supportTickets).filter(isRecord) as SupportTicket[];
  const returns = safeArray<ReturnSummary>(input.returns).filter(isRecord) as ReturnSummary[];
  const orders = safeArray<OrderSummary>(input.orders).filter(isRecord) as OrderSummary[];
  const financeRecords = safeArray<FinanceTransaction>(input.finance?.transactions).filter(isRecord) as FinanceTransaction[];
  const events: CommunicationEvent[] = [];

  for (const ticket of supportTickets) {
    const hasVendorUnread = ticket.vendorUnreadCount > 0;
    const waitingForVendor = ticket.status === 'WAITING_FOR_VENDOR';
    const resolved = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED';
    const title = ticket.lastReplyByRole === 'ADMIN' ? 'Support replied' : 'Support request update';
    events.push({
      id: `support-${ticket.id}`,
      type: ticket.lastReplyAt ? 'support_reply' : 'support_status_change',
      title: hasVendorUnread ? title : ticket.subject,
      summary: waitingForVendor ? 'Support is waiting for your response.' : ticket.message,
      timestamp: ticket.lastReplyAt ?? ticket.updatedAt,
      severity: waitingForVendor || hasVendorUnread ? 'warning' : 'info',
      priority: waitingForVendor ? 'requires_action' : hasVendorUnread ? 'overdue_response' : 'informational',
      relatedObjectType: 'support',
      relatedObjectId: ticket.id,
      relatedLabel: ticket.subject,
      href: getSupportHref(ticket),
      unread: hasVendorUnread,
      requiresAction: waitingForVendor,
      resolved,
      context: getSupportContext(ticket),
    });
  }

  for (const returnRequest of returns) {
    const status = returnRequest.status?.toLowerCase() ?? '';
    const refundPending = returnRequest.sourceType === 'shopify_return_request' && !returnRequest.sourceShopifyRefundId;
    const requiresAction = status === 'requested' || status === 'pending' || status === 'in review';
    const resolved = ['refunded', 'processed', 'closed', 'approved'].includes(status) && !refundPending;
    events.push({
      id: `return-${returnRequest.id}`,
      type: resolved ? 'refund_processed' : 'return_update',
      title: resolved ? 'Refund processed' : 'Return needs review',
      summary: `${orderLabel(returnRequest.sourceShopifyOrderNumber)} · ${getStatusLabel(returnRequest.status)}`,
      timestamp: returnRequest.updatedAt ?? returnRequest.date,
      severity: requiresAction ? 'warning' : 'info',
      priority: requiresAction ? 'requires_action' : 'informational',
      relatedObjectType: 'return',
      relatedObjectId: returnRequest.id,
      relatedLabel: `Return ${orderLabel(returnRequest.sourceShopifyOrderNumber)}`,
      href: getReturnHref(returnRequest),
      unread: false,
      requiresAction,
      resolved,
      context: [
        { label: 'Order', value: orderLabel(returnRequest.sourceShopifyOrderNumber) },
        { label: 'Refund', value: refundPending ? 'Pending' : 'Processed' },
      ],
    });
  }

  for (const order of orders) {
    const missingTracking = !order.trackingNumber && !order.carrier && order.shippingStatus === 'Awaiting Shipment';
    if (!missingTracking) {
      continue;
    }
    events.push({
      id: `tracking-${order.id}`,
      type: 'tracking_required',
      title: 'Tracking information required',
      summary: `${orderLabel(order.sourceShopifyOrderNumber)} is awaiting shipment progress.`,
      timestamp: order.shipmentUpdatedAt ?? order.date,
      severity: 'warning',
      priority: 'requires_action',
      relatedObjectType: 'order',
      relatedObjectId: order.id,
      relatedLabel: `Order ${orderLabel(order.sourceShopifyOrderNumber)}`,
      href: getOrderHref(order),
      unread: false,
      requiresAction: true,
      resolved: false,
      context: [
        { label: 'Shipping', value: order.shippingStatus },
        { label: 'Fulfillment', value: order.fulfillmentStatus },
      ],
    });
  }

  for (const record of financeRecords) {
    if (record.category !== 'Refund' && record.category !== 'Payout') {
      continue;
    }
    const isRefund = record.category === 'Refund';
    const pending = record.status === 'Pending' || record.status === 'Failed';
    events.push({
      id: `finance-${record.id}`,
      type: isRefund ? 'refund_processed' : 'payout_update',
      title: isRefund ? 'Refund update' : 'Payout update',
      summary: `${record.amount} · ${getStatusLabel(record.status)}`,
      timestamp: record.date,
      severity: pending ? 'warning' : 'info',
      priority: pending ? 'requires_action' : 'informational',
      relatedObjectType: 'finance',
      relatedObjectId: record.id,
      relatedLabel: isRefund ? 'Refund activity' : 'Payout activity',
      href: getFinanceHref(record),
      unread: false,
      requiresAction: pending,
      resolved: !pending,
      context: [
        { label: 'Type', value: record.category },
        { label: 'Status', value: getStatusLabel(record.status) },
      ],
    });
  }

  return events.sort((left, right) => getSafeTimestamp(right.timestamp, 0) - getSafeTimestamp(left.timestamp, 0));
}

export function filterCommunicationEvents(events: CommunicationEvent[], filter: CommunicationFilter) {
  if (filter === 'all') {
    return events;
  }
  if (filter === 'unread') {
    return events.filter((event) => event.unread);
  }
  if (filter === 'action') {
    return events.filter((event) => event.requiresAction);
  }
  if (filter === 'resolved') {
    return events.filter((event) => event.resolved);
  }
  if (filter === 'support') {
    return events.filter((event) => event.relatedObjectType === 'support');
  }
  if (filter === 'returns') {
    return events.filter((event) => event.relatedObjectType === 'return');
  }
  if (filter === 'finance') {
    return events.filter((event) => event.relatedObjectType === 'finance');
  }
  if (filter === 'shipments') {
    return events.filter((event) => event.relatedObjectType === 'order' && (event.type === 'tracking_required' || event.type === 'shipment_issue'));
  }
  return events;
}

export function getCommunicationSummary(events: CommunicationEvent[]) {
  return {
    total: events.length,
    unread: events.filter((event) => event.unread).length,
    requiresAction: events.filter((event) => event.requiresAction).length,
    support: events.filter((event) => event.relatedObjectType === 'support').length,
  };
}
