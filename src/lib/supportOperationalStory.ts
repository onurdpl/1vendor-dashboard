import type { SupportTicket } from './api/contracts';
import { safeStatusLabel } from '../services/real/formatting';

export type SupportActionBucket =
  | 'all'
  | 'needs_assignment'
  | 'needs_response'
  | 'escalated'
  | 'overdue'
  | 'waiting_vendor'
  | 'resolved';

export type SupportOperationalStory = {
  contextLabel: string;
  contextDetail: string | null;
  workflowLabel: string;
  workflowTone: 'attention' | 'info' | 'warning' | 'success' | 'neutral';
  slaLabel: string;
  slaTone: 'danger' | 'warning' | 'success' | 'neutral';
  assignmentLabel: string;
  assignmentTone: 'warning' | 'success' | 'neutral';
  nextActionLabel: string;
  nextActionDetail: string;
  nextActionTone: 'danger' | 'warning' | 'info' | 'success' | 'neutral';
  replyOwnerLabel: string;
  replyOwnerDetail: string;
  replyOwnerTone: 'danger' | 'warning' | 'info' | 'success' | 'neutral';
  slaSummaryLabel: string;
  slaSummaryDetail: string;
  escalationLabel: string | null;
  escalationReason: string | null;
  needsAssignment: boolean;
  needsAdminResponse: boolean;
  isEscalated: boolean;
  isOverdue: boolean;
  isWaitingOnVendor: boolean;
  isResolved: boolean;
  isClosed: boolean;
};

function formatLabel(value: string) {
  return safeStatusLabel(value);
}

function normalizeBusinessNumber(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

export function getSupportContextLabel(ticket: SupportTicket) {
  const orderNumber = normalizeBusinessNumber(ticket.contextSummary?.orderNumber);
  if (orderNumber) {
    return `Order ${orderNumber}`;
  }

  const returnNumber = normalizeBusinessNumber(ticket.contextSummary?.returnNumber);
  if (returnNumber) {
    return `Return ${returnNumber}`;
  }

  if (ticket.contextType === 'shipment') {
    return 'Shipment issue';
  }

  if (ticket.category === 'PAYOUT' || ticket.category === 'INVOICE' || ticket.category === 'REFUND') {
    return 'Payment issue';
  }

  if (ticket.contextType === 'general') {
    return 'Vendor account issue';
  }

  return formatLabel(ticket.contextType);
}

function getContextDetail(ticket: SupportTicket) {
  if (!ticket.contextId) {
    return null;
  }
  return `${formatLabel(ticket.contextType)} ${ticket.contextId}`;
}

function getWorkflowTone(ticket: SupportTicket): SupportOperationalStory['workflowTone'] {
  if (ticket.status === 'OPEN') {
    return 'attention';
  }
  if (ticket.status === 'IN_REVIEW') {
    return 'info';
  }
  if (ticket.status === 'WAITING_FOR_VENDOR') {
    return 'warning';
  }
  if (ticket.status === 'RESOLVED') {
    return 'success';
  }
  return 'neutral';
}

function getSlaLabel(ticket: SupportTicket) {
  if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
    return 'Closed';
  }
  if (ticket.sla?.escalationLevel === 'escalated' || ticket.escalatedAt) {
    return 'Escalated';
  }
  if (ticket.sla?.isOverdue || ticket.sla?.escalationLevel === 'overdue') {
    return 'Overdue';
  }
  if (ticket.sla?.escalationLevel === 'due_soon') {
    return 'Due soon';
  }
  return ticket.sla?.dueLabel ? 'On track' : 'No active SLA';
}

function getSlaTone(ticket: SupportTicket): SupportOperationalStory['slaTone'] {
  if (ticket.sla?.escalationLevel === 'escalated' || ticket.escalatedAt || ticket.sla?.isOverdue) {
    return 'danger';
  }
  if (ticket.sla?.escalationLevel === 'due_soon') {
    return 'warning';
  }
  if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
    return 'success';
  }
  return 'neutral';
}

function isUnresolved(ticket: SupportTicket) {
  return ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED';
}

export function isResolvedToday(ticket: SupportTicket, now = new Date()) {
  const resolvedAt = ticket.resolvedAt ?? ticket.closedAt;
  if (!resolvedAt) {
    return false;
  }
  return new Date(resolvedAt).toDateString() === now.toDateString();
}

// Operational story projection should be centralized here before adding page-specific state copy.
export function getSupportOperationalStory(ticket: SupportTicket): SupportOperationalStory {
  const unresolved = isUnresolved(ticket);
  const needsAssignment = unresolved && !ticket.assigneeUserId && !ticket.assigneeName;
  const needsAdminResponse =
    unresolved &&
    ticket.status !== 'WAITING_FOR_VENDOR' &&
    (ticket.adminUnreadCount > 0 || ticket.lastReplyByRole === 'VENDOR');
  const isEscalated = unresolved && Boolean(ticket.escalatedAt || ticket.sla?.escalationLevel === 'escalated');
  const isOverdue = unresolved && Boolean(ticket.sla?.isOverdue || ticket.sla?.escalationLevel === 'overdue');
  const isWaitingOnVendor = ticket.status === 'WAITING_FOR_VENDOR';
  const isResolved = ticket.status === 'RESOLVED';
  const isClosed = ticket.status === 'CLOSED';
  const assignmentLabel = needsAssignment ? 'Needs assignment' : ticket.assigneeName ?? 'Assigned';

  let nextActionLabel = 'Review ticket';
  let nextActionDetail = 'Open the ticket and review the latest support context.';
  let nextActionTone: SupportOperationalStory['nextActionTone'] = 'info';
  let replyOwnerLabel = 'Admin reply required';
  let replyOwnerDetail = 'Support should review the ticket and decide the next response.';
  let replyOwnerTone: SupportOperationalStory['replyOwnerTone'] = 'warning';
  let slaSummaryLabel = ticket.sla?.dueLabel ?? 'No active SLA';
  let slaSummaryDetail = 'No active response deadline is currently projected.';

  if (isClosed) {
    nextActionLabel = 'Closed';
    nextActionDetail = 'No support action is required.';
    nextActionTone = 'neutral';
    replyOwnerLabel = 'Closed';
    replyOwnerDetail = 'Conversation is closed.';
    replyOwnerTone = 'neutral';
    slaSummaryLabel = 'Closed';
    slaSummaryDetail = 'SLA tracking is complete.';
  } else if (isResolved) {
    nextActionLabel = 'Resolved';
    nextActionDetail = 'Review only if new information arrives.';
    nextActionTone = 'success';
    replyOwnerLabel = 'Resolved';
    replyOwnerDetail = 'No reply is currently required.';
    replyOwnerTone = 'success';
    slaSummaryLabel = 'Resolved';
    slaSummaryDetail = 'SLA tracking is complete.';
  } else if (isWaitingOnVendor) {
    nextActionLabel = 'Waiting vendor response';
    nextActionDetail = 'No admin response is due until the vendor replies.';
    nextActionTone = 'neutral';
    replyOwnerLabel = 'Vendor reply required';
    replyOwnerDetail = 'Support is waiting for the vendor to respond.';
    replyOwnerTone = 'info';
    slaSummaryLabel = 'Waiting vendor response';
    slaSummaryDetail = 'Admin response timer is paused or inactive while vendor input is pending.';
  } else if (isEscalated) {
    nextActionLabel = 'Escalation review required';
    nextActionDetail = ticket.escalationReason ?? 'Review the escalation reason and owner.';
    nextActionTone = 'danger';
    replyOwnerLabel = 'Admin reply required';
    replyOwnerDetail = 'Escalation needs support review.';
    replyOwnerTone = 'danger';
    slaSummaryLabel = 'Escalated by vendor';
    slaSummaryDetail = ticket.escalationReason ?? 'Vendor escalation is active.';
  } else if (isOverdue) {
    nextActionLabel = 'Needs admin reply';
    nextActionDetail = ticket.sla?.dueLabel ?? 'SLA is overdue.';
    nextActionTone = 'danger';
    replyOwnerLabel = 'Admin reply required';
    replyOwnerDetail = 'Response required now.';
    replyOwnerTone = 'danger';
    slaSummaryLabel = ticket.sla?.overdueByHours ? `${ticket.sla.overdueByHours}h overdue` : 'Overdue';
    slaSummaryDetail = ticket.sla?.dueLabel ?? 'SLA is overdue.';
  } else if (needsAssignment) {
    nextActionLabel = 'Needs assignment';
    nextActionDetail = 'Assign an operator before continuing investigation.';
    nextActionTone = 'warning';
    replyOwnerLabel = 'Admin reply required';
    replyOwnerDetail = 'Owner required before investigation.';
    replyOwnerTone = 'warning';
    slaSummaryLabel = getSlaLabel(ticket);
    slaSummaryDetail = ticket.sla?.dueLabel ?? 'No active response deadline is currently projected.';
  } else if (needsAdminResponse) {
    nextActionLabel = 'Needs admin reply';
    nextActionDetail = 'Vendor has unread or recent context waiting for admin review.';
    nextActionTone = 'warning';
    replyOwnerLabel = 'Admin reply required';
    replyOwnerDetail = 'Vendor has unread or recent context waiting for admin review.';
    replyOwnerTone = 'warning';
    slaSummaryLabel = getSlaLabel(ticket);
    slaSummaryDetail = ticket.sla?.dueLabel ?? 'No active response deadline is currently projected.';
  } else if (ticket.status === 'IN_REVIEW') {
    nextActionLabel = 'Continue review';
    nextActionDetail = 'Owner should continue investigation or reply to the vendor.';
    nextActionTone = 'info';
    replyOwnerLabel = 'Admin reply required';
    replyOwnerDetail = 'Support owns the next update while review is active.';
    replyOwnerTone = 'info';
    slaSummaryLabel = getSlaLabel(ticket);
    slaSummaryDetail = ticket.sla?.dueLabel ?? 'No active response deadline is currently projected.';
  }

  return {
    contextLabel: getSupportContextLabel(ticket),
    contextDetail: getContextDetail(ticket),
    workflowLabel: formatLabel(ticket.status),
    workflowTone: getWorkflowTone(ticket),
    slaLabel: getSlaLabel(ticket),
    slaTone: getSlaTone(ticket),
    assignmentLabel,
    assignmentTone: needsAssignment ? 'warning' : ticket.assigneeName ? 'success' : 'neutral',
    nextActionLabel,
    nextActionDetail,
    nextActionTone,
    replyOwnerLabel,
    replyOwnerDetail,
    replyOwnerTone,
    slaSummaryLabel,
    slaSummaryDetail,
    escalationLabel: isEscalated ? 'Escalated' : null,
    escalationReason: ticket.escalationReason,
    needsAssignment,
    needsAdminResponse,
    isEscalated,
    isOverdue,
    isWaitingOnVendor,
    isResolved,
    isClosed,
  };
}

export function ticketMatchesSupportActionBucket(ticket: SupportTicket, bucket: SupportActionBucket, now = new Date()) {
  const story = getSupportOperationalStory(ticket);
  if (bucket === 'all') {
    return true;
  }
  if (bucket === 'needs_assignment') {
    return story.needsAssignment;
  }
  if (bucket === 'needs_response') {
    return story.needsAdminResponse;
  }
  if (bucket === 'escalated') {
    return story.isEscalated;
  }
  if (bucket === 'overdue') {
    return story.isOverdue;
  }
  if (bucket === 'waiting_vendor') {
    return story.isWaitingOnVendor;
  }
  return story.isResolved || story.isClosed || isResolvedToday(ticket, now);
}
