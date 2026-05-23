import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  EmptyStatePanel,
  FilterBar,
  OperationalActionGroup,
  OperationalSection,
  SectionErrorRetry,
  SectionSkeleton,
  TableSkeletonRows,
  OperationalTable,
  OperationalTableRow,
  OperationalToolbar,
  SearchInput,
  SideDetailPanel,
  StatusBadge,
  TimelineBlock,
} from '../components/OperationalPrimitives';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import {
  createShipmentExecution,
  getOrder,
  listOrders,
  retryFailedShipmentExecution,
  type OrderDetail,
  type OrderSummary,
  type ShipmentExecution,
} from '../features/orders/api';
import { useAppReadiness } from '../lib/appReadiness';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';
import { sameNormalizedIdentifier } from '../lib/shopifyIdentifiers';
import { formatShippingProviderName, formatTrackingCarrierLabel } from '../lib/shippingDisplay';
import { useMutationAction } from '../hooks/useMutationAction';

type OrderQuickFilter = 'all' | 'awaiting' | 'tracking_missing' | 'high_value' | 'returns';
type LabelActionFeedback = {
  tone: 'success' | 'warning' | 'error';
  message: string;
};

function formatDate(value?: string | null) {
  if (!value) {
    return 'Not synced';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getStatusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes('fulfilled') || normalized.includes('delivered') || normalized === 'active') {
    return 'success' as const;
  }
  if (normalized.includes('blocked') || normalized.includes('reassignment') || normalized.includes('hold')) {
    return 'warning' as const;
  }
  if (normalized.includes('pending') || normalized.includes('awaiting') || normalized.includes('processing')) {
    return 'attention' as const;
  }
  return 'neutral' as const;
}

function getLineItemCount(order: OrderSummary | OrderDetail) {
  return (
    (order as OrderDetail).lineItems?.length ??
    (order as OrderDetail).items?.length ??
    (order as OrderSummary & { lineItemCount?: number }).lineItemCount ??
    0
  );
}

function getTrackingLabel(order: OrderSummary | OrderDetail) {
  const carrier = formatTrackingCarrierLabel(order.carrier);
  if (order.trackingNumber || carrier) {
    return [carrier, order.trackingNumber].filter(Boolean).join(' / ');
  }

  return 'Tracking pending';
}

function getCustomerLabel(customer?: string | null) {
  const value = customer?.trim();
  const normalized = value?.toLowerCase() ?? '';
  if (!value || normalized.includes('customer details') || normalized.includes('customer unavailable')) {
    return 'Customer hidden for vendor scope';
  }
  return value;
}

function getAttentionLabel(order: OrderSummary) {
  if (order.allocationStatus === 'vendor_blocked') {
    return 'Vendor blocked';
  }
  if (order.allocationStatus === 'pending_reassignment') {
    return 'Reassignment needed';
  }
  if (order.shippingStatus === 'Awaiting Shipment') {
    return 'Awaiting shipment';
  }
  return 'In flow';
}

function getLifecyclePrimaryLabel(order: OrderSummary) {
  if (order.shippingStatus === 'Awaiting Shipment') {
    return 'Awaiting shipment';
  }
  if (order.fulfillmentStatus === 'Fulfilled') {
    return 'Fulfilled';
  }
  return getAttentionLabel(order);
}

function getLifecycleSecondaryLabel(order: OrderSummary) {
  if (order.trackingNumber || order.carrier) {
    return 'Tracking visible';
  }
  if (order.shippingStatus === 'Awaiting Shipment') {
    return 'Tracking pending';
  }
  if (order.allocationStatus === 'pending_reassignment' || order.allocationStatus === 'vendor_blocked') {
    return order.allocationStatus.replace(/_/g, ' ');
  }
  return null;
}

function getShippingOperationalLabel(order: OrderSummary | OrderDetail) {
  if (order.allocationStatus === 'vendor_blocked') {
    return { label: 'Shipment blocked', tone: 'blocked' as const, helper: null };
  }
  if (order.allocationStatus === 'pending_reassignment') {
    return { label: 'Needs review', tone: 'blocked' as const, helper: null };
  }
  if (order.trackingNumber && order.trackingUrl) {
    return { label: 'Tracking synced', tone: 'tracking' as const, helper: getTrackingLabel(order) };
  }
  if (order.trackingNumber || order.carrier) {
    return { label: 'Shopify sync pending', tone: 'tracking' as const, helper: getTrackingLabel(order) };
  }
  if (order.shippingStatus === 'Label Created' || order.shippingStatus === 'In Transit') {
    return { label: 'Provider pending', tone: 'pending' as const, helper: null };
  }
  if (order.shippingStatus === 'Awaiting Shipment') {
    return { label: 'No tracking yet', tone: 'pending' as const, helper: null };
  }
  if (order.fulfillmentStatus === 'Fulfilled' || order.shippingStatus === 'Delivered') {
    return { label: 'Fulfilled', tone: 'fulfilled' as const, helper: null };
  }
  return { label: 'Provider pending', tone: 'pending' as const, helper: null };
}

function getShopifyFulfillmentRailLabel(order: OrderSummary | OrderDetail) {
  const detail = order as OrderDetail;
  if (detail.shopifyFulfillmentSync?.fulfillmentIdPresent || detail.shopifyFulfillmentSync?.status === 'synced') {
    return 'Synced';
  }
  if (order.fulfillmentStatus === 'Fulfilled') {
    return 'Fulfilled';
  }
  if (order.trackingNumber || order.carrier) {
    return 'Pending';
  }
  return 'Not fulfilled';
}

function getRailProviderLabel(order: OrderSummary | OrderDetail) {
  const detail = order as OrderDetail;
  return (
    formatShippingProviderName(detail.shipmentExecution?.providerCarrierName) ||
    formatShippingProviderName(detail.shipmentExecution?.provider) ||
    formatShippingProviderName(order.carrier) ||
    'Provider pending'
  );
}

function getItemInitials(name: string) {
  const [first = '', second = ''] = name.trim().split(/\s+/);
  return `${first[0] ?? 'I'}${second[0] ?? ''}`.toUpperCase();
}

function parseOperationalAmount(amount: string) {
  const numeric = amount.replace(/[^\d.,-]/g, '');
  const hasComma = numeric.includes(',');
  const hasDot = numeric.includes('.');
  const normalized = hasComma && hasDot
    ? numeric.lastIndexOf('.') > numeric.lastIndexOf(',')
      ? numeric.replace(/,/g, '')
      : numeric.replace(/\./g, '').replace(',', '.')
    : hasComma
      ? numeric.replace(',', '.')
      : numeric;
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : 0;
}

function formatMetricShare(value: number, total: number) {
  if (!total) {
    return '0% of queue';
  }
  return `${Math.round((value / total) * 100)}% of queue`;
}

function MetricIcon({ tone }: { tone: string }) {
  if (tone === 'awaiting') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </svg>
    );
  }
  if (tone === 'missing') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 7v6" />
        <path d="M12 17h.01" />
        <circle cx="12" cy="12" r="8" />
      </svg>
    );
  }
  if (tone === 'fulfilled') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m7 12 3 3 7-7" />
        <circle cx="12" cy="12" r="8" />
      </svg>
    );
  }
  if (tone === 'tracking') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h11v8H4z" />
        <path d="M15 10h3l2 3v2h-5z" />
        <circle cx="8" cy="17" r="1.5" />
        <circle cx="17" cy="17" r="1.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 7h12v10H6z" />
      <path d="M9 7V5h6v2" />
      <path d="M9 11h6" />
    </svg>
  );
}

function MetricSparkline({ tone }: { tone: string }) {
  const pointsByTone: Record<string, string> = {
    orders: '0,18 12,15 24,16 36,10 48,13 60,7 72,9 84,4',
    awaiting: '0,16 12,17 24,14 36,15 48,10 60,12 72,8 84,9',
    missing: '0,12 12,12 24,12 36,12 48,12 60,12 72,12 84,12',
    fulfilled: '0,17 12,16 24,16 36,14 48,13 60,11 72,8 84,5',
    tracking: '0,18 12,16 24,17 36,14 48,12 60,11 72,7 84,6',
  };

  return (
    <svg className="orders-kpi-sparkline" viewBox="0 0 84 24" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pointsByTone[tone] ?? pointsByTone.orders} />
    </svg>
  );
}

function orderMatchesTarget(order: OrderSummary, target: string | null) {
  if (!target) {
    return false;
  }

  return (
    sameNormalizedIdentifier(order.id, target) ||
    sameNormalizedIdentifier(order.sourceShopifyOrderId, target) ||
    sameNormalizedIdentifier(order.sourceShopifyOrderNumber, target)
  );
}

function getRequestedOrderTargets(searchParams: URLSearchParams) {
  return [
    'orderId',
    'shopifyOrderId',
    'sourceShopifyOrderId',
    'shopifyOrderNumber',
    'sourceShopifyOrderNumber',
    'orderNumber',
    'id',
    'order',
  ]
    .map((name) => searchParams.get(name)?.trim())
    .filter((value): value is string => Boolean(value));
}

export function OrdersPage() {
  const [searchParams] = useSearchParams();
  const appReadiness = useAppReadiness();
  const currentVendor = appReadiness.currentVendor;
  const currentUser = appReadiness.currentUser;
  const authContextReady = appReadiness.ready;
  const isAdmin = currentUser?.role === 'admin';
  const { data: orders, isLoading, isError, error, diagnostics, refetch } = useQueryResource(
    queryKeys.orders.list(currentVendor.vendorId),
    ({ signal }) => listOrders({ vendorId: currentVendor.vendorId, signal }),
    { enabled: authContextReady },
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [fulfillmentFilter, setFulfillmentFilter] = useState('all');
  const [shippingFilter, setShippingFilter] = useState('all');
  const [quickFilter, setQuickFilter] = useState<OrderQuickFilter>('all');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [labelActionFeedback, setLabelActionFeedback] = useState<LabelActionFeedback | null>(null);
  const requestedOrderTargets = useMemo(() => getRequestedOrderTargets(searchParams), [searchParams]);
  const hasRequestedOrderTarget = requestedOrderTargets.length > 0;
  const requestedOrderTargetKey = requestedOrderTargets.join('|');

  useEffect(() => {
    setSelectedOrderId(null);
  }, [requestedOrderTargetKey]);

  const rankedOrders = useMemo(() => {
    const rank = (order: OrderSummary) => {
      if (order.allocationStatus === 'vendor_blocked') {
        return 0;
      }
      if (order.allocationStatus === 'pending_reassignment') {
        return 1;
      }
      if (order.shippingStatus === 'Awaiting Shipment') {
        return 2;
      }
      if (order.fulfillmentStatus === 'Fulfilled') {
        return 4;
      }
      return 3;
    };

    return [...(orders ?? [])].sort((a, b) => {
      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return rankedOrders.filter((order) => {
      const matchesStatus = statusFilter === 'all' || order.allocationStatus === statusFilter || order.status === statusFilter;
      const matchesFulfillment = fulfillmentFilter === 'all' || order.fulfillmentStatus === fulfillmentFilter;
      const matchesShipping = shippingFilter === 'all' || order.shippingStatus === shippingFilter;
      const searchableText = [
        order.id,
        order.sourceShopifyOrderId,
        String(order.sourceShopifyOrderNumber),
        getCustomerLabel(order.customer),
        order.status,
        order.allocationStatus,
        order.fulfillmentStatus,
        order.shippingStatus,
        order.trackingNumber ?? '',
        order.carrier ?? '',
        order.amount,
        currentVendor.vendorName,
        currentVendor.vendorId,
      ]
        .join(' ')
        .toLowerCase();

      const matchesQuickFilter =
        quickFilter === 'all' ||
        (quickFilter === 'awaiting' && order.shippingStatus === 'Awaiting Shipment') ||
        (quickFilter === 'tracking_missing' && !order.trackingNumber && !order.carrier) ||
        (quickFilter === 'high_value' && parseOperationalAmount(order.amount) >= 3000) ||
        (quickFilter === 'returns' && searchableText.includes('return'));

      return matchesStatus && matchesFulfillment && matchesShipping && matchesQuickFilter && (!query || searchableText.includes(query));
    });
  }, [currentVendor.vendorId, currentVendor.vendorName, fulfillmentFilter, quickFilter, rankedOrders, searchTerm, shippingFilter, statusFilter]);

  const selectedOrderSummary = useMemo(() => {
    const selectedByClick = selectedOrderId ? filteredOrders.find((order) => order.id === selectedOrderId) : null;
    if (selectedByClick) {
      return selectedByClick;
    }
    if (hasRequestedOrderTarget) {
      return (
        rankedOrders.find((order) => requestedOrderTargets.some((target) => orderMatchesTarget(order, target))) ??
        null
      );
    }
    if (!filteredOrders.length) {
      return null;
    }
    return filteredOrders[0];
  }, [filteredOrders, hasRequestedOrderTarget, rankedOrders, requestedOrderTargets, selectedOrderId]);

  const orderDetailQuery = useQueryResource(
    selectedOrderSummary
      ? queryKeys.orders.detail(selectedOrderSummary.id, currentVendor.vendorId)
      : ['orders', 'detail', currentVendor.vendorId, 'empty'],
    ({ signal }) => {
      if (!selectedOrderSummary) {
        throw new Error('Order not found.');
      }
      return getOrder(selectedOrderSummary.id, { vendorId: currentVendor.vendorId, signal });
    },
    { enabled: authContextReady && Boolean(selectedOrderSummary) },
  );

  const selectedOrder = orderDetailQuery.data ?? selectedOrderSummary;

  const { mutateAsync: createShipmentMutation, isPending: isCreatingShipmentLabel } = useMutationAction(
    async (allocationId: string) =>
      createShipmentExecution(allocationId, {
        vendorId: currentVendor.vendorId,
      }),
    {
      invalidateQueryKeys: [
        queryKeys.orders.list(currentVendor.vendorId),
        selectedOrderSummary
          ? queryKeys.orders.detail(selectedOrderSummary.id, currentVendor.vendorId)
          : queryKeys.orders.list(currentVendor.vendorId),
      ],
    },
  );
  const { mutateAsync: retryShipmentLabelMutation, isPending: isRetryingShipmentLabel } = useMutationAction(
    async (shipmentExecutionId: string) =>
      retryFailedShipmentExecution(shipmentExecutionId, {
        vendorId: currentVendor.vendorId,
      }),
    {
      invalidateQueryKeys: [
        queryKeys.orders.list(currentVendor.vendorId),
        selectedOrderSummary
          ? queryKeys.orders.detail(selectedOrderSummary.id, currentVendor.vendorId)
          : queryKeys.orders.list(currentVendor.vendorId),
      ],
    },
  );
  const isLabelActionPending = isCreatingShipmentLabel || isRetryingShipmentLabel;

  const summary = useMemo(() => {
    const source = orders ?? [];
    return {
      total: source.length,
      awaitingShipment: source.filter((order) => order.shippingStatus === 'Awaiting Shipment').length,
      trackingMissing: source.filter((order) => !order.trackingNumber && !order.carrier).length,
      blocked: source.filter((order) => order.allocationStatus === 'pending_reassignment' || order.allocationStatus === 'vendor_blocked').length,
      fulfilled: source.filter((order) => order.fulfillmentStatus === 'Fulfilled').length,
      tracked: source.filter((order) => order.trackingNumber || order.carrier).length,
    };
  }, [orders]);

  const orderKpis = [
    { label: 'Total orders', value: summary.total, detail: 'Current vendor scope', tone: 'orders', trend: 'Live queue' },
    { label: 'Awaiting shipment', value: summary.awaitingShipment, detail: 'Needs fulfillment progress', tone: 'awaiting', trend: formatMetricShare(summary.awaitingShipment, summary.total) },
    { label: 'Tracking missing', value: summary.trackingMissing, detail: 'No carrier evidence yet', tone: 'missing', trend: formatMetricShare(summary.trackingMissing, summary.total) },
    { label: 'Fulfilled', value: summary.fulfilled, detail: 'Fulfillment complete', tone: 'fulfilled', trend: formatMetricShare(summary.fulfilled, summary.total) },
    { label: 'Tracking visible', value: summary.tracked, detail: 'Carrier or tracking present', tone: 'tracking', trend: formatMetricShare(summary.tracked, summary.total) },
  ];

  const recentOrders = filteredOrders.slice(0, 3);

  const quickFilters: Array<{ key: OrderQuickFilter; label: string; count: number }> = [
    { key: 'all', label: 'All orders', count: orders?.length ?? 0 },
    { key: 'awaiting', label: 'Awaiting shipment', count: summary.awaitingShipment },
    { key: 'tracking_missing', label: 'Tracking missing', count: summary.trackingMissing },
    { key: 'high_value', label: 'High value', count: (orders ?? []).filter((order) => parseOperationalAmount(order.amount) >= 3000).length },
    { key: 'returns', label: 'Returns', count: (orders ?? []).filter((order) => `${order.status} ${order.shippingStatus}`.toLowerCase().includes('return')).length },
  ];

  async function handleSmartLabelAction(order: OrderSummary | OrderDetail) {
    const shipmentExecution = (order as OrderDetail).shipmentExecution;
    const labelUrl = shipmentExecution?.labelUrl ?? null;

    if (labelUrl) {
      globalThis.open?.(labelUrl, '_blank', 'noopener,noreferrer');
      setLabelActionFeedback({ tone: 'success', message: 'Existing label opened. No duplicate shipment was created.' });
      return;
    }

    if (shipmentExecution) {
      if (shipmentExecution.shipmentStatus === 'failed') {
        try {
          setLabelActionFeedback(null);
          const shipment = await retryShipmentLabelMutation(shipmentExecution.id);
          if (shipment.labelUrl) {
            globalThis.open?.(shipment.labelUrl, '_blank', 'noopener,noreferrer');
            setLabelActionFeedback({ tone: 'success', message: 'Shipment label created and opened.' });
          } else {
            setLabelActionFeedback({ tone: 'warning', message: 'Shipment retry completed. Label is still processing.' });
          }
          await orderDetailQuery.refetch();
        } catch (mutationError) {
          const message = mutationError instanceof Error ? mutationError.message : 'Shipment label could not be created.';
          setLabelActionFeedback({ tone: 'error', message });
        }
        return;
      }

      setLabelActionFeedback({
        tone: 'warning',
        message: 'Shipment exists, but the label is not available yet.',
      });
      return;
    }

    try {
      setLabelActionFeedback(null);
      const shipment = await createShipmentMutation(order.id);
      if (shipment.labelUrl) {
        globalThis.open?.(shipment.labelUrl, '_blank', 'noopener,noreferrer');
        setLabelActionFeedback({ tone: 'success', message: 'Shipment label created and opened.' });
      } else {
        setLabelActionFeedback({ tone: 'warning', message: 'Shipment was created. Label is still processing.' });
      }
      await orderDetailQuery.refetch();
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : 'Shipment label could not be created.';
      setLabelActionFeedback({ tone: 'error', message });
    }
  }

  function getSmartLabelButtonText(shipmentExecution?: ShipmentExecution | null) {
    if (isLabelActionPending) {
      return 'Etiket oluşturuluyor...';
    }
    if (shipmentExecution?.labelUrl) {
      return 'Etiketi yazdır';
    }
    if (shipmentExecution?.shipmentStatus === 'failed' || labelActionFeedback?.tone === 'error') {
      return 'Tekrar dene';
    }
    return 'Kargo etiketi yazdır';
  }

  return (
    <section className="op-page orders-control-center orders-enterprise-workspace">
      <div className="orders-workspace-shell">
        <div className="orders-compact-header">
          <div>
            <div className="orders-title-row">
              <h2>Orders</h2>
              <StatusBadge tone="info">{currentVendor.vendorName}</StatusBadge>
            </div>
            <p>Manage shipments and tracking</p>
          </div>
          <div className="op-heading-meta">
            <StatusBadge tone={summary.blocked > 0 ? 'warning' : 'success'}>{summary.blocked} attention</StatusBadge>
          </div>
        </div>

        <div className="op-control-layout orders-control-layout orders-workspace-grid">
          <div className="orders-left-column">
            <div className="orders-enterprise-kpis" aria-label="Orders operational metrics">
              {orderKpis.map((metric) => (
                <article key={metric.label} className={`orders-enterprise-kpi orders-kpi-${metric.tone}`}>
                  <span className="orders-kpi-icon" aria-hidden="true">
                    <MetricIcon tone={metric.tone} />
                  </span>
                  <div className="orders-kpi-copy">
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <small>{metric.detail}</small>
                  </div>
                  <div className="orders-kpi-signal">
                    <small>{metric.trend}</small>
                    <MetricSparkline tone={metric.tone} />
                  </div>
                </article>
              ))}
            </div>

            <div className="orders-filter-card">
              <OperationalToolbar>
                <SearchInput
                  placeholder="Search order, customer, tracking, carrier..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
                <FilterBar>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="all">All allocation states</option>
                    <option value="active">Active</option>
                    <option value="pending_reassignment">Pending reassignment</option>
                    <option value="vendor_blocked">Vendor blocked</option>
                    <option value="fulfilled">Fulfilled allocation</option>
                  </select>
                  <select value={fulfillmentFilter} onChange={(event) => setFulfillmentFilter(event.target.value)}>
                    <option value="all">All fulfillment</option>
                    <option value="Pending">Pending</option>
                    <option value="Processing">Processing</option>
                    <option value="Partially Fulfilled">Partially fulfilled</option>
                    <option value="Fulfilled">Fulfilled</option>
                  </select>
                  <select value={shippingFilter} onChange={(event) => setShippingFilter(event.target.value)}>
                    <option value="all">All shipping</option>
                    <option value="Awaiting Shipment">Awaiting shipment</option>
                    <option value="Label Created">Label created</option>
                    <option value="In Transit">In transit</option>
                    <option value="Delivered">Delivered</option>
                  </select>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      setSearchTerm('');
                      setStatusFilter('all');
                      setFulfillmentFilter('all');
                      setShippingFilter('all');
                      setQuickFilter('all');
                    }}
                  >
                    Filters
                  </button>
                </FilterBar>
              </OperationalToolbar>

              <div className="orders-filter-summary" aria-label="Order quick filters">
                {quickFilters.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className={quickFilter === filter.key ? 'is-active' : ''}
                    onClick={() => setQuickFilter(filter.key)}
                  >
                    {filter.label}
                    <strong>{filter.count}</strong>
                  </button>
                ))}
              </div>
            </div>

            <div className="op-main-column orders-table-shell">
              <OperationalTable
                columns={['Order', 'Status', 'Tracking', 'Value', 'Updated', 'Actions']}
                className="orders-op-table orders-op-table-v3"
              >
                {isError && !orders ? (
                  <OperationalTableRow>
                    <SectionErrorRetry
                      title="Orders unavailable"
                      description={error ?? 'Unable to load orders.'}
                      onRetry={() => void refetch()}
                    />
                  </OperationalTableRow>
                ) : !authContextReady || isLoading ? (
                  <TableSkeletonRows columns={6} rows={5} />
                ) : filteredOrders.length === 0 ? (
                  <OperationalTableRow>
                    <EmptyStatePanel
                      title="No orders in this view"
                      description="Adjust the search or filters to inspect vendor-scoped Shopify orders."
                    />
                  </OperationalTableRow>
                ) : filteredOrders.map((order) => {
                  const lifecyclePrimary = getLifecyclePrimaryLabel(order);
                  const lifecycleSecondary = getLifecycleSecondaryLabel(order);
                  const shippingOperational = getShippingOperationalLabel(order);
                  return (
                    <OperationalTableRow
                      key={order.id}
                      selected={selectedOrderSummary?.id === order.id}
                      onSelect={() => setSelectedOrderId(order.id)}
                    >
                      <span className="orders-table-order-cell">
                        <strong>{formatShopifyOrderNumber(order.sourceShopifyOrderNumber)}</strong>
                        <small>{getCustomerLabel(order.customer)}</small>
                        <small>{currentVendor.vendorName} · {order.channel}</small>
                      </span>
                      <div className="orders-table-status-cell">
                        <StatusBadge tone={getStatusTone(lifecyclePrimary)}>{lifecyclePrimary}</StatusBadge>
                        {lifecycleSecondary ? <small>{lifecycleSecondary}</small> : null}
                      </div>
                      <span className={`orders-table-shipping-cell orders-table-shipping-${shippingOperational.tone}`}>
                        <strong>{shippingOperational.label}</strong>
                        {shippingOperational.helper ? <small>{shippingOperational.helper}</small> : null}
                      </span>
                      <span>
                        <strong className="finance-amount-emphasis">{order.amount}</strong>
                        <small>{getLineItemCount(order)} line items</small>
                      </span>
                      <span>
                        <strong>{formatDate(order.shipmentUpdatedAt ?? order.fulfilledAt ?? order.date)}</strong>
                        <small>{order.channel}</small>
                      </span>
                      <OperationalActionGroup>
                        <Link className="button button-primary" to={`/orders/${order.id}`} onClick={(event) => event.stopPropagation()}>
                          Open detail
                        </Link>
                      </OperationalActionGroup>
                    </OperationalTableRow>
                  );
                })}
              </OperationalTable>
            </div>
          </div>

          <SideDetailPanel
            eyebrow={selectedOrder ? currentVendor.vendorName : 'Order detail'}
            title={selectedOrder ? formatShopifyOrderNumber(selectedOrder.sourceShopifyOrderNumber) : 'No order selected'}
            action={selectedOrder ? <Link className="button button-secondary" to={`/orders/${selectedOrder.id}`}>Open canonical detail</Link> : null}
          >
          {selectedOrder ? (
            (() => {
              const shippingOperational = getShippingOperationalLabel(selectedOrder);
              const shopifyFulfillmentState = getShopifyFulfillmentRailLabel(selectedOrder);
              const shipmentExecution = (selectedOrder as OrderDetail).shipmentExecution;
              const trackingLabel = selectedOrder.trackingNumber
                ? selectedOrder.trackingNumber
                : shipmentExecution?.trackingNumber ?? '—';
              const trackingUrl = selectedOrder.trackingUrl ?? shipmentExecution?.trackingUrl ?? null;
              const labelUrl = shipmentExecution?.labelUrl ?? null;
              const smartLabelDisabled = isLabelActionPending || Boolean(shipmentExecution && !shipmentExecution.labelUrl && shipmentExecution.shipmentStatus !== 'failed');
              const warehouseId = shipmentExecution?.warehouseId ?? '—';
              const lastUpdate = selectedOrder.shipmentUpdatedAt ?? shipmentExecution?.lastProviderResponseAt ?? selectedOrder.fulfilledAt ?? selectedOrder.date;
              const timelineItems: Array<{ label: string; at?: string | null; detail?: string }> = [
                { label: 'Order received', at: formatDate(selectedOrder.date) },
              ];
              if (selectedOrder.shipmentCreatedAt) {
                timelineItems.push({ label: 'Shipment created', at: formatDate(selectedOrder.shipmentCreatedAt) });
              }
              if (selectedOrder.trackingNumber) {
                timelineItems.push({ label: 'Tracking assigned', detail: getTrackingLabel(selectedOrder) });
              }
              if (shopifyFulfillmentState === 'Synced' || selectedOrder.fulfilledAt) {
                timelineItems.push({
                  label: 'Fulfillment synced',
                  at: selectedOrder.fulfilledAt ? formatDate(selectedOrder.fulfilledAt) : undefined,
                  detail: shopifyFulfillmentState,
                });
              }

              return (
            <>
              <div className="orders-detail-rail-header">
                <div className="orders-detail-rail-badges">
                  <StatusBadge tone={getStatusTone(selectedOrder.allocationStatus)}>{selectedOrder.allocationStatus.replace(/_/g, ' ')}</StatusBadge>
                  <StatusBadge tone={getStatusTone(selectedOrder.fulfillmentStatus)}>{selectedOrder.fulfillmentStatus}</StatusBadge>
                </div>
              </div>

              <div className={`orders-detail-status-strip orders-detail-status-${shippingOperational.tone}`}>
                <strong>{selectedOrder.shippingStatus}</strong>
                <span>{shippingOperational.label}</span>
                <span>Shopify {shopifyFulfillmentState.toLowerCase()}</span>
              </div>

              <section className="orders-smart-label-card" aria-label="Smart label action">
                <button
                  type="button"
                  className="orders-smart-label-button"
                  disabled={smartLabelDisabled}
                  onClick={() => void handleSmartLabelAction(selectedOrder)}
                >
                  <span className="orders-smart-label-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M7 8V4h10v4" />
                      <path d="M7 17H5a2 2 0 0 1-2-2v-4a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v4a2 2 0 0 1-2 2h-2" />
                      <path d="M7 14h10v6H7z" />
                      <path d="M17 11h.01" />
                    </svg>
                  </span>
                  <span>
                    <strong>{getSmartLabelButtonText(shipmentExecution)}</strong>
                    <small>
                      {labelUrl
                        ? 'Open existing label without creating a duplicate.'
                        : shipmentExecution
                          ? 'Shipment exists. Label availability is controlled by the provider.'
                          : 'Create shipment and open label when available.'}
                    </small>
                  </span>
                  <span className="orders-smart-label-arrow" aria-hidden="true">›</span>
                </button>
                {labelActionFeedback ? (
                  <p className={`orders-smart-label-feedback orders-smart-label-${labelActionFeedback.tone}`}>
                    {labelActionFeedback.message}
                  </p>
                ) : null}
              </section>

              <section className="orders-detail-card">
                <h4>Fulfillment and shipping</h4>
                <div className="orders-rail-summary-list">
                  <div>
                    <span>Provider</span>
                    <strong>{getRailProviderLabel(selectedOrder)}</strong>
                  </div>
                  <div>
                    <span>Tracking</span>
                    <strong>{trackingUrl ? <a className="inline-link" href={trackingUrl}>Open tracking</a> : trackingLabel}</strong>
                  </div>
                  <div>
                    <span>Shopify sync</span>
                    <strong>{shopifyFulfillmentState}</strong>
                  </div>
                  <div>
                    <span>Label</span>
                    <strong>{labelUrl ? <a className="inline-link" href={labelUrl}>Open label</a> : 'Unavailable'}</strong>
                  </div>
                  <div>
                    <span>Last update</span>
                    <strong>{formatDate(lastUpdate)}</strong>
                  </div>
                </div>
              </section>

              <section className="orders-detail-card">
                <h4>Line items</h4>
                {(selectedOrder as OrderDetail).lineItems?.length ? (
                  <div className="order-detail-items">
                    {(selectedOrder as OrderDetail).lineItems.map((item) => (
                      <article key={item.id} className="order-detail-item">
                        <span className="order-detail-thumb" aria-hidden="true">{getItemInitials(item.name)}</span>
                        <div className="order-detail-item-copy">
                          <strong>{item.name}</strong>
                          <small>{item.sku} · {item.variantTitle}</small>
                        </div>
                        <div className="return-detail-item-meta">
                          <span>Qty {item.quantity}</span>
                          <span>{item.price}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="page-description">No line items synced.</p>
                )}
              </section>

              <section className="orders-detail-card">
                <h4>Operational timeline</h4>
                <TimelineBlock items={timelineItems} />
              </section>

              {isAdmin ? (
                <details className="orders-detail-card orders-rail-diagnostics">
                  <summary>Internal metadata</summary>
                  <div className="orders-rail-summary-list">
                    <div>
                      <span>Allocation</span>
                      <strong>{selectedOrder.id}</strong>
                    </div>
                    <div>
                      <span>Shopify ID</span>
                      <strong>{selectedOrder.sourceShopifyOrderId}</strong>
                    </div>
                    <div>
                      <span>Customer scope</span>
                      <strong>{getCustomerLabel(selectedOrder.customer)}</strong>
                    </div>
                    <div>
                      <span>Warehouse</span>
                      <strong>{warehouseId}</strong>
                    </div>
                    <div>
                      <span>Source</span>
                      <strong>{selectedOrder.channel}</strong>
                    </div>
                    <div>
                      <span>Tracking source</span>
                      <strong>{getTrackingLabel(selectedOrder)}</strong>
                    </div>
                  </div>
                </details>
              ) : null}
            </>
              );
            })()
          ) : !authContextReady || isLoading ? (
            <SectionSkeleton title="Loading order detail" description="Order detail will hydrate after the list finishes loading." />
          ) : (
            <EmptyStatePanel
              title={hasRequestedOrderTarget ? 'Linked order unavailable' : 'Select an order'}
              description={
                hasRequestedOrderTarget
                  ? 'The linked order is not available in the current vendor scope.'
                  : 'Choose an order to inspect allocation, fulfillment, and tracking context.'
              }
            />
          )}
          </SideDetailPanel>
        </div>

        <div className="orders-insights-grid">
          <OperationalSection title="Operational insights" description="Current vendor-scoped order signals.">
            <div className="orders-insight-list">
              <div>
                <span>Awaiting shipment</span>
                <strong>{summary.awaitingShipment}</strong>
              </div>
              <div>
                <span>Blocked / attention</span>
                <strong>{summary.blocked}</strong>
              </div>
              <div>
                <span>Tracking visible</span>
                <strong>{summary.tracked}</strong>
              </div>
            </div>
          </OperationalSection>

          <OperationalSection title="Recent order activity" description="Latest orders in the current filtered view.">
            {recentOrders.length ? (
              <div className="orders-activity-list">
                {recentOrders.map((order) => (
                  <div key={order.id} className="orders-activity-row">
                    <span className="orders-activity-dot" aria-hidden="true" />
                    <div>
                      <strong>{formatShopifyOrderNumber(order.sourceShopifyOrderNumber)}</strong>
                      <small>{order.shippingStatus} · {formatDate(order.shipmentUpdatedAt ?? order.fulfilledAt ?? order.date)}</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyStatePanel title="No records available" description="No records available." />
            )}
          </OperationalSection>

          <OperationalSection title="Automation signals" description="Order conditions that may need operator attention.">
            <div className="orders-insight-list">
              <div>
                <span>Reassignment or vendor block</span>
                <strong>{summary.blocked}</strong>
              </div>
              <div>
                <span>Awaiting shipment</span>
                <strong>{summary.awaitingShipment}</strong>
              </div>
              <div>
                <span>Current view</span>
                <strong>{filteredOrders.length}</strong>
              </div>
            </div>
          </OperationalSection>
        </div>
      </div>
    </section>
  );
}
