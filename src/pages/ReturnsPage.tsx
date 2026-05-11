import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { listReturns, type ReturnSummary } from '../features/returns/api';
import { getCurrentUser, getCurrentVendorContext } from '../lib/auth';
import { runtimeConfig } from '../config/runtime';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function ReturnsPage() {
  const { data: returns, isLoading, isError, error } = useQueryResource(queryKeys.returns.list(), listReturns);
  const currentUser = getCurrentUser();
  const currentVendor = getCurrentVendorContext();
  const isRealMode = runtimeConfig.apiMode === 'real';

  if (isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Returns"
        title="Loading returns"
        description="Fetching a structured return queue from the central data layer."
      />
    );
  }

  if (isError || !returns) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Returns"
        title="Returns unavailable"
        description={error ?? 'Unable to load returns.'}
      />
    );
  }

  const totalReturns = returns.length;
  const pendingCount = returns.filter((item) => item.status === 'Pending' || item.status === 'In Review').length;
  const resolvedCount = returns.filter((item) => item.status === 'Approved' || item.status === 'Refunded').length;
  const totalRefundAmount = returns.reduce((total, item) => total + Number.parseFloat(item.amount.replace(/[^0-9.-]/g, '') || '0'), 0);

  return (
    <section className="dashboard returns-dashboard returns-workspace">
      <div className="hero-card operational-card queue-header">
        <div className="queue-header-copy">
          <p className="eyebrow">Returns</p>
          <h2>{currentVendor.vendorName} refund allocation queue</h2>
          <p className="page-description">
            {currentUser?.role === 'admin'
              ? 'Selected vendor return allocations with operational refund status and review visibility.'
              : 'Track your vendor refund allocations, review status, and refunded line item impact.'}
          </p>
          {isRealMode ? (
            <p className="page-description operational-helper-copy">
              Refund state is synced from Shopify webhook ingestion. Refund processing actions are not enabled in real mode yet.
            </p>
          ) : null}
        </div>
        <div className="queue-health">
          <span className="severity-chip severity-normal">Vendor {currentVendor.vendorName}</span>
          <span className="severity-chip severity-attention">Pending review {pendingCount}</span>
        </div>
      </div>

      <div className="finance-summary-grid returns-summary-grid">
        <article className="finance-summary-card operational-card">
          <span>Total returns</span>
          <strong>{totalReturns}</strong>
        </article>
        <article className="finance-summary-card operational-card deduction-card">
          <span>Refund amount</span>
          <strong>-${totalRefundAmount.toFixed(2)}</strong>
        </article>
        <article className="finance-summary-card operational-card">
          <span>Pending / needs review</span>
          <strong>{pendingCount}</strong>
        </article>
        <article className="finance-summary-card operational-card">
          <span>Completed / resolved</span>
          <strong>{resolvedCount}</strong>
        </article>
      </div>

      <article className="panel operational-card">
        <div className="queue-list-header">
          <h3>Refund allocations</h3>
        </div>
        {returns.length === 0 ? (
          <div className="queue-empty">
            <p className="eyebrow">Refunds</p>
            <h3>No return allocations</h3>
            <p className="page-description">
              Return records will appear here when refunded line items are allocated to this vendor.
            </p>
          </div>
        ) : (
          <div className="queue-list">
            {returns.map((item: ReturnSummary) => (
              <article key={item.id} className="queue-item queue-medium refund-record">
                <header className="queue-item-top">
                  <div className="queue-title-block">
                    <h4>{item.id}</h4>
                    <span className="queue-description">
                      Shopify order #{item.sourceShopifyOrderNumber} · Refund {item.sourceShopifyRefundId}
                    </span>
                  </div>
                  <span className={`status-badge status-${item.status.toLowerCase().replace(/\s+/g, '-')}`}>{item.status}</span>
                </header>
                <div className="queue-meta">
                  <span>
                    <strong>Shopify order:</strong> #{item.sourceShopifyOrderNumber}
                  </span>
                  <span>
                    <strong>Shopify order ID:</strong> {item.sourceShopifyOrderId}
                  </span>
                  <span>
                    <strong>Refund ID:</strong> {item.sourceShopifyRefundId || 'Pending Shopify refund link'}
                  </span>
                  <span>
                    <strong>Created:</strong> {formatDate(item.date)}
                  </span>
                  <span>
                    <strong>Latest update:</strong> {item.updatedAt ? formatDate(item.updatedAt) : formatDate(item.date)}
                  </span>
                  <span>
                    <strong>Vendor owner:</strong> {item.assignedVendorId}
                  </span>
                  <span>
                    <strong>Refunded SKUs:</strong> {item.refundedSkus?.length ? item.refundedSkus.join(', ') : 'Visible in refund detail'}
                  </span>
                  <span>
                    <strong>Refund context:</strong> Shopify webhook allocation
                  </span>
                </div>
                <div className="queue-actions">
                  <span className="finance-amount finance-negative">-{item.amount}</span>
                  <Link to={`/returns/${item.id}`} className="button button-secondary button-link">
                    View return
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
