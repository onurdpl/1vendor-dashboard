import { apiClient } from '../../lib/api-client';
import type { ReturnDetail, ReturnSummary } from '../../lib/api/contracts';
import { formatCurrency, toTitleCaseLabel } from './formatting';

type ReturnSummaryDto = {
  id: string;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string;
  sourceShopifyRefundId: string;
  sourceShopifyReturnId: string | null;
  sourceShopifyReturnGid: string | null;
  returnLifecycleStatus: string | null;
  returnRequestSource: string | null;
  vendorId: string;
  assignedVendorId: string;
  status: string;
  reason?: string | null;
  returnReasonNote?: string | null;
  returnProvider?: string | null;
  returnProviderShipmentId?: string | null;
  returnLabel?: string | null;
  returnReferenceId?: string | null;
  navlungoReturnCreatedAt?: string | null;
  returnProviderSnapshot?: Record<string, unknown> | null;
  returnCarrierName?: string | null;
  returnTrackingNumber?: string | null;
  returnTrackingUrl?: string | null;
  vendorReceivedAt?: string | null;
  vendorReviewedAt?: string | null;
  vendorDecision?: 'approved' | 'rejected' | null;
  vendorDecisionReason?: string | null;
  refundAmount: string;
  refundedItemCount: number;
  refundedSkus: string[];
  itemTitle?: string | null;
  displayTitle?: string | null;
  variantTitle?: string | null;
  refundedItems?: Array<{
    id: string;
    sourceLineItemId?: string;
    sourceVariantId: string | null;
    sku: string | null;
    title: string | null;
    itemTitle?: string | null;
    displayTitle?: string | null;
    name?: string | null;
    productTitle?: string | null;
    productName?: string | null;
    lineItemTitle?: string | null;
    orderLineItemTitle?: string | null;
    variantTitle?: string | null;
    variant?: string | null;
    optionTitle?: string | null;
    imageUrl?: string | null;
    product?: {
      title?: string | null;
      name?: string | null;
    } | null;
    merchandise?: {
      title?: string | null;
      name?: string | null;
      product?: {
        title?: string | null;
        name?: string | null;
      } | null;
    } | null;
    lineItem?: {
      title?: string | null;
      name?: string | null;
      productTitle?: string | null;
      productName?: string | null;
    } | null;
    orderLineItem?: {
      title?: string | null;
      name?: string | null;
      productTitle?: string | null;
      productName?: string | null;
    } | null;
    quantity: number;
    refundAmount: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

type ReturnDetailDto = ReturnSummaryDto & {
  sourceShopifyInternalOrderId: string;
  originalVendorId: string;
  requestCreatedAt: string | null;
  requestUpdatedAt: string | null;
  refundedItems: NonNullable<ReturnSummaryDto['refundedItems']>;
};

function mapStatus(status: string, sourceType: ReturnSummary['sourceType']): ReturnSummary['status'] {
  const normalized = status.trim().toLowerCase();
  if (sourceType === 'shopify_return_request') {
    if (normalized === 'requested') {
      return 'Requested';
    }
    if (normalized === 'approved') {
      return 'Approved';
    }
    if (normalized === 'declined') {
      return 'Declined';
    }
    if (normalized === 'cancelled') {
      return 'Cancelled';
    }
    if (normalized === 'closed') {
      return 'Closed';
    }
    return toTitleCaseLabel(status) as ReturnSummary['status'];
  }

  if (normalized === 'processed' || normalized === 'refunded' || normalized === 'approved') {
    return 'Processed';
  }

  return toTitleCaseLabel(status) as ReturnSummary['status'];
}

function readDtoText(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  const text = value.trim();
  const normalized = text.toLowerCase();
  if (
    !text ||
    text === 'Return item' ||
    normalized === 'default' ||
    normalized === 'default title' ||
    /^gid:\/\//i.test(text) ||
    /^unknown-sku$/i.test(text)
  ) {
    return '';
  }

  return text;
}

function readDtoProductText(value: unknown, sku?: string | null) {
  const text = readDtoText(value)
    .replace(/\s*\/\s*default(?:\s+title)?$/i, '')
    .trim();
  const normalizedSku = readDtoText(sku);
  if (!text || (normalizedSku && text === normalizedSku) || /^\d{6,}$/.test(text)) {
    return '';
  }

  return text;
}

function readFirstDtoText(...values: unknown[]) {
  return values.map(readDtoText).find(Boolean) ?? '';
}

function readFirstDtoProductText(sku: string | null | undefined, ...values: unknown[]) {
  return values.map((value) => readDtoProductText(value, sku)).find(Boolean) ?? '';
}

function formatReturnReason(value: string | null | undefined) {
  const text = readDtoText(value);
  if (!text) {
    return '';
  }

  if (!text.includes('_') && text !== text.toUpperCase()) {
    return text;
  }

  return text
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

type ReturnItemDto = NonNullable<ReturnSummaryDto['refundedItems']>[number];

function getReturnItemFallbackName(item: Pick<ReturnItemDto, 'sku'>) {
  return readDtoText(item.sku) || 'Unknown item';
}

function resolveReturnItemName(item: ReturnItemDto) {
  return readFirstDtoProductText(
    item.sku,
    item.displayTitle,
    item.itemTitle,
    item.productTitle,
    item.productName,
    item.product?.title,
    item.product?.name,
    item.lineItemTitle,
    item.lineItem?.productTitle,
    item.lineItem?.productName,
    item.lineItem?.title,
    item.lineItem?.name,
    item.orderLineItemTitle,
    item.orderLineItem?.productTitle,
    item.orderLineItem?.productName,
    item.orderLineItem?.title,
    item.orderLineItem?.name,
    item.merchandise?.product?.title,
    item.merchandise?.product?.name,
    item.merchandise?.title,
    item.merchandise?.name,
    item.title,
    item.name,
    item.variantTitle,
    item.variant,
    item.optionTitle,
  ) || getReturnItemFallbackName(item);
}

function resolveReturnItemVariant(item: ReturnItemDto) {
  return readFirstDtoText(item.variantTitle, item.variant, item.optionTitle) || 'Details pending';
}

function mapReturnLineItem(item: ReturnItemDto, originalVendorId: string, assignedVendorId: string) {
  return {
    id: item.id,
    originalVendorId,
    assignedVendorId,
    vendorId: assignedVendorId,
    sku: item.sku ?? 'UNKNOWN-SKU',
    variantTitle: resolveReturnItemVariant(item),
    name: resolveReturnItemName(item),
    imageUrl: item.imageUrl ?? null,
    quantity: item.quantity,
    condition: 'Opened' as const,
    refundAmount: formatCurrency(item.refundAmount),
  };
}

function mapSummary(dto: ReturnSummaryDto): ReturnSummary {
  const sourceType = dto.returnRequestSource === 'shopify_return_request' ? 'shopify_return_request' : 'shopify_refund';
  const sourceLabel = dto.returnRequestSource === 'shopify_return_request'
    ? 'Shopify return request lifecycle'
    : 'Shopify refund webhook allocation';
  const sourceId = dto.sourceShopifyReturnId
    ? `Return ${dto.sourceShopifyReturnId}`
    : dto.sourceShopifyRefundId
      ? `Refund ${dto.sourceShopifyRefundId}`
      : 'Pending Shopify source link';

  const summaryDisplayTitle = readFirstDtoProductText(
    dto.refundedSkus[0],
    dto.displayTitle,
    dto.itemTitle,
  );
  const summaryVariantTitle = readFirstDtoText(dto.variantTitle);
  const summaryFallbackItem =
    summaryDisplayTitle || summaryVariantTitle || dto.refundedSkus[0]
      ? [{
          id: `${dto.id}-summary-item`,
          sourceLineItemId: undefined,
          sourceVariantId: null,
          sku: dto.refundedSkus[0] ?? null,
          title: summaryDisplayTitle || null,
          itemTitle: summaryDisplayTitle || null,
          displayTitle: summaryDisplayTitle || null,
          variantTitle: summaryVariantTitle || null,
          quantity: dto.refundedItemCount || 1,
          refundAmount: dto.refundAmount,
        }]
      : [];
  const refundedItemsSource = dto.refundedItems?.length ? dto.refundedItems : summaryFallbackItem;
  const refundedItems = refundedItemsSource.map((item) => mapReturnLineItem(item, dto.assignedVendorId, dto.assignedVendorId));

  return {
    id: dto.id,
    originalVendorId: dto.assignedVendorId,
    assignedVendorId: dto.assignedVendorId,
    vendorId: dto.assignedVendorId,
    sourceShopifyOrderId: dto.sourceShopifyOrderId,
    sourceShopifyOrderNumber: dto.sourceShopifyOrderNumber,
    sourceShopifyRefundId: dto.sourceShopifyRefundId,
    sourceShopifyReturnId: dto.sourceShopifyReturnId,
    sourceType,
    status: mapStatus(dto.status, sourceType),
    relatedOrderId: dto.sourceShopifyOrderId,
    date: dto.createdAt,
    updatedAt: dto.updatedAt,
    customer: 'Customer unavailable',
    reason: formatReturnReason(dto.reason) || `${sourceLabel} · ${sourceId}`,
    returnReasonNote: readDtoText(dto.returnReasonNote) || null,
    returnProvider: readDtoText(dto.returnProvider) || null,
    returnProviderShipmentId: readDtoText(dto.returnProviderShipmentId) || null,
    returnLabel: readDtoText(dto.returnLabel) || null,
    returnReferenceId: readDtoText(dto.returnReferenceId) || null,
    navlungoReturnCreatedAt: dto.navlungoReturnCreatedAt ?? null,
    returnProviderSnapshot: dto.returnProviderSnapshot ?? null,
    returnCarrierName: readDtoText(dto.returnCarrierName) || null,
    returnTrackingNumber: readDtoText(dto.returnTrackingNumber) || null,
    returnTrackingUrl: readDtoText(dto.returnTrackingUrl) || null,
    vendorReceivedAt: dto.vendorReceivedAt ?? null,
    vendorReviewedAt: dto.vendorReviewedAt ?? null,
    vendorDecision: dto.vendorDecision ?? null,
    vendorDecisionReason: readDtoText(dto.vendorDecisionReason) || null,
    amount: formatCurrency(dto.refundAmount),
    itemTitle: summaryDisplayTitle || null,
    displayTitle: summaryDisplayTitle || null,
    variantTitle: summaryVariantTitle || null,
    refundedSkus: dto.refundedSkus,
    refundedItems,
  };
}

function readVendorRequestOptions(options: { vendorId?: string | null; signal?: AbortSignal } = {}) {
  const requestOptions: { vendorId?: string; signal?: AbortSignal } = {};
  if (options.vendorId) requestOptions.vendorId = options.vendorId;
  if (options.signal) requestOptions.signal = options.signal;
  return Object.keys(requestOptions).length > 0 ? requestOptions : undefined;
}

export async function listReturns(options: { limit?: number; offset?: number; vendorId?: string | null; signal?: AbortSignal } = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  const path = `/returns${params.size ? `?${params.toString()}` : ''}`;
  const requestOptions = readVendorRequestOptions(options);
  const response = await (requestOptions
    ? apiClient.get<ReturnSummaryDto[]>(path, requestOptions)
    : apiClient.get<ReturnSummaryDto[]>(path));
  const mapped = response.map(mapSummary);
  return mapped;
}

export async function getReturn(returnId: string, options: { vendorId?: string | null; signal?: AbortSignal } = {}): Promise<ReturnDetail> {
  const requestOptions = readVendorRequestOptions(options);
  const response = await (requestOptions
    ? apiClient.get<ReturnDetailDto>(`/returns/${returnId}`, requestOptions)
    : apiClient.get<ReturnDetailDto>(`/returns/${returnId}`));
  const summary = mapSummary(response);
  const refundedItems = response.refundedItems.map((item) => mapReturnLineItem(item, response.originalVendorId, response.assignedVendorId));

  const detail = {
    ...summary,
    originalVendorId: response.originalVendorId,
    resolution:
      response.returnReasonNote
        ? response.returnReasonNote
        : response.returnRequestSource === 'shopify_return_request'
        ? ''
        : summary.status === 'Processed'
          ? 'Refund processed and allocated to vendor scope.'
          : 'Refund allocation recorded for operational review.',
    refundMethod:
      response.returnRequestSource === 'shopify_return_request'
        ? 'Pending return request (no refund posted yet)'
        : 'Original payment method (Shopify refund flow)',
    processedBy:
      response.returnRequestSource === 'shopify_return_request'
        ? 'Shopify return lifecycle webhook ingestion via backend'
        : 'Shopify webhook ingestion via backend',
    refundedItems,
    items: refundedItems,
    timeline: [
      {
        label: response.returnRequestSource === 'shopify_return_request' ? 'Return requested' : 'Refund requested',
        at: response.requestCreatedAt ?? response.createdAt,
      },
      { label: 'Latest backend update', at: response.updatedAt },
    ],
  };
  return detail;
}

export async function createNavlungoReturnPickup(
  returnId: string,
  input: {
    dryRun?: boolean;
    apiVersionOverride?: 'current' | 'v2' | 'v2.1';
    endpointVersionOverride?: 'current' | 'v2' | 'v2.1';
    carrierOverride?: 'current' | '9' | '10';
    carrierIdOverride?: 'current' | '9' | '10';
    endpointPathOverride?: '/post/create' | '/post/return';
    diagnosticConfirm?: 'YES';
    customerOverrides?: Record<string, string | undefined>;
  } = {},
  options: { vendorId?: string | null } = {},
): Promise<ReturnDetail> {
  const requestOptions = readVendorRequestOptions(options);
  const response = await (requestOptions
    ? apiClient.post<ReturnDetailDto>(`/returns/${returnId}/navlungo-return-pickup`, input, requestOptions)
    : apiClient.post<ReturnDetailDto>(`/returns/${returnId}/navlungo-return-pickup`, input));
  const summary = mapSummary(response);
  const refundedItems = response.refundedItems.map((item) => mapReturnLineItem(item, response.originalVendorId, response.assignedVendorId));

  return {
    ...summary,
    originalVendorId: response.originalVendorId,
    resolution: response.returnReasonNote ?? '',
    refundMethod:
      response.returnRequestSource === 'shopify_return_request'
        ? 'Pending return request (no refund posted yet)'
        : 'Original payment method (Shopify refund flow)',
    processedBy: '',
    refundedItems,
    items: refundedItems,
    timeline: [
      {
        label: response.returnRequestSource === 'shopify_return_request' ? 'Return requested' : 'Refund requested',
        at: response.requestCreatedAt ?? response.createdAt,
      },
      { label: 'Latest backend update', at: response.updatedAt },
    ],
  };
}

export async function saveNavlungoReturnPickupAddressCompletion(
  returnId: string,
  input: { customerOverrides?: Record<string, string | undefined> } = {},
  options: { vendorId?: string | null } = {},
): Promise<ReturnDetail> {
  const requestOptions = readVendorRequestOptions(options);
  const response = await (requestOptions
    ? apiClient.post<ReturnDetailDto>(`/returns/${returnId}/navlungo-return-pickup/address-completion`, input, requestOptions)
    : apiClient.post<ReturnDetailDto>(`/returns/${returnId}/navlungo-return-pickup/address-completion`, input));
  const summary = mapSummary(response);
  const refundedItems = response.refundedItems.map((item) => mapReturnLineItem(item, response.originalVendorId, response.assignedVendorId));

  return {
    ...summary,
    originalVendorId: response.originalVendorId,
    resolution: response.returnReasonNote ?? '',
    refundMethod:
      response.returnRequestSource === 'shopify_return_request'
        ? 'Pending return request (no refund posted yet)'
        : 'Original payment method (Shopify refund flow)',
    processedBy: '',
    refundedItems,
    items: refundedItems,
    timeline: [
      {
        label: response.returnRequestSource === 'shopify_return_request' ? 'Return requested' : 'Refund requested',
        at: response.requestCreatedAt ?? response.createdAt,
      },
      { label: 'Latest backend update', at: response.updatedAt },
    ],
  };
}

export async function syncNavlungoReturnStatus(
  returnId: string,
  options: { vendorId?: string | null } = {},
): Promise<ReturnDetail> {
  const requestOptions = readVendorRequestOptions(options);
  const response = await (requestOptions
    ? apiClient.post<ReturnDetailDto>(`/returns/${returnId}/navlungo-return-status-sync`, {}, requestOptions)
    : apiClient.post<ReturnDetailDto>(`/returns/${returnId}/navlungo-return-status-sync`, {}));
  const summary = mapSummary(response);
  const refundedItems = response.refundedItems.map((item) => mapReturnLineItem(item, response.originalVendorId, response.assignedVendorId));

  return {
    ...summary,
    originalVendorId: response.originalVendorId,
    resolution: response.returnReasonNote ?? '',
    refundMethod:
      response.returnRequestSource === 'shopify_return_request'
        ? 'Pending return request (no refund posted yet)'
        : 'Original payment method (Shopify refund flow)',
    processedBy: '',
    refundedItems,
    items: refundedItems,
    timeline: [
      {
        label: response.returnRequestSource === 'shopify_return_request' ? 'Return requested' : 'Refund requested',
        at: response.requestCreatedAt ?? response.createdAt,
      },
      { label: 'Latest backend update', at: response.updatedAt },
    ],
  };
}

export async function markReturnReceived(
  returnId: string,
  options: { vendorId?: string | null } = {},
): Promise<ReturnDetail> {
  const requestOptions = readVendorRequestOptions(options);
  const response = await (requestOptions
    ? apiClient.post<ReturnDetailDto>(`/returns/${returnId}/mark-received`, {}, requestOptions)
    : apiClient.post<ReturnDetailDto>(`/returns/${returnId}/mark-received`, {}));
  const summary = mapSummary(response);
  return {
    ...summary,
    originalVendorId: response.originalVendorId,
    resolution: response.returnReasonNote ?? '',
    refundMethod:
      response.returnRequestSource === 'shopify_return_request'
        ? 'Pending return request (no refund posted yet)'
        : 'Original payment method (Shopify refund flow)',
    processedBy: '',
    refundedItems: response.refundedItems.map((item) => mapReturnLineItem(item, response.originalVendorId, response.assignedVendorId)),
    items: response.refundedItems.map((item) => mapReturnLineItem(item, response.originalVendorId, response.assignedVendorId)),
    timeline: [],
  };
}

export async function reviewReturn(
  returnId: string,
  input: { decision: 'approved' | 'rejected'; reason?: string },
  options: { vendorId?: string | null } = {},
): Promise<ReturnDetail> {
  const requestOptions = readVendorRequestOptions(options);
  const response = await (requestOptions
    ? apiClient.post<ReturnDetailDto>(`/returns/${returnId}/review`, input, requestOptions)
    : apiClient.post<ReturnDetailDto>(`/returns/${returnId}/review`, input));
  const summary = mapSummary(response);
  return {
    ...summary,
    originalVendorId: response.originalVendorId,
    resolution: response.returnReasonNote ?? '',
    refundMethod:
      response.returnRequestSource === 'shopify_return_request'
        ? 'Pending return request (no refund posted yet)'
        : 'Original payment method (Shopify refund flow)',
    processedBy: '',
    refundedItems: response.refundedItems.map((item) => mapReturnLineItem(item, response.originalVendorId, response.assignedVendorId)),
    items: response.refundedItems.map((item) => mapReturnLineItem(item, response.originalVendorId, response.assignedVendorId)),
    timeline: [],
  };
}
