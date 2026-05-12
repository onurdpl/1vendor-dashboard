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

function getLifecycleLabel(item: ReturnSummary) {
  if (item.sourceType === 'shopify_return_request') {
    return 'Pending return lifecycle';
  }

  return 'Processed refund lifecycle';
}

function getShopifyEntityLabel(item: ReturnSummary) {
  if (item.sourceType === 'shopify_return_request') {
    return 'Shopify Return ID';
  }

  return 'Shopify Refund ID';
}

function getShopifyEntityValue(item: ReturnSummary) {
  if (item.sourceType === 'shopify_return_request') {
    return item.sourceShopifyReturnId || 'Not available';
  }

  return item.sourceShopifyRefundId || 'Not available';
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
  const pendingCount = returns.filter((item) => item.status === 'Requested' || item.status === 'Pending' || item.status === 'In Review').length;
  const resolvedCount = returns.filter((item) => item.status === 'Approved' || item.status === 'Closed' || item.status === 'Processed').length;
  const totalRefundAmount = returns
    .filter((item) => item.sourceType !== 'shopify_return_request')
    .reduce((total, item) => total + Number.parseFloat(item.amount.replace(/[^0-9.-]/g, '') || '0'), 0);

  return (
    <section className="dashboard returns-dashboard returns-workspace">
      <div className="hero-card operational-card queue-header">
        <div className="queue-header-copy">
          <p className="eyebrow">Returns</p>
          <h2>{currentVendor.vendorName} returns operations queue</h2>
          <p className="page-description">
            {currentUser?.role === 'admin'
              ? 'Selected vendor return allocations with operational refund status and review visibility.'
              : 'Track your vendor pending returns and processed refunds with clear operational lifecycle visibility.'}
          </p>
          {isRealMode ? (
            <p className="page-description operational-helper-copy">
              Pending return requests and processed refunds are shown as separate lifecycle states. Refund processing actions are not enabled in real mode yet.
            </p>
          ) : null}
        </div>
        <div className="queue-health">
          <span className="severity-chip severity-normal">Vendor {currentVendor.vendorName}</span>
          <span className="severity-chip severity-attention">Pending lifecycle {pendingCount}</span>
        </div>
      </div>

      <div className="finance-summary-grid returns-summary-grid">
        <article className="finance-summary-card operational-card">
          <span>Total returns</span>
          <strong>{totalReturns}</strong>
        </article>
        <article className="finance-summary-card operational-card deduction-card">
          <span>Processed refund amount</span>
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
          <h3>Returns and refund records</h3>
        </div>
        {returns.length === 0 ? (
          <div className="queue-empty">
            <p className="eyebrow">Refunds</p>
            <h3>No return or refund records</h3>
            <p className="page-description">
              Pending return requests and processed refund records will appear here for this vendor scope.
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
                      Shopify Order #{item.sourceShopifyOrderNumber} · {item.sourceType === 'shopify_return_request' ? `Return ${item.sourceShopifyReturnId ?? 'Pending'}` : `Refund ${item.sourceShopifyRefundId}`}
                    </span>
                  </div>
                  <span className={`status-badge status-${item.status.toLowerCase().replace(/\s+/g, '-')}`}>{item.status}</span>
                </header>
                <div className="queue-meta">
                  <span>
                    <strong>Lifecycle:</strong> {getLifecycleLabel(item)}
                  </span>
                  <span>
                    <strong>Shopify Order Number:</strong> #{item.sourceShopifyOrderNumber}
                  </span>
                  <span>
                    <strong>Shopify Order ID:</strong> {item.sourceShopifyOrderId}
                  </span>
                  <span>
                    <strong>{getShopifyEntityLabel(item)}:</strong> {getShopifyEntityValue(item)}
                  </span>
                  <span>
                    <strong>Created At:</strong> {formatDate(item.date)}
                  </span>
                  <span>
                    <strong>Updated At:</strong> {item.updatedAt ? formatDate(item.updatedAt) : formatDate(item.date)}
                  </span>
                  <span>
                    <strong>Vendor Owner:</strong> {item.assignedVendorId}
                  </span>
                  <span>
                    <strong>{item.sourceType === 'shopify_return_request' ? 'Requested SKUs' : 'Refunded SKUs'}:</strong>{' '}
                    {item.refundedSkus?.length ? item.refundedSkus.join(', ') : 'Visible in return detail'}
                  </span>
                  <span>
                    <strong>Operational Source:</strong>{' '}
                    {item.sourceType === 'shopify_return_request'
                      ? 'Shopify return lifecycle request'
                      : 'Shopify webhook allocation'}
                  </span>
                </div>
                <div className="queue-actions">
                  {item.sourceType === 'shopify_return_request' ? (
                    <span className="queue-muted-action">Pending return request (no refund posted)</span>
                  ) : (
                    <span className="finance-amount finance-negative">-{item.amount}</span>
                  )}
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
