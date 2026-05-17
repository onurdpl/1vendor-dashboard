import { Link, useLocation, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { DataStatePanel } from '../components/DataStatePanel';
import { ActionFeedback } from '../components/ActionFeedback';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import {
  createShipmentExecution,
  getOrder,
  getShippingProviderDiagnostics,
  retryShipmentExecution,
  submitFulfillmentTracking,
} from '../features/orders/api';
import { useActionFeedback } from '../lib/ui';
import { useMutationAction } from '../hooks/useMutationAction';
import { runtimeConfig } from '../config/runtime';
import { ApiError } from '../lib/api/errors';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';
import { formatCurrency, toTitleCaseLabel } from '../services/real/formatting';
import { SupportTicketModal } from '../components/SupportTicketModal';
import { useAppReadiness } from '../lib/appReadiness';
import { listReturns } from '../features/returns/api';
import { getFinanceDashboard } from '../features/finance/api';
import { listAdminSupportTickets, listVendorSupportTickets } from '../features/support/api';
import { OperationalLinkCards, OperationalTimeline } from '../components/OperationalTimeline';
import { OperationalRecommendations } from '../components/OperationalRecommendations';
import type { OperationsRecommendation } from '../lib/api/contracts';
import {
  sameOperationalOrderNumber,
  supportTicketMatchesOrder,
  type OperationalEventInput,
  type OperationalLinkInput,
} from '../lib/operationalCrossLinks';
import { sameShopifyIdentifier } from '../lib/shopifyIdentifiers';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatOptionalDate(value?: string, fallback = '—') {
  return value ? formatDate(value) : fallback;
}

function buildFinanceHref(record: { id: string }) {
  return `/finance?ledgerId=${encodeURIComponent(record.id)}`;
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
  const location = useLocation();
  const appReadiness = useAppReadiness();
  const currentUser = appReadiness.currentUser;
  const currentVendor = appReadiness.currentVendor;
  const authContextReady = appReadiness.ready;
  const isAdmin = currentUser?.role === 'admin';
  const isRealMode = runtimeConfig.apiMode === 'real';
  const { message, tone, showFeedback } = useActionFeedback();
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const { data: order, isLoading, isError, error, diagnostics, refetch } = useQueryResource(
    orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId),
    () => {
      if (!orderId) {
        throw new Error('Order not found.');
      }

      return getOrder(orderId, { vendorId: currentVendor.vendorId });
    },
    {
      enabled: authContextReady && Boolean(orderId),
    },
  );
  const { data: shippingProviderDiagnostics } = useQueryResource(
    queryKeys.admin.shipments.providerConfig('kargo_entegrator'),
    () => getShippingProviderDiagnostics(),
    {
      enabled: authContextReady && isAdmin,
    },
  );
  const { data: relatedReturnsData } = useQueryResource(
    queryKeys.returns.list(currentVendor.vendorId),
    () => listReturns({ vendorId: currentVendor.vendorId }),
    {
      enabled: authContextReady && Boolean(order),
    },
  );
  const { data: relatedFinanceData } = useQueryResource(
    queryKeys.finance.summary(currentVendor.vendorId),
    () => getFinanceDashboard({ vendorId: currentVendor.vendorId }),
    {
      enabled: authContextReady && Boolean(order),
    },
  );
  const { data: relatedSupportTicketsData } = useQueryResource(
    isAdmin ? queryKeys.admin.support.tickets() : queryKeys.support.tickets(currentVendor.vendorId),
    () => (isAdmin ? listAdminSupportTickets() : listVendorSupportTickets()),
    {
      enabled: authContextReady && Boolean(order),
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
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
    },
  );
  const { mutateAsync: createShipmentMutation, isPending: isCreatingShipment } = useMutationAction(
    async (allocationId: string) => createShipmentExecution(allocationId),
    {
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
    },
  );
  const { mutateAsync: retryShipmentMutation, isPending: isRetryingShipment } = useMutationAction(
    async (shipmentExecutionId: string) => retryShipmentExecution(shipmentExecutionId),
    {
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
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
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
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
  const canRetryDryRunShipment =
    isAdmin &&
    Boolean(shipmentExecution) &&
    shipmentExecution?.shipmentStatus === 'pending' &&
    !shipmentExecution.providerShipmentId &&
    !shipmentExecution.trackingNumber &&
    Boolean(shipmentProviderSummary?.dryRun === true || (shipmentProviderSummary?.disabledGates.length ?? 0) > 0);
  const supportSnapshot = order
    ? {
        route: location.pathname,
        orderNumber: formatShopifyOrderNumber(order.sourceShopifyOrderNumber),
        allocationStatus: order.allocationStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        shippingStatus: order.shippingStatus,
        trackingPresent: Boolean(order.trackingNumber || order.trackingUrl),
        shipmentExecutionId: shipmentExecution?.id ?? null,
        shipmentStatus: shipmentExecution?.shipmentStatus ?? null,
      }
    : null;
  const relatedReturns = useMemo(
    () =>
      (relatedReturnsData ?? []).filter(
        (returnRecord) =>
          returnRecord.relatedOrderId === order?.id ||
          sameOperationalOrderNumber(returnRecord.sourceShopifyOrderNumber, order?.sourceShopifyOrderNumber) ||
          sameShopifyIdentifier(returnRecord.sourceShopifyOrderId, order?.sourceShopifyOrderId),
      ),
    [order?.id, order?.sourceShopifyOrderId, order?.sourceShopifyOrderNumber, relatedReturnsData],
  );
  const relatedFinanceRecords = useMemo(
    () =>
      (relatedFinanceData?.transactions ?? []).filter(
        (record) =>
          sameOperationalOrderNumber(record.shopifyOrderNumber, order?.sourceShopifyOrderNumber) ||
          sameShopifyIdentifier(record.shopifyOrderId, order?.sourceShopifyOrderId),
      ),
    [order?.sourceShopifyOrderId, order?.sourceShopifyOrderNumber, relatedFinanceData?.transactions],
  );
  const relatedSupportTickets = useMemo(
    () =>
      (relatedSupportTicketsData ?? []).filter((ticket) =>
        supportTicketMatchesOrder(ticket, order?.id, order?.sourceShopifyOrderNumber, {
          audience: isAdmin ? 'admin' : 'vendor',
          currentVendorId: currentVendor.vendorId,
        }),
      ),
    [currentVendor.vendorId, isAdmin, order?.id, order?.sourceShopifyOrderNumber, relatedSupportTicketsData],
  );

  const handleRetryShipment = () => {
    if (!shipmentExecution || !canRetryDryRunShipment) {
      return;
    }

    void retryShipmentMutation(shipmentExecution.id)
      .then((shipment) => {
        showFeedback(
          shipment.shipmentStatus === 'pending'
            ? 'Shipment retry recorded. Carrier execution is pending.'
            : `Shipment ${shipment.providerShipmentId ?? shipment.id} refreshed.`,
          'success',
        );
        void refetch();
      })
      .catch((mutationError) => {
        showFeedback(getTrackingMutationErrorMessage(mutationError), 'error');
      });
  };

  useEffect(() => {
    if (!order) {
      return;
    }

    setCarrier(order.carrier ?? '');
    setTrackingNumber(order.trackingNumber ?? '');
    setTrackingUrl('');
    setNotifyCustomer(false);
  }, [order]);

  if (!authContextReady || isLoading) {
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
        diagnostics={diagnostics}
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
  const audience = isAdmin ? 'admin' : 'vendor';
  const supportBasePath = isAdmin ? '/admin/support' : '/support';
  const orderTimelineEvents: OperationalEventInput[] = [];
  orderTimelineEvents.push({
    id: 'order-created',
    title: 'Order created',
    description: `Order ${formatShopifyOrderNumber(order.sourceShopifyOrderNumber)} entered the vendor workspace.`,
    at: order.date,
    status: order.status,
    tone: 'info',
  });
  if (order.shipmentCreatedAt) {
    orderTimelineEvents.push({
      id: 'shipment-created',
      title: 'Shipment created',
      description: order.carrier ? `Carrier: ${order.carrier}` : 'Shipment record is available.',
      at: order.shipmentCreatedAt,
      status: order.shippingStatus,
      tone: 'success',
    });
  }
  if (order.trackingNumber || order.trackingUrl) {
    orderTimelineEvents.push({
      id: 'tracking-added',
      title: 'Tracking added',
      description: [order.carrier, order.trackingNumber].filter(Boolean).join(' / ') || 'Tracking link available.',
      at: order.shipmentUpdatedAt ?? order.fulfilledAt ?? order.date,
      status: 'Tracking added',
      tone: 'success',
    });
  }
  orderTimelineEvents.push(
    ...relatedReturns.map((returnRecord) => ({
      id: `return-${returnRecord.id}`,
      title: 'Return requested',
      description: `${returnRecord.displayTitle ?? returnRecord.itemTitle ?? 'Returned item'} · ${getStatusClass(returnRecord.status).replace(/-/g, ' ')}`,
      at: returnRecord.date,
      status: returnRecord.status,
      tone: 'attention' as const,
      href: `/returns/${returnRecord.id}`,
    })),
    ...relatedFinanceRecords.map((record) => ({
      id: `finance-${record.id}`,
      title: record.category === 'Refund' ? 'Refund processed' : 'Finance entry created',
      description: `${record.category} · ${record.amount}`,
      at: record.date,
      status: record.status,
      tone: record.category === 'Refund' ? ('warning' as const) : ('success' as const),
      href: buildFinanceHref(record),
    })),
    ...relatedSupportTickets.map((ticket) => ({
      id: `support-${ticket.id}`,
      title: 'Support ticket opened',
      description: ticket.subject,
      at: ticket.createdAt,
      status: ticket.status.replace(/_/g, ' '),
      tone: ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? ('success' as const) : ('info' as const),
      href: `${supportBasePath}/${ticket.id}`,
    })),
    ...relatedSupportTickets
      .filter((ticket) => Boolean(ticket.lastReplyAt))
      .map((ticket) => ({
        id: `support-reply-${ticket.id}`,
        title: 'Support reply added',
        description: ticket.subject,
        at: ticket.lastReplyAt,
        status: ticket.lastReplyByRole ?? 'Reply',
        tone: 'neutral' as const,
        href: `${supportBasePath}/${ticket.id}`,
      })),
  );
  const orderCrossLinks: OperationalLinkInput[] = [
    ...relatedReturns.map((returnRecord) => ({
      id: `return-${returnRecord.id}`,
      eyebrow: 'Return',
      title: `Return for ${formatShopifyOrderNumber(returnRecord.sourceShopifyOrderNumber)}`,
      description: returnRecord.displayTitle ?? returnRecord.itemTitle ?? 'Returned item',
      href: `/returns/${returnRecord.id}`,
      status: returnRecord.status,
      tone: returnRecord.status === 'Refunded' || returnRecord.status === 'Closed' ? ('success' as const) : ('attention' as const),
    })),
    ...relatedFinanceRecords.map((record) => ({
      id: `finance-${record.id}`,
      eyebrow: 'Finance',
      title: record.category === 'Refund' ? 'Refund impact' : 'Payout activity',
      description: `${record.amount} · ${record.status}`,
      href: buildFinanceHref(record),
      status: record.category,
      tone: record.category === 'Refund' ? ('warning' as const) : ('success' as const),
    })),
    ...relatedSupportTickets.map((ticket) => ({
      id: `support-${ticket.id}`,
      eyebrow: 'Support',
      title: ticket.subject,
      description: ticket.vendorName ?? ticket.vendorId,
      href: `${supportBasePath}/${ticket.id}`,
      status: ticket.status.replace(/_/g, ' '),
      tone: ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? ('success' as const) : ('info' as const),
    })),
  ];
  const orderRecommendations: OperationsRecommendation[] = [];
  if (!hasTrackingSync && order.shippingStatus !== 'Delivered') {
    orderRecommendations.push({
      id: `order-rec-tracking-${order.id}`,
      type: 'shipment_tracking',
      severity: order.shipmentCreatedAt ? 'warning' : 'info',
      title: 'Review shipment tracking',
      description: `Order ${formatShopifyOrderNumber(order.sourceShopifyOrderNumber)} does not have tracking visible yet.`,
      recommendedAction: 'Confirm shipment progress and add tracking when available',
      relatedObjectType: 'Order',
      relatedObjectId: order.id,
      vendor: {
        id: order.assignedVendorId,
        name: currentVendor.vendorName ?? order.assignedVendorId,
      },
      createdFromSignal: `order:${order.id}:tracking`,
      deepLink: `/orders/${order.id}`,
      vendorVisible: true,
      createdAt: order.shipmentUpdatedAt ?? order.date,
    });
  }
  const activeReturn = relatedReturns.find((returnRecord) => !['Closed', 'Processed', 'Refunded'].includes(returnRecord.status));
  if (activeReturn) {
    orderRecommendations.push({
      id: `order-rec-return-${activeReturn.id}`,
      type: 'return_review',
      severity: activeReturn.status === 'Requested' || activeReturn.status === 'In Review' ? 'warning' : 'info',
      title: 'Review unresolved return',
      description: `A related return for ${formatShopifyOrderNumber(activeReturn.sourceShopifyOrderNumber)} is still active.`,
      recommendedAction: 'Open the return and review the next vendor action',
      relatedObjectType: 'Return',
      relatedObjectId: activeReturn.id,
      vendor: {
        id: activeReturn.assignedVendorId,
        name: currentVendor.vendorName ?? activeReturn.assignedVendorId,
      },
      createdFromSignal: `return:${activeReturn.id}`,
      deepLink: `/returns/${activeReturn.id}`,
      vendorVisible: true,
      createdAt: activeReturn.updatedAt ?? activeReturn.date,
    });
  }
  const waitingSupportTicket = relatedSupportTickets.find((ticket) => ticket.status === 'WAITING_FOR_VENDOR');
  if (waitingSupportTicket) {
    orderRecommendations.push({
      id: `order-rec-support-${waitingSupportTicket.id}`,
      type: 'support_assignment',
      severity: 'warning',
      title: 'Reply to support request',
      description: waitingSupportTicket.subject,
      recommendedAction: 'Open support and provide the requested update',
      relatedObjectType: 'Support ticket',
      relatedObjectId: waitingSupportTicket.id,
      vendor: {
        id: waitingSupportTicket.vendorId,
        name: waitingSupportTicket.vendorName ?? waitingSupportTicket.vendorId,
      },
      createdFromSignal: `support:${waitingSupportTicket.id}`,
      deepLink: `${supportBasePath}/${waitingSupportTicket.id}`,
      vendorVisible: true,
      createdAt: waitingSupportTicket.lastReplyAt ?? waitingSupportTicket.updatedAt,
    });
  }

  return (
    <section className="order-detail-workspace">
      <header className="order-detail-topbar">
        <Link className="order-detail-back" to="/orders">
          Back to orders
        </Link>
        <div className="order-detail-title-row">
          <div className="order-detail-title-stack">
            <div className="order-detail-heading-line">
              <h1>Order {formatShopifyOrderNumber(order.sourceShopifyOrderNumber)}</h1>
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

          <OperationalLinkCards
            title="Related operational records"
            subtitle="Returns, payout activity, and support linked to this order."
            links={orderCrossLinks}
            audience={audience}
          />
        </div>

        <aside className="order-detail-right-column">
          <OperationalRecommendations
            title="Suggested next steps"
            subtitle="Contextual, read-only guidance for this order."
            recommendations={orderRecommendations}
            audience={audience}
          />

          <OperationalTimeline
            title="Unified activity"
            subtitle="Order, return, finance, and support events."
            events={[
              ...order.timeline.map((entry) => ({
                id: `order-native-${entry.label}-${entry.at}`,
                title: getVendorTimelineLabel(entry.label),
                at: entry.at,
                tone: 'neutral' as const,
              })),
              ...orderTimelineEvents,
            ]}
            audience={audience}
            emptyMessage="No records available."
          />

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
                              <span>Detected format</span>
                              <strong>{shipmentProviderSummary.detectedResponseFormat || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Auth/header mode</span>
                              <strong>{shipmentProviderSummary.authHeaderMode || '—'}</strong>
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
                              <span>Stored dry-run response</span>
                              <strong>{shipmentProviderSummary.dryRun === null ? '—' : shipmentProviderSummary.dryRun ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Disabled gates at response time</span>
                              <strong>{shipmentProviderSummary.disabledGates.length ? shipmentProviderSummary.disabledGates.join(', ') : '—'}</strong>
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
                            {shipmentProviderSummary.responseSnippet ? (
                              <div className="summary-row">
                                <span>Safe response snippet</span>
                                <strong>{shipmentProviderSummary.responseSnippet}</strong>
                              </div>
                            ) : null}
                            {canRetryDryRunShipment ? (
                              <button
                                type="button"
                                className="button button-secondary"
                                disabled={isRetryingShipment}
                                onClick={handleRetryShipment}
                              >
                                {isRetryingShipment ? 'Retrying...' : 'Retry live shipment'}
                              </button>
                            ) : null}
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
                          <span>Detected format</span>
                          <strong>{shipmentProviderSummary.detectedResponseFormat || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Auth/header mode</span>
                          <strong>{shipmentProviderSummary.authHeaderMode || '—'}</strong>
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
                          <span>Stored dry-run response</span>
                          <strong>{shipmentProviderSummary.dryRun === null ? '—' : shipmentProviderSummary.dryRun ? 'yes' : 'no'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Disabled gates at response time</span>
                          <strong>{shipmentProviderSummary.disabledGates.length ? shipmentProviderSummary.disabledGates.join(', ') : '—'}</strong>
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
                        {shipmentProviderSummary.responseSnippet ? (
                          <div className="summary-row">
                            <span>Safe response snippet</span>
                            <strong>{shipmentProviderSummary.responseSnippet}</strong>
                          </div>
                        ) : null}
                        {canRetryDryRunShipment ? (
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={isRetryingShipment}
                            onClick={handleRetryShipment}
                          >
                            {isRetryingShipment ? 'Retrying...' : 'Retry live shipment'}
                          </button>
                        ) : null}
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
                    <div className="summary-row">
                      <span>Deprecated env fallback</span>
                      <strong>
                        {shippingProviderDiagnostics.deprecatedEnvFallbacks?.length
                          ? shippingProviderDiagnostics.deprecatedEnvFallbacks.join(', ')
                          : '—'}
                      </strong>
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
                      onClick={() => setSupportOpen(true)}
                      disabled={!canReportIssue}
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
      {order ? (
        <SupportTicketModal
          open={supportOpen}
          contextType="order"
          contextId={order.id}
          contextSnapshot={supportSnapshot}
          defaultSubject={`Help with order ${formatShopifyOrderNumber(order.sourceShopifyOrderNumber)}`}
          onClose={() => setSupportOpen(false)}
          onCreated={() => showFeedback('Support ticket created.', 'success')}
        />
      ) : null}
    </section>
  );
}
