import { apiClient } from '../../lib/api-client';
import type { ReturnDetail, ReturnSummary } from '../../lib/api/contracts';

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
  createdAt: string;
  updatedAt: string;
};

type ReturnDetailDto = ReturnSummaryDto & {
  sourceShopifyInternalOrderId: string;
  originalVendorId: string;
  requestCreatedAt: string | null;
  requestUpdatedAt: string | null;
  refundedItems: Array<{
    id: string;
    sourceLineItemId: string;
    sourceVariantId: string | null;
    sku: string | null;
    title: string | null;
    quantity: number;
    refundAmount: string;
  }>;
};

function formatMoney(amount: string) {
  const value = Number(amount ?? 0);
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function mapStatus(status: string): ReturnSummary['status'] {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'requested') {
    return 'Pending';
  }
  if (normalized === 'approved') {
    return 'Approved';
  }
  if (normalized === 'declined' || normalized === 'cancelled') {
    return 'Rejected';
  }
  if (normalized === 'closed') {
    return 'Refunded';
  }
  if (normalized === 'rejected') {
    return 'Rejected';
  }
  if (normalized === 'refunded') {
    return 'Refunded';
  }
  if (normalized === 'in review' || normalized === 'in_review' || normalized === 'needs_review') {
    return 'In Review';
  }
  return 'Pending';
}

function mapSummary(dto: ReturnSummaryDto): ReturnSummary {
  const sourceType = dto.returnRequestSource === 'shopify_return_request'
    ? 'Shopify return request lifecycle'
    : 'Shopify refund webhook allocation';
  const sourceId = dto.sourceShopifyReturnId
    ? `Return ${dto.sourceShopifyReturnId}`
    : dto.sourceShopifyRefundId
      ? `Refund ${dto.sourceShopifyRefundId}`
      : 'Pending Shopify source link';

  return {
    id: dto.id,
    originalVendorId: dto.assignedVendorId,
    assignedVendorId: dto.assignedVendorId,
    vendorId: dto.assignedVendorId,
    sourceShopifyOrderId: dto.sourceShopifyOrderId,
    sourceShopifyOrderNumber: dto.sourceShopifyOrderNumber,
    sourceShopifyRefundId: dto.sourceShopifyRefundId,
    sourceShopifyReturnId: dto.sourceShopifyReturnId,
    sourceType: dto.returnRequestSource === 'shopify_return_request' ? 'shopify_return_request' : 'shopify_refund',
    status: mapStatus(dto.status),
    relatedOrderId: dto.sourceShopifyOrderId,
    date: dto.createdAt,
    updatedAt: dto.updatedAt,
    customer: 'Shopify customer details stay outside the current refund sync scope.',
    reason: `${sourceType} · ${sourceId}`,
    amount: formatMoney(dto.refundAmount),
    refundedSkus: dto.refundedSkus,
  };
}

export async function listReturns() {
  const response = await apiClient.get<ReturnSummaryDto[]>('/returns');
  return response.map(mapSummary);
}

export async function getReturn(returnId: string): Promise<ReturnDetail> {
  const response = await apiClient.get<ReturnDetailDto>(`/returns/${returnId}`);
  const summary = mapSummary(response);
  const refundedItems = response.refundedItems.map((item) => ({
    id: item.id,
    originalVendorId: response.originalVendorId,
    assignedVendorId: response.assignedVendorId,
    vendorId: response.assignedVendorId,
    sku: item.sku ?? 'UNKNOWN-SKU',
    variantTitle: item.sourceVariantId ?? 'Default',
    name: item.title ?? 'Refunded line item',
    quantity: item.quantity,
    condition: 'Opened' as const,
    refundAmount: formatMoney(item.refundAmount),
  }));

  return {
    ...summary,
    originalVendorId: response.originalVendorId,
    resolution:
      response.returnRequestSource === 'shopify_return_request'
        ? 'Pending return request synced from Shopify return lifecycle.'
        : response.status === 'Refunded'
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
