import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  EmptyStatePanel,
  FilterBar,
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
  WorkflowActionGuidance,
} from '../components/OperationalPrimitives';
import { ProductImagePreview } from '../components/ProductImagePreview';
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
import { formatCurrency, formatDateTime, getSafeTimestamp, safeArray, safeStatusLabel } from '../services/real/formatting';
import { getOrderWorkflowAction } from '../lib/workflowActionGuidance';

type OrderQuickFilter = 'all' | 'blocked' | 'awaiting' | 'tracking_missing' | 'high_value' | 'returns';
type LabelActionFeedback = {
  tone: 'success' | 'warning' | 'error';
  message: string;
};

function formatDate(value?: string | null) {
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }, 'Not synced');
}

function getSnapshotCurrency(order: OrderSummary | OrderDetail) {
  return (order as OrderDetail).orderSnapshot?.currency || 'TRY';
}

function formatSnapshotValue(value: string | null | undefined) {
  return value?.trim() || '—';
}

function formatSnapshotAmount(value: string | null | undefined, currency: string) {
  return value === null || value === undefined || value === '' ? '—' : formatCurrency(value, currency);
}

function formatVatRate(value: string | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toLocaleString('en-US')}%` : value;
}

function formatBillingAddress(address: NonNullable<OrderDetail['orderSnapshot']>['billingAddress'] | null | undefined) {
  if (!address) {
    return '—';
  }

  return [address.fullName, address.company, address.phone, address.address1, address.address2, address.district, address.city, address.postcode]
    .filter((part) => part?.trim())
    .join(' · ') || '—';
}

function getStatusTone(status: string | null | undefined) {
  const normalized = status?.toLowerCase() ?? '';
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

function orderNeedsAction(order: OrderSummary) {
  return (
    order.allocationStatus === 'vendor_blocked' ||
    order.allocationStatus === 'pending_reassignment' ||
    order.shippingStatus === 'Awaiting Shipment' ||
    !order.trackingNumber && !order.carrier
  );
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
    return safeStatusLabel(order.allocationStatus);
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

function getLineItemImageAlt(item: OrderDetail['lineItems'][number]) {
  return item.name ? `${item.name} product image` : item.sku ? `${item.sku} product image` : 'Product image';
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

function MetricIcon({ tone }: { tone: string }) {
  if (tone === 'blocked') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4 4 19h16L12 4z" />
        <path d="M12 9v4" />
        <path d="M12 16h.01" />
      </svg>
    );
  }
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

function getOrdersWorkflowFilter(workflow: string | null) {
  if (workflow === 'blocked-allocation') {
    return {
      label: 'Blocked allocation',
      description: 'Showing orders with blocked or reassignment-needed vendor allocations.',
      emptyTitle: 'No blocked allocations currently need action',
      emptyDescription: 'This workflow queue is clear for the current vendor scope. Clear the workflow to review all orders.',
      quickFilter: 'blocked' as OrderQuickFilter,
    };
  }
  if (workflow === 'awaiting-shipment') {
    return {
      label: 'Awaiting shipment',
      description: 'Showing orders that need shipment creation or provider progress.',
      emptyTitle: 'No shipments currently awaiting action',
      emptyDescription: 'This workflow queue is clear for the current vendor scope. Clear the workflow to review all orders.',
      quickFilter: 'awaiting' as OrderQuickFilter,
    };
  }
  if (workflow === 'stale-fulfillment') {
    return {
      label: 'Stale fulfillment',
      description: 'Showing fulfillment work that still needs shipment progress.',
      emptyTitle: 'No stale fulfillment work in this queue',
      emptyDescription: 'No stale fulfillment items match this workflow right now. Clear the workflow to inspect the full orders list.',
      quickFilter: 'awaiting' as OrderQuickFilter,
    };
  }
  if (workflow === 'tracking-missing') {
    return {
      label: 'Tracking missing',
      description: 'Showing orders without carrier or tracking evidence.',
      emptyTitle: 'No orders missing tracking',
      emptyDescription: 'Tracking evidence is present for the current workflow queue. Clear the workflow to review all orders.',
      quickFilter: 'tracking_missing' as OrderQuickFilter,
    };
  }
  return null;
}

export function OrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const appReadiness = useAppReadiness();
  const currentVendor = appReadiness.currentVendor;
  const currentUser = appReadiness.currentUser;
  const authContextReady = appReadiness.ready;
  const isAdmin = currentUser?.role === 'admin';
  const { data: orders, isLoading, isError, error, diagnostics, refetch } = useQueryResource(
    queryKeys.orders.list(currentVendor.vendorId),
    ({ signal }) => listOrders({ vendorId: currentVendor.vendorId, signal }),
    { enabled: authContextReady && Boolean(currentVendor.vendorId) },
  );
  const ordersMissingVendorContext = appReadiness.status === 'missing_vendor_context';
  const ordersWaitingForVendorContext = !ordersMissingVendorContext && (!authContextReady || !currentVendor.vendorId);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [fulfillmentFilter, setFulfillmentFilter] = useState('all');
  const [shippingFilter, setShippingFilter] = useState('all');
  const [quickFilter, setQuickFilter] = useState<OrderQuickFilter>('all');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [labelActionFeedback, setLabelActionFeedback] = useState<LabelActionFeedback | null>(null);
  const activeWorkflowFilter = useMemo(() => getOrdersWorkflowFilter(searchParams.get('workflow')), [searchParams]);
  const requestedOrderTargets = useMemo(() => getRequestedOrderTargets(searchParams), [searchParams]);
  const hasRequestedOrderTarget = requestedOrderTargets.length > 0;
  const requestedOrderTargetKey = requestedOrderTargets.join('|');

  useEffect(() => {
    setSelectedOrderId(null);
  }, [requestedOrderTargetKey]);

  function clearWorkflowFilter() {
    if (!searchParams.has('workflow')) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('workflow');
    setSearchParams(nextParams, { replace: true });
  }

  function handleResetFilters() {
    clearWorkflowFilter();
    setSearchTerm('');
    setStatusFilter('all');
    setFulfillmentFilter('all');
    setShippingFilter('all');
    setQuickFilter('all');
  }

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

    return safeArray(orders).sort((a, b) => {
      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return getSafeTimestamp(b.date, 0) - getSafeTimestamp(a.date, 0);
    });
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const effectiveQuickFilter = activeWorkflowFilter?.quickFilter ?? quickFilter;

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
        effectiveQuickFilter === 'all' ||
        (effectiveQuickFilter === 'blocked' && (order.allocationStatus === 'vendor_blocked' || order.allocationStatus === 'pending_reassignment')) ||
        (effectiveQuickFilter === 'awaiting' && order.shippingStatus === 'Awaiting Shipment') ||
        (effectiveQuickFilter === 'tracking_missing' && !order.trackingNumber && !order.carrier) ||
        (effectiveQuickFilter === 'high_value' && parseOperationalAmount(order.amount) >= 3000) ||
        (effectiveQuickFilter === 'returns' && searchableText.includes('return'));

      return matchesStatus && matchesFulfillment && matchesShipping && matchesQuickFilter && (!query || searchableText.includes(query));
    });
  }, [activeWorkflowFilter, currentVendor.vendorId, currentVendor.vendorName, fulfillmentFilter, quickFilter, rankedOrders, searchTerm, shippingFilter, statusFilter]);

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
    const source = safeArray(orders);
    return {
      total: source.length,
      awaitingShipment: source.filter((order) => order.shippingStatus === 'Awaiting Shipment').length,
      trackingMissing: source.filter((order) => !order.trackingNumber && !order.carrier).length,
      blocked: source.filter((order) => order.allocationStatus === 'pending_reassignment' || order.allocationStatus === 'vendor_blocked').length,
      fulfilled: source.filter((order) => order.fulfillmentStatus === 'Fulfilled').length,
      tracked: source.filter((order) => order.trackingNumber || order.carrier).length,
    };
  }, [orders]);

  const recentOrders = filteredOrders.slice(0, 3);
  const needsActionOrders = filteredOrders.filter(orderNeedsAction);
  const inFlowOrders = filteredOrders.filter((order) => !orderNeedsAction(order));

  const latestOperationalTimestamp = useMemo(() => {
    const timestamps = safeArray(orders)
      .map((order) => getSafeTimestamp(order.shipmentUpdatedAt ?? order.fulfilledAt ?? order.date, 0))
      .filter((value) => value > 0);
    return timestamps.length ? Math.max(...timestamps) : 0;
  }, [orders]);
  const latestOperationalDate = latestOperationalTimestamp ? new Date(latestOperationalTimestamp).toISOString() : null;
  const latestOperationalLabel = latestOperationalDate ? formatDate(latestOperationalDate) : 'Not synced';

  const priorityQueues = [
    {
      key: 'awaiting' as OrderQuickFilter,
      label: 'Shipment queue',
      value: summary.awaitingShipment,
      detail: 'Awaiting shipment',
      tone: 'awaiting',
    },
    {
      key: 'blocked' as OrderQuickFilter,
      label: 'Allocation issues',
      value: summary.blocked,
      detail: 'Needs attention',
      tone: 'blocked',
    },
    {
      key: 'tracking_missing' as OrderQuickFilter,
      label: 'Tracking sync',
      value: summary.trackingMissing,
      detail: 'Missing or failed',
      tone: 'missing',
    },
  ];

  const operationsHealth = [
    {
      label: 'Shopify sync',
      state: diagnostics ? 'Check API' : 'Synced',
      detail: diagnostics?.status ? `HTTP ${diagnostics.status}` : 'Canonical data',
      age: latestOperationalLabel,
      tone: diagnostics ? 'warning' : 'success',
    },
    {
      label: 'Provider status',
      state: summary.trackingMissing ? 'Provider pending' : 'Healthy',
      detail: `${summary.trackingMissing} missing tracking`,
      age: `${summary.tracked} tracked`,
      tone: summary.trackingMissing ? 'warning' : 'success',
    },
    {
      label: 'Reconciliation',
      state: activeWorkflowFilter ? 'Filtered' : 'Fresh',
      detail: activeWorkflowFilter?.label ?? `${filteredOrders.length} visible orders`,
      age: `${summary.total} in scope`,
      tone: 'info',
    },
  ];

  const quickFilters: Array<{ key: OrderQuickFilter; label: string; count: number }> = [
    { key: 'all', label: 'All orders', count: orders?.length ?? 0 },
    { key: 'blocked', label: 'Blocked', count: summary.blocked },
    { key: 'awaiting', label: 'Awaiting shipment', count: summary.awaitingShipment },
    { key: 'tracking_missing', label: 'Tracking missing', count: summary.trackingMissing },
    { key: 'high_value', label: 'High value', count: safeArray(orders).filter((order) => parseOperationalAmount(order.amount) >= 3000).length },
    { key: 'returns', label: 'Returns', count: safeArray(orders).filter((order) => `${order.status} ${order.shippingStatus}`.toLowerCase().includes('return')).length },
  ];
  const effectiveQuickFilter = activeWorkflowFilter?.quickFilter ?? quickFilter;

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
      return 'Creating shipment...';
    }
    if (shipmentExecution?.labelUrl) {
      return 'Print label';
    }
    if (shipmentExecution?.shipmentStatus === 'failed' || labelActionFeedback?.tone === 'error') {
      return 'Retry shipment';
    }
    return 'Create shipment';
  }

  function renderOrderRow(order: OrderSummary) {
    const lifecyclePrimary = getLifecyclePrimaryLabel(order);
    const lifecycleSecondary = getLifecycleSecondaryLabel(order);
    const shippingOperational = getShippingOperationalLabel(order);
    const trackingPresent = Boolean(order.trackingNumber || order.carrier);

    return (
      <OperationalTableRow
        key={order.id}
        selected={selectedOrderSummary?.id === order.id}
        onSelect={() => setSelectedOrderId(order.id)}
      >
        <span className="orders-table-order-cell">
          <strong>{formatShopifyOrderNumber(order.sourceShopifyOrderNumber)}</strong>
          <small>{formatDate(order.date)}</small>
        </span>
        <span className="orders-table-allocation-cell">
          <strong>{currentVendor.vendorName}</strong>
          <small>{safeStatusLabel(order.allocationStatus)}</small>
        </span>
        <span className="orders-table-customer-cell">
          <strong>{getCustomerLabel(order.customer)}</strong>
          <small>{order.channel}</small>
        </span>
        <div className="orders-table-status-cell">
          <StatusBadge tone={getStatusTone(lifecyclePrimary)}>{lifecyclePrimary}</StatusBadge>
          {lifecycleSecondary ? <small>{lifecycleSecondary}</small> : null}
        </div>
        <span className={`orders-table-shipping-cell orders-table-shipping-${shippingOperational.tone}`}>
          <strong>{shippingOperational.label}</strong>
          {shippingOperational.helper ? <small>{shippingOperational.helper}</small> : null}
        </span>
        <span className="orders-table-tracking-cell">
          <StatusBadge tone={trackingPresent ? 'info' : 'danger'}>
            {trackingPresent ? 'Tracking synced' : 'Tracking missing'}
          </StatusBadge>
          <small>{trackingPresent ? getTrackingLabel(order) : 'Carrier evidence pending'}</small>
        </span>
        <span className="orders-table-amount-cell">
          <strong className="finance-amount-emphasis">{order.amount}</strong>
          <small>{getLineItemCount(order)} line items</small>
        </span>
      </OperationalTableRow>
    );
  }

  return (
    <section className="op-page orders-control-center orders-enterprise-workspace">
      <div className="orders-workspace-shell">
        <div className="orders-command-header">
          <div className="orders-command-title">
            <h2>Orders</h2>
            <p>Allocation-scoped order operations, fulfillment progress, and tracking sync.</p>
          </div>
          <div className="orders-context-strip" aria-label="Orders workspace context">
            <div className="orders-context-card">
              <span>Vendor scope</span>
              <strong>{currentVendor.vendorName}</strong>
            </div>
            <div className="orders-context-card orders-context-good">
              <span>Shopify canonical</span>
              <strong>{diagnostics ? 'Review API' : 'Synced'}</strong>
            </div>
            <div className="orders-context-card">
              <span>Last queue update</span>
              <strong>{latestOperationalLabel}</strong>
            </div>
          </div>
        </div>

        <section className="orders-priority-band" aria-label="Orders operational metrics">
          <div className="orders-work-priority">
            <div className="orders-band-heading">
              <h3>Work priority</h3>
              <span>{needsActionOrders.length} needs action</span>
            </div>
            <div className="orders-priority-grid">
              {priorityQueues.map((queue) => (
                <button
                  key={queue.key}
                  type="button"
                  className={`orders-priority-card orders-priority-${queue.tone} ${effectiveQuickFilter === queue.key ? 'is-active' : ''}`}
                  onClick={() => {
                    clearWorkflowFilter();
                    setQuickFilter(queue.key);
                  }}
                >
                  <span className="orders-priority-icon" aria-hidden="true">
                    <MetricIcon tone={queue.tone} />
                  </span>
                  <span>
                    <strong>{queue.label}</strong>
                    <small>{queue.detail}</small>
                  </span>
                  <b>{queue.value}</b>
                </button>
              ))}
            </div>
          </div>
          <div className="orders-health-panel">
            <div className="orders-band-heading">
              <h3>Operations health</h3>
              <button type="button" className="orders-link-button" onClick={() => void refetch()}>
                Refresh
              </button>
            </div>
            <div className="orders-health-list">
              {operationsHealth.map((item) => (
                <div key={item.label} className="orders-health-row">
                  <span className={`orders-health-dot orders-health-${item.tone}`} aria-hidden="true" />
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </div>
                  <span>{item.state}</span>
                  <small>{item.age}</small>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="orders-filter-card">
              <OperationalToolbar>
                <SearchInput
                  placeholder="Search order, customer, tracking, carrier..."
                  value={searchTerm}
                  onChange={(event) => {
                    clearWorkflowFilter();
                    setSearchTerm(event.target.value);
                  }}
                />
                <FilterBar>
                  <select
                    value={statusFilter}
                    onChange={(event) => {
                      clearWorkflowFilter();
                      setStatusFilter(event.target.value);
                    }}
                  >
                    <option value="all">All allocation states</option>
                    <option value="active">Active</option>
                    <option value="pending_reassignment">Pending reassignment</option>
                    <option value="vendor_blocked">Vendor blocked</option>
                    <option value="fulfilled">Fulfilled allocation</option>
                  </select>
                  <select
                    value={fulfillmentFilter}
                    onChange={(event) => {
                      clearWorkflowFilter();
                      setFulfillmentFilter(event.target.value);
                    }}
                  >
                    <option value="all">All fulfillment</option>
                    <option value="Pending">Pending</option>
                    <option value="Processing">Processing</option>
                    <option value="Partially Fulfilled">Partially fulfilled</option>
                    <option value="Fulfilled">Fulfilled</option>
                  </select>
                  <select
                    value={shippingFilter}
                    onChange={(event) => {
                      clearWorkflowFilter();
                      setShippingFilter(event.target.value);
                    }}
                  >
                    <option value="all">All shipping</option>
                    <option value="Awaiting Shipment">Awaiting shipment</option>
                    <option value="Label Created">Label created</option>
                    <option value="In Transit">In transit</option>
                    <option value="Delivered">Delivered</option>
                  </select>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={handleResetFilters}
                  >
                    Filters
                  </button>
                </FilterBar>
              </OperationalToolbar>

              {activeWorkflowFilter ? (
                <div className="workflow-filter-banner" aria-label="Active workflow filter">
                  <div>
                    <span>Workflow filter</span>
                    <strong>{activeWorkflowFilter.label}</strong>
                    <small>{activeWorkflowFilter.description}</small>
                  </div>
                  <button type="button" className="button button-secondary button-compact" onClick={handleResetFilters}>
                    Clear workflow
                  </button>
                </div>
              ) : null}

              <div className="orders-filter-summary" aria-label="Order quick filters">
                {quickFilters.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className={effectiveQuickFilter === filter.key ? 'is-active' : ''}
                    onClick={() => {
                      clearWorkflowFilter();
                      setQuickFilter(filter.key);
                    }}
                  >
                    {filter.label}
                    <strong>{filter.count}</strong>
                  </button>
                ))}
              </div>
            </div>

        <div className="op-control-layout orders-control-layout orders-workspace-grid">
          <div className="orders-left-column">
            <div className="op-main-column orders-table-shell">
              <OperationalTable
                columns={['Order', 'Vendor allocation', 'Customer', 'Fulfillment', 'Shipping', 'Tracking', 'Amount']}
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
                ) : ordersMissingVendorContext ? (
                  <OperationalTableRow>
                    <EmptyStatePanel
                      title="Select vendor"
                      description="Choose a vendor context before loading vendor-scoped orders."
                    />
                  </OperationalTableRow>
                ) : ordersWaitingForVendorContext ? (
                  <OperationalTableRow>
                    <EmptyStatePanel
                      title="Waiting for vendor context"
                      description="Orders will load after the authenticated vendor scope is ready."
                    />
                  </OperationalTableRow>
                ) : isLoading ? (
                  <TableSkeletonRows columns={7} rows={5} />
                ) : filteredOrders.length === 0 ? (
                  <OperationalTableRow>
                    <EmptyStatePanel
                      title={activeWorkflowFilter?.emptyTitle ?? 'No orders in this view'}
                      description={activeWorkflowFilter?.emptyDescription ?? 'Adjust the search or filters to inspect vendor-scoped Shopify orders.'}
                    />
                  </OperationalTableRow>
                ) : (
                  <>
                    {needsActionOrders.length ? (
                      <OperationalTableRow className="orders-group-row">
                        <span className="orders-group-label">Needs action ({needsActionOrders.length})</span>
                      </OperationalTableRow>
                    ) : null}
                    {needsActionOrders.map(renderOrderRow)}
                    {inFlowOrders.length ? (
                      <OperationalTableRow className="orders-group-row orders-group-row-muted">
                        <span className="orders-group-label">In flow ({inFlowOrders.length})</span>
                      </OperationalTableRow>
                    ) : null}
                    {inFlowOrders.map(renderOrderRow)}
                  </>
                )}
              </OperationalTable>
            </div>
          </div>

          <SideDetailPanel
            eyebrow="Action workspace"
            title={selectedOrder ? formatShopifyOrderNumber(selectedOrder.sourceShopifyOrderNumber) : 'No order selected'}
            action={selectedOrder ? <Link className="button button-secondary" to={`/orders/${selectedOrder.id}`}>View</Link> : null}
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
              const workflowGuidance = getOrderWorkflowAction({
                allocationStatus: selectedOrder.allocationStatus,
                shippingStatus: selectedOrder.shippingStatus,
                fulfillmentStatus: selectedOrder.fulfillmentStatus,
                trackingNumber: selectedOrder.trackingNumber ?? shipmentExecution?.trackingNumber,
                carrier: selectedOrder.carrier ?? shipmentExecution?.provider,
                hasShipment: Boolean(shipmentExecution),
                hasLabel: Boolean(labelUrl),
              });
              const railActionDescription =
                selectedOrder.allocationStatus === 'pending_reassignment' || selectedOrder.allocationStatus === 'vendor_blocked'
                  ? 'Resolve vendor scope before shipment work.'
                  : workflowGuidance.description;
              const smartLabelDisabled = isLabelActionPending || Boolean(shipmentExecution && !shipmentExecution.labelUrl && shipmentExecution.shipmentStatus !== 'failed');
              const warehouseId = shipmentExecution?.warehouseId ?? '—';
              const lastUpdate = selectedOrder.shipmentUpdatedAt ?? shipmentExecution?.lastProviderResponseAt ?? selectedOrder.fulfilledAt ?? selectedOrder.date;
              const orderSnapshot = (selectedOrder as OrderDetail).orderSnapshot ?? null;
              const snapshotCurrency = getSnapshotCurrency(selectedOrder);
              const railLineItems = safeArray((selectedOrder as OrderDetail).lineItems);
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
              <section className="orders-detail-card orders-recommended-action-card" aria-label="Smart label action">
                <div className="orders-recommended-body">
                  <span className="orders-smart-label-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M7 8V4h10v4" />
                      <path d="M7 17H5a2 2 0 0 1-2-2v-4a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v4a2 2 0 0 1-2 2h-2" />
                      <path d="M7 14h10v6H7z" />
                      <path d="M17 11h.01" />
                    </svg>
                  </span>
                  <WorkflowActionGuidance
                    actionLabel={workflowGuidance.actionLabel}
                    description={railActionDescription}
                    tone={workflowGuidance.tone}
                    title="Recommended next action"
                  >
                    <button
                      type="button"
                      className="orders-primary-action-button"
                      disabled={smartLabelDisabled}
                      onClick={() => void handleSmartLabelAction(selectedOrder)}
                    >
                      {getSmartLabelButtonText(shipmentExecution)}
                    </button>
                  </WorkflowActionGuidance>
                </div>
                <details className="orders-why-action">
                  <summary>Why this action?</summary>
                  <p>
                    {labelUrl
                        ? 'A provider label already exists for this allocation, so opening it avoids a duplicate shipment.'
                        : shipmentExecution
                          ? 'The shipment job already exists. The provider controls when tracking and label evidence becomes available.'
                          : railActionDescription}
                  </p>
                </details>
                {labelActionFeedback ? (
                  <p className={`orders-smart-label-feedback orders-smart-label-${labelActionFeedback.tone}`}>
                    {labelActionFeedback.message}
                  </p>
                ) : null}
              </section>

              <section className="orders-detail-card orders-allocation-card">
                <div className="orders-card-heading-row">
                  <h4>Allocation details</h4>
                  <Link className="orders-rail-link" to={`/orders/${selectedOrder.id}`}>Edit allocation</Link>
                </div>
                <div className="orders-allocation-grid">
                  <div>
                    <span>Vendor</span>
                    <strong>{currentVendor.vendorName}</strong>
                  </div>
                  <div>
                    <span>Allocation</span>
                    <strong>1 of {Math.max(getLineItemCount(selectedOrder), 1)}</strong>
                  </div>
                  <div>
                    <span>Allocation status</span>
                    <StatusBadge tone={getStatusTone(selectedOrder.allocationStatus)}>{safeStatusLabel(selectedOrder.allocationStatus)}</StatusBadge>
                  </div>
                  <div>
                    <span>Requested</span>
                    <strong>{formatDate(selectedOrder.date)}</strong>
                  </div>
                  <div>
                    <span>Allocated</span>
                    <strong>{formatDate(selectedOrder.shipmentCreatedAt ?? selectedOrder.date)}</strong>
                  </div>
                  <div>
                    <span>Source</span>
                    <strong>{selectedOrder.channel}</strong>
                  </div>
                </div>
              </section>

              <section className="orders-detail-card orders-line-items-card">
                <h4>Line items ({getLineItemCount(selectedOrder)})</h4>
                {railLineItems.length ? (
                  <div className="order-detail-items">
                    {railLineItems.slice(0, 1).map((item) => (
                      <article key={item.id} className="order-detail-item">
                        <ProductImagePreview
                          imageUrl={item.imageUrl}
                          fallbackLabel={getItemInitials(item.name || item.sku || 'Item')}
                          alt={getLineItemImageAlt(item)}
                          title={item.name || item.sku || 'Product image'}
                          subtitle={[item.sku, item.variantTitle].filter(Boolean).join(' · ')}
                          size="compact"
                        />
                        <div className="order-detail-item-copy">
                          <strong>{item.name}</strong>
                          <small>SKU: {item.sku}</small>
                        </div>
                        <div className="return-detail-item-meta">
                          <span>Qty {item.quantity}</span>
                          <span>{item.price}</span>
                        </div>
                        <details className="orders-line-item-audit">
                          <summary>Tax detail</summary>
                          <small>
                            {[
                              `VAT ${formatVatRate(item.vatRate)}`,
                              item.lineTaxAmount ? `VAT amount ${formatSnapshotAmount(item.lineTaxAmount, snapshotCurrency)}` : null,
                              `Unit price incl. VAT ${formatSnapshotAmount(item.unitPriceVatIncluded, snapshotCurrency)}`,
                              `Line total incl. VAT ${formatSnapshotAmount(item.lineTotalVatIncluded, snapshotCurrency)}`,
                              item.shopifyProductId ? `Shopify product ${item.shopifyProductId}` : null,
                            ].filter(Boolean).join(' · ')}
                          </small>
                        </details>
                      </article>
                    ))}
                    {railLineItems.length > 1 ? (
                      <div className="orders-line-items-more">
                        <span>{railLineItems.length - 1} more item{railLineItems.length - 1 === 1 ? '' : 's'}</span>
                        <Link className="orders-rail-link" to={`/orders/${selectedOrder.id}`}>View all</Link>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="page-description">No line items synced.</p>
                )}
              </section>

              <section className="orders-detail-card orders-support-card">
                <div className="orders-support-row">
                  <strong>Support & returns</strong>
                  <span>
                    <Link className="orders-rail-link" to={`/returns?order=${encodeURIComponent(String(selectedOrder.sourceShopifyOrderNumber))}`}>
                      View returns
                    </Link>
                    <Link className="orders-rail-link" to={`/support?order=${encodeURIComponent(String(selectedOrder.sourceShopifyOrderNumber))}`}>
                      Contact customer
                    </Link>
                  </span>
                </div>
              </section>

              <section className="orders-detail-card orders-timeline-card">
                <h4>Timeline</h4>
                <TimelineBlock items={timelineItems} />
              </section>

              <section className="orders-detail-card orders-fulfillment-card">
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

              <section className="orders-detail-card" aria-label="Integration snapshot">
                <h4>Integration Snapshot</h4>
                <div className="orders-rail-summary-list">
                  <div>
                    <span>Financial status</span>
                    <strong>{formatSnapshotValue(orderSnapshot?.financialStatus)}</strong>
                  </div>
                  <div>
                    <span>Payment gateway</span>
                    <strong>{formatSnapshotValue(orderSnapshot?.paymentGatewayName)}</strong>
                  </div>
                  <div>
                    <span>Vendor integration</span>
                    <strong>{formatSnapshotValue(orderSnapshot?.vendorIntegrationStatus)}</strong>
                  </div>
                  <div>
                    <span>Currency</span>
                    <strong>{formatSnapshotValue(orderSnapshot?.currency)}</strong>
                  </div>
                  {orderSnapshot?.orderTaxAmount ? (
                    <div>
                      <span>Tax total</span>
                      <strong>{formatSnapshotAmount(orderSnapshot.orderTaxAmount, snapshotCurrency)}</strong>
                    </div>
                  ) : null}
                  <div>
                    <span>Shipping</span>
                    <strong>{formatSnapshotAmount(orderSnapshot?.shippingAmount, snapshotCurrency)}</strong>
                  </div>
                  <div>
                    <span>Discount</span>
                    <strong>{formatSnapshotAmount(orderSnapshot?.discountAmount, snapshotCurrency)}</strong>
                  </div>
                  <div>
                    <span>Billing</span>
                    <strong>{formatBillingAddress(orderSnapshot?.billingAddress)}</strong>
                  </div>
                  {orderSnapshot?.vendorIntegrationTrackingUrl ? (
                    <div>
                      <span>External shipment</span>
                      <strong>
                        <a className="inline-link" href={orderSnapshot.vendorIntegrationTrackingUrl} target="_blank" rel="noreferrer">
                          Open external tracking
                        </a>
                      </strong>
                    </div>
                  ) : null}
                  {orderSnapshot?.vendorIntegrationShippedAt ? (
                    <div>
                      <span>External shipped at</span>
                      <strong>{formatDate(orderSnapshot.vendorIntegrationShippedAt)}</strong>
                    </div>
                  ) : null}
                </div>
              </section>

              {orderSnapshot?.vendorInvoiceNumber ? (
                <section className="orders-detail-card" aria-label="Vendor invoice">
                  <h4>Vendor Invoice</h4>
                  <div className="orders-rail-summary-list">
                    <div>
                      <span>Invoice Number</span>
                      <strong>{orderSnapshot.vendorInvoiceNumber}</strong>
                    </div>
                    <div>
                      <span>Invoice Date</span>
                      <strong>{orderSnapshot.vendorInvoiceDate ?? '—'}</strong>
                    </div>
                    <div>
                      <span>Invoice Amount</span>
                      <strong>{formatSnapshotAmount(orderSnapshot.vendorInvoiceAmount, snapshotCurrency)}</strong>
                    </div>
                    <div>
                      <span>Received At</span>
                      <strong>{orderSnapshot.vendorInvoiceReceivedAt ? formatDate(orderSnapshot.vendorInvoiceReceivedAt) : '—'}</strong>
                    </div>
                    {orderSnapshot.vendorInvoiceUrl ? (
                      <div>
                        <span>Invoice URL</span>
                        <strong>
                          <a className="inline-link" href={orderSnapshot.vendorInvoiceUrl} target="_blank" rel="noreferrer">
                            Open invoice
                          </a>
                        </strong>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

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
          ) : ordersMissingVendorContext ? (
            <EmptyStatePanel
              title="Select vendor"
              description="Order detail requires a selected vendor context."
            />
          ) : ordersWaitingForVendorContext ? (
            <EmptyStatePanel
              title="Waiting for vendor context"
              description="Order detail will be available after the authenticated vendor scope is ready."
            />
          ) : isLoading ? (
            <SectionSkeleton title="Loading order detail" description="Order detail will hydrate after the orders list loads." />
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
