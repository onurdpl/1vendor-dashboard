import { Link, useParams } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import { DataStatePanel } from '../components/DataStatePanel';
import { getAdminShopifyOrderBreakdown } from '../features/orders/api';
import { useMutationAction } from '../hooks/useMutationAction';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryKeys } from '../lib/api/queryKeys';
import { useActionFeedback } from '../lib/ui';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function AdminShopifyOrderPage() {
  const { shopifyOrderId } = useParams();
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
              <dt>Original vendor</dt>
              <dd>{allocation.originalVendorId}</dd>
            </div>
            <div>
              <dt>Assigned vendor</dt>
              <dd>
                {allocation.assignedVendorId}
                {allocation.originalVendorId === allocation.assignedVendorId ? ' (same as original)' : ''}
              </dd>
            </div>
            <div>
              <dt>Allocation order</dt>
              <dd>{allocation.allocationOrderId}</dd>
            </div>
            <div>
              <dt>Allocation status</dt>
              <dd>{allocation.allocationStatus}</dd>
            </div>
            <div>
              <dt>Cancellation reason</dt>
              <dd>{allocation.cancellationReason ?? 'None'}</dd>
            </div>
            <div>
              <dt>Reassignment required</dt>
              <dd>{allocation.reassignmentRequired ? 'Yes' : 'No'}</dd>
            </div>
            <div>
              <dt>Reassignment note</dt>
              <dd>{allocation.reassignmentNote ?? 'None'}</dd>
            </div>
            <div>
              <dt>Reassigned at</dt>
              <dd>{allocation.reassignedAt ? formatDate(allocation.reassignedAt) : 'Not reassigned'}</dd>
            </div>
            <div>
              <dt>Reassigned by</dt>
              <dd>{allocation.reassignedBy ?? 'Not reassigned'}</dd>
            </div>
            <div>
              <dt>Assignment blocked at</dt>
              <dd>{allocation.assignmentBlockedAt ? formatDate(allocation.assignmentBlockedAt) : 'Not blocked'}</dd>
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
              <dt>Fulfillment action state</dt>
              <dd>{allocation.fulfillmentActionState}</dd>
            </div>
            <div>
              <dt>Fulfillment action available</dt>
              <dd>{allocation.fulfillmentActionAvailable ? 'Yes' : 'No'}</dd>
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
            <div>
              <dt>Shipment created at</dt>
              <dd>{allocation.shipmentCreatedAt ? formatDate(allocation.shipmentCreatedAt) : 'Not created'}</dd>
            </div>
            <div>
              <dt>Shipment updated at</dt>
              <dd>{allocation.shipmentUpdatedAt ? formatDate(allocation.shipmentUpdatedAt) : 'Not updated'}</dd>
            </div>
            <div>
              <dt>Fulfilled at</dt>
              <dd>{allocation.fulfilledAt ? formatDate(allocation.fulfilledAt) : 'Not fulfilled'}</dd>
            </div>
            <div>
              <dt>Fulfilled by vendor</dt>
              <dd>{allocation.fulfilledByVendorId ?? 'Not fulfilled'}</dd>
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

          {allocation.reassignmentRequired ? (
            <div className="detail-actions">
              <p className="page-description">
                Reassignment candidates: {allocation.reassignmentCandidateVendorIds.join(', ')}
              </p>
              {allocation.reassignmentCandidateVendorIds.map((candidateVendorId) => (
                <button
                  key={candidateVendorId}
                  className="button button-secondary"
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
          ) : null}

          <h3>Assignment history</h3>
          <div className="line-item-table">
            <div className="line-item-head">
              <span>Action</span>
              <span>From</span>
              <span>To</span>
              <span>Reason</span>
              <span>Actor</span>
              <span>At</span>
            </div>
            {allocation.assignmentHistory.map((entry, index) => (
              <div key={`${allocation.vendorId}-${entry.action}-${entry.createdAt}-${index}`} className="line-item-row">
                <span>{entry.action}</span>
                <span>{entry.fromVendorId ?? 'Unassigned'}</span>
                <span>{entry.toVendorId}</span>
                <span>{entry.reason ?? 'None'}</span>
                <span>
                  {entry.actorName} ({entry.actorRole})
                </span>
                <span>{formatDate(entry.createdAt)}</span>
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
