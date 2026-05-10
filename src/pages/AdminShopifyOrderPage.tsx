import { Link, useParams } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { getAdminShopifyOrderBreakdown } from '../features/orders/api';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryKeys } from '../lib/api/queryKeys';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function AdminShopifyOrderPage() {
  const { shopifyOrderId } = useParams();
  const { data: breakdown, isLoading, isError, error } = useQueryResource(
    shopifyOrderId ? queryKeys.admin.orders.breakdown(shopifyOrderId) : queryKeys.orders.list(),
    () => {
      if (!shopifyOrderId) {
        throw new Error('Shopify order not found.');
      }

      return getAdminShopifyOrderBreakdown(shopifyOrderId);
    },
  );

  if (isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Admin orders"
        title="Loading Shopify breakdown"
        description="Preparing cross-vendor order allocations for operations review."
      />
    );
  }

  if (isError || !breakdown) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Admin orders"
        title="Breakdown unavailable"
        description={error ?? 'The requested Shopify order could not be loaded.'}
        actionLabel="Back to orders"
        actionTo="/orders"
      />
    );
  }

  return (
    <section className="dashboard order-detail">
      <div className="hero-card">
        <div>
          <p className="eyebrow">Admin orders</p>
          <h2>Shopify Order #{breakdown.sourceShopifyOrderNumber}</h2>
          <p className="page-description">
            Source order {breakdown.sourceShopifyOrderId} · {breakdown.customer} · {formatDate(breakdown.createdAt)}
          </p>
        </div>
      </div>

      {breakdown.allocations.map((allocation) => (
        <article key={allocation.vendorId} className="panel">
          <h3>{allocation.vendorName} allocation</h3>
          <dl className="detail-list">
            <div>
              <dt>Vendor id</dt>
              <dd>{allocation.vendorId}</dd>
            </div>
            <div>
              <dt>Allocation order</dt>
              <dd>{allocation.allocationOrderId}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{allocation.allocationTotal}</dd>
            </div>
            <div>
              <dt>Refund total</dt>
              <dd>{allocation.refundTotal}</dd>
            </div>
            <div>
              <dt>Fulfillment</dt>
              <dd>{allocation.fulfillmentStatus}</dd>
            </div>
            <div>
              <dt>Shipping</dt>
              <dd>{allocation.shippingStatus}</dd>
            </div>
            <div>
              <dt>Carrier</dt>
              <dd>{allocation.carrier ?? 'Not assigned'}</dd>
            </div>
            <div>
              <dt>Tracking</dt>
              <dd>{allocation.trackingNumber ?? 'Not assigned'}</dd>
            </div>
          </dl>

          <h3>Allocated line items</h3>
          <div className="line-item-table">
            <div className="line-item-head">
              <span>SKU</span>
              <span>Variant</span>
              <span>Item</span>
              <span>Quantity</span>
              <span>Price</span>
              <span>Fulfillment</span>
            </div>
            {allocation.lineItems.map((item) => (
              <div key={item.id} className="line-item-row">
                <span>{item.sku}</span>
                <span>{item.variantTitle}</span>
                <span>{item.name}</span>
                <span>{item.quantity}</span>
                <span>{item.price}</span>
                <span className="order-state-stack">
                  <span className={`status-badge status-${item.fulfillmentStatus.toLowerCase().replace(/\s+/g, '-')}`}>
                    {item.fulfillmentStatus}
                  </span>
                  <span className={`status-badge status-${item.shippingStatus.toLowerCase().replace(/\s+/g, '-')}`}>
                    {item.shippingStatus}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <h3>Allocated refunded items</h3>
          {allocation.refundedItems.length === 0 ? (
            <p className="page-description">No refunded items in this vendor allocation.</p>
          ) : (
            <div className="line-item-table">
              <div className="line-item-head">
                <span>SKU</span>
                <span>Variant</span>
                <span>Item</span>
                <span>Quantity</span>
                <span>Refund</span>
                <span>Condition</span>
              </div>
              {allocation.refundedItems.map((item) => (
                <div key={item.id} className="line-item-row">
                  <span>{item.sku}</span>
                  <span>{item.variantTitle}</span>
                  <span>{item.name}</span>
                  <span>{item.quantity}</span>
                  <span>{item.refundAmount}</span>
                  <span>{item.condition}</span>
                </div>
              ))}
            </div>
          )}
        </article>
      ))}

      <article className="panel">
        <Link className="button button-secondary" to="/orders">
          Back to vendor orders
        </Link>
      </article>
    </section>
  );
}
