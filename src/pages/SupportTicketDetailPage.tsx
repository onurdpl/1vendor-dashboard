import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { EmptyStatePanel, SectionErrorRetry, SectionSkeleton, StatusBadge } from '../components/OperationalPrimitives';
import { useMutationAction } from '../hooks/useMutationAction';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryClient } from '../lib/api/queryClient';
import { queryKeys } from '../lib/api/queryKeys';
import { useAppReadiness } from '../lib/appReadiness';
import {
  addAdminSupportTicketNote,
  addAdminSupportTicketReply,
  addVendorSupportTicketReply,
  assignAdminSupportTicketToSelf,
  getAdminSupportTicket,
  getVendorSupportTicket,
  unassignAdminSupportTicket,
  updateAdminSupportTicketStatus,
  type SupportTicket,
  type SupportTicketStatus,
} from '../features/support/api';
import { ActionFeedback } from '../components/ActionFeedback';
import { useActionFeedback } from '../lib/ui';
import { formatSupportLabel, getSupportStatusTone } from './AdminSupportTicketsPage';
import { OperationalTimeline } from '../components/OperationalTimeline';
import { MentionText } from '../components/MentionText';
import { getSnapshotString, type OperationalEventInput, type OperationalLinkInput } from '../lib/operationalCrossLinks';
import type { OperationsRecommendation } from '../lib/api/contracts';
import { getSupportOperationalStory } from '../lib/supportOperationalStory';
import { formatDateTime, safeArray } from '../services/real/formatting';

const ADMIN_STATUSES: SupportTicketStatus[] = ['IN_REVIEW', 'WAITING_FOR_VENDOR', 'RESOLVED', 'CLOSED'];
const ADMIN_REPLY_TEMPLATES = [
  {
    label: 'Tracking required',
    value: 'Hi, please add tracking information when the shipment is ready so we can keep the customer updated.',
  },
  {
    label: 'Awaiting vendor response',
    value: 'Hi, we need one more update from your team before we can continue reviewing this request.',
  },
  {
    label: 'Refund approved',
    value: 'Hi, the return review has been approved. The refund update will be reflected in the operational view.',
  },
  {
    label: 'Shipment delayed',
    value: 'Hi, we noticed the shipment may be delayed. Please confirm the latest carrier status.',
  },
  {
    label: 'Payout pending',
    value: 'Hi, this payout item is still pending review. We will update the ticket once the finance status changes.',
  },
] as const;

function formatDate(value: string | null | undefined) {
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getSnapshotEntries(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return [];
  }

  return Object.entries(snapshot as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
    .slice(0, 8)
    .map(([key, value]) => ({
      label: formatSupportLabel(key),
      value: String(value),
    }));
}

function getBusinessContextEntries(ticket: SupportTicket, story: ReturnType<typeof getSupportOperationalStory>) {
  return [
    { label: 'Business context', value: story.contextLabel },
    { label: 'Vendor', value: ticket.vendorName ?? ticket.vendorId },
    { label: 'Allocation', value: getSnapshotString(ticket.contextSnapshot, 'allocationStatus') ?? getSnapshotString(ticket.contextSnapshot, 'status') ?? ticket.contextSummary?.status ?? '—' },
    { label: 'Fulfillment', value: getSnapshotString(ticket.contextSnapshot, 'fulfillmentStatus') ?? getSnapshotString(ticket.contextSnapshot, 'shippingStatus') ?? '—' },
    { label: 'Created', value: formatDate(ticket.createdAt) },
    { label: 'Priority', value: formatSupportLabel(ticket.priority) },
    { label: ticket.assigneeName ? 'Owned by' : 'Owner', value: ticket.assigneeName ?? 'Unassigned' },
  ];
}

function getAuditEntries(ticket: SupportTicket) {
  const entries = [
    { label: 'Ticket id', value: ticket.id },
    { label: 'Vendor id', value: ticket.vendorId },
    { label: 'Raw context id', value: ticket.contextId ?? '—' },
    { label: 'Context type', value: formatSupportLabel(ticket.contextType) },
    { label: 'Created at', value: ticket.createdAt },
    { label: 'Updated at', value: ticket.updatedAt },
    { label: 'First response due', value: ticket.firstResponseDueAt ?? '—' },
    { label: 'Next response due', value: ticket.nextResponseDueAt ?? '—' },
    { label: 'Escalated at', value: ticket.escalatedAt ?? '—' },
    { label: 'Resolved at', value: ticket.resolvedAt ?? '—' },
    { label: 'Closed at', value: ticket.closedAt ?? '—' },
  ];

  return [...entries, ...getSnapshotEntries(ticket.contextSnapshot)];
}

function getContextSummaryEntries(ticket: SupportTicket | null | undefined) {
  const summary = ticket?.contextSummary;
  if (!summary) {
    return [];
  }

  const entries: Array<{ label: string; value: string }> = [];
  for (const key of ['route', 'path', 'orderNumber', 'returnNumber', 'status'] as const) {
    const value = summary[key];
    if (value) {
      entries.push({ label: formatSupportLabel(key), value: String(value) });
    }
  }

  if (summary.flags) {
    for (const [key, value] of Object.entries(summary.flags)) {
      entries.push({ label: formatSupportLabel(key), value: value ? 'Yes' : 'No' });
    }
  }

  return entries.slice(0, 8);
}

export function getSupportTicketContextEntries(ticket: SupportTicket | null | undefined, isAdmin: boolean) {
  return isAdmin ? getSnapshotEntries(ticket?.contextSnapshot) : getContextSummaryEntries(ticket);
}

function getContextSummaryString(ticket: SupportTicket, key: 'orderNumber' | 'returnNumber' | 'status') {
  const value = ticket.contextSummary?.[key];
  return value ? String(value) : null;
}

function getContextLink(ticket: SupportTicket) {
  if (!ticket.contextId) {
    return null;
  }

  if (ticket.contextType === 'return') {
    return `/returns/${ticket.contextId}`;
  }
  if (ticket.contextType === 'order') {
    return `/orders/${ticket.contextId}`;
  }
  return null;
}

function getFinanceContextLink(financeLedgerEntryId: string | null, refundId: string | null) {
  if (financeLedgerEntryId) {
    return `/finance?ledgerId=${encodeURIComponent(financeLedgerEntryId)}`;
  }
  if (refundId) {
    return `/finance?refundId=${encodeURIComponent(refundId)}`;
  }
  return '/finance';
}

function buildContextLinks(ticket: SupportTicket, isAdmin: boolean): OperationalLinkInput[] {
  const links: OperationalLinkInput[] = [];
  const contextLink = getContextLink(ticket);

  if (contextLink) {
    links.push({
      id: `context-${ticket.contextType}-${ticket.contextId}`,
      eyebrow: formatSupportLabel(ticket.contextType),
      title:
        getContextSummaryString(ticket, 'orderNumber') ??
        getContextSummaryString(ticket, 'returnNumber') ??
        (isAdmin ? getSnapshotString(ticket.contextSnapshot, 'orderNumber') : null) ??
        (isAdmin ? getSnapshotString(ticket.contextSnapshot, 'returnNumber') : null) ??
        ticket.contextId ??
        'Linked context',
      description: [
        getContextSummaryString(ticket, 'status') ? `Status: ${getContextSummaryString(ticket, 'status')}` : null,
        ticket.vendorName ? `Vendor: ${ticket.vendorName}` : null,
        getSnapshotString(ticket.contextSnapshot, 'allocationStatus') ? `Allocation: ${getSnapshotString(ticket.contextSnapshot, 'allocationStatus')}` : null,
      ].filter(Boolean).join(' · ') || 'Open the operational record connected to this ticket.',
      href: contextLink,
      status: 'Linked',
      tone: 'info',
    });
  }

  const financeLedgerEntryId = isAdmin
    ? (
    getSnapshotString(ticket.contextSnapshot, 'financeLedgerEntryId') ??
      getSnapshotString(ticket.contextSnapshot, 'financeRecordId')
    )
    : null;
  const refundId = isAdmin
    ? (
    getSnapshotString(ticket.contextSnapshot, 'refundId') ??
      getSnapshotString(ticket.contextSnapshot, 'shopifyRefundId')
    )
    : null;

  if (isAdmin && (financeLedgerEntryId || refundId || ticket.category === 'PAYOUT' || ticket.category === 'INVOICE' || ticket.category === 'REFUND')) {
    links.push({
      id: `finance-${financeLedgerEntryId ?? refundId ?? ticket.id}`,
      eyebrow: 'Finance',
      title: financeLedgerEntryId ? 'Finance row' : 'Finance workspace',
      description: refundId ? `Refund ${refundId}` : 'Review payout and invoice context.',
      href: getFinanceContextLink(financeLedgerEntryId, refundId),
      status: ticket.category,
      tone: ticket.category === 'REFUND' ? 'warning' : 'success',
    });
  }

  return links;
}

function buildUnifiedSupportTimeline(ticket: SupportTicket): OperationalEventInput[] {
  const events: OperationalEventInput[] = [
    {
      id: 'ticket-created',
      title: 'Support ticket opened',
      description: ticket.subject,
      at: ticket.createdAt,
      status: formatSupportLabel(ticket.priority),
      tone: 'info',
    },
    ...safeArray(ticket.replies).map((reply) => ({
      id: `reply-${reply.id}`,
      title: reply.authorRole === 'ADMIN' ? 'Support reply added' : 'Vendor reply added',
      description: reply.message,
      at: reply.createdAt,
      status: formatSupportLabel(reply.authorRole),
      tone: reply.authorRole === 'ADMIN' ? ('info' as const) : ('neutral' as const),
    })),
  ];

  if (ticket.resolvedAt) {
    events.push({
      id: 'ticket-resolved',
      title: 'Ticket resolved',
      at: ticket.resolvedAt,
      status: 'Resolved',
      tone: 'success',
    });
  }
  if (ticket.closedAt) {
    events.push({
      id: 'ticket-closed',
      title: 'Ticket closed',
      at: ticket.closedAt,
      status: 'Closed',
      tone: 'neutral',
    });
  }
  if (ticket.assigneeName) {
    events.push({
      id: 'ticket-assignment-current',
      title: 'Assignment current',
      description: `Owner: ${ticket.assigneeName}`,
      at: ticket.updatedAt,
      status: 'Assigned',
      tone: 'info',
    });
  }
  if (ticket.escalatedAt) {
    events.push({
      id: 'ticket-escalated',
      title: 'Ticket escalated',
      description: ticket.escalationReason ?? 'Escalation requested.',
      at: ticket.escalatedAt,
      status: 'Escalated',
      tone: 'warning',
    });
  }

  return events;
}

function dedupeTimelineEvents(events: OperationalEventInput[]) {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = [event.title, event.at ?? '', event.description ?? ''].join('|');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getReplySummary(ticket: SupportTicket) {
  const replies = safeArray(ticket.replies);
  const lastVendorReply = [...replies].reverse().find((reply) => reply.authorRole === 'VENDOR');
  const lastAdminReply = [...replies].reverse().find((reply) => reply.authorRole === 'ADMIN');
  return {
    unreadCount: ticket.adminUnreadCount + ticket.vendorUnreadCount,
    lastVendorReplyAt: lastVendorReply?.createdAt ?? (ticket.createdByRole === 'vendor' ? ticket.createdAt : null),
    lastAdminReplyAt: lastAdminReply?.createdAt ?? (ticket.createdByRole === 'admin' ? ticket.createdAt : null),
  };
}

function getVendorSupportStatusCopy(ticket: SupportTicket) {
  if (ticket.status === 'WAITING_FOR_VENDOR') {
    return 'Waiting for your reply.';
  }
  if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
    return 'Resolved.';
  }
  return 'Support is reviewing this.';
}

function getSlaBadgeTone(ticket: SupportTicket) {
  if (ticket.sla?.isOverdue || ticket.sla?.escalationLevel === 'escalated') {
    return 'danger' as const;
  }
  if (ticket.sla?.escalationLevel === 'due_soon') {
    return 'warning' as const;
  }
  return 'neutral' as const;
}

export function SupportTicketDetailPage() {
  const { ticketId } = useParams();
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin/');
  const appReadiness = useAppReadiness();
  const currentUser = appReadiness.currentUser;
  const currentVendor = appReadiness.currentVendor;
  const authContextReady = appReadiness.ready;
  const [note, setNote] = useState('');
  const [replyMessage, setReplyMessage] = useState('');
  const [replyStatus, setReplyStatus] = useState<'keep' | 'WAITING_FOR_VENDOR'>('keep');
  const { message, tone, showFeedback } = useActionFeedback();

  const queryKey = isAdmin
    ? queryKeys.admin.support.detail(ticketId ?? 'missing')
    : queryKeys.support.detail(ticketId ?? 'missing', currentVendor.vendorId);
  const { data: ticket, isLoading, isError, error, diagnostics, refetch } = useQueryResource(
    queryKey,
    ({ signal }) => {
      if (!ticketId) {
        throw new Error('Support ticket not found.');
      }
      return isAdmin ? getAdminSupportTicket(ticketId, { signal }) : getVendorSupportTicket(ticketId, { signal });
    },
    {
      enabled: authContextReady && Boolean(ticketId),
    },
  );

  const statusMutation = useMutationAction(
    (status: SupportTicketStatus) => {
      if (!ticketId) {
        throw new Error('Support ticket not found.');
      }
      return updateAdminSupportTicketStatus(ticketId, status);
    },
    {
      onSuccess: async () => {
        await Promise.all([
          refetch(),
          queryClient.invalidateQueries({ queryKey: queryKeys.admin.support.tickets() }),
        ]);
        showFeedback('Support ticket status updated.', 'success');
      },
      onError: (error) => {
        showFeedback(error instanceof Error ? error.message : 'Unable to update support ticket.', 'error');
      },
    },
  );

  const noteMutation = useMutationAction(
    (content: string) => {
      if (!ticketId) {
        throw new Error('Support ticket not found.');
      }
      return addAdminSupportTicketNote(ticketId, content);
    },
    {
      onSuccess: async () => {
        setNote('');
        await refetch();
        showFeedback('Internal note added.', 'success');
      },
      onError: (error) => {
        showFeedback(error instanceof Error ? error.message : 'Unable to add internal note.', 'error');
      },
    },
  );

  const replyMutation = useMutationAction(
    (content: string) => {
      if (!ticketId) {
        throw new Error('Support ticket not found.');
      }
      return isAdmin
        ? addAdminSupportTicketReply(ticketId, content, replyStatus === 'WAITING_FOR_VENDOR' ? 'WAITING_FOR_VENDOR' : undefined)
        : addVendorSupportTicketReply(ticketId, content);
    },
    {
      onSuccess: async () => {
        setReplyMessage('');
        setReplyStatus('keep');
        await Promise.all([
          refetch(),
          queryClient.invalidateQueries({ queryKey: queryKeys.admin.support.tickets() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.support.tickets(currentVendor.vendorId) }),
        ]);
        showFeedback('Reply posted.', 'success');
      },
      onError: (error) => {
        showFeedback(error instanceof Error ? error.message : 'Unable to post reply.', 'error');
      },
    },
  );

  const assignMutation = useMutationAction(
    () => {
      if (!ticketId) {
        throw new Error('Support ticket not found.');
      }
      return assignAdminSupportTicketToSelf(ticketId);
    },
    {
      onSuccess: async () => {
        await Promise.all([
          refetch(),
          queryClient.invalidateQueries({ queryKey: queryKeys.admin.support.tickets() }),
        ]);
        showFeedback('Ticket assigned to you.', 'success');
      },
      onError: (error) => {
        showFeedback(error instanceof Error ? error.message : 'Unable to assign ticket.', 'error');
      },
    },
  );

  const unassignMutation = useMutationAction(
    () => {
      if (!ticketId) {
        throw new Error('Support ticket not found.');
      }
      return unassignAdminSupportTicket(ticketId);
    },
    {
      onSuccess: async () => {
        await Promise.all([
          refetch(),
          queryClient.invalidateQueries({ queryKey: queryKeys.admin.support.tickets() }),
        ]);
        showFeedback('Ticket unassigned.', 'success');
      },
      onError: (error) => {
        showFeedback(error instanceof Error ? error.message : 'Unable to unassign ticket.', 'error');
      },
    },
  );

  useEffect(() => {
    if (!ticket) {
      return;
    }
    if (isAdmin) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.support.tickets() });
      return;
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.support.tickets(currentVendor.vendorId) });
  }, [currentVendor.vendorId, isAdmin, ticket?.id]);

  if (!authContextReady || (isLoading && !ticket)) {
    return (
      <section className="op-page support-detail-page">
        <div className="op-page-heading">
          <div>
            <p className="eyebrow">Support</p>
            <h1>Support ticket</h1>
            <p>Preparing support ticket context.</p>
          </div>
        </div>
        <SectionSkeleton title="Loading support ticket" description="Fetching ticket details in the background." />
      </section>
    );
  }

  if (isError || !ticket) {
    return (
      <section className="op-page support-detail-page">
        <div className="op-page-heading">
          <div>
            <p className="eyebrow">Support</p>
            <h1>Support ticket</h1>
            <p>Unable to load support ticket context.</p>
          </div>
        </div>
        <SectionErrorRetry
          title="Support ticket unavailable"
          description={error ?? 'Unable to load support ticket.'}
          onRetry={() => void refetch()}
        />
      </section>
    );
  }

  const canReply = ticket.status !== 'CLOSED';
  const assignedToCurrentUser = Boolean(currentUser?.name && ticket.assigneeName === currentUser.name);
  const story = getSupportOperationalStory(ticket);
  const contextLinks = buildContextLinks(ticket, isAdmin);
  const unifiedTimeline = dedupeTimelineEvents(buildUnifiedSupportTimeline(ticket));
  const replySummary = getReplySummary(ticket);
  const businessContextEntries = getBusinessContextEntries(ticket, story);
  const auditEntries = getAuditEntries(ticket);
  const supportRecommendations: OperationsRecommendation[] = [];
  if (isAdmin && ticket.sla?.isOverdue) {
    supportRecommendations.push({
      id: `support-rec-escalate-${ticket.id}`,
      type: 'support_escalation',
      severity: 'critical',
      title: 'Escalate overdue support request',
      description: ticket.sla.dueLabel ?? 'This support request is overdue.',
      recommendedAction: 'Review ownership and send the next response',
      relatedObjectType: 'Support ticket',
      relatedObjectId: ticket.id,
      vendor: {
        id: ticket.vendorId,
        name: ticket.vendorName ?? ticket.vendorId,
      },
      createdFromSignal: `support:${ticket.id}:sla`,
      deepLink: `/admin/support/${ticket.id}`,
      vendorVisible: false,
      createdAt: ticket.updatedAt,
    });
  }
  if (isAdmin && !ticket.assigneeName && ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED') {
    supportRecommendations.push({
      id: `support-rec-assign-${ticket.id}`,
      type: 'support_assignment',
      severity: ticket.priority === 'high' ? 'critical' : 'warning',
      title: 'Assign support ownership',
      description: 'This open support request does not have an admin owner.',
      recommendedAction: 'Assign an operator before continuing investigation',
      relatedObjectType: 'Support ticket',
      relatedObjectId: ticket.id,
      vendor: {
        id: ticket.vendorId,
        name: ticket.vendorName ?? ticket.vendorId,
      },
      createdFromSignal: `support:${ticket.id}:assignment`,
      deepLink: `/admin/support/${ticket.id}`,
      vendorVisible: false,
      createdAt: ticket.updatedAt,
    });
  }
  if (!isAdmin && ticket.status === 'WAITING_FOR_VENDOR') {
    supportRecommendations.push({
      id: `support-rec-vendor-reply-${ticket.id}`,
      type: 'support_assignment',
      severity: 'warning',
      title: 'Reply to support request',
      description: 'Support is waiting for your update on this request.',
      recommendedAction: 'Post a reply with the requested operational context',
      relatedObjectType: 'Support ticket',
      relatedObjectId: ticket.id,
      vendor: {
        id: currentVendor.vendorId,
        name: currentVendor.vendorName,
      },
      createdFromSignal: `support:${ticket.id}:vendor-reply`,
      deepLink: `/support/${ticket.id}`,
      vendorVisible: true,
      createdAt: ticket.updatedAt,
    });
  }
  const hasAssignmentRecommendation = supportRecommendations.some((recommendation) => recommendation.type === 'support_assignment');

  return (
    <section className="op-page support-detail-page">
      <div className="support-detail-header support-command-header">
        <div>
          <Link to={isAdmin ? '/admin/support' : '/support'} className="return-review-back">
            {'<-'} Back to support
          </Link>
          <p className="eyebrow">Ticket</p>
          <h1>Support ticket #{ticket.id}</h1>
          <p>{ticket.subject}</p>
        </div>
        <div className="support-command-status-grid">
          <div>
            <span>Business context</span>
            <strong>{story.contextLabel}</strong>
          </div>
          <div>
            <span>Vendor</span>
            <strong>{ticket.vendorName ?? ticket.vendorId}</strong>
          </div>
          <div>
            <span>Workflow</span>
            <StatusBadge tone={story.workflowTone}>{story.workflowLabel}</StatusBadge>
          </div>
          <div>
            <span>SLA</span>
            <StatusBadge tone={story.slaTone}>{story.slaLabel}</StatusBadge>
          </div>
          <div>
            <span>Owner</span>
            <StatusBadge tone={story.assignmentTone}>{story.assignmentLabel}</StatusBadge>
          </div>
          <div>
            <span>Next action</span>
            <StatusBadge tone={story.nextActionTone}>{story.nextActionLabel}</StatusBadge>
          </div>
        </div>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}

      <article className="support-card support-operations-summary" aria-label="Operations Summary">
        <div className="support-card-header">
          <div>
            <p className="eyebrow">Operations</p>
            <h3>Operations Summary</h3>
          </div>
          <StatusBadge tone={story.nextActionTone}>{story.nextActionLabel}</StatusBadge>
        </div>
        <div className="support-command-grid">
          {businessContextEntries.map((entry) => (
            <div key={entry.label} className={entry.label === 'Owner' && !ticket.assigneeName ? 'support-owner-warning' : undefined}>
              <span>{entry.label}</span>
              <strong>{entry.value}</strong>
              {entry.label === 'Owner' && !ticket.assigneeName ? <small>Owner required before investigation.</small> : null}
            </div>
          ))}
          <div>
            <span>Workflow</span>
            <StatusBadge tone={story.workflowTone}>{story.workflowLabel}</StatusBadge>
          </div>
          <div>
            <span>SLA status</span>
            <strong>{story.slaSummaryLabel}</strong>
            <small>{story.slaSummaryDetail}</small>
          </div>
          <div>
            <span>Conversation owner</span>
            <StatusBadge tone={story.replyOwnerTone}>{story.replyOwnerLabel}</StatusBadge>
            <small>{story.replyOwnerDetail}</small>
          </div>
          <div>
            <span>Next action</span>
            <strong>{story.nextActionLabel}</strong>
            <small>{story.nextActionDetail}</small>
          </div>
        </div>
      </article>

      <div className="support-detail-grid">
        <main className="support-detail-main">
          {contextLinks.length ? (
            <article className="support-card support-context-link-card">
              <div className="support-card-header">
                <div>
                  <p className="eyebrow">Linked context</p>
                  <h3>Operational record</h3>
                </div>
              </div>
              <div className="support-context-link-list">
                {contextLinks.map((link) => (
                  <Link key={link.id} to={link.href ?? '#'} className="support-context-link-row">
                    <div>
                      <span>{link.eyebrow}</span>
                      <strong>{link.title}</strong>
                      {link.description ? <small>{link.description}</small> : null}
                    </div>
                    <span className="button button-secondary button-compact">Open {formatSupportLabel(ticket.contextType)}</span>
                  </Link>
                ))}
              </div>
            </article>
          ) : null}

          <article className="support-card">
            <div className="support-card-header">
              <div>
                <p className="eyebrow">Conversation</p>
                <h3>Public thread</h3>
              </div>
            </div>
            <div className="support-conversation-summary">
              <div>
                <span>Conversation status</span>
                <StatusBadge tone={story.replyOwnerTone}>{story.replyOwnerLabel}</StatusBadge>
              </div>
              <div>
                <span>Unread messages</span>
                <strong>{replySummary.unreadCount}</strong>
              </div>
              <div>
                <span>Last vendor reply</span>
                <strong>{formatDate(replySummary.lastVendorReplyAt)}</strong>
              </div>
              <div>
                <span>Last admin reply</span>
                <strong>{formatDate(replySummary.lastAdminReplyAt)}</strong>
              </div>
            </div>
            <div className="support-reply-list">
              <div className="support-reply">
                <div>
                  <strong>{ticket.createdByRole === 'admin' ? 'Admin' : ticket.vendorName ?? 'Vendor'}</strong>
                  <span>{formatDate(ticket.createdAt)}</span>
                </div>
                <p>{ticket.message}</p>
              </div>
              {safeArray(ticket.replies).length ? (
                safeArray(ticket.replies).map((reply) => (
                  <div key={reply.id} className="support-reply">
                    <div>
                      <strong>{reply.authorName}</strong>
                      <StatusBadge tone={reply.authorRole === 'ADMIN' ? 'info' : 'neutral'}>{formatSupportLabel(reply.authorRole)}</StatusBadge>
                      <span>{formatDate(reply.createdAt)}</span>
                    </div>
                    <p>{reply.message}</p>
                  </div>
                ))
              ) : (
                <EmptyStatePanel title="No replies yet" description="Public support replies will appear here." />
              )}
            </div>
            {canReply ? (
              <form
                className="support-note-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!replyMessage.trim()) {
                    return;
                  }
                  void replyMutation.mutateAsync(replyMessage);
                }}
              >
                <textarea
                  value={replyMessage}
                  onChange={(event) => setReplyMessage(event.target.value)}
                  placeholder="Write a public reply..."
                  rows={4}
                />
                {isAdmin ? (
                  <div className="support-reply-tools">
                    <select
                      aria-label="Reply template"
                      defaultValue=""
                      onChange={(event) => {
                        const template = ADMIN_REPLY_TEMPLATES.find((item) => item.label === event.target.value);
                        if (template) {
                          setReplyMessage(template.value);
                        }
                        event.currentTarget.value = '';
                      }}
                    >
                      <option value="">Insert reply template</option>
                      {ADMIN_REPLY_TEMPLATES.map((template) => (
                        <option key={template.label} value={template.label}>
                          {template.label}
                        </option>
                      ))}
                    </select>
                    <select value={replyStatus} onChange={(event) => setReplyStatus(event.target.value as typeof replyStatus)}>
                      <option value="keep">Keep current status</option>
                      <option value="WAITING_FOR_VENDOR">Set waiting for vendor</option>
                    </select>
                  </div>
                ) : null}
                <button type="submit" className="button button-primary" disabled={replyMutation.isPending || !replyMessage.trim()}>
                  {replyMutation.isPending ? 'Posting...' : 'Post reply'}
                </button>
              </form>
            ) : (
              <p className="page-description">Closed support tickets cannot receive new replies.</p>
            )}
          </article>

          {isAdmin ? (
            <article className="support-card support-investigation-card">
              <div className="support-card-header">
                <div>
                  <p className="eyebrow">Investigation workspace</p>
                  <h3>Internal notes</h3>
                </div>
              </div>
              <div className="support-conversation-summary">
                <div>
                  <span>Owner</span>
                  <strong>{ticket.assigneeName ?? 'Unassigned'}</strong>
                </div>
                <div>
                  <span>Last update</span>
                  <strong>{formatDate(ticket.updatedAt)}</strong>
                </div>
                <div>
                  <span>Investigation status</span>
                  <strong>{safeArray(ticket.notes).length ? 'In progress' : 'Not started'}</strong>
                </div>
              </div>
              <div className="support-notes-list">
                {safeArray(ticket.notes).length ? (
                  safeArray(ticket.notes).map((item) => (
                    <div key={item.id} className="support-note">
                      <strong>{item.authorName}</strong>
                      <span>{formatDate(item.createdAt)}</span>
                      <p>
                        <MentionText text={item.content} />
                      </p>
                    </div>
                  ))
                ) : (
                  <EmptyStatePanel title="No investigation started." description="Add an internal note when support investigation begins." />
                )}
              </div>
              <form
                className="support-note-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!note.trim()) {
                    return;
                  }
                  void noteMutation.mutateAsync(note);
                }}
              >
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Add an internal note..."
                  rows={4}
                />
                <button type="submit" className="button button-primary" disabled={noteMutation.isPending || !note.trim()}>
                  Add note
                </button>
              </form>
            </article>
          ) : null}

          <details className="support-card support-history-details">
            <summary>
              <span>
                <span className="eyebrow">History</span>
                <strong>Activity history ({unifiedTimeline.length} events)</strong>
              </span>
              <span>Expand to view events</span>
            </summary>
            <OperationalTimeline
              title="Activity history"
              subtitle="Historical ticket activity and support replies."
              events={unifiedTimeline}
              audience={isAdmin ? 'admin' : 'vendor'}
            />
          </details>
        </main>

        <aside className="support-detail-side">
          {supportRecommendations.length ? (
            <article className="support-card support-action-panel">
              <div className="support-card-header">
                <div>
                  <p className="eyebrow">Next action</p>
                  <h3>Suggested action</h3>
                </div>
              </div>
              <div className="support-action-recommendation-list">
                {supportRecommendations.map((recommendation) => (
                  <div key={recommendation.id} className="support-action-recommendation">
                    <div>
                      <strong>{recommendation.title}</strong>
                      <p>{recommendation.description}</p>
                      <span>{recommendation.recommendedAction}</span>
                    </div>
                    {recommendation.type === 'support_assignment' && isAdmin ? (
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={assignMutation.isPending || assignedToCurrentUser}
                        onClick={() => void assignMutation.mutateAsync(undefined)}
                      >
                        Assign to me
                      </button>
                    ) : recommendation.type === 'support_escalation' && isAdmin ? (
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={statusMutation.isPending || ticket.status === 'WAITING_FOR_VENDOR'}
                        onClick={() => void statusMutation.mutateAsync('WAITING_FOR_VENDOR')}
                      >
                        Mark Waiting For Vendor
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          {isAdmin ? (
            <article className="support-card">
              <div className="support-card-header">
                <div>
                  <p className="eyebrow">SLA</p>
                  <h3>Response timing</h3>
                </div>
                <StatusBadge tone={getSlaBadgeTone(ticket)}>
                  {ticket.sla?.isOverdue ? 'Overdue' : ticket.sla?.escalationLevel === 'due_soon' ? 'Due soon' : 'On track'}
                </StatusBadge>
              </div>
              <div className="support-summary-grid">
                <div>
                  <span>SLA status</span>
                  <strong>{story.slaSummaryLabel}</strong>
                </div>
                <div>
                  <span>Operational summary</span>
                  <strong>{story.slaSummaryDetail}</strong>
                </div>
                <div>
                  <span>First response due</span>
                  <strong>{formatDate(ticket.firstResponseDueAt)}</strong>
                </div>
                <div>
                  <span>Next response due</span>
                  <strong>{formatDate(ticket.nextResponseDueAt)}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{ticket.sla?.dueLabel ?? 'No active SLA'}</strong>
                </div>
                <div>
                  <span>Escalation</span>
                  <strong>{ticket.escalationReason ?? formatSupportLabel(ticket.sla?.escalationLevel ?? 'none')}</strong>
                </div>
              </div>
            </article>
          ) : null}

          {isAdmin ? (
            <article className="support-card">
              <div className="support-card-header">
                <div>
                  <p className="eyebrow">Actions</p>
                  <h3>Manage ticket</h3>
                </div>
              </div>
              <div className="support-assignee-box">
                <span>Assignee</span>
                <strong>{ticket.assigneeName ?? 'Unassigned'}</strong>
                {ticket.assigneeName && ticket.assigneeName !== currentUser?.name ? (
                  <small>Owned by another admin</small>
                ) : null}
              </div>
              <div className="support-status-actions">
                {assignedToCurrentUser ? (
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={unassignMutation.isPending}
                    onClick={() => void unassignMutation.mutateAsync(undefined)}
                  >
                    Unassign
                  </button>
                ) : !hasAssignmentRecommendation ? (
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={assignMutation.isPending}
                    onClick={() => void assignMutation.mutateAsync(undefined)}
                  >
                    Assign to me
                  </button>
                ) : null}
                {ADMIN_STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className="button button-secondary"
                    disabled={statusMutation.isPending || ticket.status === status}
                    onClick={() => void statusMutation.mutateAsync(status)}
                  >
                    Mark {formatSupportLabel(status)}
                  </button>
                ))}
              </div>
            </article>
          ) : null}

          {isAdmin ? (
            <details className="support-card support-audit-details">
              <summary>
                <span>
                  <span className="eyebrow">Audit</span>
                  <strong>Audit Details</strong>
                </span>
                <span>Technical references</span>
              </summary>
              <div className="support-snapshot-grid">
                {auditEntries.map((entry) => (
                  <div key={`${entry.label}-${entry.value}`}>
                    <span>{entry.label}</span>
                    <strong>{entry.value}</strong>
                  </div>
                ))}
              </div>
            </details>
          ) : (
            <article className="support-card">
              <div className="support-card-header">
                <div>
                  <p className="eyebrow">Status</p>
                  <h3>Support review</h3>
                </div>
              </div>
              <p className="page-description">
                {getVendorSupportStatusCopy(ticket)}
              </p>
            </article>
          )}
        </aside>
      </div>
    </section>
  );
}
