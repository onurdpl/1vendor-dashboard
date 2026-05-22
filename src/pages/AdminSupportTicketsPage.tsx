import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import {
  EmptyStatePanel,
  FilterBar,
  OperationalTable,
  OperationalTableRow,
  OperationalToolbar,
  SearchInput,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryKeys } from '../lib/api/queryKeys';
import { useAppReadiness } from '../lib/appReadiness';
import { listAdminSupportTickets, type SupportTicket, type SupportTicketCategory, type SupportTicketStatus } from '../features/support/api';
import { toTitleCaseLabel } from '../services/real/formatting';

const ALL_STATUSES: Array<SupportTicketStatus | 'all'> = ['all', 'OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR', 'RESOLVED', 'CLOSED'];
const ALL_CATEGORIES: Array<SupportTicketCategory | 'all'> = ['all', 'ORDER', 'RETURN', 'REFUND', 'SHIPMENT', 'TRACKING', 'PAYOUT', 'INVOICE', 'OTHER'];
const ALL_PRIORITIES = ['all', 'low', 'normal', 'high'] as const;
const ASSIGNEE_FILTERS = ['all', 'unassigned', 'me'] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatLastReply(ticket: SupportTicket) {
  if (!ticket.lastReplyAt || !ticket.lastReplyByRole) {
    return 'No replies';
  }
  return `${formatSupportLabel(ticket.lastReplyByRole)} · ${formatDate(ticket.lastReplyAt)}`;
}

function getSlaTone(ticket: SupportTicket) {
  if (ticket.sla?.escalationLevel === 'escalated' || ticket.sla?.isOverdue) {
    return 'danger' as const;
  }
  if (ticket.sla?.escalationLevel === 'due_soon') {
    return 'warning' as const;
  }
  return 'neutral' as const;
}

function getSlaLabel(ticket: SupportTicket) {
  if (!ticket.sla || ticket.sla.escalationLevel === 'none') {
    return ticket.sla?.dueLabel ?? 'No active SLA';
  }
  if (ticket.sla.escalationLevel === 'due_soon') {
    return 'Due soon';
  }
  return ticket.sla.escalationLevel === 'escalated' ? 'Escalated' : 'Overdue';
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
  return toTitleCaseLabel(value.toLowerCase());
}

function getContextLabel(ticket: SupportTicket) {
  if (!ticket.contextId) {
    return formatSupportLabel(ticket.contextType);
  }
  return `${formatSupportLabel(ticket.contextType)} ${ticket.contextId}`;
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
  return Boolean(ticket.sla?.isOverdue || ticket.sla?.escalationLevel === 'escalated');
}

export function AdminSupportTicketsPage() {
  const appReadiness = useAppReadiness();
  const currentUser = appReadiness.currentUser;
  const { data: tickets, isLoading, isError, error, diagnostics, refetch } = useQueryResource(
    queryKeys.admin.support.tickets(),
    listAdminSupportTickets,
    { enabled: appReadiness.ready },
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof ALL_STATUSES)[number]>('all');
  const [categoryFilter, setCategoryFilter] = useState<(typeof ALL_CATEGORIES)[number]>('all');
  const [priorityFilter, setPriorityFilter] = useState<(typeof ALL_PRIORITIES)[number]>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<(typeof ASSIGNEE_FILTERS)[number]>('all');
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);
  const [needsResponseOnly, setNeedsResponseOnly] = useState(false);
  const [escalatedOnly, setEscalatedOnly] = useState(false);

  const filteredTickets = useMemo(() => {
    return (tickets ?? []).filter((ticket) => {
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
      const leftRank = left.sla?.isOverdue ? 0 : left.sla?.escalationLevel === 'due_soon' ? 1 : 2;
      const rightRank = right.sla?.isOverdue ? 0 : right.sla?.escalationLevel === 'due_soon' ? 1 : 2;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [assigneeFilter, categoryFilter, currentUser?.name, escalatedOnly, needsResponseOnly, priorityFilter, searchTerm, statusFilter, tickets, unresolvedOnly]);

  if (!appReadiness.ready || isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Support"
        title="Loading support tickets"
        description="Collecting vendor support requests."
      />
    );
  }

  if (isError || !tickets) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Support"
        title="Support tickets unavailable"
        description={error ?? 'Unable to load support tickets.'}
        diagnostics={diagnostics}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <section className="op-page support-ops-page">
      <div className="op-page-heading support-ops-header">
        <div>
          <p className="eyebrow">Support operations</p>
          <h1>Support Operations Workspace</h1>
          <p>Review vendor support requests, operational context, and internal investigation notes.</p>
        </div>
        <Link to="/admin/support/analytics" className="button button-secondary button-link">
          View analytics
        </Link>
      </div>

      <OperationalToolbar>
        <SearchInput
          placeholder="Search ticket, order, return, subject, or vendor..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
        <FilterBar>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            {ALL_STATUSES.map((status) => (
              <option key={status} value={status}>{status === 'all' ? 'All statuses' : formatSupportLabel(status)}</option>
            ))}
          </select>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}>
            {ALL_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category === 'all' ? 'All categories' : formatSupportLabel(category)}</option>
            ))}
          </select>
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as typeof priorityFilter)}>
            {ALL_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>{priority === 'all' ? 'All priorities' : formatSupportLabel(priority)}</option>
            ))}
          </select>
          <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value as typeof assigneeFilter)}>
            <option value="all">All assignees</option>
            <option value="unassigned">Unassigned</option>
            {currentUser?.name ? <option value="me">Assigned to me</option> : null}
          </select>
          <label className="support-toggle">
            <input type="checkbox" checked={unresolvedOnly} onChange={(event) => setUnresolvedOnly(event.target.checked)} />
            Unresolved only
          </label>
          <label className="support-toggle">
            <input type="checkbox" checked={needsResponseOnly} onChange={(event) => setNeedsResponseOnly(event.target.checked)} />
            Needs response
          </label>
          <label className="support-toggle">
            <input type="checkbox" checked={escalatedOnly} onChange={(event) => setEscalatedOnly(event.target.checked)} />
            Escalated
          </label>
        </FilterBar>
      </OperationalToolbar>

      {filteredTickets.length ? (
        <OperationalTable
          columns={['Ticket', 'Vendor', 'Context', 'Category', 'Priority', 'Status', 'SLA', 'Assignee', 'Last reply', 'Updated', 'Action']}
          className="support-admin-table"
        >
          {filteredTickets.map((ticket) => (
            <OperationalTableRow key={ticket.id}>
              <span role="cell" className="support-ticket-cell">
                <strong>{ticket.subject}</strong>
                <span>{ticket.id}</span>
                {ticket.adminUnreadCount > 0 ? (
                  <StatusBadge tone="attention">{ticket.adminUnreadCount} unread</StatusBadge>
                ) : null}
              </span>
              <span role="cell" className="support-muted-cell">{ticket.vendorName ?? ticket.vendorId}</span>
              <span role="cell" className="support-context-cell">{getContextLabel(ticket)}</span>
              <span role="cell">{formatSupportLabel(ticket.category)}</span>
              <span role="cell">
                <StatusBadge tone={getPriorityTone(ticket.priority)}>{formatSupportLabel(ticket.priority)}</StatusBadge>
              </span>
              <span role="cell">
                <StatusBadge tone={getSupportStatusTone(ticket.status)}>{formatSupportLabel(ticket.status)}</StatusBadge>
              </span>
              <span role="cell" className="support-sla-cell">
                <StatusBadge tone={getSlaTone(ticket)}>{getSlaLabel(ticket)}</StatusBadge>
                <span>{ticket.sla?.dueLabel ?? 'No active SLA'}</span>
              </span>
              <span role="cell" className="support-muted-cell">{ticket.assigneeName ?? 'Unassigned'}</span>
              <span role="cell" className="support-last-reply-cell">{formatLastReply(ticket)}</span>
              <span role="cell" className="support-muted-cell">{formatDate(ticket.updatedAt)}</span>
              <span role="cell" className="support-action-cell">
                <Link to={`/admin/support/${ticket.id}`} className="button button-secondary button-link">
                  Open
                </Link>
              </span>
            </OperationalTableRow>
          ))}
        </OperationalTable>
      ) : (
        <EmptyStatePanel title="No support tickets" description="No tickets match the current filters." />
      )}
    </section>
  );
}
