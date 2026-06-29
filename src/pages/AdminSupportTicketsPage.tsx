import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  EmptyStatePanel,
  FilterBar,
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
import { getPageReadinessState } from '../lib/pageReadiness';
import {
  assignAdminSupportTicketToSelf,
  listAdminSupportTickets,
  type SupportTicket,
  type SupportTicketCategory,
  type SupportTicketStatus,
} from '../features/support/api';
import {
  getSupportOperationalStory,
  ticketMatchesSupportActionBucket,
  type SupportActionBucket,
} from '../lib/supportOperationalStory';
import { formatDateTime, getSafeTimestamp, safeArray, safeStatusLabel } from '../services/real/formatting';

const ALL_STATUSES: Array<SupportTicketStatus | 'all'> = ['all', 'OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR', 'RESOLVED', 'CLOSED'];
const ALL_CATEGORIES: Array<SupportTicketCategory | 'all'> = ['all', 'ORDER', 'RETURN', 'REFUND', 'SHIPMENT', 'TRACKING', 'PAYOUT', 'INVOICE', 'OTHER'];
const ALL_PRIORITIES = ['all', 'low', 'normal', 'high'] as const;
const ASSIGNEE_FILTERS = ['all', 'unassigned', 'me'] as const;
const WORKFLOW_TABS: Array<{ key: SupportActionBucket; label: string; detail: string }> = [
  { key: 'all', label: 'All', detail: 'Full queue' },
  { key: 'needs_assignment', label: 'Needs Assignment', detail: 'No owner yet' },
  { key: 'needs_response', label: 'Needs Admin Response', detail: 'Vendor update waiting' },
  { key: 'escalated', label: 'Escalated', detail: 'Vendor raised urgency' },
  { key: 'overdue', label: 'Overdue', detail: 'SLA breached' },
  { key: 'waiting_vendor', label: 'Waiting on Vendor', detail: 'Vendor owes next reply' },
  { key: 'resolved', label: 'Resolved', detail: 'Recently closed work' },
];

function formatShortDate(value: string) {
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
  });
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

function getContextKind(ticket: SupportTicket) {
  if (ticket.contextType === 'general') {
    return 'Vendor Profile';
  }
  if (ticket.category === 'TRACKING') {
    return 'Tracking';
  }
  if (ticket.category === 'SHIPMENT') {
    return 'Shipment';
  }
  if (ticket.category === 'RETURN') {
    return 'Return';
  }
  if (ticket.category === 'ORDER') {
    return 'Order';
  }
  if (ticket.category === 'REFUND' || ticket.category === 'PAYOUT' || ticket.category === 'INVOICE') {
    return 'Payment';
  }
  return formatSupportLabel(ticket.category);
}

function getContextTarget(ticket: SupportTicket) {
  if (ticket.contextType === 'general') {
    return 'Vendor Settings';
  }
  return getContextLabel(ticket);
}

function getOperationalContextLabel(ticket: SupportTicket) {
  return `${getContextKind(ticket)} • ${getContextTarget(ticket)}`;
}

function getWaitingOnLabel(ticket: SupportTicket) {
  const story = getSupportOperationalStory(ticket);
  if (story.isResolved || story.isClosed) {
    return 'Resolved';
  }
  if (story.isEscalated) {
    return 'Escalated';
  }
  if (story.isWaitingOnVendor) {
    return 'Waiting on Vendor';
  }
  if (story.needsAssignment || story.needsAdminResponse || story.isOverdue) {
    return 'Waiting on Admin';
  }
  return 'Review Required';
}

function getWaitingOnTone(ticket: SupportTicket) {
  const label = getWaitingOnLabel(ticket);
  if (label === 'Resolved') {
    return 'success' as const;
  }
  if (label === 'Escalated') {
    return 'danger' as const;
  }
  if (label === 'Waiting on Vendor') {
    return 'info' as const;
  }
  return 'warning' as const;
}

function getLastUpdateLabel(ticket: SupportTicket) {
  if (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED' && ticket.sla?.isOverdue) {
    return typeof ticket.sla.overdueByHours === 'number'
      ? `Overdue ${ticket.sla.overdueByHours}h`
      : 'Overdue';
  }
  if (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED' && ticket.sla?.dueLabel) {
    return ticket.sla.dueLabel;
  }
  return `Updated ${formatShortDate(ticket.lastReplyAt ?? ticket.updatedAt)}`;
}

function getLastUpdateTone(ticket: SupportTicket) {
  if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
    return 'success' as const;
  }
  if (ticket.sla?.isOverdue || ticket.sla?.escalationLevel === 'overdue' || ticket.sla?.escalationLevel === 'escalated') {
    return 'danger' as const;
  }
  if (ticket.sla?.escalationLevel === 'due_soon') {
    return 'warning' as const;
  }
  return 'neutral' as const;
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
  const pageReadiness = getPageReadinessState(appReadiness, {
    requiresVendorContext: false,
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const initialBucket = (searchParams.get('filter') ?? 'all') as SupportActionBucket;
  const { data: tickets, isLoading, isError, error, refetch } = useQueryResource(
    queryKeys.admin.support.tickets(),
    ({ signal }) => listAdminSupportTickets({ signal }),
    { enabled: pageReadiness.ready },
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof ALL_STATUSES)[number]>('all');
  const [categoryFilter, setCategoryFilter] = useState<(typeof ALL_CATEGORIES)[number]>('all');
  const [priorityFilter, setPriorityFilter] = useState<(typeof ALL_PRIORITIES)[number]>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<(typeof ASSIGNEE_FILTERS)[number]>('all');
  const [unresolvedOnly, setUnresolvedOnly] = useState(initialBucket === 'resolved' ? false : true);
  const [actionBucket, setActionBucket] = useState<SupportActionBucket>(
    WORKFLOW_TABS.some((bucket) => bucket.key === initialBucket) ? initialBucket : 'all',
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
    return WORKFLOW_TABS.reduce<Record<SupportActionBucket, number>>((counts, bucket) => {
      counts[bucket.key] = bucket.key === 'all'
        ? allTickets.filter((ticket) => !unresolvedOnly || (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED')).length
        : allTickets.filter((ticket) => ticketMatchesSupportActionBucket(ticket, bucket.key)).length;
      return counts;
    }, {
      all: allTickets.filter((ticket) => !unresolvedOnly || (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED')).length,
      needs_assignment: 0,
      needs_response: 0,
      escalated: 0,
      overdue: 0,
      waiting_vendor: 0,
      resolved: 0,
    });
  }, [allTickets, unresolvedOnly]);

  function selectActionBucket(bucket: SupportActionBucket) {
    setActionBucket(bucket);
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
  }, [actionBucket, allTickets, assigneeFilter, categoryFilter, currentUser?.name, priorityFilter, searchTerm, statusFilter, unresolvedOnly]);

  return (
    <section className="op-page support-ops-page">
      <div className="op-page-heading support-ops-header">
        <div>
          <h1>Support Operations</h1>
          <p className="support-ops-summary">Manage operational support tickets.</p>
        </div>
        <Link to="/admin/support/analytics" className="button button-secondary button-link support-analytics-link">
          View analytics
        </Link>
      </div>

      <div className="orders-workflow-tabs support-workflow-tabs" aria-label="Support workflow tabs">
        {WORKFLOW_TABS.map((bucket) => (
          <button
            key={bucket.key}
            type="button"
            className={actionBucket === bucket.key ? 'is-active' : ''}
            aria-pressed={actionBucket === bucket.key}
            onClick={() => selectActionBucket(bucket.key)}
          >
            <span>{bucket.label}</span>
            <strong>{bucketCounts[bucket.key] ?? 0}</strong>
            <small>{bucket.detail}</small>
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
          <div className="support-toggle-group" aria-label="Support ticket quick filters">
            <label className="support-toggle">
              <input type="checkbox" checked={unresolvedOnly} onChange={(event) => setUnresolvedOnly(event.target.checked)} />
              <span>Unresolved only</span>
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
      ) : pageReadiness.status === 'unauthorized' ? (
        <SectionErrorRetry
          title="Sign in required"
          description="An authenticated admin session is required to load support tickets."
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <SectionSkeleton title="Loading support tickets" description="Collecting vendor support requests in the background." />
      ) : filteredTickets.length ? (
        <OperationalTable
          columns={['Ticket', 'Vendor', 'Context', 'Priority', 'Owner', 'Waiting On', 'Last Update', 'Open']}
          className="support-admin-table"
        >
          {filteredTickets.map((ticket) => {
            const story = getSupportOperationalStory(ticket);
            const canAssignInline = story.needsAssignment && Boolean(currentUser?.name);
            return (
              <OperationalTableRow key={ticket.id}>
                <span role="cell" className="support-ticket-cell">
                  <strong>{ticket.subject}</strong>
                  {ticket.adminUnreadCount > 0 ? (
                    <StatusBadge tone="attention">{ticket.adminUnreadCount} unread</StatusBadge>
                  ) : null}
                </span>
                <span role="cell" className="support-muted-cell">{ticket.vendorName ?? 'Unknown vendor'}</span>
                <span role="cell" className="support-context-cell" title={story.contextDetail ?? ticket.contextId ?? getOperationalContextLabel(ticket)}>
                  {getOperationalContextLabel(ticket)}
                </span>
                <span role="cell">
                  <StatusBadge tone={getPriorityTone(ticket.priority)}>{formatSupportLabel(ticket.priority)}</StatusBadge>
                </span>
                <span role="cell" className={`support-assignment-cell ${story.needsAssignment ? 'is-unassigned' : ''}`}>
                  {canAssignInline ? (
                    <button
                      type="button"
                      className="button button-secondary button-compact"
                      disabled={assignMutation.isPending}
                      onClick={() => assignMutation.mutate(ticket.id)}
                    >
                      Assign to me
                    </button>
                  ) : (
                    <strong>{ticket.assigneeName ?? 'Unassigned'}</strong>
                  )}
                </span>
                <span role="cell" className="support-waiting-cell">
                  <StatusBadge tone={getWaitingOnTone(ticket)}>{getWaitingOnLabel(ticket)}</StatusBadge>
                </span>
                <span role="cell" className="support-update-cell">
                  <StatusBadge tone={getLastUpdateTone(ticket)}>{getLastUpdateLabel(ticket)}</StatusBadge>
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
