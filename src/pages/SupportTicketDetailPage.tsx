import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { EmptyStatePanel, StatusBadge } from '../components/OperationalPrimitives';
import { useMutationAction } from '../hooks/useMutationAction';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryClient } from '../lib/api/queryClient';
import { queryKeys } from '../lib/api/queryKeys';
import { getCurrentVendorContext } from '../lib/auth';
import {
  addAdminSupportTicketNote,
  getAdminSupportTicket,
  getVendorSupportTicket,
  updateAdminSupportTicketStatus,
  type SupportTicket,
  type SupportTicketStatus,
} from '../features/support/api';
import { ActionFeedback } from '../components/ActionFeedback';
import { useActionFeedback } from '../lib/ui';
import { formatSupportLabel, getSupportStatusTone } from './AdminSupportTicketsPage';

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

function buildTimeline(ticket: SupportTicket) {
  return [
    { label: 'Ticket created', at: ticket.createdAt, enabled: true },
    { label: `Status ${formatSupportLabel(ticket.status)}`, at: ticket.updatedAt, enabled: true },
    { label: 'Resolved', at: ticket.resolvedAt, enabled: Boolean(ticket.resolvedAt) },
    { label: 'Closed', at: ticket.closedAt, enabled: Boolean(ticket.closedAt) },
  ].filter((entry) => entry.enabled);
}

export function SupportTicketDetailPage() {
  const { ticketId } = useParams();
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin/');
  const currentVendor = getCurrentVendorContext();
  const [note, setNote] = useState('');
  const { message, tone, showFeedback } = useActionFeedback();

  const queryKey = isAdmin
    ? queryKeys.admin.support.detail(ticketId ?? 'missing')
    : queryKeys.support.detail(ticketId ?? 'missing', currentVendor.vendorId);
  const { data: ticket, isLoading, isError, error, refetch } = useQueryResource(
    queryKey,
    () => {
      if (!ticketId) {
        throw new Error('Support ticket not found.');
      }
      return isAdmin ? getAdminSupportTicket(ticketId) : getVendorSupportTicket(ticketId);
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

  const snapshotEntries = useMemo(() => getSnapshotEntries(ticket?.contextSnapshot), [ticket?.contextSnapshot]);

  if (isLoading) {
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
      />
    );
  }

  const contextLink = getContextLink(ticket);

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
            </div>
            {snapshotEntries.length ? (
              <div className="support-snapshot-grid">
                {snapshotEntries.map((entry) => (
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
                <p className="eyebrow">Conversation timeline</p>
                <h3>Progress</h3>
              </div>
            </div>
            <ol className="return-review-timeline">
              {buildTimeline(ticket).map((entry) => (
                <li key={`${entry.label}-${entry.at}`}>
                  <span aria-hidden="true" />
                  <div>
                    <strong>{entry.label}</strong>
                    <small>{formatDate(entry.at)}</small>
                  </div>
                </li>
              ))}
            </ol>
          </article>
        </main>

        <aside className="support-detail-side">
          {isAdmin ? (
            <article className="support-card">
              <div className="support-card-header">
                <div>
                  <p className="eyebrow">Actions</p>
                  <h3>Manage ticket</h3>
                </div>
              </div>
              <div className="support-status-actions">
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
                Your support request is visible to the operations team. Status changes will appear here.
              </p>
            </article>
          )}
        </aside>
      </div>
    </section>
  );
}
