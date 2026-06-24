import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  EmptyStatePanel,
  FilterBar,
  OperationalTable,
  OperationalTableRow,
  OperationalToolbar,
  SectionErrorRetry,
  SectionSkeleton,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryKeys } from '../lib/api/queryKeys';
import { useAppReadiness } from '../lib/appReadiness';
import { getPageReadinessState } from '../lib/pageReadiness';
import { listVendorSupportTickets, type SupportTicket } from '../features/support/api';
import { formatSupportLabel, getSupportStatusTone } from './AdminSupportTicketsPage';
import { formatDateTime, safeArray } from '../services/real/formatting';

function formatDate(value: string | null | undefined) {
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

export function isVendorSupportUnread(ticket: SupportTicket) {
  return ticket.vendorUnreadCount > 0;
}

function isOpenSupportIssue(ticket: SupportTicket) {
  const status = String(ticket.status ?? '').toUpperCase();
  return !ticket.closedAt && !ticket.resolvedAt && !['CLOSED', 'RESOLVED'].includes(status);
}

export function VendorSupportTicketsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const appReadiness = useAppReadiness();
  const currentVendor = appReadiness.currentVendor;
  const pageReadiness = getPageReadinessState(appReadiness, {
    requiresVendorContext: true,
    currentVendorId: currentVendor.vendorId,
  });
  const [unreadOnly, setUnreadOnly] = useState(false);
  const workflowOpenSupportIssues = searchParams.get('workflow') === 'open-support-issues';
  const { data: tickets, isLoading, isError, error, refetch } = useQueryResource(
    queryKeys.support.tickets(currentVendor.vendorId),
    ({ signal }) => listVendorSupportTickets({ signal }),
    { enabled: pageReadiness.ready },
  );

  const filteredTickets = useMemo(() => {
    return safeArray(tickets).filter((ticket) => {
      const matchesWorkflow = !workflowOpenSupportIssues || isOpenSupportIssue(ticket);
      const matchesUnread = !unreadOnly || isVendorSupportUnread(ticket);
      return matchesWorkflow && matchesUnread;
    });
  }, [tickets, unreadOnly, workflowOpenSupportIssues]);

  function clearWorkflowFilter() {
    if (!searchParams.has('workflow')) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('workflow');
    setSearchParams(nextParams, { replace: true });
  }

  return (
    <section className="op-page support-ops-page">
      <div className="op-page-heading support-ops-header">
        <div>
          <p className="eyebrow">Support</p>
          <h1>Vendor Support Requests</h1>
          <p>Track support requests submitted with order, return, and shipment context.</p>
        </div>
      </div>

      <OperationalToolbar>
        <FilterBar>
          <label className="support-toggle">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => {
                clearWorkflowFilter();
                setUnreadOnly(event.target.checked);
              }}
            />
            Unread only
          </label>
        </FilterBar>
      </OperationalToolbar>

      {workflowOpenSupportIssues ? (
        <div className="workflow-filter-banner" aria-label="Active workflow filter">
          <div>
            <span>Workflow filter</span>
            <strong>Open support issues</strong>
            <small>Showing active support records that need follow-up.</small>
          </div>
          <button type="button" className="button button-secondary button-compact" onClick={clearWorkflowFilter}>
            Clear workflow
          </button>
        </div>
      ) : null}

      {isError && !tickets ? (
        <SectionErrorRetry
          title="Support requests unavailable"
          description={error ?? 'Unable to load support requests.'}
          onRetry={() => void refetch()}
        />
      ) : pageReadiness.status === 'missing_vendor_context' ? (
        <EmptyStatePanel
          title="Select vendor"
          description="No vendor context available. Choose a vendor context before loading support requests."
        />
      ) : pageReadiness.status === 'waiting_vendor_context' ? (
        <EmptyStatePanel
          title="Waiting for vendor context"
          description="Support requests will load after the authenticated vendor scope is ready."
        />
      ) : pageReadiness.status === 'unauthorized' ? (
        <EmptyStatePanel title="Sign in required" description="Sign in before loading support requests." />
      ) : isLoading ? (
        <SectionSkeleton title="Loading support requests" description="Collecting your vendor support requests in the background." />
      ) : filteredTickets.length ? (
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
              <span role="cell" className="support-last-reply-cell">{formatLastReply(ticket)}</span>
              <span role="cell" className="support-muted-cell">{formatDate(ticket.updatedAt)}</span>
            </OperationalTableRow>
          ))}
        </OperationalTable>
      ) : (
        <EmptyStatePanel
          title={workflowOpenSupportIssues ? 'No open support issues' : 'No support requests'}
          description={
            workflowOpenSupportIssues
              ? 'This workflow queue is clear. Clear the workflow to inspect all support history.'
              : 'Submitted support tickets will appear here.'
          }
        />
      )}
    </section>
  );
}
