import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { DataStatePanel } from '../components/DataStatePanel';
import { ActionFeedback } from '../components/ActionFeedback';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { createShipmentExecution, getOrder, getShippingProviderDiagnostics, submitFulfillmentTracking } from '../features/orders/api';
import { getCurrentUser } from '../lib/auth';
import { useActionFeedback } from '../lib/ui';
import { useMutationAction } from '../hooks/useMutationAction';
import { runtimeConfig } from '../config/runtime';
import { ApiError } from '../lib/api/errors';
import { formatCurrency, toTitleCaseLabel } from '../services/real/formatting';

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

function getVendorTimelineLabel(label: string) {
  const normalized = label.toLowerCase();

  if (normalized.includes('order')) {
    return 'Order received';
  }
  if (normalized.includes('fulfillment')) {
    return 'Fulfillment pending';
  }
  if (normalized.includes('shipping') || normalized.includes('shipment')) {
    return 'Awaiting shipment';
  }
  if (normalized.includes('tracking')) {
    return 'Tracking pending';
  }
  if (normalized.includes('delivered')) {
    return 'Delivered';
  }

  return toTitleCaseLabel(label);
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
  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.role === 'admin';
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
  const { data: shippingProviderDiagnostics } = useQueryResource(
    queryKeys.admin.shipments.providerConfig('kargo_entegrator'),
    () => getShippingProviderDiagnostics(),
    {
      enabled: isAdmin,
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
  const { mutateAsync: createShipmentMutation, isPending: isCreatingShipment } = useMutationAction(
    async (allocationId: string) => createShipmentExecution(allocationId),
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
  const shipmentExecution = order?.shipmentExecution ?? null;
  const hasShipmentExecution = Boolean(shipmentExecution);
  const shipmentProviderSummary = shipmentExecution?.providerResponseSummary;
  const shouldShowShipmentProviderSummary =
    isAdmin &&
    Boolean(shipmentProviderSummary) &&
    Boolean(
      shipmentExecution &&
        (['pending', 'failed', 'unknown'].includes(shipmentExecution.shipmentStatus) ||
          !shipmentExecution.providerShipmentId ||
          !shipmentExecution.trackingNumber ||
          !shipmentExecution.labelUrl),
    );

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
            </div>
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
              <h2>Financial summary</h2>
            </div>
            <div className="order-financial-impact-grid">
              <div>
                <span>Order total</span>
                <strong>{order.amount}</strong>
              </div>
              <div>
                <span>Vendor payout impact</span>
                <strong>Included in payout calculations</strong>
              </div>
              <div>
                <span>Refund status</span>
                <strong>—</strong>
              </div>
            </div>
          </article>

          <article className="order-detail-card-v2">
            <div className="order-card-heading">
              <h2>Additional details</h2>
            </div>
            <div className="order-secondary-detail-grid">
              <div>
                <span>Shopify order ID</span>
                <strong>{order.sourceShopifyOrderId || '—'}</strong>
              </div>
              <div>
                <span>Shipment status</span>
                <strong>{order.shipmentCreatedAt ? formatOptionalDate(order.shipmentCreatedAt) : order.shippingStatus}</strong>
              </div>
              <div>
                <span>Shipping address</span>
                <strong>{order.shippingAddress || 'Unknown'}</strong>
              </div>
            </div>
          </article>
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
                      <strong>{getVendorTimelineLabel(entry.label)}</strong>
                      <span>{formatDate(entry.at)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="order-empty-copy">No records available.</p>
            )}
          </article>

          <article className="order-detail-card-v2 order-primary-action-card">
            <div className="order-card-heading">
              <div>
                <h2>Vendor actions</h2>
                <p>{hasTrackingSync ? 'Shipment information is available for this order.' : 'Add shipment details when the package is ready.'}</p>
              </div>
            </div>
            {canUseFulfillmentActions ? (
              <div className="action-row vendor-action-panel">
                {isRealMode ? (
                  <>
                    {hasTrackingSync || hasShipmentExecution ? (
                      <div className="tracking-summary-card order-tracking-summary-card">
                        {shipmentExecution ? (
                          <>
                            <div className="summary-row">
                              <span>Shipment provider</span>
                              <strong>{toTitleCaseLabel(shipmentExecution.provider)}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Carrier status</span>
                              <strong>{toTitleCaseLabel(shipmentExecution.shipmentStatus)}</strong>
                            </div>
                            {shipmentExecution.warehouseId ? (
                              <div className="summary-row">
                                <span>Warehouse</span>
                                <strong>{shipmentExecution.warehouseId}</strong>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                        <div className="summary-row">
                          <span>Tracking</span>
                          <strong className={order.trackingNumber || shipmentExecution?.trackingNumber ? '' : 'muted'}>
                            {order.trackingNumber ?? shipmentExecution?.trackingNumber ?? 'Not available'}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Carrier</span>
                          <strong className={order.carrier ? '' : 'muted'}>{order.carrier ?? 'Not available'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Tracking link</span>
                          {order.trackingUrl || shipmentExecution?.trackingUrl ? (
                            <a
                              className="inline-link"
                              href={(order.trackingUrl ?? shipmentExecution?.trackingUrl) || undefined}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open tracking
                            </a>
                          ) : (
                            <strong className="muted">Not available</strong>
                          )}
                        </div>
                        {shipmentExecution?.labelUrl ? (
                          <div className="summary-row">
                            <span>Label</span>
                            <a className="inline-link" href={shipmentExecution.labelUrl} target="_blank" rel="noreferrer">
                              Open label
                            </a>
                          </div>
                        ) : null}
                        {shipmentExecution?.shippingCost ? (
                          <div className="summary-row">
                            <span>Shipping cost</span>
                            <strong>{formatCurrency(shipmentExecution.shippingCost, shipmentExecution.currency)}</strong>
                          </div>
                        ) : null}
                        {shouldShowShipmentProviderSummary && shipmentProviderSummary ? (
                          <div className="provider-response-summary" aria-label="Provider response summary">
                            <div className="provider-response-heading">
                              <strong>Provider response summary</strong>
                              <span>Admin only</span>
                            </div>
                            <div className="summary-row">
                              <span>HTTP</span>
                              <strong>{shipmentProviderSummary.httpStatus ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Content type</span>
                              <strong>{shipmentProviderSummary.contentType || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Body type</span>
                              <strong>{shipmentProviderSummary.parsedBodyType || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Response keys</span>
                              <strong>{shipmentProviderSummary.responseKeys.length ? shipmentProviderSummary.responseKeys.join(', ') : '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Status field</span>
                              <strong>{shipmentProviderSummary.statusField || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Provider message</span>
                              <strong>{shipmentProviderSummary.providerError || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Provider id present</span>
                              <strong>{shipmentProviderSummary.providerShipmentIdPresent ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Tracking present</span>
                              <strong>{shipmentProviderSummary.trackingNumberPresent ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Label present</span>
                              <strong>{shipmentProviderSummary.labelPresent ? 'yes' : 'no'}</strong>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {!hasTrackingSync && !hasShipmentExecution ? (
                      <button
                        type="button"
                        className="button button-primary"
                        disabled={isCreatingShipment}
                        onClick={() => {
                          void createShipmentMutation(order.id)
                            .then((shipment) => {
                              showFeedback(
                                shipment.shipmentStatus === 'pending'
                                  ? 'Shipment request recorded. Carrier execution is pending.'
                                  : `Shipment ${shipment.providerShipmentId ?? shipment.id} recorded.`,
                                'success',
                              );
                            })
                            .catch((mutationError) => {
                              showFeedback(
                                mutationError instanceof Error ? mutationError.message : 'Unable to create shipment right now.',
                                'error',
                              );
                            });
                        }}
                      >
                        {isCreatingShipment ? 'Creating...' : 'Create shipment'}
                      </button>
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
                                `Tracking ${result.trackingNumber} submitted. Shipping status: ${result.shippingStatus}.`,
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
                          {isSubmittingTracking ? 'Submitting...' : 'Add tracking information'}
                        </button>
                      </form>
                    ) : null}
                  </>
                ) : (
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
                      Create shipment
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
                      Add tracking information
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="action-row vendor-blocked-panel">
                {isAdmin && shipmentExecution ? (
                  <div className="tracking-summary-card order-tracking-summary-card">
                    <div className="summary-row">
                      <span>Shipment provider</span>
                      <strong>{toTitleCaseLabel(shipmentExecution.provider)}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Carrier status</span>
                      <strong>{toTitleCaseLabel(shipmentExecution.shipmentStatus)}</strong>
                    </div>
                    {shipmentExecution.warehouseId ? (
                      <div className="summary-row">
                        <span>Warehouse</span>
                        <strong>{shipmentExecution.warehouseId}</strong>
                      </div>
                    ) : null}
                    <div className="summary-row">
                      <span>Tracking</span>
                      <strong className={order.trackingNumber || shipmentExecution.trackingNumber ? '' : 'muted'}>
                        {order.trackingNumber ?? shipmentExecution.trackingNumber ?? 'Not available'}
                      </strong>
                    </div>
                    <div className="summary-row">
                      <span>Carrier</span>
                      <strong className={order.carrier ? '' : 'muted'}>{order.carrier ?? 'Not available'}</strong>
                    </div>
                    {shouldShowShipmentProviderSummary && shipmentProviderSummary ? (
                      <div className="provider-response-summary" aria-label="Provider response summary">
                        <div className="provider-response-heading">
                          <strong>Provider response summary</strong>
                          <span>Admin only</span>
                        </div>
                        <div className="summary-row">
                          <span>HTTP</span>
                          <strong>{shipmentProviderSummary.httpStatus ?? '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Content type</span>
                          <strong>{shipmentProviderSummary.contentType || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Body type</span>
                          <strong>{shipmentProviderSummary.parsedBodyType || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Response keys</span>
                          <strong>{shipmentProviderSummary.responseKeys.length ? shipmentProviderSummary.responseKeys.join(', ') : '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Status field</span>
                          <strong>{shipmentProviderSummary.statusField || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Provider message</span>
                          <strong>{shipmentProviderSummary.providerError || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Provider id present</span>
                          <strong>{shipmentProviderSummary.providerShipmentIdPresent ? 'yes' : 'no'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Tracking present</span>
                          <strong>{shipmentProviderSummary.trackingNumberPresent ? 'yes' : 'no'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Label present</span>
                          <strong>{shipmentProviderSummary.labelPresent ? 'yes' : 'no'}</strong>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {isAdmin && shippingProviderDiagnostics ? (
                  <div className="shipping-provider-diagnostics" aria-label="Shipping provider diagnostics">
                    <div className="provider-response-heading">
                      <strong>Shipping provider diagnostics</strong>
                      <span>Admin only</span>
                    </div>
                    <div className="summary-row">
                      <span>Shipping execution enabled</span>
                      <strong>{shippingProviderDiagnostics.shippingExecutionEnabled ? 'yes' : 'no'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Provider enabled</span>
                      <strong>{shippingProviderDiagnostics.providerEnabled ? 'yes' : 'no'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Base URL configured</span>
                      <strong>{shippingProviderDiagnostics.baseUrlConfigured ? 'yes' : 'no'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>API key configured</span>
                      <strong>{shippingProviderDiagnostics.apiKeyConfigured ? 'yes' : 'no'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Missing env names</span>
                      <strong>{shippingProviderDiagnostics.missing.length ? shippingProviderDiagnostics.missing.join(', ') : '—'}</strong>
                    </div>
                  </div>
                ) : null}
                <p className="page-description">
                  Shipping actions are currently unavailable.
                  {order.cancellationReason ? ` Reason: ${order.cancellationReason.replace(/_/g, ' ')}.` : ''}
                </p>
                {isVendorAssignedOwner ? (
                  <div className="detail-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => {
                        if (!canReportIssue || !order) {
                          showFeedback('This order is already under review.', 'info');
                          return;
                        }

                        void reportFulfillmentIssue(order.id)
                          .then(() => {
                            showFeedback('Fulfillment issue reported for review.', 'success');
                          })
                          .catch(() => {
                            showFeedback('Unable to report fulfillment issue right now.', 'error');
                          });
                      }}
                      disabled={isReportingIssue || !canReportIssue}
                    >
                      Contact support
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </article>
        </aside>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
