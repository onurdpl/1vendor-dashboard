import { Link, useParams } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { ActionFeedback } from '../components/ActionFeedback';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { getOrder } from '../features/orders/api';
import { getCurrentUser, getCurrentUserRole } from '../lib/auth';
import { useActionFeedback } from '../lib/ui';
import { useMutationAction } from '../hooks/useMutationAction';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function OrderDetailPage() {
  const { orderId } = useParams();
  const isAdmin = getCurrentUserRole() === 'admin';
  const currentUser = getCurrentUser();
  const { message, tone, showFeedback } = useActionFeedback();
  const { data: order, isLoading, isError, error } = useQueryResource(
    orderId ? queryKeys.orders.detail(orderId) : queryKeys.orders.list(),
    () => {
      if (!orderId) {
        throw new Error('Order not found.');
      }

      return getOrder(orderId);
    },
  );
  const { mutateAsync: reportFulfillmentIssue, isPending: isReportingIssue } = useMutationAction(
    async (issueOrderId: string) => {
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 300);
      });
      return issueOrderId;
    },
    {
      invalidateQueryKeys: [queryKeys.orders.list(), orderId ? queryKeys.orders.detail(orderId) : queryKeys.orders.list()],
    },
  );
  const { mutateAsync: runFulfillmentAction, isPending: isRunningFulfillmentAction } = useMutationAction(
    async (payload: { orderId: string; action: 'label' | 'ship' | 'tracking' }) => {
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 300);
      });
      return payload;
    },
    {
      invalidateQueryKeys: [queryKeys.orders.list(), orderId ? queryKeys.orders.detail(orderId) : queryKeys.orders.list()],
    },
  );

  const isVendorAssignedOwner =
    currentUser?.role === 'vendor' && !!order && currentUser.vendorAccess.includes(order.assignedVendorId);
  const canReportIssue =
    isVendorAssignedOwner && !!order && (order.allocationStatus === 'active' || order.allocationStatus === 'fulfilled');
  const canUseFulfillmentActions =
    isVendorAssignedOwner &&
    !!order &&
    order.fulfillmentActionAvailable &&
    order.allocationStatus !== 'pending_reassignment' &&
    order.allocationStatus !== 'vendor_blocked';

  if (isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Orders"
        title="Loading order"
        description="Fetching the selected order from the central data layer."
      />
    );
  }

  if (isError || !order) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Orders"
        title="Order unavailable"
        description={error ?? 'The selected order could not be loaded.'}
        actionLabel="Back to orders"
        actionTo="/orders"
      />
    );
  }

  return (
    <section className="dashboard order-detail vendor-workspace">
      <div className="hero-card operational-card vendor-order-header">
        <div>
          <p className="eyebrow">Vendor fulfillment</p>
          <h2>{order.id}</h2>
          <p className="page-description">
            {order.customer} · {formatDate(order.date)}
          </p>
        </div>
        <div className="chip-row">
          <span className={`status-badge status-${order.allocationStatus}`}>{order.allocationStatus}</span>
          <span className={`status-badge status-${order.fulfillmentStatus.toLowerCase().replace(/\s+/g, '-')}`}>
            {order.fulfillmentStatus}
          </span>
          <span className={`status-badge status-${order.shippingStatus.toLowerCase().replace(/\s+/g, '-')}`}>
            {order.shippingStatus}
          </span>
        </div>
      </div>

      <article className="panel operational-card">
        <div className="compact-meta-grid">
          <div className="meta-item">
            <span>Source Shopify order</span>
            <strong>{order.sourceShopifyOrderNumber}</strong>
          </div>
          <div className="meta-item">
            <span>Assigned vendor</span>
            <strong>{order.assignedVendorId}</strong>
          </div>
          <div className="meta-item">
            <span>Original vendor</span>
            <strong>{order.originalVendorId}</strong>
          </div>
          <div className="meta-item">
            <span>Channel</span>
            <strong>{order.channel}</strong>
          </div>
        </div>
      </article>

      <article className="panel operational-card">
        <h3>Primary action</h3>
        {canUseFulfillmentActions ? (
          <div className="action-row vendor-action-panel">
            <p className="page-description">This allocation is fulfillable. Select the next shipping action.</p>
            <div className="detail-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={isRunningFulfillmentAction}
                onClick={() => {
                  if (!order) {
                    return;
                  }

                  void runFulfillmentAction({ orderId: order.id, action: 'label' })
                    .then(() => showFeedback('Shipping label creation requested (mock).', 'success'))
                    .catch(() => showFeedback('Unable to create shipping label right now.', 'error'));
                }}
              >
                Create shipping label
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={isRunningFulfillmentAction}
                onClick={() => {
                  if (!order) {
                    return;
                  }

                  void runFulfillmentAction({ orderId: order.id, action: 'ship' })
                    .then(() => showFeedback('Order marked as shipped (mock).', 'success'))
                    .catch(() => showFeedback('Unable to mark shipment right now.', 'error'));
                }}
              >
                Mark as shipped
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={isRunningFulfillmentAction}
                onClick={() => {
                  if (!order) {
                    return;
                  }

                  void runFulfillmentAction({ orderId: order.id, action: 'tracking' })
                    .then(() => showFeedback('Tracking update submitted (mock).', 'success'))
                    .catch(() => showFeedback('Unable to update tracking right now.', 'error'));
                }}
              >
                Update tracking
              </button>
            </div>
          </div>
        ) : (
          <div className="action-row vendor-blocked-panel">
            <p className="page-description">
              Allocation is currently blocked for shipping actions.
              {order.cancellationReason ? ` Reason: ${order.cancellationReason.replace(/_/g, ' ')}.` : ''}
            </p>
            {isVendorAssignedOwner ? (
              <div className="detail-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    if (!canReportIssue || !order) {
                      showFeedback('This allocation is already blocked for reassignment.', 'info');
                      return;
                    }

                    void reportFulfillmentIssue(order.id)
                      .then(() => {
                        showFeedback('Fulfillment issue reported. Allocation marked for admin review.', 'success');
                      })
                      .catch(() => {
                        showFeedback('Unable to report fulfillment issue right now.', 'error');
                      });
                  }}
                  disabled={isReportingIssue || !canReportIssue}
                >
                  Report fulfillment issue
                </button>
              </div>
            ) : null}
          </div>
        )}
      </article>

      <div className="detail-grid">
        <article className="panel operational-card">
          <h3>Fulfillment summary</h3>
          <div className="allocation-summary-grid">
            <div className="summary-row">
              <span>Fulfillment status</span>
              <strong>{order.fulfillmentStatus}</strong>
            </div>
            <div className="summary-row">
              <span>Shipping status</span>
              <strong>{order.shippingStatus}</strong>
            </div>
            <div className="summary-row">
              <span>Carrier</span>
              <strong className={order.carrier ? '' : 'muted'}>{order.carrier ?? 'Not assigned'}</strong>
            </div>
            <div className="summary-row">
              <span>Tracking</span>
              <strong className={order.trackingNumber ? '' : 'muted'}>{order.trackingNumber ?? 'Not assigned'}</strong>
            </div>
            <div className="summary-row">
              <span>Estimated delivery</span>
              <strong className={order.estimatedDelivery ? '' : 'muted'}>
                {order.estimatedDelivery ? formatDate(order.estimatedDelivery) : 'Not available'}
              </strong>
            </div>
            <div className="summary-row">
              <span>Fulfilled at</span>
              <strong className={order.fulfilledAt ? '' : 'muted'}>
                {order.fulfilledAt ? formatDate(order.fulfilledAt) : 'Not fulfilled'}
              </strong>
            </div>
          </div>
        </article>

        <article className="panel operational-card">
          <h3>Operational timeline</h3>
          <ul className="timeline">
            {order.timeline.map((entry) => (
              <li key={entry.label}>
                <strong>{entry.label}</strong>
                <span>{formatDate(entry.at)}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <article className="panel operational-card">
        <h3>Line items</h3>
        <div className="line-item-table vendor-line-items">
          <div className="line-item-head">
            <span>SKU</span>
            <span>Variant</span>
            <span>Item</span>
            <span>Quantity</span>
            <span>Unit price</span>
            <span>Line total</span>
          </div>
          {(order.lineItems ?? order.items).map((item) => (
            <div key={item.id} className="line-item-row">
              <span>{item.sku}</span>
              <span>{item.variantTitle}</span>
              <span>{item.name}</span>
              <span>{item.quantity}</span>
              <span>{item.price}</span>
              <span>{item.price}</span>
            </div>
          ))}
        </div>
      </article>

      <article className="panel operational-card">
        <h3>Financial impact</h3>
        <div className="allocation-summary-grid">
          <div className="summary-row">
            <span>Allocation total</span>
            <strong>{order.amount}</strong>
          </div>
          <div className="summary-row">
            <span>Refund impact</span>
            <strong className="muted">Included in finance reconciliation</strong>
          </div>
          <div className="summary-row">
            <span>Net impact</span>
            <strong className="muted">Tracked in vendor finance view</strong>
          </div>
        </div>
      </article>

      <article className="panel operational-card">
        <h3>Secondary details</h3>
        <div className="compact-meta-grid">
          <div className="meta-item">
            <span>Source Shopify order ID</span>
            <strong>{order.sourceShopifyOrderId}</strong>
          </div>
          <div className="meta-item">
            <span>Workflow status</span>
            <strong>{order.allocationStatus}</strong>
          </div>
          <div className="meta-item">
            <span>Shipment created</span>
            <strong className={order.shipmentCreatedAt ? '' : 'muted'}>
              {order.shipmentCreatedAt ? formatDate(order.shipmentCreatedAt) : 'Not created'}
            </strong>
          </div>
          <div className="meta-item">
            <span>Shipment updated</span>
            <strong className={order.shipmentUpdatedAt ? '' : 'muted'}>
              {order.shipmentUpdatedAt ? formatDate(order.shipmentUpdatedAt) : 'Not updated'}
            </strong>
          </div>
          <div className="meta-item">
            <span>Shipping address</span>
            <strong>{order.shippingAddress}</strong>
          </div>
          <div className="meta-item">
            <span>Notes</span>
            <strong>{order.notes}</strong>
          </div>
        </div>
      </article>

      {isAdmin ? (
        <article className="panel operational-card">
          <h3>Admin tools</h3>
          <p className="page-description">Inspect the full Shopify order graph across all vendor allocations.</p>
          <Link className="button button-secondary" to={`/admin/orders/${order.sourceShopifyOrderNumber}`}>
            Open Shopify order breakdown
          </Link>
        </article>
      ) : null}

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
