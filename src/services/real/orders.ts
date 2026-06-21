import { apiClient } from '../../lib/api-client';
import type {
  AllocationStatus,
  AssignmentHistoryAction,
  AssignmentHistoryEntry,
  FulfillmentActionState,
  FulfillmentStatus,
  OrderDetail,
  OrderLineItem,
  ShipmentExecution,
  ShipmentCustomerOverrides,
  ShippingProvider,
  ShippingProviderDiagnostics,
  OrderStatus,
  OrderSummary,
  ShippingStatus,
  ShopifyOrderBreakdown,
  VendorAllocationSummary,
  KargonomiWarehouseSyncResult,
  VendorShippingConfig,
  VendorShippingConfigUpdate,
  ParatikaSessionTokenLiveProbeResult,
} from '../../lib/api/contracts';
import { formatCurrency } from './formatting';

export type SubmitFulfillmentTrackingPayload = {
  trackingNumber: string;
  carrier: string;
  trackingUrl?: string;
  notifyCustomer?: boolean;
};

export type SubmitFulfillmentTrackingResult = {
  ok: true;
  allocationId: string;
  trackingNumber: string;
  carrier: string;
  trackingUrl?: string | null;
  notifyCustomer: boolean;
  fulfillmentStatus: string;
  shippingStatus: string;
  shopifySyncSource: string;
  shopifyFulfillmentId: string;
  shopifyFulfillmentCreated?: boolean;
  shopifyFulfillmentSkippedReason?: string | null;
  shopifyFulfillmentOrderIdPresent?: boolean;
  shopifyFulfillmentIdPresent?: boolean;
  shopifyFulfillmentOrderLookupAttempted?: boolean;
  shopifyFulfillmentOrderLookupSuccess?: boolean;
  shopifyFulfillmentOrderCount?: number;
  shopifySelectedFulfillmentOrderIdPresent?: boolean;
  fulfilledAt: string;
  shipmentCreatedAt: string;
  shipmentUpdatedAt: string;
};

export type CreateShipmentExecutionResult = ShipmentExecution;
export type ShippingProviderDiagnosticsResult = ShippingProviderDiagnostics;
export type UpdateNavlungoShipmentPayload = {
  recipient?: Partial<Record<'name' | 'phone' | 'email' | 'country' | 'postcode' | 'city' | 'district' | 'address', string | null>>;
  postNote?: string | null;
  barcodeFormat?: string | null;
};

export type RejectOrderReason = 'OUT_OF_STOCK' | 'VENDOR_CANCELLED' | 'DAMAGED_INVENTORY' | 'FULFILLMENT_ISSUE';

export type RejectOrderPayload = {
  reason: RejectOrderReason;
  note: string;
};

type OrderSummaryDto = {
  id: string;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string;
  vendorId: string;
  assignedVendorId: string;
  originalVendorId: string;
  allocationStatus: string;
  fulfillmentStatus: string;
  shippingStatus: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  fulfilledAt: string | null;
  shipmentCreatedAt: string | null;
  shipmentUpdatedAt: string | null;
  totalAmount: string;
  lineItemCount: number;
  createdAt: string;
  updatedAt: string;
};

type OrderDetailDto = OrderSummaryDto & {
  customerName: string | null;
  reassignmentRequired: boolean;
  cancellationReason: string | null;
  orderSnapshot?: OrderDetail['orderSnapshot'];
  shopifyFulfillmentSync?: {
    status: 'synced' | 'pending' | 'failed' | 'not_available';
    fulfillmentOrderIdPresent: boolean;
    fulfillmentIdPresent: boolean;
    syncStatus: string | null;
    skippedReason: string | null;
    errorMessage: string | null;
    lastAttemptedAt: string | null;
  };
  shopifyReturnSignal?: OrderDetail['shopifyReturnSignal'];
  lineItems: Array<{
    id: string;
    sourceLineItemId: string;
    sourceVariantId: string | null;
    sku: string | null;
    title: string | null;
    imageUrl: string | null;
    quantity: number;
    lineAmount: string;
    shopifyProductId?: string | null;
    unitPriceVatIncluded?: string | null;
    lineTotalVatIncluded?: string | null;
    lineTaxAmount?: string | null;
    vatRate?: string | null;
  }>;
  assignmentHistory: Array<{
    id: string;
    action: string;
    fromVendorId: string | null;
    toVendorId: string;
    reason: string | null;
    actorUserId: string | null;
    createdAt: string;
  }>;
  shipmentExecution: OrderDetail['shipmentExecution'];
};

type AdminOrderBreakdownDto = {
  order: {
    sourceShopifyOrderId: string;
    sourceShopifyOrderNumber: string;
    customerName: string | null;
    customerEmail: string | null;
    totalAmount: string;
    createdAt: string;
    updatedAt: string;
  };
  allocations: Array<{
    id: string;
    vendorId: string;
    vendorName: string;
    originalVendorId: string;
    assignedVendorId: string;
    allocationStatus: string;
    cancellationReason: string | null;
    reassignmentRequired: boolean;
    fulfillmentStatus: string;
    shippingStatus: string;
    trackingNumber: string | null;
    carrier: string | null;
    trackingUrl: string | null;
    fulfilledAt: string | null;
    shipmentCreatedAt: string | null;
    shipmentUpdatedAt: string | null;
    totalAmount: string;
    lineItems: Array<{
      id: string;
      sourceLineItemId: string;
      sourceVariantId: string | null;
      sku: string | null;
      title: string | null;
      imageUrl: string | null;
      quantity: number;
      lineAmount: string;
    }>;
    assignmentHistory: Array<{
      id: string;
      action: string;
      fromVendorId: string | null;
      toVendorId: string;
      reason: string | null;
      actorUserId: string | null;
      createdAt: string;
    }>;
    returnRecords: Array<{
      id: string;
      status: string;
      reason: string | null;
      createdAt: string;
    }>;
    refundRecords: Array<{
      id: string;
      sourceShopifyRefundId: string;
      amount: string;
      status: string;
      createdAt: string;
    }>;
  }>;
};

function toAllocationStatus(value: string): AllocationStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'vendor_blocked' || normalized === 'pending_reassignment' || normalized === 'reassigned' || normalized === 'fulfilled') {
    return normalized;
  }
  return 'active';
}

function toFulfillmentStatus(value: string): FulfillmentStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'fulfilled') {
    return 'Fulfilled';
  }
  if (normalized === 'partially fulfilled' || normalized === 'partially_fulfilled') {
    return 'Partially Fulfilled';
  }
  if (normalized === 'pending') {
    return 'Pending';
  }
  return 'Processing';
}

function toShippingStatus(value: string): ShippingStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'delivered') {
    return 'Delivered';
  }
  if (normalized === 'in transit' || normalized === 'in_transit' || normalized === 'shipped' || normalized === 'partially_shipped') {
    return 'In Transit';
  }
  if (normalized === 'label created' || normalized === 'label_created') {
    return 'Label Created';
  }
  return 'Awaiting Shipment';
}

function toOrderStatus(allocationStatus: AllocationStatus, fulfillmentStatus: FulfillmentStatus, shippingStatus: ShippingStatus): OrderStatus {
  if (allocationStatus === 'vendor_blocked' || allocationStatus === 'pending_reassignment') {
    return 'On Hold';
  }
  if (shippingStatus === 'Delivered') {
    return 'Delivered';
  }
  if (shippingStatus === 'In Transit') {
    return 'Shipped';
  }
  if (fulfillmentStatus === 'Pending') {
    return 'Pending';
  }
  return 'Processing';
}

function toFulfillmentActionState(shippingStatus: ShippingStatus): FulfillmentActionState {
  if (shippingStatus === 'Delivered') {
    return 'delivered';
  }
  if (shippingStatus === 'In Transit') {
    return 'shipped';
  }
  if (shippingStatus === 'Label Created') {
    return 'label_created';
  }
  return 'awaiting_shipment';
}

function mapAssignmentHistory(entries: OrderDetailDto['assignmentHistory']): AssignmentHistoryEntry[] {
  return entries.map((entry) => ({
    action: (entry.action.trim().toLowerCase() as AssignmentHistoryAction) || 'assigned',
    fromVendorId: entry.fromVendorId,
    toVendorId: entry.toVendorId,
    reason: entry.reason ?? undefined,
    actorName: entry.actorUserId ? `User ${entry.actorUserId}` : 'System',
    actorRole: entry.actorUserId ? 'admin' : 'system',
    createdAt: entry.createdAt,
  }));
}

function mapOrderLineItems(
  items: OrderDetailDto['lineItems'],
  assignedVendorId: string,
  originalVendorId: string,
  allocationStatus: AllocationStatus,
  shippingStatus: ShippingStatus,
  fulfillmentStatus: FulfillmentStatus,
  trackingNumber?: string | null,
  carrier?: string | null,
  trackingUrl?: string | null,
  fulfilledAt?: string | null,
  shipmentCreatedAt?: string | null,
  shipmentUpdatedAt?: string | null,
): OrderLineItem[] {
  const fulfillmentActionState = toFulfillmentActionState(shippingStatus);
  const fulfillmentActionAvailable = allocationStatus === 'active';

  return items.map((item) => ({
    id: item.id,
    originalVendorId,
    assignedVendorId,
    vendorId: assignedVendorId,
    sku: item.sku ?? 'UNKNOWN-SKU',
    variantTitle: item.sourceVariantId ?? 'Default',
    name: item.title ?? 'Shopify line item',
    imageUrl: item.imageUrl ?? null,
    quantity: item.quantity,
    price: formatCurrency(item.lineAmount),
    shopifyProductId: item.shopifyProductId ?? null,
    unitPriceVatIncluded: item.unitPriceVatIncluded ?? null,
    lineTotalVatIncluded: item.lineTotalVatIncluded ?? null,
    lineTaxAmount: item.lineTaxAmount ?? null,
    vatRate: item.vatRate ?? null,
    allocationStatus,
    reassignmentRequired: allocationStatus === 'pending_reassignment',
    fulfillmentActionState,
    fulfillmentActionAvailable,
    fulfillmentStatus,
    shippingStatus,
    trackingNumber: trackingNumber ?? undefined,
    carrier: carrier ?? undefined,
    trackingUrl: trackingUrl ?? undefined,
    fulfilledAt: fulfilledAt ?? undefined,
    fulfilledByVendorId: fulfilledAt ? assignedVendorId : undefined,
    shipmentCreatedAt: shipmentCreatedAt ?? undefined,
    shipmentUpdatedAt: shipmentUpdatedAt ?? undefined,
  }));
}

function mapOrderSummary(dto: OrderSummaryDto): OrderSummary {
  const allocationStatus = toAllocationStatus(dto.allocationStatus);
  const fulfillmentStatus = toFulfillmentStatus(dto.fulfillmentStatus);
  const shippingStatus = toShippingStatus(dto.shippingStatus);

  return {
    id: dto.id,
    originalVendorId: dto.originalVendorId,
    assignedVendorId: dto.assignedVendorId,
    vendorId: dto.assignedVendorId,
    sourceShopifyOrderId: dto.sourceShopifyOrderId,
    sourceShopifyOrderNumber: dto.sourceShopifyOrderNumber,
    status: toOrderStatus(allocationStatus, fulfillmentStatus, shippingStatus),
    allocationStatus,
    reassignmentRequired: allocationStatus === 'pending_reassignment',
    assignmentHistory: [],
    fulfillmentActionState: toFulfillmentActionState(shippingStatus),
    fulfillmentActionAvailable: allocationStatus === 'active',
    fulfillmentStatus,
    shippingStatus,
    trackingNumber: dto.trackingNumber ?? undefined,
    carrier: dto.carrier ?? undefined,
    trackingUrl: dto.trackingUrl ?? undefined,
    fulfilledAt: dto.fulfilledAt ?? undefined,
    fulfilledByVendorId: dto.fulfilledAt ? dto.assignedVendorId : undefined,
    shipmentCreatedAt: dto.shipmentCreatedAt ?? undefined,
    shipmentUpdatedAt: dto.shipmentUpdatedAt ?? undefined,
    lineItemCount: dto.lineItemCount,
    date: dto.createdAt,
    customer: 'Customer unavailable',
    amount: formatCurrency(dto.totalAmount),
    channel: 'Shopify',
  };
}

function mapOrderDetail(dto: OrderDetailDto): OrderDetail {
  const summary = mapOrderSummary(dto);
  const history = mapAssignmentHistory(dto.assignmentHistory);

  return {
    ...summary,
    trackingNumber: dto.trackingNumber ?? undefined,
    carrier: dto.carrier ?? undefined,
    trackingUrl: dto.trackingUrl ?? undefined,
    fulfilledAt: dto.fulfilledAt ?? undefined,
    fulfilledByVendorId: dto.fulfilledAt ? dto.assignedVendorId : undefined,
    shipmentCreatedAt: dto.shipmentCreatedAt ?? undefined,
    shipmentUpdatedAt: dto.shipmentUpdatedAt ?? undefined,
    shipmentExecution: dto.shipmentExecution ?? null,
    shopifyFulfillmentSync: dto.shopifyFulfillmentSync,
    shopifyReturnSignal: dto.shopifyReturnSignal ?? null,
    orderSnapshot: dto.orderSnapshot ?? null,
    reassignmentRequired: dto.reassignmentRequired,
    cancellationReason: (dto.cancellationReason?.trim().toLowerCase() as OrderDetail['cancellationReason']) ?? undefined,
    assignmentHistory: history,
    customer: dto.customerName?.trim() || 'Customer unavailable',
    shippingAddress: 'Shopify shipping address available in future detail sync.',
    notes: 'Loaded from backend operational allocation detail.',
    lineItems: mapOrderLineItems(
      dto.lineItems,
      dto.assignedVendorId,
      dto.originalVendorId,
      summary.allocationStatus,
      summary.shippingStatus,
      summary.fulfillmentStatus,
      dto.trackingNumber,
      dto.carrier,
      dto.trackingUrl,
      dto.fulfilledAt,
      dto.shipmentCreatedAt,
      dto.shipmentUpdatedAt,
    ),
    items: mapOrderLineItems(
      dto.lineItems,
      dto.assignedVendorId,
      dto.originalVendorId,
      summary.allocationStatus,
      summary.shippingStatus,
      summary.fulfillmentStatus,
      dto.trackingNumber,
      dto.carrier,
      dto.trackingUrl,
      dto.fulfilledAt,
      dto.shipmentCreatedAt,
      dto.shipmentUpdatedAt,
    ),
    timeline: history.map((entry) => ({
      label: entry.action.replace(/_/g, ' '),
      at: entry.createdAt,
    })),
  };
}

function readVendorRequestOptions(options: { vendorId?: string | null; signal?: AbortSignal; headers?: HeadersInit } = {}) {
  const requestOptions: { vendorId?: string; signal?: AbortSignal; headers?: HeadersInit } = {};
  if (options.vendorId) requestOptions.vendorId = options.vendorId;
  if (options.signal) requestOptions.signal = options.signal;
  if (options.headers) requestOptions.headers = options.headers;
  return Object.keys(requestOptions).length > 0 ? requestOptions : undefined;
}

export async function listOrders(options: { limit?: number; offset?: number; vendorId?: string | null; signal?: AbortSignal; headers?: HeadersInit } = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  const path = `/orders${params.size ? `?${params.toString()}` : ''}`;
  const requestOptions = readVendorRequestOptions(options);
  const response = await (requestOptions
    ? apiClient.get<OrderSummaryDto[]>(path, requestOptions)
    : apiClient.get<OrderSummaryDto[]>(path));
  return response.map(mapOrderSummary);
}

export async function getOrder(orderId: string, options: { vendorId?: string | null; signal?: AbortSignal } = {}) {
  const requestOptions = readVendorRequestOptions(options);
  const response = await (requestOptions
    ? apiClient.get<OrderDetailDto>(`/orders/${orderId}`, requestOptions)
    : apiClient.get<OrderDetailDto>(`/orders/${orderId}`));
  return mapOrderDetail(response);
}

export async function getAdminShopifyOrderBreakdown(
  shopifyOrderId: string,
  options: { signal?: AbortSignal } = {},
): Promise<ShopifyOrderBreakdown> {
  const response = await apiClient.get<AdminOrderBreakdownDto>(`/admin/orders/${shopifyOrderId}`, {
    signal: options.signal,
  });

  return {
    sourceShopifyOrderId: response.order.sourceShopifyOrderId,
    sourceShopifyOrderNumber: response.order.sourceShopifyOrderNumber,
    customer: response.order.customerName ?? response.order.customerEmail ?? 'Shopify customer',
    createdAt: response.order.createdAt,
    allocations: response.allocations.map((allocation): VendorAllocationSummary => {
      const allocationStatus = toAllocationStatus(allocation.allocationStatus);
      const shippingStatus = toShippingStatus(allocation.shippingStatus);
      const fulfillmentStatus = toFulfillmentStatus(allocation.fulfillmentStatus);
      const refundedItems = allocation.refundRecords.map((refund) => ({
        id: refund.id,
        originalVendorId: allocation.originalVendorId,
        assignedVendorId: allocation.assignedVendorId,
        vendorId: allocation.assignedVendorId,
        sku: refund.sourceShopifyRefundId,
        variantTitle: 'Refund',
        name: `Refund ${refund.sourceShopifyRefundId}`,
        quantity: 1,
        condition: 'Opened' as const,
        refundAmount: formatCurrency(refund.amount),
      }));

      return {
        originalVendorId: allocation.originalVendorId,
        assignedVendorId: allocation.assignedVendorId,
        vendorId: allocation.vendorId,
        vendorName: allocation.vendorName,
        allocationOrderId: allocation.id,
        status: toOrderStatus(allocationStatus, fulfillmentStatus, shippingStatus),
        allocationStatus,
        cancellationReason: (allocation.cancellationReason?.trim().toLowerCase() as VendorAllocationSummary['cancellationReason']) ?? undefined,
        reassignmentRequired: allocation.reassignmentRequired,
        reassignmentCandidateVendorIds: [],
        assignmentHistory: mapAssignmentHistory(allocation.assignmentHistory),
        fulfillmentActionState: toFulfillmentActionState(shippingStatus),
        fulfillmentActionAvailable: allocationStatus === 'active',
        fulfillmentStatus,
        shippingStatus,
        trackingNumber: allocation.trackingNumber ?? undefined,
        carrier: allocation.carrier ?? undefined,
        trackingUrl: allocation.trackingUrl ?? undefined,
        fulfilledAt: allocation.fulfilledAt ?? undefined,
        fulfilledByVendorId: allocation.fulfilledAt ? allocation.assignedVendorId : undefined,
        shipmentCreatedAt: allocation.shipmentCreatedAt ?? undefined,
        shipmentUpdatedAt: allocation.shipmentUpdatedAt ?? undefined,
        allocationTotal: formatCurrency(allocation.totalAmount),
        lineItems: mapOrderLineItems(
          allocation.lineItems,
          allocation.assignedVendorId,
          allocation.originalVendorId,
          allocationStatus,
          shippingStatus,
          fulfillmentStatus,
          allocation.trackingNumber,
          allocation.carrier,
          allocation.trackingUrl,
          allocation.fulfilledAt,
          allocation.shipmentCreatedAt,
          allocation.shipmentUpdatedAt,
        ),
        refundedItems,
        refundTotal: formatCurrency(
          allocation.refundRecords.reduce((total, refund) => total + Number(refund.amount ?? 0), 0).toFixed(2),
        ),
      };
    }),
  };
}

export async function createParatikaHostedPaymentLink(
  shopifyOrderId: string,
): Promise<ParatikaSessionTokenLiveProbeResult> {
  return apiClient.post<ParatikaSessionTokenLiveProbeResult>(
    `/admin/probes/paratika/orders/${encodeURIComponent(shopifyOrderId)}/sessiontoken-live-probe`,
    undefined,
    { skipVendorContext: true },
  );
}

export async function submitFulfillmentTracking(
  allocationId: string,
  payload: SubmitFulfillmentTrackingPayload,
) {
  return apiClient.post<SubmitFulfillmentTrackingResult>(
    `/fulfillments/${allocationId}/tracking`,
    payload,
  );
}

export async function rejectOrder(
  orderId: string,
  payload: RejectOrderPayload,
  options: { vendorId?: string | null } = {},
) {
  const dto = await apiClient.post<OrderDetailDto>(
    `/orders/${encodeURIComponent(orderId)}/reject`,
    payload,
    {
      vendorId: options.vendorId,
    },
  );
  return mapOrderDetail(dto);
}

export async function createShipmentExecution(
  allocationId: string,
  options: { vendorId?: string | null; customerOverrides?: ShipmentCustomerOverrides } = {},
) {
  return apiClient.post<CreateShipmentExecutionResult>('/shipments/create', {
    allocationId,
    customerOverrides: options.customerOverrides,
  }, {
    vendorId: options.vendorId,
  });
}

export async function retryShipmentExecution(shipmentExecutionId: string) {
  return apiClient.post<CreateShipmentExecutionResult>(`/admin/shipments/${shipmentExecutionId}/retry`, {});
}

export async function retryFailedShipmentExecution(
  shipmentExecutionId: string,
  options: {
    vendorId?: string | null;
    customerOverrides?: ShipmentCustomerOverrides;
    useFullSenderDetailsForThisRetry?: boolean;
  } = {},
) {
  return apiClient.post<CreateShipmentExecutionResult>(
    `/shipments/${shipmentExecutionId}/retry`,
    {
      customerOverrides: options.customerOverrides,
      ...(options.useFullSenderDetailsForThisRetry ? { useFullSenderDetailsForThisRetry: true } : {}),
    },
    {
      vendorId: options.vendorId,
    },
  );
}

export async function refreshShipmentExecutionStatus(
  shipmentExecutionId: string,
  options: { vendorId?: string | null } = {},
) {
  return apiClient.post<CreateShipmentExecutionResult>(
    `/shipments/${shipmentExecutionId}/refresh`,
    {},
    {
      vendorId: options.vendorId,
    },
  );
}

export async function refreshShipmentProviderData(
  shipmentExecutionId: string,
  options: { vendorId?: string | null } = {},
) {
  return apiClient.post<CreateShipmentExecutionResult>(
    `/shipments/${shipmentExecutionId}/refresh-provider-data`,
    {},
    {
      vendorId: options.vendorId,
    },
  );
}

export async function cancelShipmentExecution(
  shipmentExecutionId: string,
  options: { vendorId?: string | null } = {},
) {
  return apiClient.post<CreateShipmentExecutionResult>(
    `/shipments/${shipmentExecutionId}/cancel`,
    {},
    {
      vendorId: options.vendorId,
    },
  );
}

export async function updateNavlungoShipmentExecution(
  shipmentExecutionId: string,
  payload: UpdateNavlungoShipmentPayload,
  options: { vendorId?: string | null } = {},
) {
  return apiClient.post<CreateShipmentExecutionResult>(
    `/shipments/${shipmentExecutionId}/update-navlungo`,
    payload,
    {
      vendorId: options.vendorId,
    },
  );
}

export async function createReturnShipmentLabel(
  shipmentExecutionId: string,
  options: { vendorId?: string | null; dryRun?: boolean; customerOverrides?: ShipmentCustomerOverrides } = {},
) {
  return apiClient.post<CreateShipmentExecutionResult>(
    `/shipments/${shipmentExecutionId}/create-return`,
    {
      ...(options.dryRun ? { dryRun: true } : {}),
      ...(options.customerOverrides ? { customerOverrides: options.customerOverrides } : {}),
    },
    {
      vendorId: options.vendorId,
    },
  );
}

export async function probeShopifyReturnLabelUpload(shipmentExecutionId: string) {
  return apiClient.post<CreateShipmentExecutionResult>(
    `/admin/shipments/${shipmentExecutionId}/probe-shopify-return-label`,
    {},
  );
}

export async function probeTryOtoReturnDetails(shipmentExecutionId: string) {
  return apiClient.post<CreateShipmentExecutionResult>(
    `/admin/shipments/${shipmentExecutionId}/probe-try-oto-return-details`,
    {},
  );
}

export async function probeTryOtoReturnLink(shipmentExecutionId: string) {
  return apiClient.post<CreateShipmentExecutionResult>(
    `/admin/shipments/${shipmentExecutionId}/probe-try-oto-return-link`,
    {},
  );
}

export async function probeTryOtoReturnAwbPrint(shipmentExecutionId: string) {
  return apiClient.post<CreateShipmentExecutionResult>(
    `/admin/shipments/${shipmentExecutionId}/probe-try-oto-return-awb-print`,
    {},
  );
}

export async function getShippingProviderDiagnostics(
  provider: ShippingProvider | 'navlungo' = 'kargo_entegrator',
  options: { vendorId?: string | null; signal?: AbortSignal } = {},
) {
  const params = new URLSearchParams({ provider });
  if (options.vendorId) {
    params.set('vendorId', options.vendorId);
  }
  return apiClient.get<ShippingProviderDiagnosticsResult>(`/admin/shipments/provider-config?${params.toString()}`, {
    signal: options.signal,
  });
}

export async function getVendorShippingConfig(options: { vendorId?: string | null; signal?: AbortSignal } = {}) {
  return apiClient.get<VendorShippingConfig>('/shipping/config', {
    vendorId: options.vendorId,
    signal: options.signal,
  });
}

export async function updateVendorShippingConfig(vendorId: string, input: VendorShippingConfigUpdate) {
  return apiClient.put<VendorShippingConfig>(
    `/admin/vendors/${encodeURIComponent(vendorId)}/shipping-config`,
    input,
  );
}

export async function syncKargonomiWarehouseDetails(vendorId: string, warehouseId: string) {
  return apiClient.post<KargonomiWarehouseSyncResult>(
    `/admin/vendors/${encodeURIComponent(vendorId)}/shipping-config/kargonomi/warehouses/${encodeURIComponent(warehouseId)}/sync`,
    {},
  );
}
