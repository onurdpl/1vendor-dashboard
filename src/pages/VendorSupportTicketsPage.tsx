import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  EmptyStatePanel,
  FilterBar,
  OperationalTable,
  OperationalTableRow,
  OperationalToolbar,
  SectionErrorRetry,
  SearchInput,
  SectionSkeleton,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryKeys } from '../lib/api/queryKeys';
import { useAppReadiness } from '../lib/appReadiness';
import { getPageReadinessState } from '../lib/pageReadiness';
import { listVendorSupportTicketsPage, type SupportTicket } from '../features/support/api';
import { formatSupportLabel, getSupportStatusTone } from './AdminSupportTicketsPage';
import { formatDateTime } from '../services/real/formatting';

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
  const [searchTerm, setSearchTerm] = useState('');
  const filters = { search: searchTerm, unreadOnly, workflow: workflowOpenSupportIssues ? 'open-support-issues' : 'all' };
  const signature = JSON.stringify({ ...filters, vendorId: currentVendor.vendorId });
  const [pagination, setPagination] = useState<{ signature: string; cursors: Array<string | null>; index: number }>({ signature: '', cursors: [null], index: 0 });
  const activePagination = pagination.signature === signature ? pagination : { signature, cursors: [null], index: 0 };
  const cursor = activePagination.cursors[activePagination.index];
  const { data: page, isLoading, isError, error, refetch } = useQueryResource(
    [...queryKeys.support.tickets(currentVendor.vendorId), 'page', signature, cursor],
    ({ signal }) => listVendorSupportTicketsPage({ ...filters, cursor }, { signal }),
    { enabled: pageReadiness.ready, placeholderData: () => undefined, timeoutMs: 60000 },
  );
  const filteredTickets = page?.items?.filter((ticket) => ticket.vendorId === currentVendor.vendorId) ?? [];
  function nextPage() {
    if (!page?.nextCursor) return;
    setPagination({ signature, cursors: [...activePagination.cursors.slice(0, activePagination.index + 1), page.nextCursor], index: activePagination.index + 1 });
  }
  function previousPage() {
    setPagination({ ...activePagination, index: Math.max(0, activePagination.index - 1) });
  }

  function clearWorkflowFilter() {
    if (!searchParams.has('workflow')) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('workflow');
    setSearchParams(nextParams, { replace: true });
  }

  return (
    <section className="op-page support-ops-page support-vendor-page">
      <div className="op-page-heading support-ops-header">
        <div>
          <p className="eyebrow">Support</p>
          <h1>Vendor Support Requests</h1>
        </div>
      </div>

      <OperationalToolbar>
        <label className="support-search-field" htmlFor="vendor-support-search">
          <span>Search</span>
          <SearchInput id="vendor-support-search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search support history..." />
        </label>
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

      {isError && !page ? (
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
        <OperationalTable columns={['Subject', 'Category', 'Status', 'Last reply', 'Updated']} className="support-vendor-table">
          {filteredTickets.map((ticket: SupportTicket) => (
            <OperationalTableRow key={ticket.id}>
              <span role="cell" className="support-ticket-cell support-vendor-subject-cell">
                <span className="support-vendor-subject-heading">
                  <Link to={`/support/${ticket.id}`}>{ticket.subject}</Link>
                  {ticket.vendorUnreadCount > 0 ? (
                    <StatusBadge tone="attention">{ticket.vendorUnreadCount} unread</StatusBadge>
                  ) : null}
                </span>
                <span className="support-vendor-message-preview">{ticket.message}</span>
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
      {page && page.total > 0 ? <nav aria-label="Support ticket pages" className="pagination-controls">
        <button type="button" onClick={previousPage} disabled={activePagination.index === 0}>Previous</button>
        <span>Page {activePagination.index + 1} · {page.total} matching tickets</span>
        <button type="button" onClick={nextPage} disabled={!page.hasNextPage}>Next</button>
      </nav> : null}
    </section>
  );
}
