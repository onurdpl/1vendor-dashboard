import { Link, useParams } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { getReturn } from '../features/returns/api';
import { getCurrentVendorContext } from '../lib/auth';
import { runtimeConfig } from '../config/runtime';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function ReturnDetailPage() {
  const { returnId } = useParams();
  const currentVendor = getCurrentVendorContext();
  const isRealMode = runtimeConfig.apiMode === 'real';
  const { data: returnRequest, isLoading, isError, error } = useQueryResource(
    returnId ? queryKeys.returns.detail(returnId) : queryKeys.returns.list(),
    () => {
      if (!returnId) {
        throw new Error('Return not found.');
      }

      return getReturn(returnId);
    },
  );

  if (isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Returns"
        title="Loading return request"
        description="Fetching the selected return from the central data layer."
      />
    );
  }

  if (isError || !returnRequest) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Returns"
        title="Return unavailable"
        description={error ?? 'The selected return could not be loaded.'}
        actionNode={
          <Link className="button button-secondary" to="/returns">
            Back to returns
          </Link>
        }
      />
    );
  }

  return (
    <section className="dashboard return-detail returns-workspace">
      <div className="hero-card operational-card queue-header">
        <div>
          <p className="eyebrow">Refund allocation</p>
          <h2>{returnRequest.id}</h2>
          <p className="page-description">
            Shopify order #{returnRequest.sourceShopifyOrderNumber} ·{' '}
            {returnRequest.sourceType === 'shopify_return_request'
              ? `Return ${returnRequest.sourceShopifyReturnId ?? 'Not available'}`
              : `Refund ${returnRequest.sourceShopifyRefundId || 'Not available'}`}
          </p>
          {isRealMode ? (
            <p className="page-description operational-helper-copy">
              Return lifecycle state is synced from Shopify webhook ingestion. Refund/return processing actions are not enabled in real mode yet.
            </p>
          ) : null}
        </div>
        <div className="chip-row">
          <span className={`status-badge status-${returnRequest.status.toLowerCase().replace(/\s+/g, '-')}`}>
            {returnRequest.status}
          </span>
          <span className="severity-chip severity-normal">Vendor {currentVendor.vendorName}</span>
        </div>
      </div>

      <div className="detail-grid">
        <article className="panel operational-card">
          <h3>{returnRequest.sourceType === 'shopify_return_request' ? 'Return request summary' : 'Refund summary'}</h3>
          <div className="allocation-summary-grid refund-summary-grid">
            <div className="summary-row">
              <span>{returnRequest.sourceType === 'shopify_return_request' ? 'Refund amount' : 'Total refund amount'}</span>
              {returnRequest.sourceType === 'shopify_return_request' ? (
                <strong className="muted">Not posted yet</strong>
              ) : (
                <strong className="finance-negative">-{returnRequest.amount}</strong>
              )}
            </div>
            <div className="summary-row">
              <span>Refunded item count</span>
              <strong>{(returnRequest.refundedItems ?? returnRequest.items).length}</strong>
            </div>
            <div className="summary-row">
              <span>Vendor impact</span>
              <strong>{currentVendor.vendorName}</strong>
            </div>
            <div className="summary-row">
              <span>Related order</span>
              <strong>#{returnRequest.sourceShopifyOrderNumber}</strong>
            </div>
            <div className="summary-row">
              <span>Shopify order ID</span>
              <strong>{returnRequest.sourceShopifyOrderId}</strong>
            </div>
            <div className="summary-row">
              <span>{returnRequest.sourceType === 'shopify_return_request' ? 'Shopify Return ID' : 'Shopify Refund ID'}</span>
              <strong>
                {returnRequest.sourceType === 'shopify_return_request'
                  ? returnRequest.sourceShopifyReturnId ?? 'Not available'
                  : returnRequest.sourceShopifyRefundId || 'Not available'}
              </strong>
            </div>
            <div className="summary-row">
              <span>Source type</span>
              <strong>
                {returnRequest.sourceType === 'shopify_return_request'
                  ? 'Shopify return lifecycle request'
                  : 'Shopify refund webhook allocation'}
              </strong>
            </div>
            <div className="summary-row">
              <span>Created</span>
              <strong>{formatDate(returnRequest.date)}</strong>
            </div>
            <div className="summary-row">
              <span>Latest backend update</span>
              <strong>{returnRequest.updatedAt ? formatDate(returnRequest.updatedAt) : formatDate(returnRequest.date)}</strong>
            </div>
          </div>
        </article>

        <article className="panel operational-card">
          <h3>Workflow timeline</h3>
          <ul className="timeline">
            {returnRequest.timeline.map((entry) => (
              <li key={entry.label}>
                <strong>{entry.label}</strong>
                <span>{formatDate(entry.at)}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <div className="detail-grid">
        <article className="panel operational-card">
          <h3>Refunded items</h3>
          <div className="line-item-table return-line-items">
            <div className="line-item-head">
              <span>SKU</span>
              <span>Variant</span>
              <span>Item</span>
              <span>Quantity</span>
              <span>Condition</span>
              <span>Refund amount</span>
            </div>
            {(returnRequest.refundedItems ?? returnRequest.items).map((item) => (
              <div key={item.id} className="line-item-row">
                <span>{item.sku}</span>
                <span>{item.variantTitle}</span>
                <span>{item.name}</span>
                <span>{item.quantity}</span>
                <span>{item.condition}</span>
                <span className="finance-negative">-{item.refundAmount}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel operational-card">
          <h3>Operational context</h3>
          <div className="compact-meta-grid">
            <div className="meta-item">
              <span>Vendor</span>
              <strong>{currentVendor.vendorName}</strong>
            </div>
            <div className="meta-item">
              <span>Vendor ID</span>
              <strong>{returnRequest.vendorId}</strong>
            </div>
            <div className="meta-item">
              <span>Assigned vendor owner</span>
              <strong>{returnRequest.assignedVendorId}</strong>
            </div>
            <div className="meta-item">
              <span>Original vendor owner</span>
              <strong>{returnRequest.originalVendorId}</strong>
            </div>
            <div className="meta-item">
              <span>Source Shopify order ID</span>
              <strong>{returnRequest.sourceShopifyOrderId}</strong>
            </div>
            <div className="meta-item">
              <span>{returnRequest.sourceType === 'shopify_return_request' ? 'Source Shopify return ID' : 'Source Shopify refund ID'}</span>
              <strong>
                {returnRequest.sourceType === 'shopify_return_request'
                  ? returnRequest.sourceShopifyReturnId ?? 'Not available'
                  : returnRequest.sourceShopifyRefundId || 'Not available'}
              </strong>
            </div>
            <div className="meta-item">
              <span>Refund operational state</span>
              <strong>
                {returnRequest.sourceType === 'shopify_return_request'
                  ? 'Return requested / lifecycle pending'
                  : returnRequest.status === 'Processed'
                    ? 'Refund processed'
                    : 'Refund requested / under review'}
              </strong>
            </div>
            <div className="meta-item">
              <span>Resolution</span>
              <strong>{returnRequest.resolution}</strong>
            </div>
            <div className="meta-item">
              <span>Refund method</span>
              <strong>{returnRequest.refundMethod}</strong>
            </div>
            <div className="meta-item">
              <span>Refund-linked finance context</span>
              <strong>
                {returnRequest.sourceType === 'shopify_return_request'
                  ? 'No refund ledger entry is created until refunds/create is ingested.'
                  : 'Vendor finance ledger reflects this refund allocation.'}
              </strong>
            </div>
            <div className="meta-item">
              <span>Operational sync source</span>
              <strong>{returnRequest.processedBy}</strong>
            </div>
            <div className="meta-item">
              <span>Refund notes</span>
              <strong>{returnRequest.reason}</strong>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
