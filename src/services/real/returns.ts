import { apiClient } from '../../lib/api-client';
import type { ReturnDetail, ReturnSummary } from '../../lib/api/contracts';

type ReturnSummaryDto = {
  id: string;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string;
  sourceShopifyRefundId: string;
  vendorId: string;
  assignedVendorId: string;
  status: string;
  refundAmount: string;
  refundedItemCount: number;
  createdAt: string;
  updatedAt: string;
};

type ReturnDetailDto = ReturnSummaryDto & {
  sourceShopifyInternalOrderId: string;
  originalVendorId: string;
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
  if (normalized === 'approved') {
    return 'Approved';
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
  return {
    id: dto.id,
    originalVendorId: dto.assignedVendorId,
    assignedVendorId: dto.assignedVendorId,
    vendorId: dto.assignedVendorId,
    sourceShopifyOrderId: dto.sourceShopifyOrderId,
    sourceShopifyOrderNumber: dto.sourceShopifyOrderNumber,
    sourceShopifyRefundId: dto.sourceShopifyRefundId,
    status: mapStatus(dto.status),
    relatedOrderId: dto.sourceShopifyOrderId,
    date: dto.createdAt,
    customer: 'Customer details available in return view',
    reason: 'Refund allocation synced from backend refund records.',
    amount: formatMoney(dto.refundAmount),
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
    resolution: 'Backend-scoped refund allocation.',
    refundMethod: 'Original payment method',
    processedBy: 'Backend sync',
    refundedItems,
    items: refundedItems,
    timeline: [
      { label: 'Return record created', at: response.createdAt },
      { label: 'Latest backend update', at: response.updatedAt },
    ],
  };
}
