import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { EmptyStatePanel, FilterBar, OperationalTable, OperationalTableRow, OperationalToolbar, StatusBadge } from '../components/OperationalPrimitives';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryKeys } from '../lib/api/queryKeys';
import { useAppReadiness } from '../lib/appReadiness';
import { listVendorSupportTickets, type SupportTicket } from '../features/support/api';
import { formatSupportLabel, getSupportStatusTone } from './AdminSupportTicketsPage';

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

export function isVendorSupportUnread(ticket: SupportTicket) {
  return ticket.vendorUnreadCount > 0;
}

export function VendorSupportTicketsPage() {
  const appReadiness = useAppReadiness();
  const currentVendor = appReadiness.currentVendor;
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data: tickets, isLoading, isError, error, diagnostics } = useQueryResource(
    queryKeys.support.tickets(currentVendor.vendorId),
    listVendorSupportTickets,
    { enabled: appReadiness.ready },
  );

  const filteredTickets = useMemo(() => {
    return (tickets ?? []).filter((ticket) => !unreadOnly || isVendorSupportUnread(ticket));
  }, [tickets, unreadOnly]);

  if (!appReadiness.ready || isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Support"
        title="Loading support requests"
        description="Collecting your vendor support requests."
      />
    );
  }

  if (isError || !tickets) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Support"
        title="Support requests unavailable"
        description={error ?? 'Unable to load support requests.'}
        diagnostics={diagnostics}
      />
    );
  }

  return (
    <section className="op-page support-ops-page">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Support</p>
          <h1>Vendor Support Requests</h1>
          <p>Track support requests submitted with order, return, and shipment context.</p>
        </div>
      </div>

      <OperationalToolbar>
        <FilterBar>
          <label className="support-toggle">
            <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />
            Unread only
          </label>
        </FilterBar>
      </OperationalToolbar>

      {filteredTickets.length ? (
        <OperationalTable columns={['Ticket', 'Subject', 'Category', 'Status', 'Last reply', 'Updated']} className="support-vendor-table">
          {filteredTickets.map((ticket: SupportTicket) => (
            <OperationalTableRow key={ticket.id}>
              <span role="cell" className="support-ticket-cell">
                <Link to={`/support/${ticket.id}`}>{ticket.id}</Link>
                {ticket.vendorUnreadCount > 0 ? (
                  <StatusBadge tone="attention">{ticket.vendorUnreadCount} unread</StatusBadge>
                ) : null}
              </span>
              <span role="cell" className="support-ticket-cell">
                <strong>{ticket.subject}</strong>
                <span>{ticket.message}</span>
              </span>
              <span role="cell">{formatSupportLabel(ticket.category)}</span>
              <span role="cell">
                <StatusBadge tone={getSupportStatusTone(ticket.status)}>{formatSupportLabel(ticket.status)}</StatusBadge>
              </span>
              <span role="cell">{formatLastReply(ticket)}</span>
              <span role="cell">{formatDate(ticket.updatedAt)}</span>
            </OperationalTableRow>
          ))}
        </OperationalTable>
      ) : (
        <EmptyStatePanel title="No support requests" description="Submitted support tickets will appear here." />
      )}
    </section>
  );
}
