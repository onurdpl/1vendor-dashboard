import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { EmptyStatePanel, StatusBadge } from '../components/OperationalPrimitives';
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
import { OperationalLinkCards, OperationalTimeline } from '../components/OperationalTimeline';
import { OperationalRecommendations } from '../components/OperationalRecommendations';
import { getSnapshotString, type OperationalEventInput, type OperationalLinkInput } from '../lib/operationalCrossLinks';
import type { OperationsRecommendation } from '../lib/api/contracts';

const ADMIN_STATUSES: SupportTicketStatus[] = ['IN_REVIEW', 'WAITING_FOR_VENDOR', 'RESOLVED', 'CLOSED'];

function formatDate(value: string | null | undefined) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
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
      description: 'Open the operational record connected to this ticket.',
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
      href: '/finance',
      status: ticket.category,
      tone: ticket.category === 'REFUND' ? 'warning' : 'success',
    });
  }

  return links;
}

function buildTimeline(ticket: SupportTicket) {
  return [
    { label: 'Ticket created', at: ticket.createdAt, enabled: true },
    { label: `Status ${formatSupportLabel(ticket.status)}`, at: ticket.updatedAt, enabled: true },
    { label: 'Resolved', at: ticket.resolvedAt, enabled: Boolean(ticket.resolvedAt) },
    { label: 'Closed', at: ticket.closedAt, enabled: Boolean(ticket.closedAt) },
  ].filter((entry) => entry.enabled);
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
    ...(ticket.replies ?? []).map((reply) => ({
      id: `reply-${reply.id}`,
      title: reply.authorRole === 'ADMIN' ? 'Support reply added' : 'Vendor reply added',
      description: reply.message,
      at: reply.createdAt,
      status: formatSupportLabel(reply.authorRole),
      tone: reply.authorRole === 'ADMIN' ? ('info' as const) : ('neutral' as const),
    })),
    {
      id: 'ticket-updated',
      title: `Status ${formatSupportLabel(ticket.status)}`,
      at: ticket.updatedAt,
      status: formatSupportLabel(ticket.status),
      tone: ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? 'success' : 'attention',
    },
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

  return events;
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
    () => {
      if (!ticketId) {
        throw new Error('Support ticket not found.');
      }
      return isAdmin ? getAdminSupportTicket(ticketId) : getVendorSupportTicket(ticketId);
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

  const contextEntries = useMemo(
    () => getSupportTicketContextEntries(ticket, isAdmin),
    [isAdmin, ticket?.contextSnapshot, ticket?.contextSummary],
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

  if (!authContextReady || isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Support"
        title="Loading support ticket"
        description="Preparing support ticket context."
      />
    );
  }

  if (isError || !ticket) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Support"
        title="Support ticket unavailable"
        description={error ?? 'Unable to load support ticket.'}
        diagnostics={diagnostics}
      />
    );
  }

  const contextLink = getContextLink(ticket);
  const canReply = ticket.status !== 'CLOSED';
  const assignedToCurrentUser = Boolean(currentUser?.name && ticket.assigneeName === currentUser.name);
  const contextLinks = buildContextLinks(ticket, isAdmin);
  const unifiedTimeline = buildUnifiedSupportTimeline(ticket);
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

  return (
    <section className="op-page support-detail-page">
      <div className="support-detail-header">
        <div>
          <Link to={isAdmin ? '/admin/support' : '/support'} className="return-review-back">
            {'<-'} Back to support
          </Link>
          <p className="eyebrow">{isAdmin ? 'Support operations' : 'Support request'}</p>
          <h1>{ticket.subject}</h1>
          <p>{ticket.message}</p>
        </div>
        <div className="support-detail-badges">
          <StatusBadge tone={getSupportStatusTone(ticket.status)}>{formatSupportLabel(ticket.status)}</StatusBadge>
          <StatusBadge tone="info">{formatSupportLabel(ticket.category)}</StatusBadge>
        </div>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}

      <div className="support-detail-grid">
        <main className="support-detail-main">
          <article className="support-card">
            <div className="support-card-header">
              <div>
                <p className="eyebrow">Context summary</p>
                <h3>{formatSupportLabel(ticket.contextType)}</h3>
              </div>
              {contextLink ? (
                <Link to={contextLink} className="button button-secondary button-link">
                  Open context
                </Link>
              ) : null}
            </div>
            <div className="support-summary-grid">
              <div>
                <span>Vendor</span>
                <strong>{ticket.vendorName ?? ticket.vendorId}</strong>
              </div>
              <div>
                <span>Context</span>
                <strong>{ticket.contextId ?? 'General'}</strong>
              </div>
              <div>
                <span>Priority</span>
                <strong>{formatSupportLabel(ticket.priority)}</strong>
              </div>
              <div>
                <span>Created</span>
                <strong>{formatDate(ticket.createdAt)}</strong>
              </div>
              <div>
                <span>Assignee</span>
                <strong>{ticket.assigneeName ?? 'Unassigned'}</strong>
              </div>
            </div>
            {contextEntries.length ? (
              <div className="support-snapshot-grid">
                {contextEntries.map((entry) => (
                  <div key={entry.label}>
                    <span>{entry.label}</span>
                    <strong>{entry.value}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </article>

          <article className="support-card">
            <div className="support-card-header">
              <div>
                <p className="eyebrow">Conversation</p>
                <h3>Public thread</h3>
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
              {ticket.replies?.length ? (
                ticket.replies.map((reply) => (
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
                  <select value={replyStatus} onChange={(event) => setReplyStatus(event.target.value as typeof replyStatus)}>
                    <option value="keep">Keep current status</option>
                    <option value="WAITING_FOR_VENDOR">Set waiting for vendor</option>
                  </select>
                ) : null}
                <button type="submit" className="button button-primary" disabled={replyMutation.isPending || !replyMessage.trim()}>
                  {replyMutation.isPending ? 'Posting...' : 'Post reply'}
                </button>
              </form>
            ) : (
              <p className="page-description">Closed support tickets cannot receive new replies.</p>
            )}
          </article>

          <OperationalTimeline
            title="Unified activity"
            subtitle="Ticket status and public support replies."
            events={[
              ...buildTimeline(ticket).map((entry) => ({
                id: `status-${entry.label}-${entry.at}`,
                title: entry.label,
                at: entry.at,
                tone: 'neutral' as const,
              })),
              ...unifiedTimeline,
            ]}
            audience={isAdmin ? 'admin' : 'vendor'}
          />
        </main>

        <aside className="support-detail-side">
          <OperationalRecommendations
            title="Suggested next steps"
            subtitle="Contextual, read-only support guidance."
            recommendations={supportRecommendations}
            audience={isAdmin ? 'admin' : 'vendor'}
          />

          <OperationalLinkCards
            title="Context links"
            subtitle="Operational records connected to this support ticket."
            links={contextLinks}
            audience={isAdmin ? 'admin' : 'vendor'}
          />

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
                ) : (
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={assignMutation.isPending}
                    onClick={() => void assignMutation.mutateAsync(undefined)}
                  >
                    Assign to me
                  </button>
                )}
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
            <article className="support-card">
              <div className="support-card-header">
                <div>
                  <p className="eyebrow">Internal notes</p>
                  <h3>Investigation</h3>
                </div>
              </div>
              <div className="support-notes-list">
                {ticket.notes?.length ? (
                  ticket.notes.map((item) => (
                    <div key={item.id} className="support-note">
                      <strong>{item.authorName}</strong>
                      <span>{formatDate(item.createdAt)}</span>
                      <p>{item.content}</p>
                    </div>
                  ))
                ) : (
                  <EmptyStatePanel title="No internal notes" description="Add investigation notes for admins." />
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
