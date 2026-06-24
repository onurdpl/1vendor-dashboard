import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  EmptyStatePanel,
  FilterBar,
  KPIStatCard,
  OperationalTable,
  OperationalTableRow,
  OperationalToolbar,
  SearchInput,
  SectionErrorRetry,
  SectionSkeleton,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { useMutationAction } from '../hooks/useMutationAction';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryClient } from '../lib/api/queryClient';
import { queryKeys } from '../lib/api/queryKeys';
import { useAppReadiness } from '../lib/appReadiness';
import {
  assignAdminSupportTicketToSelf,
  listAdminSupportTickets,
  type SupportTicket,
  type SupportTicketCategory,
  type SupportTicketStatus,
} from '../features/support/api';
import {
  getSupportOperationalStory,
  isResolvedToday,
  ticketMatchesSupportActionBucket,
  type SupportActionBucket,
} from '../lib/supportOperationalStory';
import { formatDateTime, getSafeTimestamp, safeArray, safeStatusLabel } from '../services/real/formatting';

const ALL_STATUSES: Array<SupportTicketStatus | 'all'> = ['all', 'OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR', 'RESOLVED', 'CLOSED'];
const ALL_CATEGORIES: Array<SupportTicketCategory | 'all'> = ['all', 'ORDER', 'RETURN', 'REFUND', 'SHIPMENT', 'TRACKING', 'PAYOUT', 'INVOICE', 'OTHER'];
const ALL_PRIORITIES = ['all', 'low', 'normal', 'high'] as const;
const ASSIGNEE_FILTERS = ['all', 'unassigned', 'me'] as const;
const ACTION_BUCKETS: Array<{ key: SupportActionBucket; label: string; detail: string; tone: 'info' | 'warning' | 'danger' | 'success' | 'neutral' }> = [
  { key: 'needs_assignment', label: 'Needs assignment', detail: 'No owner yet', tone: 'warning' },
  { key: 'needs_response', label: 'Needs admin response', detail: 'Vendor update waiting', tone: 'warning' },
  { key: 'escalated', label: 'Escalated', detail: 'Vendor raised urgency', tone: 'danger' },
  { key: 'overdue', label: 'Overdue', detail: 'SLA breached', tone: 'danger' },
  { key: 'waiting_vendor', label: 'Waiting on vendor', detail: 'Vendor owes next reply', tone: 'info' },
  { key: 'resolved', label: 'Resolved today', detail: 'Recently closed work', tone: 'success' },
];

function formatDate(value: string) {
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatLastReply(ticket: SupportTicket) {
  if (!ticket.lastReplyAt || !ticket.lastReplyByRole) {
    return 'No replies';
  }
  return `${formatSupportLabel(ticket.lastReplyByRole)} · ${formatDate(ticket.lastReplyAt)}`;
}

function getSlaTone(ticket: SupportTicket) {
  return getSupportOperationalStory(ticket).slaTone;
}

function getSlaLabel(ticket: SupportTicket) {
  return getSupportOperationalStory(ticket).slaLabel;
}

function getPriorityTone(priority: SupportTicket['priority']) {
  if (priority === 'high') {
    return 'warning' as const;
  }
  if (priority === 'low') {
    return 'neutral' as const;
  }
  return 'info' as const;
}

export function getSupportStatusTone(status: SupportTicketStatus) {
  if (status === 'OPEN') {
    return 'attention' as const;
  }
  if (status === 'IN_REVIEW') {
    return 'info' as const;
  }
  if (status === 'WAITING_FOR_VENDOR') {
    return 'warning' as const;
  }
  if (status === 'RESOLVED') {
    return 'success' as const;
  }
  return 'neutral' as const;
}

export function formatSupportLabel(value: string) {
  return safeStatusLabel(value);
}

function getContextLabel(ticket: SupportTicket) {
  return getSupportOperationalStory(ticket).contextLabel;
}

function ticketMatchesSearch(ticket: SupportTicket, searchTerm: string) {
  const query = searchTerm.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return [
    ticket.id,
    ticket.subject,
    ticket.vendorId,
    ticket.vendorName,
    ticket.assigneeName,
    ticket.assigneeUserId,
    ticket.contextId,
    JSON.stringify(ticket.contextSnapshot ?? {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query);
}

export function isAdminSupportNeedsResponse(ticket: SupportTicket) {
  return ticket.adminUnreadCount > 0 || (ticket.status === 'OPEN' && !ticket.assigneeUserId && !ticket.assigneeName);
}

export function isAdminSupportEscalated(ticket: SupportTicket) {
  const story = getSupportOperationalStory(ticket);
  return story.isEscalated || story.isOverdue;
}

export function AdminSupportTicketsPage() {
  const appReadiness = useAppReadiness();
  const currentUser = appReadiness.currentUser;
  const [searchParams, setSearchParams] = useSearchParams();
  const initialBucket = (searchParams.get('filter') ?? 'all') as SupportActionBucket;
  const { data: tickets, isLoading, isError, error, refetch } = useQueryResource(
    queryKeys.admin.support.tickets(),
    ({ signal }) => listAdminSupportTickets({ signal }),
    { enabled: appReadiness.ready },
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof ALL_STATUSES)[number]>('all');
  const [categoryFilter, setCategoryFilter] = useState<(typeof ALL_CATEGORIES)[number]>('all');
  const [priorityFilter, setPriorityFilter] = useState<(typeof ALL_PRIORITIES)[number]>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<(typeof ASSIGNEE_FILTERS)[number]>('all');
  const [unresolvedOnly, setUnresolvedOnly] = useState(initialBucket === 'resolved' ? false : true);
  const [needsResponseOnly, setNeedsResponseOnly] = useState(false);
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [actionBucket, setActionBucket] = useState<SupportActionBucket>(
    ACTION_BUCKETS.some((bucket) => bucket.key === initialBucket) ? initialBucket : 'all',
  );
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  const assignMutation = useMutationAction(
    (ticketId: string) => assignAdminSupportTicketToSelf(ticketId),
    {
      onSuccess: async () => {
        setAssignmentError(null);
        await queryClient.invalidateQueries({ queryKey: queryKeys.admin.support.tickets() });
      },
      onError: (error) => {
        setAssignmentError(error instanceof Error ? error.message : 'Unable to assign support ticket.');
      },
    },
  );

  const allTickets = safeArray(tickets);
  const bucketCounts = useMemo(() => {
    return ACTION_BUCKETS.reduce<Record<SupportActionBucket, number>>((counts, bucket) => {
      counts[bucket.key] = allTickets.filter((ticket) => ticketMatchesSupportActionBucket(ticket, bucket.key)).length;
      return counts;
    }, {
      all: allTickets.length,
      needs_assignment: 0,
      needs_response: 0,
      escalated: 0,
      overdue: 0,
      waiting_vendor: 0,
      resolved: 0,
    });
  }, [allTickets]);

  function selectActionBucket(bucket: SupportActionBucket) {
    setActionBucket(bucket);
    setNeedsResponseOnly(false);
    setEscalatedOnly(false);
    setUnresolvedOnly(bucket === 'resolved' ? false : true);
    const nextParams = new URLSearchParams(searchParams);
    if (bucket === 'all') {
      nextParams.delete('filter');
    } else {
      nextParams.set('filter', bucket);
    }
    setSearchParams(nextParams, { replace: true });
  }

  const filteredTickets = useMemo(() => {
    return allTickets.filter((ticket) => {
      if (!ticketMatchesSupportActionBucket(ticket, actionBucket)) {
        return false;
      }
      if (unresolvedOnly && (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED')) {
        return false;
      }
      if (statusFilter !== 'all' && ticket.status !== statusFilter) {
        return false;
      }
      if (categoryFilter !== 'all' && ticket.category !== categoryFilter) {
        return false;
      }
      if (priorityFilter !== 'all' && ticket.priority !== priorityFilter) {
        return false;
      }
      if (assigneeFilter === 'unassigned' && ticket.assigneeUserId) {
        return false;
      }
      if (assigneeFilter === 'me' && currentUser?.name && ticket.assigneeName !== currentUser.name) {
        return false;
      }
      if (assigneeFilter === 'me' && !currentUser?.name) {
        return false;
      }
      if (needsResponseOnly) {
        if (!isAdminSupportNeedsResponse(ticket)) {
          return false;
        }
      }
      if (escalatedOnly && !isAdminSupportEscalated(ticket)) {
        return false;
      }
      return ticketMatchesSearch(ticket, searchTerm);
    }).sort((left, right) => {
      const leftStory = getSupportOperationalStory(left);
      const rightStory = getSupportOperationalStory(right);
      const leftRank = leftStory.isEscalated ? 0 : leftStory.isOverdue ? 1 : leftStory.needsAssignment ? 2 : leftStory.needsAdminResponse ? 3 : 4;
      const rightRank = rightStory.isEscalated ? 0 : rightStory.isOverdue ? 1 : rightStory.needsAssignment ? 2 : rightStory.needsAdminResponse ? 3 : 4;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return getSafeTimestamp(right.updatedAt, 0) - getSafeTimestamp(left.updatedAt, 0);
    });
  }, [actionBucket, allTickets, assigneeFilter, categoryFilter, currentUser?.name, escalatedOnly, needsResponseOnly, priorityFilter, searchTerm, statusFilter, unresolvedOnly]);

  return (
    <section className="op-page support-ops-page">
      <div className="op-page-heading support-ops-header">
        <div>
          <p className="eyebrow">Support operations</p>
          <h1>Support Operations Workspace</h1>
          <p className="support-ops-summary">Review vendor support requests, operational context, and internal investigation notes.</p>
        </div>
        <Link to="/admin/support/analytics" className="button button-secondary button-link support-analytics-link">
          View analytics
        </Link>
      </div>

      <div className="support-action-buckets" aria-label="Support action buckets">
        {ACTION_BUCKETS.map((bucket) => (
          <button
            key={bucket.key}
            type="button"
            className={`support-action-bucket ${actionBucket === bucket.key ? 'is-active' : ''}`}
            onClick={() => selectActionBucket(bucket.key)}
          >
            <KPIStatCard
              label={bucket.label}
              value={bucketCounts[bucket.key] ?? 0}
              detail={bucket.detail}
              tone={bucket.tone}
            />
          </button>
        ))}
      </div>

      <OperationalToolbar>
        <label className="support-search-field" htmlFor="support-ticket-search">
          <span>Search</span>
          <SearchInput
            id="support-ticket-search"
            placeholder="Search ticket, order, return, subject, or vendor..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </label>
        <FilterBar>
          <label className="support-filter-field" htmlFor="support-status-filter">
            <span>Status</span>
            <select id="support-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              {ALL_STATUSES.map((status) => (
                <option key={status} value={status}>{status === 'all' ? 'All statuses' : formatSupportLabel(status)}</option>
              ))}
            </select>
          </label>
          <label className="support-filter-field" htmlFor="support-category-filter">
            <span>Category</span>
            <select id="support-category-filter" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}>
              {ALL_CATEGORIES.map((category) => (
                <option key={category} value={category}>{category === 'all' ? 'All categories' : formatSupportLabel(category)}</option>
              ))}
            </select>
          </label>
          <label className="support-filter-field" htmlFor="support-priority-filter">
            <span>Priority</span>
            <select id="support-priority-filter" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as typeof priorityFilter)}>
              {ALL_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>{priority === 'all' ? 'All priorities' : formatSupportLabel(priority)}</option>
              ))}
            </select>
          </label>
          <label className="support-filter-field" htmlFor="support-assignee-filter">
            <span>Assignee</span>
            <select id="support-assignee-filter" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value as typeof assigneeFilter)}>
              <option value="all">All assignees</option>
              <option value="unassigned">Unassigned</option>
              {currentUser?.name ? <option value="me">Assigned to me</option> : null}
            </select>
          </label>
          <label className="support-filter-field" htmlFor="support-action-filter">
            <span>Quick filter</span>
            <select id="support-action-filter" value={actionBucket} onChange={(event) => selectActionBucket(event.target.value as SupportActionBucket)}>
              <option value="all">All tickets</option>
              {ACTION_BUCKETS.map((bucket) => (
                <option key={bucket.key} value={bucket.key}>{bucket.label}</option>
              ))}
            </select>
          </label>
          <div className="support-toggle-group" aria-label="Support ticket quick filters">
            <label className="support-toggle">
              <input type="checkbox" checked={unresolvedOnly} onChange={(event) => setUnresolvedOnly(event.target.checked)} />
              <span>Unresolved only</span>
            </label>
            <label className="support-toggle">
              <input type="checkbox" checked={needsResponseOnly} onChange={(event) => setNeedsResponseOnly(event.target.checked)} />
              <span>Needs response</span>
            </label>
            <label className="support-toggle">
              <input type="checkbox" checked={escalatedOnly} onChange={(event) => setEscalatedOnly(event.target.checked)} />
              <span>Escalated</span>
            </label>
          </div>
        </FilterBar>
      </OperationalToolbar>
      {assignmentError ? <p className="support-inline-error" role="alert">{assignmentError}</p> : null}

      {isError && !tickets ? (
        <SectionErrorRetry
          title="Support tickets unavailable"
          description={error ?? 'Unable to load support tickets.'}
          onRetry={() => void refetch()}
        />
      ) : !appReadiness.ready || isLoading ? (
        <SectionSkeleton title="Loading support tickets" description="Collecting vendor support requests in the background." />
      ) : filteredTickets.length ? (
        <OperationalTable
          columns={['Ticket', 'Vendor', 'Context', 'Category', 'Priority', 'Workflow', 'SLA', 'Assignment', 'Next action', 'Last reply', 'Action']}
          className="support-admin-table"
        >
          {filteredTickets.map((ticket) => {
            const story = getSupportOperationalStory(ticket);
            const canAssignInline = story.needsAssignment && Boolean(currentUser?.name);
            return (
              <OperationalTableRow key={ticket.id}>
                <span role="cell" className="support-ticket-cell">
                  <strong>{ticket.subject}</strong>
                  <span title={ticket.id}>{ticket.id}</span>
                  {ticket.adminUnreadCount > 0 ? (
                    <StatusBadge tone="attention">{ticket.adminUnreadCount} unread</StatusBadge>
                  ) : null}
                </span>
                <span role="cell" className="support-muted-cell">{ticket.vendorName ?? ticket.vendorId}</span>
                <span role="cell" className="support-context-cell" title={story.contextDetail ?? ticket.contextId ?? story.contextLabel}>
                  <strong>{getContextLabel(ticket)}</strong>
                  {story.contextDetail ? <small>{story.contextDetail}</small> : null}
                </span>
                <span role="cell">{formatSupportLabel(ticket.category)}</span>
                <span role="cell">
                  <StatusBadge tone={getPriorityTone(ticket.priority)}>{formatSupportLabel(ticket.priority)}</StatusBadge>
                </span>
                <span role="cell" className="support-axis-cell">
                  <small>Workflow</small>
                  <StatusBadge tone={getSupportStatusTone(ticket.status)}>{story.workflowLabel}</StatusBadge>
                </span>
                <span role="cell" className="support-sla-cell support-axis-cell">
                  <small>SLA</small>
                  <StatusBadge tone={getSlaTone(ticket)}>{getSlaLabel(ticket)}</StatusBadge>
                  <span>{ticket.sla?.dueLabel ?? 'No active SLA'}</span>
                </span>
                <span role="cell" className={`support-assignment-cell ${story.needsAssignment ? 'is-unassigned' : ''}`}>
                  <strong>{story.assignmentLabel}</strong>
                  {canAssignInline ? (
                    <button
                      type="button"
                      className="button button-secondary button-compact"
                      disabled={assignMutation.isPending}
                      onClick={() => assignMutation.mutate(ticket.id)}
                    >
                      Assign to me
                    </button>
                  ) : null}
                </span>
                <span role="cell" className="support-next-action-cell">
                  <StatusBadge tone={story.nextActionTone}>{story.nextActionLabel}</StatusBadge>
                  <small>{story.nextActionDetail}</small>
                  {story.escalationReason ? <small>Escalated: {story.escalationReason}</small> : null}
                </span>
                <span role="cell" className="support-last-reply-cell">
                  {formatLastReply(ticket)}
                  <small>Updated {formatDate(ticket.updatedAt)}</small>
                </span>
                <span role="cell" className="support-action-cell">
                  <Link to={`/admin/support/${ticket.id}`} className="button button-secondary button-link">
                    Open
                  </Link>
                </span>
              </OperationalTableRow>
            );
          })}
        </OperationalTable>
      ) : (
        <EmptyStatePanel title="No support tickets" description="No tickets match the current filters." />
      )}
    </section>
  );
}
