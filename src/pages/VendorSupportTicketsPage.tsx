import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { EmptyStatePanel, OperationalTable, OperationalTableRow, StatusBadge } from '../components/OperationalPrimitives';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryKeys } from '../lib/api/queryKeys';
import { getCurrentVendorContext } from '../lib/auth';
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

export function VendorSupportTicketsPage() {
  const currentVendor = getCurrentVendorContext();
  const { data: tickets, isLoading, isError, error } = useQueryResource(
    queryKeys.support.tickets(currentVendor.vendorId),
    listVendorSupportTickets,
  );

  if (isLoading) {
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

      {tickets.length ? (
        <OperationalTable columns={['Ticket', 'Subject', 'Category', 'Status', 'Updated']}>
          {tickets.map((ticket: SupportTicket) => (
            <OperationalTableRow key={ticket.id}>
              <td>
                <Link to={`/support/${ticket.id}`}>{ticket.id}</Link>
              </td>
              <td>
                <strong>{ticket.subject}</strong>
                <span>{ticket.message}</span>
              </td>
              <td>{formatSupportLabel(ticket.category)}</td>
              <td>
                <StatusBadge tone={getSupportStatusTone(ticket.status)}>{formatSupportLabel(ticket.status)}</StatusBadge>
              </td>
              <td>{formatDate(ticket.updatedAt)}</td>
            </OperationalTableRow>
          ))}
        </OperationalTable>
      ) : (
        <EmptyStatePanel title="No support requests" description="Submitted support tickets will appear here." />
      )}
    </section>
  );
}
