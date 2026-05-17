import { Link, useParams } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import { DataStatePanel } from '../components/DataStatePanel';
import { getAdminShopifyOrderBreakdown } from '../features/orders/api';
import { useMutationAction } from '../hooks/useMutationAction';
import { useQueryResource } from '../hooks/useQueryResource';
import { useAppReadiness } from '../lib/appReadiness';
import { queryKeys } from '../lib/api/queryKeys';
import { useActionFeedback } from '../lib/ui';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function AdminShopifyOrderPage() {
  const { shopifyOrderId } = useParams();
  const appReadiness = useAppReadiness();
  const { message, tone, showFeedback } = useActionFeedback();
  const reassignAllocation = useMutationAction(
    async (payload: { allocationOrderId: string; nextVendorId: string }) => payload,
    {
      onSuccess: (result) => {
        showFeedback(
          `Reassignment request prepared for ${result.allocationOrderId} -> ${result.nextVendorId} (mock only).`,
          'success',
        );
      },
      onError: () => {
        showFeedback('Unable to prepare reassignment request.', 'error');
      },
    },
  );
  const { data: breakdown, isLoading, isError, error, diagnostics } = useQueryResource(
    shopifyOrderId ? queryKeys.admin.orders.breakdown(shopifyOrderId) : queryKeys.orders.list(),
    () => {
      if (!shopifyOrderId) {
        throw new Error('Shopify order not found.');
      }

      return getAdminShopifyOrderBreakdown(shopifyOrderId);
    },
    {
      enabled: appReadiness.ready && Boolean(shopifyOrderId),
    },
  );

  if (!appReadiness.ready || isLoading) {
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
        diagnostics={diagnostics}
        actionLabel="Back to orders"
        actionTo="/orders"
      />
    );
  }

  return (
    <section className="dashboard order-detail">
      <div className="hero-card operational-card">
        <div>
          <p className="eyebrow">Admin orders</p>
          <h2>Shopify Order {formatShopifyOrderNumber(breakdown.sourceShopifyOrderNumber)}</h2>
          <p className="page-description">Operational allocation overview across assigned vendors.</p>
        </div>
        <div className="operational-meta-grid">
          <div className="meta-item">
            <span>Source order</span>
            <strong>{breakdown.sourceShopifyOrderId}</strong>
          </div>
          <div className="meta-item">
            <span>Customer</span>
            <strong>{breakdown.customer}</strong>
          </div>
          <div className="meta-item">
            <span>Created</span>
            <strong>{formatDate(breakdown.createdAt)}</strong>
          </div>
          <div className="meta-item">
            <span>Allocations</span>
            <strong>{breakdown.allocations.length}</strong>
          </div>
        </div>
      </div>

      {breakdown.allocations.map((allocation) => (
        <article key={allocation.vendorId} className="panel allocation-card operational-card">
          <header className="allocation-header">
            <div>
              <p className="eyebrow">Vendor allocation</p>
              <h3>{allocation.vendorName}</h3>
            </div>
            <div className="chip-row">
              <span className={`status-badge status-${allocation.allocationStatus}`}>{allocation.allocationStatus}</span>
              <span
                className={`status-badge status-${allocation.fulfillmentActionState.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {allocation.fulfillmentActionState}
              </span>
              <span className={`status-badge status-${allocation.shippingStatus.toLowerCase().replace(/\s+/g, '-')}`}>
                {allocation.shippingStatus}
              </span>
            </div>
          </header>

          <div className="allocation-summary-grid">
            <div className="summary-row">
              <span>Original vendor</span>
              <strong>{allocation.originalVendorId}</strong>
            </div>
            <div className="summary-row">
              <span>Assigned vendor</span>
              <strong>{allocation.assignedVendorId}</strong>
            </div>
            <div className="summary-row">
              <span>Allocation order</span>
              <strong>{allocation.allocationOrderId}</strong>
            </div>
            <div className="summary-row">
              <span>Total</span>
              <strong>{allocation.allocationTotal}</strong>
            </div>
            <div className="summary-row">
              <span>Refund impact</span>
              <strong>{allocation.refundTotal}</strong>
            </div>
            <div className="summary-row">
              <span>Fulfillment</span>
              <strong>{allocation.fulfillmentStatus}</strong>
            </div>
          </div>

          <section className="compact-meta-grid">
            <div className="meta-item">
              <span>Cancellation reason</span>
              <strong className={allocation.cancellationReason ? '' : 'muted'}>{allocation.cancellationReason ?? 'None'}</strong>
            </div>
            <div className="meta-item">
              <span>Reassignment required</span>
              <strong>{allocation.reassignmentRequired ? 'Yes' : 'No'}</strong>
            </div>
            <div className="meta-item">
              <span>Assignment blocked</span>
              <strong className={allocation.assignmentBlockedAt ? '' : 'muted'}>
                {allocation.assignmentBlockedAt ? formatDate(allocation.assignmentBlockedAt) : 'Not blocked'}
              </strong>
            </div>
            <div className="meta-item">
              <span>Reassigned by</span>
              <strong className={allocation.reassignedBy ? '' : 'muted'}>{allocation.reassignedBy ?? 'Not reassigned'}</strong>
            </div>
            <div className="meta-item">
              <span>Carrier</span>
              <strong className={allocation.carrier ? '' : 'muted'}>{allocation.carrier ?? 'Not assigned'}</strong>
            </div>
            <div className="meta-item">
              <span>Tracking</span>
              <strong className={allocation.trackingNumber ? '' : 'muted'}>
                {allocation.trackingNumber ?? 'Not assigned'}
              </strong>
            </div>
            <div className="meta-item">
              <span>Tracking URL</span>
              {allocation.trackingUrl ? (
                <a className="inline-link" href={allocation.trackingUrl} target="_blank" rel="noreferrer">
                  Open tracking
                </a>
              ) : (
                <strong className="muted">Not synced</strong>
              )}
            </div>
            <div className="meta-item">
              <span>Fulfilled at</span>
              <strong className={allocation.fulfilledAt ? '' : 'muted'}>
                {allocation.fulfilledAt ? formatDate(allocation.fulfilledAt) : 'Not fulfilled'}
              </strong>
            </div>
            <div className="meta-item">
              <span>Shipment created</span>
              <strong className={allocation.shipmentCreatedAt ? '' : 'muted'}>
                {allocation.shipmentCreatedAt ? formatDate(allocation.shipmentCreatedAt) : 'Not created'}
              </strong>
            </div>
            <div className="meta-item">
              <span>Shipment updated</span>
              <strong className={allocation.shipmentUpdatedAt ? '' : 'muted'}>
                {allocation.shipmentUpdatedAt ? formatDate(allocation.shipmentUpdatedAt) : 'Not updated'}
              </strong>
            </div>
          </section>

          {allocation.reassignmentRequired ? (
            <section className="action-row">
              <p className="page-description">{allocation.reassignmentNote ?? 'Reassignment review required.'}</p>
              <div className="detail-actions">
                {allocation.reassignmentCandidateVendorIds.map((candidateVendorId) => (
                  <button
                    key={candidateVendorId}
                    className="button button-primary"
                    type="button"
                    disabled={reassignAllocation.isPending}
                    onClick={() => {
                      reassignAllocation.mutate({
                        allocationOrderId: allocation.allocationOrderId,
                        nextVendorId: candidateVendorId,
                      });
                    }}
                  >
                    {reassignAllocation.isPending ? 'Preparing...' : `Reassign to ${candidateVendorId}`}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <h3 className="section-header">Allocated line items</h3>
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

          <h3 className="section-header">Allocated refunded items</h3>
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

          <h3 className="section-header">Assignment timeline</h3>
          <div className="timeline-block">
            {allocation.assignmentHistory.map((entry, index) => (
              <div key={`${allocation.vendorId}-${entry.action}-${entry.createdAt}-${index}`} className="timeline-event">
                <div className="timeline-dot" aria-hidden="true" />
                <div>
                  <p className="timeline-title">
                    {entry.action.replace(/_/g, ' ')} · {entry.toVendorId}
                  </p>
                  <p className="timeline-meta">
                    {entry.fromVendorId ? `From ${entry.fromVendorId} · ` : ''}
                    {entry.reason ?? 'No reason provided'} · {entry.actorName} ({entry.actorRole}) ·{' '}
                    {formatDate(entry.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </article>
      ))}

      <article className="panel">
        {message ? <ActionFeedback tone={tone} message={message} /> : null}
        <Link className="button button-secondary" to="/orders">
          Back to vendor orders
        </Link>
      </article>
    </section>
  );
}
