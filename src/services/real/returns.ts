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
  refundAmount: string;
  refundedItemCount: number;
  refundedSkus: string[];
  refundedItems?: Array<{
    id: string;
    sourceLineItemId: string;
    sourceVariantId: string | null;
    sku: string | null;
    title: string | null;
    name?: string | null;
    productTitle?: string | null;
    productName?: string | null;
    lineItemTitle?: string | null;
    orderLineItemTitle?: string | null;
    variantTitle?: string | null;
    variant?: string | null;
    optionTitle?: string | null;
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
  if (!text || text === 'Return item' || /^gid:\/\//i.test(text) || /^unknown-sku$/i.test(text)) {
    return '';
  }

  return text;
}

function readDtoProductText(value: unknown, sku?: string | null) {
  const text = readDtoText(value);
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

type ReturnItemDto = NonNullable<ReturnSummaryDto['refundedItems']>[number];

function getReturnItemFallbackName(item: Pick<ReturnItemDto, 'sku'>) {
  return readDtoText(item.sku) || 'Unknown item';
}

function resolveReturnItemName(item: ReturnItemDto) {
  return readFirstDtoProductText(
    item.sku,
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
  return readFirstDtoText(item.variantTitle, item.variant, item.optionTitle, 'Default');
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

  const refundedItems = (dto.refundedItems ?? []).map((item) => ({
    id: item.id,
    originalVendorId: dto.assignedVendorId,
    assignedVendorId: dto.assignedVendorId,
    vendorId: dto.assignedVendorId,
    sku: item.sku ?? 'UNKNOWN-SKU',
    variantTitle: resolveReturnItemVariant(item),
    name: resolveReturnItemName(item),
    quantity: item.quantity,
    condition: 'Opened' as const,
    refundAmount: formatCurrency(item.refundAmount),
  }));

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
    reason: `${sourceLabel} · ${sourceId}`,
    amount: formatCurrency(dto.refundAmount),
    refundedSkus: dto.refundedSkus,
    refundedItems,
  };
}

function readVendorRequestOptions(vendorId?: string | null) {
  return vendorId ? { vendorId } : undefined;
}

export async function listReturns(options: { limit?: number; offset?: number; vendorId?: string | null } = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  const path = `/returns${params.size ? `?${params.toString()}` : ''}`;
  const requestOptions = readVendorRequestOptions(options.vendorId);
  const response = await (requestOptions
    ? apiClient.get<ReturnSummaryDto[]>(path, requestOptions)
    : apiClient.get<ReturnSummaryDto[]>(path));
  return response.map(mapSummary);
}

export async function getReturn(returnId: string, options: { vendorId?: string | null } = {}): Promise<ReturnDetail> {
  const requestOptions = readVendorRequestOptions(options.vendorId);
  const response = await (requestOptions
    ? apiClient.get<ReturnDetailDto>(`/returns/${returnId}`, requestOptions)
    : apiClient.get<ReturnDetailDto>(`/returns/${returnId}`));
  const summary = mapSummary(response);
  const refundedItems = response.refundedItems.map((item) => ({
    id: item.id,
    originalVendorId: response.originalVendorId,
    assignedVendorId: response.assignedVendorId,
    vendorId: response.assignedVendorId,
    sku: item.sku ?? 'UNKNOWN-SKU',
    variantTitle: resolveReturnItemVariant(item),
    name: resolveReturnItemName(item),
    quantity: item.quantity,
    condition: 'Opened' as const,
    refundAmount: formatCurrency(item.refundAmount),
  }));

  return {
    ...summary,
    originalVendorId: response.originalVendorId,
    resolution:
      response.returnRequestSource === 'shopify_return_request'
        ? 'Pending return request synced from Shopify return lifecycle.'
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
}
