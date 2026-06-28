import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import {
  EmptyStatePanel,
  FilterBar,
  OperationalActionGroup,
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
import { getOperationalStory, getVendorBlockedOperationalStory } from '../lib/orderOperationalStory';
import { getRejectUnavailableReason } from '../lib/rejectEligibility';
import { openShipmentLabel } from '../lib/shipmentLabelOpening';
import { useActionFeedback } from '../lib/ui';

type OrderQuickFilter = 'all' | 'blocked' | 'awaiting' | 'tracking_missing' | 'high_value' | 'returns';
type OrderWorkflowTabKey = 'all' | 'awaiting-shipment' | 'blocked-allocation' | 'stale-fulfillment' | 'tracking-missing';
type LabelActionFeedback = {
  tone: 'success' | 'warning' | 'error';
  message: string;
  allocationId: string;
  vendorId: string;
  contextKey: string;
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

function getPaymentStatusTone(status: string | null | undefined) {
  const normalized = status?.toLowerCase() ?? '';
  if (normalized.includes('refund completed') || normalized.includes('refunded') || normalized === 'paid') {
    return 'success' as const;
  }
  if (normalized.includes('pending') || normalized.includes('authorized')) {
    return 'attention' as const;
  }
  if (normalized.includes('void') || normalized.includes('failed') || normalized.includes('expired')) {
    return 'warning' as const;
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

function getVendorSafeOrderPanelCopy(value: string | null | undefined) {
  if (!value) {
    return value;
  }
  return value
    .replace(/Open the order detail to inspect the blocked assignment and resolve vendor scope before shipment work\./gi, 'Review the blocked order before shipment work continues.')
    .replace(/Shopify refund webhook recorded refund finance\./gi, 'Refund details were recorded.')
    .replace(/Shopify refund is complete/gi, 'Refund is complete')
    .replace(/Shopify refund processed\./gi, 'Refund processed.')
    .replace(/Shopify not fulfilled/gi, 'Fulfillment is not ready')
    .replace(/refunded allocation/gi, 'refunded order')
    .replace(/This allocation/g, 'This order')
    .replace(/this allocation/g, 'this order')
    .replace(/The allocation/g, 'The order')
    .replace(/the allocation/g, 'the order')
    .replace(/blocked allocation state/gi, 'blocked order state')
    .replace(/blocked allocation/gi, 'blocked order')
    .replace(/allocation/gi, 'order')
    .replace(/vendor scope/gi, 'admin review');
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
  const story = getOperationalStory(order);
  if (story.state !== 'active_or_unknown') {
    return story.primaryLabel;
  }
  if (order.shippingStatus === 'Awaiting Shipment') {
    return 'Awaiting shipment';
  }
  if (order.fulfillmentStatus === 'Fulfilled') {
    return 'Fulfilled';
  }
  return getAttentionLabel(order);
}

function getLifecycleSecondaryLabel(order: OrderSummary) {
  const story = getOperationalStory(order);
  if (story.state !== 'active_or_unknown') {
    return story.secondaryLabel;
  }
  if (order.trackingNumber || order.carrier) {
    return 'Tracking visible';
  }
  if (order.shippingStatus === 'Awaiting Shipment') {
    return 'Tracking pending';
  }
  if (order.allocationStatus === 'pending_reassignment') {
    return safeStatusLabel(order.allocationStatus);
  }
  return null;
}

function getShippingOperationalLabel(order: OrderSummary | OrderDetail) {
  const story = getOperationalStory(order);
  if (story.state !== 'active_or_unknown') {
    return {
      label: story.state === 'vendor_blocked_awaiting_admin_resolution' ? story.secondaryLabel : story.fulfillmentLabel,
      tone: 'blocked' as const,
      helper: story.state === 'vendor_blocked_awaiting_admin_resolution'
        ? 'Vendor rejected allocation.'
        : 'Refund completed for this allocation.',
    };
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
  const story = getOperationalStory(order);
  if (story.state !== 'active_or_unknown') {
    return story.state === 'vendor_blocked_awaiting_admin_resolution' ? 'Not fulfilled' : story.fulfillmentLabel;
  }
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
  const story = getOperationalStory(order);
  if (story.state !== 'active_or_unknown') {
    return 'Blocked';
  }
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
      emptyDescription: 'This workflow queue is clear for the current vendor scope. Switch to All orders to review the full list.',
      quickFilter: 'blocked' as OrderQuickFilter,
    };
  }
  if (workflow === 'awaiting-shipment') {
    return {
      label: 'Awaiting shipment',
      description: 'Showing orders that need shipment creation or provider progress.',
      emptyTitle: 'No shipments currently awaiting action',
      emptyDescription: 'This workflow queue is clear for the current vendor scope. Switch to All orders to review the full list.',
      quickFilter: 'awaiting' as OrderQuickFilter,
    };
  }
  if (workflow === 'stale-fulfillment') {
    return {
      label: 'Stale fulfillment',
      description: 'Showing fulfillment work that still needs shipment progress.',
      emptyTitle: 'No stale fulfillment work in this queue',
      emptyDescription: 'No stale fulfillment items match this workflow right now. Switch to All orders to inspect the full list.',
      quickFilter: 'awaiting' as OrderQuickFilter,
    };
  }
  if (workflow === 'tracking-missing') {
    return {
      label: 'Tracking missing',
      description: 'Showing orders without carrier or tracking evidence.',
      emptyTitle: 'No orders missing tracking',
      emptyDescription: 'Tracking evidence is present for the current workflow queue. Switch to All orders to review the full list.',
      quickFilter: 'tracking_missing' as OrderQuickFilter,
    };
  }
  return null;
}

function buildOrderActionContextKey(input: {
  vendorId: string;
  allocationId?: string | null;
  sourceShopifyOrderId?: string | null;
  sourceShopifyOrderNumber?: string | number | null;
}) {
  const orderNumber = input.sourceShopifyOrderNumber === null || input.sourceShopifyOrderNumber === undefined
    ? ''
    : String(input.sourceShopifyOrderNumber);
  return [
    input.vendorId,
    input.allocationId ?? '',
    input.sourceShopifyOrderId ?? '',
    orderNumber,
  ].join('|');
}

export function OrdersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const appReadiness = useAppReadiness();
  const currentVendor = appReadiness.currentVendor;
  const currentUser = appReadiness.currentUser;
  const authContextReady = appReadiness.ready;
  const isAdmin = currentUser?.role === 'admin';
  const { message, tone, showFeedback } = useActionFeedback();
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

  function setWorkflowTab(workflow: OrderWorkflowTabKey) {
    const nextParams = new URLSearchParams(searchParams);
    if (workflow === 'all') {
      nextParams.delete('workflow');
    } else {
      nextParams.set('workflow', workflow);
    }
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
  const selectedOrderContextId = selectedOrderSummary?.id ?? null;
  const selectedOrderActionContextKey = selectedOrderSummary
    ? buildOrderActionContextKey({
        vendorId: currentVendor.vendorId,
        allocationId: selectedOrderSummary.id,
        sourceShopifyOrderId: selectedOrderSummary.sourceShopifyOrderId,
        sourceShopifyOrderNumber: selectedOrderSummary.sourceShopifyOrderNumber,
      })
    : null;
  const selectedOrderActionContextKeyRef = useRef<string | null>(selectedOrderActionContextKey);
  useEffect(() => {
    selectedOrderActionContextKeyRef.current = selectedOrderActionContextKey;
  }, [selectedOrderActionContextKey]);
  const visibleLabelActionFeedback =
    labelActionFeedback?.vendorId === currentVendor.vendorId &&
    labelActionFeedback.allocationId === selectedOrderContextId &&
    labelActionFeedback.contextKey === selectedOrderActionContextKey
      ? labelActionFeedback
      : null;

  useEffect(() => {
    setLabelActionFeedback(null);
  }, [selectedOrderActionContextKey]);

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
      awaitingShipment: source.filter((order) => order.shippingStatus === 'Awaiting Shipment').length,
      blocked: source.filter((order) => order.allocationStatus === 'pending_reassignment' || order.allocationStatus === 'vendor_blocked').length,
    };
  }, [orders]);

  const quickFilters: Array<{ key: OrderQuickFilter; label: string; count: number }> = [
    { key: 'all', label: 'All orders', count: orders?.length ?? 0 },
    { key: 'tracking_missing', label: 'Tracking missing', count: safeArray(orders).filter((order) => !order.trackingNumber && !order.carrier).length },
    { key: 'high_value', label: 'High value', count: safeArray(orders).filter((order) => parseOperationalAmount(order.amount) >= 3000).length },
  ];
  const workflowTabs: Array<{
    key: OrderWorkflowTabKey;
    workflow: OrderWorkflowTabKey | null;
    label: string;
    description: string;
    count: number;
  }> = [
    {
      key: 'all',
      workflow: null,
      label: 'All orders',
      description: 'Full order list',
      count: orders?.length ?? 0,
    },
    {
      key: 'awaiting-shipment',
      workflow: 'awaiting-shipment',
      label: 'Ready to ship',
      description: 'Awaiting shipment',
      count: summary.awaitingShipment,
    },
    {
      key: 'blocked-allocation',
      workflow: 'blocked-allocation',
      label: 'Blocked',
      description: 'Needs admin resolution',
      count: summary.blocked,
    },
    {
      key: 'stale-fulfillment',
      workflow: 'stale-fulfillment',
      label: 'Shipment review',
      description: 'Stale fulfillment',
      count: summary.awaitingShipment,
    },
    {
      key: 'tracking-missing',
      workflow: 'tracking-missing',
      label: 'Tracking missing',
      description: 'Needs tracking evidence',
      count: safeArray(orders).filter((order) => !order.trackingNumber && !order.carrier).length,
    },
  ];
  const workflowParam = searchParams.get('workflow');
  const activeWorkflowKey: OrderWorkflowTabKey = workflowTabs.some((tab) => tab.key === workflowParam)
    ? (workflowParam as OrderWorkflowTabKey)
    : 'all';
  const effectiveQuickFilter = activeWorkflowFilter?.quickFilter ?? quickFilter;

  async function handleSmartLabelAction(order: OrderSummary | OrderDetail) {
    const shipmentExecution = (order as OrderDetail).shipmentExecution;
    const labelUrl = shipmentExecution?.labelUrl ?? null;
    const actionContextKey = buildOrderActionContextKey({
      vendorId: currentVendor.vendorId,
      allocationId: order.id,
      sourceShopifyOrderId: order.sourceShopifyOrderId,
      sourceShopifyOrderNumber: order.sourceShopifyOrderNumber,
    });
    const actionStillBelongsToCurrentSelection = () =>
      selectedOrderActionContextKeyRef.current === actionContextKey;
    const actionFeedback = (tone: LabelActionFeedback['tone'], message: string): LabelActionFeedback => ({
      tone,
      message,
      allocationId: order.id,
      vendorId: currentVendor.vendorId,
      contextKey: actionContextKey,
    });
    const setCurrentLabelActionFeedback = (tone: LabelActionFeedback['tone'], message: string) => {
      if (!actionStillBelongsToCurrentSelection()) {
        return;
      }
      setLabelActionFeedback(actionFeedback(tone, message));
    };

    if (labelUrl) {
      const labelOpenResult = openShipmentLabel(labelUrl);
      if (labelOpenResult.opened) {
        setCurrentLabelActionFeedback('success', 'Existing label opened. No duplicate shipment was created.');
      } else {
        setCurrentLabelActionFeedback('error', labelOpenResult.error);
      }
      return;
    }

    if (shipmentExecution) {
      if (shipmentExecution.shipmentStatus === 'failed') {
        try {
          setLabelActionFeedback(null);
          const shipment = await retryShipmentLabelMutation(shipmentExecution.id);
          if (shipment.labelUrl) {
            const labelOpenResult = openShipmentLabel(shipment.labelUrl);
            if (labelOpenResult.opened) {
              setCurrentLabelActionFeedback('success', 'Shipment label created and opened.');
            } else {
              setCurrentLabelActionFeedback('error', labelOpenResult.error);
            }
          } else {
            setCurrentLabelActionFeedback('warning', 'Shipment retry completed. Label is still processing.');
          }
          await orderDetailQuery.refetch();
        } catch (mutationError) {
          const message = mutationError instanceof Error ? mutationError.message : 'Shipment label could not be created.';
          setCurrentLabelActionFeedback('error', message);
        }
        return;
      }

      setCurrentLabelActionFeedback('warning', 'Shipment exists, but the label is not available yet.');
      return;
    }

    try {
      setLabelActionFeedback(null);
      const shipment = await createShipmentMutation(order.id);
      if (shipment.labelUrl) {
        const labelOpenResult = openShipmentLabel(shipment.labelUrl);
        if (labelOpenResult.opened) {
          setCurrentLabelActionFeedback('success', 'Shipment label created and opened.');
        } else {
          setCurrentLabelActionFeedback('error', labelOpenResult.error);
        }
      } else {
        setCurrentLabelActionFeedback('warning', 'Shipment was created. Label is still processing.');
      }
      await orderDetailQuery.refetch();
    } catch (mutationError) {
      const message = mutationError instanceof Error ? mutationError.message : 'Shipment label could not be created.';
      setCurrentLabelActionFeedback('error', message);
    }
  }

  function getSmartLabelButtonText(shipmentExecution?: ShipmentExecution | null) {
    if (isLabelActionPending) {
      return 'Etiket oluşturuluyor...';
    }
    if (shipmentExecution?.labelUrl) {
      return 'Etiketi yazdır';
    }
    if (shipmentExecution?.shipmentStatus === 'failed' || visibleLabelActionFeedback?.tone === 'error') {
      return 'Tekrar dene';
    }
    return 'Kargo etiketi yazdır';
  }

  return (
    <>
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
        </div>

        <div className="op-control-layout orders-control-layout orders-workspace-grid">
          <div className="orders-left-column">
            <div className="orders-workflow-tabs" aria-label="Orders workflow tabs">
              {workflowTabs.map((tab) => {
                const isActive = activeWorkflowKey === tab.key || (activeWorkflowKey === 'all' && tab.key === 'all');
                return (
                  <button
                    key={tab.key}
                    type="button"
                    className={isActive ? 'is-active' : ''}
                    aria-pressed={isActive}
                    onClick={() => setWorkflowTab(tab.workflow ?? 'all')}
                  >
                    <span>{tab.label}</span>
                    <strong>{tab.count}</strong>
                    <small>{tab.description}</small>
                  </button>
                );
              })}
            </div>

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
                  <TableSkeletonRows columns={6} rows={5} />
                ) : filteredOrders.length === 0 ? (
                  <OperationalTableRow>
                    <EmptyStatePanel
                      title={activeWorkflowFilter?.emptyTitle ?? 'No orders in this view'}
                      description={activeWorkflowFilter?.emptyDescription ?? 'Adjust the search or filters to inspect vendor-scoped Shopify orders.'}
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
            action={selectedOrder ? <Link className="button button-secondary" to={`/orders/${selectedOrder.id}`}>View details</Link> : null}
          >
          {selectedOrder ? (
            (() => {
              const operationalStory = getOperationalStory(selectedOrder);
              const vendorBlockedStory = getVendorBlockedOperationalStory(selectedOrder);
              const hasCanonicalTerminalStory = operationalStory.state !== 'active_or_unknown';
              const shippingOperational = getShippingOperationalLabel(selectedOrder);
              const shopifyFulfillmentState = getShopifyFulfillmentRailLabel(selectedOrder);
              const shipmentExecution = (selectedOrder as OrderDetail).shipmentExecution;
              const trackingLabel = hasCanonicalTerminalStory
                ? operationalStory.shippingLabel === 'Unavailable' ? '—' : operationalStory.shippingLabel
                : selectedOrder.trackingNumber
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
              const railGuidance = hasCanonicalTerminalStory
                ? {
                    actionLabel: operationalStory.nextActionLabel,
                    description: vendorBlockedStory?.nextActionDescription ?? 'This allocation has no shipment action available.',
                    tone: operationalStory.resolvedByRefund ? 'success' as const : 'warning' as const,
                  }
                : workflowGuidance;
              const smartLabelDisabled = isLabelActionPending || Boolean(shipmentExecution && !shipmentExecution.labelUrl && shipmentExecution.shipmentStatus !== 'failed');
              const rejectUnavailableReason = getRejectUnavailableReason(selectedOrder);
              const showRejectUnavailableReason = currentUser?.role === 'vendor' && rejectUnavailableReason !== null;
              const warehouseId = shipmentExecution?.warehouseId ?? '—';
              const lastUpdate = selectedOrder.shipmentUpdatedAt ?? shipmentExecution?.lastProviderResponseAt ?? selectedOrder.fulfilledAt ?? selectedOrder.date;
              const orderSnapshot = (selectedOrder as OrderDetail).orderSnapshot ?? null;
              const snapshotCurrency = getSnapshotCurrency(selectedOrder);
              const operationalStatusLabel = hasCanonicalTerminalStory ? operationalStory.primaryLabel : safeStatusLabel(selectedOrder.allocationStatus);
              const operationalStatusTone = hasCanonicalTerminalStory
                ? (operationalStory.resolvedByRefund ? 'success' : 'warning')
                : getStatusTone(selectedOrder.allocationStatus);
              const paymentStatusLabel = hasCanonicalTerminalStory
                ? operationalStory.financeLabel
                : formatSnapshotValue(orderSnapshot?.financialStatus);
              const statusStripCopy = vendorBlockedStory?.adminActionCopy ?? (hasCanonicalTerminalStory ? operationalStory.secondaryLabel : shippingOperational.label);
              const vendorStatusStripCopy = getVendorSafeOrderPanelCopy(statusStripCopy);
              const railGuidanceDescription = isAdmin
                ? railGuidance.description
                : getVendorSafeOrderPanelCopy(railGuidance.description) ?? railGuidance.description;
              const railGuidanceActionLabel = !isAdmin && railGuidance.actionLabel === 'Review allocation'
                ? 'Review order'
                : railGuidance.actionLabel;
              const rejectUnavailableCopy = isAdmin
                ? rejectUnavailableReason
                : getVendorSafeOrderPanelCopy(rejectUnavailableReason);
              const fulfillmentRailValue = hasCanonicalTerminalStory
                ? operationalStory.fulfillmentLabel
                : selectedOrder.fulfillmentStatus;
              const timelineItems: Array<{ label: string; at?: string | null; detail?: string }> = [
                { label: 'Order received', at: formatDate(selectedOrder.date) },
              ];
              if (hasCanonicalTerminalStory) {
                const vendorBlockedHistory = safeArray((selectedOrder as OrderDetail).assignmentHistory).find((entry) => entry.action === 'vendor_blocked');
                operationalStory.timelineEvents.forEach((event) => {
                  timelineItems.push({
                    label: isAdmin ? event.label : getVendorSafeOrderPanelCopy(event.label) ?? event.label,
                    detail: isAdmin ? event.detail : getVendorSafeOrderPanelCopy(event.detail) ?? undefined,
                    at: vendorBlockedHistory?.createdAt ? formatDate(vendorBlockedHistory.createdAt) : undefined,
                  });
                });
              }
              if (!hasCanonicalTerminalStory && selectedOrder.shipmentCreatedAt) {
                timelineItems.push({ label: 'Shipment created', at: formatDate(selectedOrder.shipmentCreatedAt) });
              }
              if (!hasCanonicalTerminalStory && selectedOrder.trackingNumber) {
                timelineItems.push({ label: 'Tracking assigned', detail: getTrackingLabel(selectedOrder) });
              }
              if (!hasCanonicalTerminalStory && (shopifyFulfillmentState === 'Synced' || selectedOrder.fulfilledAt)) {
                timelineItems.push({
                  label: 'Fulfillment synced',
                  at: selectedOrder.fulfilledAt ? formatDate(selectedOrder.fulfilledAt) : undefined,
                  detail: shopifyFulfillmentState,
                });
              }

              return (
            <>
              <div className="orders-detail-rail-header">
                <div className="orders-status-axis-grid" aria-label="Order status axes">
                  <div className="orders-status-axis">
                    <span>Operational Status</span>
                    <StatusBadge tone={operationalStatusTone}>{operationalStatusLabel}</StatusBadge>
                  </div>
                  <div className="orders-status-axis">
                    <span>Payment Status</span>
                    <StatusBadge tone={getPaymentStatusTone(paymentStatusLabel)}>{paymentStatusLabel}</StatusBadge>
                  </div>
                </div>
              </div>

              <div className={`orders-detail-status-strip orders-detail-status-${shippingOperational.tone}`}>
                <strong>{vendorBlockedStory?.adminActionTitle ?? (hasCanonicalTerminalStory ? operationalStory.primaryLabel : selectedOrder.shippingStatus)}</strong>
                <span>{isAdmin ? statusStripCopy : vendorStatusStripCopy}</span>
                {isAdmin && !hasCanonicalTerminalStory ? <span>Shopify {shopifyFulfillmentState?.toLowerCase() ?? 'unknown'}</span> : null}
              </div>

              <WorkflowActionGuidance
                actionLabel={railGuidanceActionLabel}
                description={railGuidanceDescription}
                tone={railGuidance.tone}
              />

              {operationalStory.actionVisibility.canCreateShipment ? (
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
                  {visibleLabelActionFeedback ? (
                    <p className={`orders-smart-label-feedback orders-smart-label-${visibleLabelActionFeedback.tone}`}>
                      {visibleLabelActionFeedback.message}
                    </p>
                  ) : null}
                </section>
              ) : null}

              {showRejectUnavailableReason ? (
                <section className="orders-detail-card" aria-label="Reject unavailable">
                    <h4>{vendorBlockedStory?.rejectUnavailableTitle ?? 'Reject unavailable'}</h4>
                  <p className="page-description">{rejectUnavailableCopy}</p>
                  {shipmentExecution && shipmentExecution.shipmentStatus !== 'failed' && shipmentExecution.shipmentStatus !== 'cancelled' ? (
                    <small className="muted">Shipment status: {safeStatusLabel(shipmentExecution.shipmentStatus)}</small>
                  ) : null}
                </section>
              ) : null}

              <section className="orders-detail-card">
                <h4>{isAdmin ? 'Fulfillment and shipping' : 'Shipment'}</h4>
                <div className="orders-rail-summary-list">
                  <div>
                    <span>{isAdmin ? 'Provider' : 'Carrier'}</span>
                    <strong>{getRailProviderLabel(selectedOrder)}</strong>
                  </div>
                  <div>
                    <span>Tracking</span>
                    <strong>{!hasCanonicalTerminalStory && trackingUrl ? <a className="inline-link" href={trackingUrl}>Open tracking</a> : trackingLabel}</strong>
                  </div>
                  <div>
                    <span>{isAdmin ? 'Shopify sync' : 'Shipment status'}</span>
                    <strong>{isAdmin ? shopifyFulfillmentState : fulfillmentRailValue}</strong>
                  </div>
                  <div>
                    <span>{isAdmin ? 'Label' : 'Shipping label'}</span>
                    <strong>
                      {operationalStory.actionVisibility.canCreateShipment && labelUrl ? (
                        <button
                          type="button"
                          className="inline-link inline-button-link"
                          onClick={() => void handleSmartLabelAction(selectedOrder)}
                        >
                          Open label
                        </button>
                      ) : (
                        operationalStory.shippingLabel
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Last update</span>
                    <strong>{formatDate(lastUpdate)}</strong>
                  </div>
                </div>
              </section>

              {isAdmin ? (
                <section className="orders-detail-card" aria-label="Shopify order snapshot">
                  <h4>Shopify order snapshot</h4>
                  <p className="page-description">
                    Full-order Shopify values. Tax, shipping, and discount are not allocation-projected.
                  </p>
                  {selectedOrder.splitSummary ? (
                    <p className="page-description">
                      This order was split. Tax, shipping, and discount below are full-order Shopify snapshot values.
                    </p>
                  ) : null}
                  <div className="orders-rail-summary-list">
                    <div>
                      <span>Financial status</span>
                      <strong>{hasCanonicalTerminalStory ? operationalStory.financeLabel : formatSnapshotValue(orderSnapshot?.financialStatus)}</strong>
                    </div>
                    <div>
                      <span>Payment gateway</span>
                      <strong>{formatSnapshotValue(orderSnapshot?.paymentGatewayName)}</strong>
                    </div>
                    <div>
                      <span>Vendor integration</span>
                      <strong>{hasCanonicalTerminalStory ? '—' : formatSnapshotValue(orderSnapshot?.vendorIntegrationStatus)}</strong>
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
              ) : null}

              {isAdmin && orderSnapshot?.vendorInvoiceNumber ? (
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

              <section className="orders-detail-card">
                <h4>{isAdmin ? 'Line items' : 'Items'}</h4>
                {(selectedOrder as OrderDetail).lineItems?.length ? (
                  <div className="order-detail-items">
                    {safeArray((selectedOrder as OrderDetail).lineItems).map((item) => (
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
                          <small>{item.sku} · {item.variantTitle}</small>
                          {isAdmin ? (
                            <small>
                              {[
                                `VAT ${formatVatRate(item.vatRate)}`,
                                item.lineTaxAmount ? `VAT amount ${formatSnapshotAmount(item.lineTaxAmount, snapshotCurrency)}` : null,
                                `Unit price incl. VAT ${formatSnapshotAmount(item.unitPriceVatIncluded, snapshotCurrency)}`,
                                `Line total incl. VAT ${formatSnapshotAmount(item.lineTotalVatIncluded, snapshotCurrency)}`,
                                item.shopifyProductId ? `Shopify product ${item.shopifyProductId}` : null,
                              ].filter(Boolean).join(' · ')}
                            </small>
                          ) : null}
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
                <h4>{isAdmin ? 'Operational timeline' : 'Order activity'}</h4>
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

      </div>
    </section>

    {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </>
  );
}
