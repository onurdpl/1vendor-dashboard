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

  const isVendorAssignedOwner =
    currentUser?.role === 'vendor' && !!order && currentUser.vendorAccess.includes(order.assignedVendorId);
  const canReportIssue =
    isVendorAssignedOwner && !!order && (order.allocationStatus === 'active' || order.allocationStatus === 'fulfilled');

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
    <section className="dashboard order-detail">
      <div className="hero-card">
        <div>
          <p className="eyebrow">Orders</p>
          <h2>{order.id}</h2>
          <p className="page-description">
            {order.customer} · {formatDate(order.date)}
          </p>
        </div>
        <div className={`status-badge status-${order.status.toLowerCase().replace(/\s+/g, '-')}`}>
          {order.status}
        </div>
      </div>

      <div className="detail-grid">
        <article className="panel">
          <h3>Summary</h3>
          <dl className="detail-list">
            <div>
              <dt>Amount</dt>
              <dd>{order.amount}</dd>
            </div>
            <div>
              <dt>Fulfillment</dt>
              <dd>{order.fulfillmentStatus}</dd>
            </div>
            <div>
              <dt>Allocation workflow</dt>
              <dd>{order.allocationStatus}</dd>
            </div>
            <div>
              <dt>Cancellation reason</dt>
              <dd>{order.cancellationReason ?? 'None'}</dd>
            </div>
            <div>
              <dt>Reassignment required</dt>
              <dd>{order.reassignmentRequired ? 'Yes' : 'No'}</dd>
            </div>
            <div>
              <dt>Assignment blocked at</dt>
              <dd>{order.assignmentBlockedAt ? formatDate(order.assignmentBlockedAt) : 'Not blocked'}</dd>
            </div>
            <div>
              <dt>Shipping</dt>
              <dd>{order.shippingStatus}</dd>
            </div>
            <div>
              <dt>Carrier</dt>
              <dd>{order.carrier ?? 'Not assigned'}</dd>
            </div>
            <div>
              <dt>Tracking number</dt>
              <dd>{order.trackingNumber ?? 'Not assigned'}</dd>
            </div>
            <div>
              <dt>Estimated delivery</dt>
              <dd>{order.estimatedDelivery ? formatDate(order.estimatedDelivery) : 'Not available'}</dd>
            </div>
            <div>
              <dt>Channel</dt>
              <dd>{order.channel}</dd>
            </div>
            <div>
              <dt>Shipping address</dt>
              <dd>{order.shippingAddress}</dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd>{order.notes}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <h3>Timeline</h3>
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

      <article className="panel">
        <h3>Line items</h3>
        <div className="line-item-table">
          <div className="line-item-head">
            <span>SKU</span>
            <span>Variant</span>
            <span>Item</span>
            <span>Quantity</span>
            <span>Price</span>
            <span>Fulfillment</span>
          </div>
          {(order.lineItems ?? order.items).map((item) => (
            <div key={item.id} className="line-item-row">
              <span>{item.sku}</span>
              <span>{item.variantTitle}</span>
              <span>{item.name}</span>
              <span>{item.quantity}</span>
              <span>{item.price}</span>
              <span className="order-state-stack">
                <span className={`status-badge status-${item.allocationStatus.toLowerCase().replace(/\s+/g, '-')}`}>
                  {item.allocationStatus}
                </span>
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
      </article>

      {isAdmin ? (
        <article className="panel">
          <h3>Admin tools</h3>
          <p className="page-description">Inspect the full Shopify order graph across all vendor allocations.</p>
          <Link className="button button-secondary" to={`/admin/orders/${order.sourceShopifyOrderNumber}`}>
            Open Shopify order breakdown
          </Link>
        </article>
      ) : null}

      {isVendorAssignedOwner ? (
        <article className="panel">
          <h3>Vendor workflow</h3>
          <p className="page-description">
            Report allocation blocking issues to mark this fulfillment as pending reassignment for admin follow-up.
          </p>
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
          {!canReportIssue ? (
            <p className="automation-permission-note">This allocation is currently not reportable.</p>
          ) : null}
        </article>
      ) : null}

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
