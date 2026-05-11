import { prisma } from '../../db/prisma.js';
import type { ReturnDetailDto, ReturnSummaryDto } from './returns.types.js';

function toAmountString(value: number) {
  return value.toFixed(2);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export async function listVendorReturns(vendorId: string): Promise<ReturnSummaryDto[]> {
  const records = await prisma.returnRecord.findMany({
    where: {
      vendorAllocation: {
        assignedVendorId: vendorId,
      },
    },
    include: {
      vendorAllocation: {
        include: {
          refundRecords: {
            orderBy: {
              createdAt: 'asc',
            },
          },
          lineItems: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return records.map((record) => {
    const refundAmount = record.vendorAllocation.refundRecords.reduce(
      (sum, refund) => sum + toNumber(refund.amount),
      0,
    );
    const sourceRefundId = record.vendorAllocation.refundRecords[0]?.sourceShopifyRefundId ?? '';
    return {
      id: record.id,
      sourceShopifyOrderId: record.sourceShopifyOrderId,
      sourceShopifyOrderNumber: record.sourceShopifyOrderNumber,
      sourceShopifyRefundId: sourceRefundId,
      vendorId: record.vendorAllocation.assignedVendorId,
      assignedVendorId: record.vendorAllocation.assignedVendorId,
      status: record.status,
      refundAmount: toAmountString(refundAmount),
      refundedItemCount: record.vendorAllocation.lineItems.length,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  });
}

export async function getVendorReturnById(vendorId: string, returnId: string): Promise<ReturnDetailDto | null> {
  const record = await prisma.returnRecord.findFirst({
    where: {
      id: returnId,
      vendorAllocation: {
        assignedVendorId: vendorId,
      },
    },
    include: {
      vendorAllocation: {
        include: {
          lineItems: {
            include: {
              shopifyOrderLineItem: true,
            },
          },
          refundRecords: {
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
      },
    },
  });

  if (!record) {
    return null;
  }

  const refundAmount = record.vendorAllocation.refundRecords.reduce(
    (sum, refund) => sum + toNumber(refund.amount),
    0,
  );
  const sourceRefundId = record.vendorAllocation.refundRecords[0]?.sourceShopifyRefundId ?? '';

  return {
    id: record.id,
    sourceShopifyOrderId: record.sourceShopifyOrderId,
    sourceShopifyOrderNumber: record.sourceShopifyOrderNumber,
    sourceShopifyRefundId: sourceRefundId,
    vendorId: record.vendorAllocation.assignedVendorId,
    assignedVendorId: record.vendorAllocation.assignedVendorId,
    status: record.status,
    refundAmount: toAmountString(refundAmount),
    refundedItemCount: record.vendorAllocation.lineItems.length,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    sourceShopifyInternalOrderId: record.vendorAllocation.sourceShopifyOrderId,
    originalVendorId: record.vendorAllocation.originalVendorId,
    refundedItems: record.vendorAllocation.lineItems.map((item) => ({
      id: item.id,
      sourceLineItemId: item.shopifyOrderLineItem.sourceLineItemId,
      sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
      sku: item.shopifyOrderLineItem.sku,
      title: item.shopifyOrderLineItem.title,
      quantity: item.quantity,
      refundAmount: toAmountString(toNumber(item.lineAmount)),
    })),
  };
}
