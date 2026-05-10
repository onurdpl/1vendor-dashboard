import { Link, useParams } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { getReturn } from '../features/returns/api';
import { getCurrentVendorContext } from '../lib/auth';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function ReturnDetailPage() {
  const { returnId } = useParams();
  const currentVendor = getCurrentVendorContext();
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
            Shopify order #{returnRequest.sourceShopifyOrderNumber} · Refund {returnRequest.sourceShopifyRefundId}
          </p>
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
          <h3>Refund summary</h3>
          <div className="allocation-summary-grid refund-summary-grid">
            <div className="summary-row">
              <span>Total refund amount</span>
              <strong className="finance-negative">-{returnRequest.amount}</strong>
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
              <strong>{returnRequest.relatedOrderId}</strong>
            </div>
            <div className="summary-row">
              <span>Reason</span>
              <strong>{returnRequest.reason}</strong>
            </div>
            <div className="summary-row">
              <span>Date</span>
              <strong>{formatDate(returnRequest.date)}</strong>
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
              <span>Source Shopify order ID</span>
              <strong>{returnRequest.sourceShopifyOrderId}</strong>
            </div>
            <div className="meta-item">
              <span>Source Shopify refund ID</span>
              <strong>{returnRequest.sourceShopifyRefundId}</strong>
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
              <span>Processed by</span>
              <strong>{returnRequest.processedBy}</strong>
            </div>
            <div className="meta-item">
              <span>Customer</span>
              <strong>{returnRequest.customer}</strong>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
