import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { DataStatePanel } from '../components/DataStatePanel';
import { ActionFeedback } from '../components/ActionFeedback';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { getOrder, submitFulfillmentTracking } from '../features/orders/api';
import { getCurrentUser, getCurrentUserRole } from '../lib/auth';
import { useActionFeedback } from '../lib/ui';
import { useMutationAction } from '../hooks/useMutationAction';
import { runtimeConfig } from '../config/runtime';
import { ApiError } from '../lib/api/errors';
import { toTitleCaseLabel } from '../services/real/formatting';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatOptionalDate(value?: string, fallback = '—') {
  return value ? formatDate(value) : fallback;
}

function getCompactCustomerLabel(value?: string) {
  const normalized = value?.trim();

  if (!normalized || normalized.toLowerCase().includes('outside the current') || normalized.toLowerCase().includes('available in order')) {
    return 'Customer unavailable';
  }

  return normalized;
}

function getStatusClass(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function getTrackingTitle(order: { trackingNumber?: string; carrier?: string; trackingUrl?: string }) {
  return order.trackingNumber || order.carrier || order.trackingUrl ? 'Tracking Synced' : 'Missing Tracking';
}

function getTrackingHelper(order: { trackingNumber?: string; carrier?: string; trackingUrl?: string }) {
  if (order.trackingNumber || order.carrier) {
    return [order.carrier, order.trackingNumber].filter(Boolean).join(' / ');
  }

  if (order.trackingUrl) {
    return 'Tracking link available';
  }

  return 'No tracking information available.';
}

function getInitialsLabel(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '—';
}

function getTrackingMutationErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
      case 403:
      case 404:
      case 409:
      case 502:
        return error.message;
      default:
        return error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unable to submit tracking right now.';
}

export function OrderDetailPage() {
  const { orderId } = useParams();
  const isAdmin = getCurrentUserRole() === 'admin';
  const currentUser = getCurrentUser();
  const isRealMode = runtimeConfig.apiMode === 'real';
  const { message, tone, showFeedback } = useActionFeedback();
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(false);
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
  const { mutateAsync: submitTrackingMutation, isPending: isSubmittingTracking } = useMutationAction(
    async (payload: { allocationId: string; trackingNumber: string; carrier: string; trackingUrl?: string; notifyCustomer: boolean }) => {
      return submitFulfillmentTracking(payload.allocationId, {
        trackingNumber: payload.trackingNumber,
        carrier: payload.carrier,
        trackingUrl: payload.trackingUrl,
        notifyCustomer: payload.notifyCustomer,
      });
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
  const hasTrackingSync =
    !!order?.trackingNumber ||
    !!order?.carrier ||
    !!order?.trackingUrl ||
    order?.shippingStatus === 'In Transit' ||
    order?.shippingStatus === 'Delivered' ||
    order?.fulfillmentStatus === 'Fulfilled';
  const shouldShowRealTrackingForm = isRealMode && canUseFulfillmentActions && !hasTrackingSync;

  useEffect(() => {
    if (!order) {
      return;
    }

    setCarrier(order.carrier ?? '');
    setTrackingNumber(order.trackingNumber ?? '');
    setTrackingUrl('');
    setNotifyCustomer(false);
  }, [order]);

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

  const orderItems = order.lineItems ?? order.items;
  const customerLabel = getCompactCustomerLabel(order.customer);
  const allocationOwner =
    order.assignedVendorId === order.originalVendorId ? 'Original vendor owner' : 'Reassigned operational owner';
  const trackingTitle = getTrackingTitle(order);
  const trackingHelper = getTrackingHelper(order);
  const summaryCards = [
    {
      label: 'Allocation status',
      value: toTitleCaseLabel(order.allocationStatus),
      helper: order.cancellationReason
        ? `Reason: ${order.cancellationReason.replace(/_/g, ' ')}`
        : 'Vendor allocation state.',
      tone: 'danger',
      icon: 'A',
    },
    {
      label: 'Fulfillment status',
      value: order.fulfillmentStatus,
      helper: order.fulfilledAt ? `Fulfilled ${formatDate(order.fulfilledAt)}` : 'Fulfillment is being processed.',
      tone: 'info',
      icon: 'F',
    },
    {
      label: 'Shipping status',
      value: order.shippingStatus,
      helper: order.shipmentCreatedAt ? `Shipment created ${formatDate(order.shipmentCreatedAt)}` : 'Waiting for shipment progression.',
      tone: 'warning',
      icon: 'S',
    },
    {
      label: 'Tracking status',
      value: trackingTitle,
      helper: trackingHelper,
      tone: hasTrackingSync ? 'success' : 'muted',
      icon: 'T',
    },
  ];

  return (
    <section className="order-detail-workspace">
      <header className="order-detail-topbar">
        <Link className="order-detail-back" to="/orders">
          Back to orders
        </Link>
        <div className="order-detail-title-row">
          <div className="order-detail-title-stack">
            <div className="order-detail-heading-line">
              <h1>Order #{order.sourceShopifyOrderNumber}</h1>
              <span className="order-source-pill">{order.channel || 'Unknown'}</span>
              <span className={`status-badge status-${getStatusClass(order.status)}`}>{order.status}</span>
            </div>
            <div className="order-detail-meta-strip">
              <div>
                <span>Created</span>
                <strong>{formatDate(order.date)}</strong>
              </div>
              <div>
                <span>Vendor</span>
                <strong>{order.assignedVendorId || 'Unknown'}</strong>
              </div>
              <div>
                <span>Customer</span>
                <strong>{customerLabel}</strong>
              </div>
              <div>
                <span>Allocation ID</span>
                <strong>{order.id || '—'}</strong>
              </div>
              <div>
                <span>Source</span>
                <strong>{order.channel || 'Unknown'}</strong>
              </div>
            </div>
          </div>
          <div className="order-detail-header-actions">
            {isAdmin ? (
              <Link className="button button-secondary" to={`/admin/orders/${order.sourceShopifyOrderNumber}`}>
                Open Shopify order breakdown
              </Link>
            ) : null}
          </div>
        </div>
        <div className="order-detail-status-pills">
          <span className={`status-badge status-${getStatusClass(order.allocationStatus)}`}>
            {toTitleCaseLabel(order.allocationStatus)}
          </span>
          <span className={`status-badge status-${getStatusClass(order.fulfillmentStatus)}`}>
            {order.fulfillmentStatus}
          </span>
          <span className={`status-badge status-${getStatusClass(order.shippingStatus)}`}>
            {order.shippingStatus}
          </span>
        </div>
      </header>

      <div className="order-status-summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className={`order-status-summary-card order-status-${card.tone}`}>
            <span className="order-status-icon" aria-hidden="true">
              {card.icon}
            </span>
            <div>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <p>{card.helper}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="order-detail-main-grid">
        <div className="order-detail-left-column">
          <article className="order-detail-card-v2 order-line-items-card">
            <div className="order-card-heading">
              <h2>Line items ({orderItems.length})</h2>
            </div>
            <div className="order-line-items-compact">
              {orderItems.length > 0 ? (
                orderItems.map((item) => (
                  <div key={item.id} className="order-line-item-row-v2">
                    <span className="order-item-thumb" aria-hidden="true">
                      {getInitialsLabel(item.name || item.sku || 'Item')}
                    </span>
                    <div className="order-item-primary">
                      <strong>{item.name || 'Unknown item'}</strong>
                      <span>{item.sku || '—'}</span>
                    </div>
                    <div>
                      <span>Variant / SKU</span>
                      <strong>{item.variantTitle || item.sku || '—'}</strong>
                    </div>
                    <div>
                      <span>Qty</span>
                      <strong>{item.quantity}</strong>
                    </div>
                    <div>
                      <span>Unit price</span>
                      <strong>{item.price}</strong>
                    </div>
                    <div>
                      <span>Total</span>
                      <strong>{item.price}</strong>
                    </div>
                  </div>
                ))
              ) : (
                <p className="order-empty-copy">No records available.</p>
              )}
            </div>
          </article>

          <article className="order-detail-card-v2">
            <div className="order-card-heading">
              <h2>Financial impact</h2>
            </div>
            <div className="order-financial-impact-grid">
              <div>
                <span>Allocation total</span>
                <strong>{order.amount}</strong>
              </div>
              <div>
                <span>Refund impact</span>
                <strong>Included in finance reconciliation</strong>
              </div>
              <div>
                <span>Net impact</span>
                <strong>Tracked in vendor finance view</strong>
              </div>
            </div>
          </article>

          <article className="order-detail-card-v2">
            <div className="order-card-heading">
              <h2>Secondary details</h2>
            </div>
            <div className="order-secondary-detail-grid">
              <div>
                <span>Shopify order ID</span>
                <strong>{order.sourceShopifyOrderId || '—'}</strong>
              </div>
              <div>
                <span>Workflow status</span>
                <strong>{order.allocationStatus || 'Unknown'}</strong>
              </div>
              <div>
                <span>Shipment created</span>
                <strong>{formatOptionalDate(order.shipmentCreatedAt, 'Not created')}</strong>
              </div>
              <div>
                <span>Shipment updated</span>
                <strong>{formatOptionalDate(order.shipmentUpdatedAt, 'Not updated')}</strong>
              </div>
              <div>
                <span>Shipping address</span>
                <strong>{order.shippingAddress || 'Unknown'}</strong>
              </div>
              <div>
                <span>Notes</span>
                <strong>{order.notes || '—'}</strong>
              </div>
            </div>
          </article>

          <article className="order-detail-card-v2 order-primary-action-card">
            <div className="order-card-heading">
              <div>
                <h2>Primary action</h2>
                <p>{isRealMode ? 'Shopify tracking sync remains routed through the backend fulfillment flow.' : 'Mock fulfillment actions remain available for demo mode.'}</p>
              </div>
            </div>
            {canUseFulfillmentActions ? (
              <div className="action-row vendor-action-panel">
                {isRealMode ? (
                  <>
                    <div className="real-mode-action-copy">
                      <p className="page-description">
                        {shouldShowRealTrackingForm
                          ? 'Ready for tracking submission. Add shipment details to sync this vendor-owned fulfillment.'
                          : 'Tracking has already been synced for this allocation.'}
                      </p>
                    </div>
                    {hasTrackingSync ? (
                      <div className="tracking-summary-card order-tracking-summary-card">
                        <div className="summary-row">
                          <span>Shipping</span>
                          <strong>{order.shippingStatus}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Fulfillment</span>
                          <strong>{order.fulfillmentStatus}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Tracking</span>
                          <strong className={order.trackingNumber ? '' : 'muted'}>{order.trackingNumber ?? 'Not available'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Carrier</span>
                          <strong className={order.carrier ? '' : 'muted'}>{order.carrier ?? 'Not available'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Tracking link</span>
                          {order.trackingUrl ? (
                            <a className="inline-link" href={order.trackingUrl} target="_blank" rel="noreferrer">
                              Open tracking
                            </a>
                          ) : (
                            <strong className="muted">Not available</strong>
                          )}
                        </div>
                      </div>
                    ) : null}
                    {shouldShowRealTrackingForm ? (
                      <form
                        className="detail-actions tracking-form order-tracking-form"
                        onSubmit={(event) => {
                          event.preventDefault();

                          if (!order) {
                            return;
                          }

                          const normalizedTrackingNumber = trackingNumber.trim();
                          const normalizedCarrier = carrier.trim();
                          const normalizedTrackingUrl = trackingUrl.trim();

                          if (!normalizedCarrier) {
                            showFeedback('Carrier is required before submitting tracking.', 'error');
                            return;
                          }

                          if (!normalizedTrackingNumber) {
                            showFeedback('Tracking number is required before submitting tracking.', 'error');
                            return;
                          }

                          void submitTrackingMutation({
                            allocationId: order.id,
                            trackingNumber: normalizedTrackingNumber,
                            carrier: normalizedCarrier,
                            trackingUrl: normalizedTrackingUrl || undefined,
                            notifyCustomer,
                          })
                            .then((result) => {
                              showFeedback(
                                `Tracking ${result.trackingNumber} submitted via ${result.shopifySyncSource}. Shipping status: ${result.shippingStatus}.`,
                                'success',
                              );
                            })
                            .catch((mutationError) => {
                              showFeedback(getTrackingMutationErrorMessage(mutationError), 'error');
                            });
                        }}
                      >
                        <label className="field">
                          <span>Carrier</span>
                          <input
                            value={carrier}
                            onChange={(event) => setCarrier(event.target.value)}
                            placeholder="Yurtiçi Kargo"
                            disabled={isSubmittingTracking}
                          />
                        </label>
                        <label className="field">
                          <span>Tracking number</span>
                          <input
                            value={trackingNumber}
                            onChange={(event) => setTrackingNumber(event.target.value)}
                            placeholder="TRACK123"
                            disabled={isSubmittingTracking}
                          />
                        </label>
                        <label className="field">
                          <span>Tracking URL (optional)</span>
                          <input
                            value={trackingUrl}
                            onChange={(event) => setTrackingUrl(event.target.value)}
                            placeholder="https://tracking.example/TRACK123"
                            disabled={isSubmittingTracking}
                          />
                        </label>
                        <label className="checkbox-field">
                          <input
                            type="checkbox"
                            checked={notifyCustomer}
                            onChange={(event) => setNotifyCustomer(event.target.checked)}
                            disabled={isSubmittingTracking}
                          />
                          <span>Notify customer</span>
                        </label>
                        <button type="submit" className="button button-primary" disabled={isSubmittingTracking}>
                          {isSubmittingTracking ? 'Submitting tracking...' : 'Submit tracking'}
                        </button>
                      </form>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="page-description">This allocation is fulfillable. Select the next shipping action.</p>
                    <div className="detail-actions order-inline-actions">
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
                  </>
                )}
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

          {isAdmin ? (
            <article className="order-detail-card-v2 order-admin-tools-card">
              <div>
                <h2>Admin tools</h2>
                <p>Inspect the full Shopify order graph across all vendor allocations.</p>
              </div>
              <Link className="button button-secondary" to={`/admin/orders/${order.sourceShopifyOrderNumber}`}>
                Open Shopify order breakdown
              </Link>
            </article>
          ) : null}
        </div>

        <aside className="order-detail-right-column">
          <article className="order-detail-card-v2">
            <div className="order-card-heading">
              <h2>Operational timeline</h2>
            </div>
            {order.timeline.length > 0 ? (
              <ol className="order-timeline-compact">
                {order.timeline.map((entry) => (
                  <li key={`${entry.label}-${entry.at}`}>
                    <span className="order-timeline-dot" aria-hidden="true" />
                    <div>
                      <strong>{entry.label}</strong>
                      <span>{formatDate(entry.at)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="order-empty-copy">No records available.</p>
            )}
          </article>

          <article className="order-detail-card-v2">
            <div className="order-card-heading">
              <h2>Summary</h2>
            </div>
            <div className="order-summary-compact">
              <div>
                <span>Channel</span>
                <strong>{order.channel || 'Unknown'}</strong>
              </div>
              <div>
                <span>Original vendor</span>
                <strong>{order.originalVendorId || 'Unknown'}</strong>
              </div>
              <div>
                <span>Assigned vendor</span>
                <strong>{order.assignedVendorId || 'Unknown'}</strong>
              </div>
              <div>
                <span>Allocation ownership</span>
                <strong>{allocationOwner}</strong>
              </div>
              <div>
                <span>Tracking submission</span>
                <strong>{isRealMode ? 'Backend Shopify fulfillment flow' : 'Demo fulfillment flow'}</strong>
              </div>
            </div>
          </article>

          <article className="order-detail-card-v2">
            <div className="order-card-heading">
              <h2>Fulfillment & shipping</h2>
            </div>
            <div className="order-shipping-state-grid">
              <div>
                <span>Fulfillment</span>
                <strong>{order.fulfillmentStatus}</strong>
              </div>
              <div>
                <span>Shipping</span>
                <strong>{order.shippingStatus}</strong>
              </div>
              <div>
                <span>Tracking</span>
                <strong>{trackingTitle}</strong>
              </div>
            </div>
          </article>

          <article className="order-detail-card-v2 order-reconciliation-card">
            <h2>Reconciliation context</h2>
            <p>
              Reconcile from Diagnostics if fulfillment, shipping, or tracking looks stale.
            </p>
          </article>
        </aside>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
