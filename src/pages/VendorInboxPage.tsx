import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  EmptyStatePanel,
  FilterBar,
  KPIStatCard,
  OperationalToolbar,
  SearchInput,
  SectionErrorRetry,
  SectionSkeleton,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { getFinanceDashboard } from '../features/finance/api';
import { listOrders } from '../features/orders/api';
import { listReturns } from '../features/returns/api';
import { listVendorSupportTickets } from '../features/support/api';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryKeys } from '../lib/api/queryKeys';
import { useAppReadiness } from '../lib/appReadiness';
import { getPageReadinessState } from '../lib/pageReadiness';
import {
  buildVendorCommunicationFeed,
  filterCommunicationEvents,
  getCommunicationSummary,
  type CommunicationEvent,
  type CommunicationFilter,
} from '../lib/communicationCenter';
import { formatDateTime, safeArray } from '../services/real/formatting';

const FILTERS: Array<{ key: CommunicationFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'action', label: 'Requires action' },
  { key: 'support', label: 'Support' },
  { key: 'returns', label: 'Returns' },
  { key: 'finance', label: 'Finance' },
  { key: 'shipments', label: 'Shipments' },
  { key: 'resolved', label: 'Resolved' },
];

function formatDate(value: string | null | undefined) {
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getSeverityTone(severity: CommunicationEvent['severity']) {
  if (severity === 'critical') {
    return 'danger' as const;
  }
  if (severity === 'warning') {
    return 'warning' as const;
  }
  return 'info' as const;
}

function formatEventType(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function VendorInboxPage() {
  const appReadiness = useAppReadiness();
  const currentVendor = appReadiness.currentVendor;
  const pageReadiness = getPageReadinessState(appReadiness, {
    requiresVendorContext: true,
    currentVendorId: currentVendor.vendorId,
  });
  const [activeFilter, setActiveFilter] = useState<CommunicationFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const supportQuery = useQueryResource(
    queryKeys.support.tickets(currentVendor.vendorId),
    ({ signal }) => listVendorSupportTickets({ signal }),
    { enabled: pageReadiness.ready },
  );
  const ordersQuery = useQueryResource(
    queryKeys.orders.list(currentVendor.vendorId),
    ({ signal }) => listOrders({ vendorId: currentVendor.vendorId, signal }),
    { enabled: pageReadiness.ready },
  );
  const returnsQuery = useQueryResource(
    queryKeys.returns.list(currentVendor.vendorId),
    ({ signal }) => listReturns({ vendorId: currentVendor.vendorId, signal }),
    { enabled: pageReadiness.ready },
  );
  const financeQuery = useQueryResource(
    queryKeys.finance.summary(currentVendor.vendorId),
    ({ signal }) => getFinanceDashboard({ vendorId: currentVendor.vendorId, signal }),
    { enabled: pageReadiness.ready },
  );

  const isLoading =
    supportQuery.isLoading || ordersQuery.isLoading || returnsQuery.isLoading || financeQuery.isLoading;
  const firstError =
    supportQuery.isError ? supportQuery.error :
    ordersQuery.isError ? ordersQuery.error :
    returnsQuery.isError ? returnsQuery.error :
    financeQuery.isError ? financeQuery.error :
    null;

  const feed = useMemo(
    () =>
      buildVendorCommunicationFeed({
        supportTickets: supportQuery.data ?? [],
        orders: ordersQuery.data ?? [],
        returns: returnsQuery.data ?? [],
        finance: financeQuery.data,
      }),
    [financeQuery.data, ordersQuery.data, returnsQuery.data, supportQuery.data],
  );
  const filteredFeed = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return filterCommunicationEvents(feed, activeFilter).filter((event) => {
      if (!query) {
        return true;
      }
      return [event.title, event.summary, event.relatedLabel, event.type, ...safeArray(event.context).map((entry) => `${entry.label} ${entry.value}`)]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [activeFilter, feed, searchTerm]);
  const selectedEvent = filteredFeed.find((event) => event.id === selectedEventId) ?? filteredFeed[0] ?? null;
  const summary = getCommunicationSummary(feed);

  return (
    <section className="op-page communication-page">
      <header className="communication-header">
        <div>
          <p className="eyebrow">Vendor communication</p>
          <h1>Communication center</h1>
          <p>Support replies, return updates, payout activity, and shipment action requests in one operational feed.</p>
        </div>
        <StatusBadge tone={summary.requiresAction > 0 ? 'warning' : 'success'}>
          {summary.requiresAction} requires action
        </StatusBadge>
      </header>

      <div className="communication-kpi-row">
        <KPIStatCard
          label="Total updates"
          value={summary.total}
          detail="Communication events"
          tone="info"
          metadata={{ scope: 'Communication events', timeWindow: 'Current vendor feed', generatedAt: 'Current inbox load' }}
        />
        <KPIStatCard
          label="Unread"
          value={summary.unread}
          detail="Unread communication events"
          tone={summary.unread ? 'attention' : 'success'}
          metadata={{ scope: 'Communication events', timeWindow: 'Current vendor feed', generatedAt: 'Current inbox load' }}
        />
        <KPIStatCard
          label="Action needed"
          value={summary.requiresAction}
          detail="Communication events requiring action"
          tone={summary.requiresAction ? 'warning' : 'success'}
          metadata={{ scope: 'Communication events', timeWindow: 'Current vendor feed', generatedAt: 'Current inbox load' }}
        />
        <KPIStatCard
          label="Support"
          value={summary.support}
          detail="Support communication events"
          tone="neutral"
          metadata={{ scope: 'Communication events', timeWindow: 'Current vendor feed', generatedAt: 'Current inbox load' }}
        />
      </div>

      <OperationalToolbar>
        <SearchInput
          placeholder="Search communications, orders, returns, or payout updates..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
        <FilterBar>
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`communication-filter ${activeFilter === filter.key ? 'active' : ''}`}
              onClick={() => setActiveFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </FilterBar>
      </OperationalToolbar>

      <div className="communication-layout">
        <main className="communication-feed">
          {firstError && feed.length === 0 ? (
            <SectionErrorRetry
              title="Communication center unavailable"
              description={firstError}
              onRetry={() => {
                void supportQuery.refetch();
                void ordersQuery.refetch();
                void returnsQuery.refetch();
                void financeQuery.refetch();
              }}
            />
          ) : pageReadiness.status === 'missing_vendor_context' ? (
            <EmptyStatePanel
              title="Select vendor"
              description="No vendor context available. Choose a vendor context before loading the communication center."
            />
          ) : pageReadiness.status === 'waiting_vendor_context' ? (
            <EmptyStatePanel
              title="Waiting for vendor context"
              description="Communication updates will load after the authenticated vendor scope is ready."
            />
          ) : pageReadiness.status === 'unauthorized' ? (
            <EmptyStatePanel title="Sign in required" description="Sign in before loading the communication center." />
          ) : isLoading ? (
            <SectionSkeleton title="Loading communication center" description="Collecting support replies and operational updates." />
          ) : filteredFeed.length ? (
            filteredFeed.map((event) => (
              <button
                key={event.id}
                type="button"
                className={`communication-feed-row ${selectedEvent?.id === event.id ? 'selected' : ''}`}
                onClick={() => setSelectedEventId(event.id)}
              >
                <span className={`communication-dot communication-${event.severity}`} aria-hidden="true" />
                <div>
                  <div className="communication-feed-title">
                    <strong>{event.title}</strong>
                    {event.unread ? <StatusBadge tone="attention">Unread</StatusBadge> : null}
                    {event.requiresAction ? <StatusBadge tone="warning">Action</StatusBadge> : null}
                  </div>
                  <p>{event.summary}</p>
                  <small>{formatEventType(event.type)} · {formatDate(event.timestamp)}</small>
                </div>
                <StatusBadge tone={getSeverityTone(event.severity)}>{event.severity}</StatusBadge>
              </button>
            ))
          ) : (
            <EmptyStatePanel title="No communications" description="No vendor-safe communication updates match this filter." />
          )}
        </main>

        <aside className="communication-sidebar">
          {selectedEvent ? (
            <article className="communication-context-card">
              <div className="communication-context-heading">
                <div>
                  <p className="eyebrow">Context</p>
                  <h3>{selectedEvent.relatedLabel}</h3>
                </div>
                <StatusBadge tone={getSeverityTone(selectedEvent.severity)}>{formatEventType(selectedEvent.priority)}</StatusBadge>
              </div>
              <p>{selectedEvent.summary}</p>
              <div className="communication-context-list">
                {safeArray(selectedEvent.context).map((entry) => (
                  <div key={`${entry.label}-${entry.value}`}>
                    <span>{entry.label}</span>
                    <strong>{entry.value}</strong>
                  </div>
                ))}
                <div>
                  <span>Updated</span>
                  <strong>{formatDate(selectedEvent.timestamp)}</strong>
                </div>
              </div>
              <Link to={selectedEvent.href} className="button button-primary button-link">
                Open linked record
              </Link>
            </article>
          ) : (
            <article className="communication-context-card">
              <EmptyStatePanel title="No update selected" description="Select a communication to inspect linked context." />
            </article>
          )}
        </aside>
      </div>
    </section>
  );
}
