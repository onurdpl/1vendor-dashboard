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
import { listAdminSupportTickets, type SupportTicket, type SupportTicketCategory, type SupportTicketStatus } from '../features/support/api';
import { toTitleCaseLabel } from '../services/real/formatting';

const ALL_STATUSES: Array<SupportTicketStatus | 'all'> = ['all', 'OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR', 'RESOLVED', 'CLOSED'];
const ALL_CATEGORIES: Array<SupportTicketCategory | 'all'> = ['all', 'ORDER', 'RETURN', 'REFUND', 'SHIPMENT', 'TRACKING', 'PAYOUT', 'INVOICE', 'OTHER'];
const ALL_PRIORITIES = ['all', 'low', 'normal', 'high'] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
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
    ticket.contextId,
    JSON.stringify(ticket.contextSnapshot ?? {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query);
}

export function AdminSupportTicketsPage() {
  const { data: tickets, isLoading, isError, error } = useQueryResource(
    queryKeys.admin.support.tickets(),
    listAdminSupportTickets,
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof ALL_STATUSES)[number]>('all');
  const [categoryFilter, setCategoryFilter] = useState<(typeof ALL_CATEGORIES)[number]>('all');
  const [priorityFilter, setPriorityFilter] = useState<(typeof ALL_PRIORITIES)[number]>('all');
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);

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
      return ticketMatchesSearch(ticket, searchTerm);
    });
  }, [categoryFilter, priorityFilter, searchTerm, statusFilter, tickets, unresolvedOnly]);

  if (isLoading) {
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
      />
    );
  }

  return (
    <section className="op-page support-ops-page">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Support operations</p>
          <h1>Support Operations Workspace</h1>
          <p>Review vendor support requests, operational context, and internal investigation notes.</p>
        </div>
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
          <label className="support-toggle">
            <input type="checkbox" checked={unresolvedOnly} onChange={(event) => setUnresolvedOnly(event.target.checked)} />
            Unresolved only
          </label>
        </FilterBar>
      </OperationalToolbar>

      {filteredTickets.length ? (
        <OperationalTable columns={['Ticket', 'Vendor', 'Context', 'Category', 'Priority', 'Status', 'Updated', 'Action']}>
          {filteredTickets.map((ticket) => (
            <OperationalTableRow key={ticket.id}>
              <td>
                <strong>{ticket.subject}</strong>
                <span>{ticket.id}</span>
              </td>
              <td>{ticket.vendorName ?? ticket.vendorId}</td>
              <td>{getContextLabel(ticket)}</td>
              <td>{formatSupportLabel(ticket.category)}</td>
              <td>
                <StatusBadge tone={getPriorityTone(ticket.priority)}>{formatSupportLabel(ticket.priority)}</StatusBadge>
              </td>
              <td>
                <StatusBadge tone={getSupportStatusTone(ticket.status)}>{formatSupportLabel(ticket.status)}</StatusBadge>
              </td>
              <td>{formatDate(ticket.updatedAt)}</td>
              <td>
                <Link to={`/admin/support/${ticket.id}`} className="button button-secondary button-link">
                  Open
                </Link>
              </td>
            </OperationalTableRow>
          ))}
        </OperationalTable>
      ) : (
        <EmptyStatePanel title="No support tickets" description="No tickets match the current filters." />
      )}
    </section>
  );
}
