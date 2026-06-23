import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
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
  WorkflowActionGuidance,
} from '../components/OperationalPrimitives';
import { AllocationSplitRejectModal } from '../components/AllocationSplitRejectModal';
import { ProductImagePreview } from '../components/ProductImagePreview';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import {
  createShipmentExecution,
  getOrder,
  listOrders,
  rejectOrder,
  retryFailedShipmentExecution,
  type AllocationSplitExecutionResponse,
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
import { canRejectOrder, canShowAllocationSplitRejectAction, getRejectUnavailableReason } from '../lib/rejectEligibility';
import { openShipmentLabel } from '../lib/shipmentLabelOpening';
import { useActionFeedback } from '../lib/ui';

type OrderQuickFilter = 'all' | 'blocked' | 'awaiting' | 'tracking_missing' | 'high_value' | 'returns';
type RejectOrderReason = 'OUT_OF_STOCK' | 'VENDOR_CANCELLED' | 'DAMAGED_INVENTORY' | 'FULFILLMENT_ISSUE';
type LabelActionFeedback = {
  tone: 'success' | 'warning' | 'error';
  message: string;
  allocationId: string;
  vendorId: string;
  contextKey: string;
};

const REJECT_ORDER_REASONS: Array<{ value: RejectOrderReason; label: string }> = [
  { value: 'OUT_OF_STOCK', label: 'Out of stock' },
  { value: 'VENDOR_CANCELLED', label: 'Vendor cancelled' },
  { value: 'DAMAGED_INVENTORY', label: 'Damaged inventory' },
  { value: 'FULFILLMENT_ISSUE', label: 'Fulfillment issue' },
];

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

function getErrorMessage(error: unknown, fallback = 'Action failed.') {
  return error instanceof Error ? error.message : fallback;
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

function isTodayOrder(order: OrderSummary) {
  const timestamp = getSafeTimestamp(order.date, Number.NaN);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const orderDate = new Date(timestamp);
  const today = new Date();
  return (
    orderDate.getFullYear() === today.getFullYear() &&
    orderDate.getMonth() === today.getMonth() &&
    orderDate.getDate() === today.getDate()
  );
}

function MetricIcon({ tone }: { tone: string }) {
  if (tone === 'today') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4" />
        <path d="M16 3v4" />
        <path d="M4 10h16" />
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
  if (tone === 'blocked') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 7v6" />
        <path d="M12 17h.01" />
        <circle cx="12" cy="12" r="8" />
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
  const [rejectOrderTarget, setRejectOrderTarget] = useState<OrderSummary | OrderDetail | null>(null);
  const [splitRejectTarget, setSplitRejectTarget] = useState<OrderDetail | null>(null);
  const [rejectReason, setRejectReason] = useState<RejectOrderReason>('OUT_OF_STOCK');
  const [rejectNote, setRejectNote] = useState('');
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

  useEffect(() => {
    setRejectOrderTarget(null);
    setSplitRejectTarget(null);
    setRejectReason('OUT_OF_STOCK');
    setRejectNote('');
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
  const { mutateAsync: rejectOrderMutation, isPending: isRejectingOrder } = useMutationAction(
    async (input: { orderId: string; reason: RejectOrderReason; note: string }) =>
      rejectOrder(
        input.orderId,
        {
          reason: input.reason,
          note: input.note,
        },
        {
          vendorId: currentVendor.vendorId,
        },
      ),
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
      today: source.filter(isTodayOrder).length,
      awaitingShipment: source.filter((order) => order.shippingStatus === 'Awaiting Shipment').length,
      blocked: source.filter((order) => order.allocationStatus === 'pending_reassignment' || order.allocationStatus === 'vendor_blocked').length,
    };
  }, [orders]);

  const orderKpis = [
    { label: 'Total Orders', value: summary.total, detail: 'Current vendor scope', tone: 'orders' },
    { label: 'Today Orders', value: summary.today, detail: 'Created today', tone: 'today' },
    { label: 'Awaiting Shipment', value: summary.awaitingShipment, detail: 'Needs fulfillment progress', tone: 'awaiting' },
    { label: 'Blocked Orders', value: summary.blocked, detail: 'Needs operator review', tone: 'blocked' },
  ];

  const recentOrders = filteredOrders.slice(0, 3);

  const quickFilters: Array<{ key: OrderQuickFilter; label: string; count: number }> = [
    { key: 'all', label: 'All orders', count: orders?.length ?? 0 },
    { key: 'blocked', label: 'Blocked', count: summary.blocked },
    { key: 'awaiting', label: 'Awaiting shipment', count: summary.awaitingShipment },
    { key: 'tracking_missing', label: 'Tracking missing', count: safeArray(orders).filter((order) => !order.trackingNumber && !order.carrier).length },
    { key: 'high_value', label: 'High value', count: safeArray(orders).filter((order) => parseOperationalAmount(order.amount) >= 3000).length },
    { key: 'returns', label: 'Returns', count: safeArray(orders).filter((order) => `${order.status} ${order.shippingStatus}`.toLowerCase().includes('return')).length },
  ];
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

  async function handleRejectOrderSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejectOrderTarget) {
      return;
    }

    const note = rejectNote.trim();
    if (!note) {
      showFeedback('Reject note is required.', 'error');
      return;
    }
    if (note.length > 500) {
      showFeedback('Reject note must be 500 characters or fewer.', 'error');
      return;
    }

    try {
      await rejectOrderMutation({
        orderId: rejectOrderTarget.id,
        reason: rejectReason,
        note,
      });
      setRejectOrderTarget(null);
      setRejectReason('OUT_OF_STOCK');
      setRejectNote('');
      showFeedback('Order rejected and sent to admin review.', 'success');
      await orderDetailQuery.refetch();
    } catch (mutationError) {
      showFeedback(getErrorMessage(mutationError, 'Order could not be rejected.'), 'error');
    }
  }

  async function handleSplitRejectSuccess(_result: AllocationSplitExecutionResponse) {
    showFeedback('Selected items rejected. A blocked allocation was created for admin review.', 'success');
    await Promise.all([
      refetch(),
      orderDetailQuery.refetch(),
    ]);
  }

  async function handleSplitFullAllocationReject(input: { orderId: string; reason: RejectOrderReason; note: string }) {
    await rejectOrderMutation(input);
    setSplitRejectTarget(null);
    showFeedback('Order rejected and sent to admin review.', 'success');
    await Promise.all([
      refetch(),
      orderDetailQuery.refetch(),
    ]);
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
                </article>
              ))}
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
            action={selectedOrder ? <Link className="button button-secondary" to={`/orders/${selectedOrder.id}`}>İNCELE</Link> : null}
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
              const rejectEligible = currentUser?.role === 'vendor' && canRejectOrder(selectedOrder);
              const selectedOrderDetail = safeArray((selectedOrder as OrderDetail).lineItems).length > 0 ? (selectedOrder as OrderDetail) : null;
              const splitRejectEligible =
                currentUser?.role === 'vendor' &&
                selectedOrderDetail !== null &&
                canShowAllocationSplitRejectAction(selectedOrderDetail);
              const showRejectUnavailableReason = currentUser?.role === 'vendor' && rejectUnavailableReason !== null;
              const warehouseId = shipmentExecution?.warehouseId ?? '—';
              const lastUpdate = selectedOrder.shipmentUpdatedAt ?? shipmentExecution?.lastProviderResponseAt ?? selectedOrder.fulfilledAt ?? selectedOrder.date;
              const orderSnapshot = (selectedOrder as OrderDetail).orderSnapshot ?? null;
              const snapshotCurrency = getSnapshotCurrency(selectedOrder);
              const timelineItems: Array<{ label: string; at?: string | null; detail?: string }> = [
                { label: 'Order received', at: formatDate(selectedOrder.date) },
              ];
              if (hasCanonicalTerminalStory) {
                const vendorBlockedHistory = safeArray((selectedOrder as OrderDetail).assignmentHistory).find((entry) => entry.action === 'vendor_blocked');
                operationalStory.timelineEvents.forEach((event) => {
                  timelineItems.push({
                    ...event,
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
                <div className="orders-detail-rail-badges">
                  <StatusBadge tone={hasCanonicalTerminalStory ? (operationalStory.resolvedByRefund ? 'success' : 'warning') : getStatusTone(selectedOrder.allocationStatus)}>
                    {hasCanonicalTerminalStory ? operationalStory.primaryLabel : safeStatusLabel(selectedOrder.allocationStatus)}
                  </StatusBadge>
                  {hasCanonicalTerminalStory ? (
                    <StatusBadge tone={operationalStory.resolvedByRefund ? 'success' : 'warning'}>{operationalStory.secondaryLabel}</StatusBadge>
                  ) : (
                    <StatusBadge tone={getStatusTone(selectedOrder.fulfillmentStatus)}>{selectedOrder.fulfillmentStatus}</StatusBadge>
                  )}
                </div>
              </div>

              <div className={`orders-detail-status-strip orders-detail-status-${shippingOperational.tone}`}>
                <strong>{vendorBlockedStory?.adminActionTitle ?? (hasCanonicalTerminalStory ? operationalStory.primaryLabel : selectedOrder.shippingStatus)}</strong>
                <span>{vendorBlockedStory?.adminActionCopy ?? (hasCanonicalTerminalStory ? operationalStory.secondaryLabel : shippingOperational.label)}</span>
                {!hasCanonicalTerminalStory ? <span>Shopify {shopifyFulfillmentState?.toLowerCase() ?? 'unknown'}</span> : null}
              </div>

              <WorkflowActionGuidance
                actionLabel={railGuidance.actionLabel}
                description={railGuidance.description}
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

              {rejectEligible ? (
                <section className="orders-detail-card" aria-label="Reject order">
                  <h4>Operational hold</h4>
                  <p className="page-description">
                    {splitRejectEligible
                      ? 'Reject unavailable items or block the full allocation for Sporgym admin review.'
                      : 'Rejecting this order blocks fulfillment and sends it to Sporgym admin review.'}
                  </p>
                  <div className="orders-reject-action-stack">
                    {splitRejectEligible && selectedOrderDetail ? (
                      <button
                        type="button"
                        className="button button-danger"
                        onClick={() => setSplitRejectTarget(selectedOrderDetail)}
                      >
                        Reject selected items
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={splitRejectEligible ? 'button button-secondary' : 'button button-danger'}
                      onClick={() => {
                        setRejectOrderTarget(selectedOrder);
                        setRejectReason('OUT_OF_STOCK');
                        setRejectNote('');
                      }}
                    >
                      Reject order
                    </button>
                  </div>
                </section>
              ) : showRejectUnavailableReason ? (
                <section className="orders-detail-card" aria-label="Reject unavailable">
                    <h4>{vendorBlockedStory?.rejectUnavailableTitle ?? 'Reject unavailable'}</h4>
                  <p className="page-description">{rejectUnavailableReason}</p>
                  {shipmentExecution && shipmentExecution.shipmentStatus !== 'failed' && shipmentExecution.shipmentStatus !== 'cancelled' ? (
                    <small className="muted">Shipment status: {safeStatusLabel(shipmentExecution.shipmentStatus)}</small>
                  ) : null}
                </section>
              ) : null}

              <section className="orders-detail-card">
                <h4>Fulfillment and shipping</h4>
                <div className="orders-rail-summary-list">
                  <div>
                    <span>Provider</span>
                    <strong>{getRailProviderLabel(selectedOrder)}</strong>
                  </div>
                  <div>
                    <span>Tracking</span>
                    <strong>{!hasCanonicalTerminalStory && trackingUrl ? <a className="inline-link" href={trackingUrl}>Open tracking</a> : trackingLabel}</strong>
                  </div>
                  <div>
                    <span>Shopify sync</span>
                    <strong>{shopifyFulfillmentState}</strong>
                  </div>
                  <div>
                    <span>Label</span>
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

              <section className="orders-detail-card">
                <h4>Line items</h4>
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
                          <small>
                            {[
                              `VAT ${formatVatRate(item.vatRate)}`,
                              item.lineTaxAmount ? `VAT amount ${formatSnapshotAmount(item.lineTaxAmount, snapshotCurrency)}` : null,
                              `Unit price incl. VAT ${formatSnapshotAmount(item.unitPriceVatIncluded, snapshotCurrency)}`,
                              `Line total incl. VAT ${formatSnapshotAmount(item.lineTotalVatIncluded, snapshotCurrency)}`,
                              item.shopifyProductId ? `Shopify product ${item.shopifyProductId}` : null,
                            ].filter(Boolean).join(' · ')}
                          </small>
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
                <strong>{safeArray(orders).filter((order) => order.trackingNumber || order.carrier).length}</strong>
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

    {rejectOrderTarget ? (
      <div className="support-modal-backdrop" role="presentation">
        <section className="support-modal" role="dialog" aria-modal="true" aria-labelledby="reject-order-title">
          <div className="support-modal-header">
            <div>
              <h2 id="reject-order-title">Reject order</h2>
              <p>
                {formatShopifyOrderNumber(rejectOrderTarget.sourceShopifyOrderNumber)}
              </p>
            </div>
            <button
              type="button"
              className="support-modal-close"
              onClick={() => setRejectOrderTarget(null)}
              aria-label="Close reject order form"
            >
              ×
            </button>
          </div>
          <form className="support-ticket-form" onSubmit={handleRejectOrderSubmit}>
            <label>
              Reason
              <select
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value as RejectOrderReason)}
                required
              >
                {REJECT_ORDER_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Note
              <textarea
                value={rejectNote}
                onChange={(event) => setRejectNote(event.target.value)}
                maxLength={500}
                rows={5}
                required
                placeholder="Explain why this allocation cannot be fulfilled."
              />
            </label>
            <p className="support-context-note">
              This will block fulfillment and send the order to Sporgym admin review.
            </p>
            <div className="support-modal-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setRejectOrderTarget(null)}
                disabled={isRejectingOrder}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button-danger"
                disabled={isRejectingOrder}
              >
                {isRejectingOrder ? 'Rejecting...' : 'Reject order'}
              </button>
            </div>
          </form>
        </section>
      </div>
    ) : null}

    {splitRejectTarget ? (
      <AllocationSplitRejectModal
        order={splitRejectTarget}
        vendorId={currentVendor.vendorId}
        onClose={() => setSplitRejectTarget(null)}
        onSuccess={handleSplitRejectSuccess}
        onFullAllocationReject={handleSplitFullAllocationReject}
      />
    ) : null}

    {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </>
  );
}
