import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { EmptyStatePanel, OperationalTable, OperationalTableRow, StatusBadge } from '../components/OperationalPrimitives';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryKeys } from '../lib/api/queryKeys';
import { listAdminSupportTickets, type SupportTicket } from '../features/support/api';
import { toTitleCaseLabel } from '../services/real/formatting';

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

function getContextPath(ticket: SupportTicket) {
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

export function AdminSupportTicketsPage() {
  const { data: tickets, isLoading, isError, error } = useQueryResource(
    queryKeys.admin.support.tickets(),
    listAdminSupportTickets,
  );

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
    <section className="op-page">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Admin support</p>
          <h1>Support tickets</h1>
          <p>Internal vendor support requests with operational context.</p>
        </div>
      </div>

      {tickets.length ? (
        <OperationalTable columns={['Created', 'Vendor', 'Subject', 'Priority', 'Context', 'Status']}>
          {tickets.map((ticket) => {
            const contextPath = getContextPath(ticket);
            return (
              <OperationalTableRow key={ticket.id}>
                <td>{formatDate(ticket.createdAt)}</td>
                <td>{ticket.vendorName ?? ticket.vendorId}</td>
                <td>
                  <strong>{ticket.subject}</strong>
                  <span>{ticket.message}</span>
                </td>
                <td>
                  <StatusBadge tone={getPriorityTone(ticket.priority)}>{toTitleCaseLabel(ticket.priority)}</StatusBadge>
                </td>
                <td>
                  {contextPath ? (
                    <Link to={contextPath}>{toTitleCaseLabel(ticket.contextType)} {ticket.contextId}</Link>
                  ) : (
                    <span>{toTitleCaseLabel(ticket.contextType)}</span>
                  )}
                </td>
                <td>
                  <StatusBadge tone={ticket.status === 'resolved' ? 'success' : 'attention'}>
                    {toTitleCaseLabel(ticket.status)}
                  </StatusBadge>
                </td>
              </OperationalTableRow>
            );
          })}
        </OperationalTable>
      ) : (
        <EmptyStatePanel title="No support tickets" description="Vendor support requests will appear here." />
      )}
    </section>
  );
}
