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
