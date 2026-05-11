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
            include: {
              lineItems: true,
            },
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
    const matchingRefundRecords = record.sourceShopifyRefundId
      ? record.vendorAllocation.refundRecords.filter(
          (refund) => refund.sourceShopifyRefundId === record.sourceShopifyRefundId,
        )
      : record.vendorAllocation.refundRecords;
    const refundAmount = matchingRefundRecords.reduce(
      (sum, refund) => sum + toNumber(refund.amount),
      0,
    );
    const sourceRefundId = record.sourceShopifyRefundId ?? matchingRefundRecords[0]?.sourceShopifyRefundId ?? '';
    const refundedItemCount = matchingRefundRecords.reduce((sum, refund) => {
      return sum + (refund.lineItems.length > 0 ? refund.lineItems.length : 0);
    }, 0) || record.vendorAllocation.lineItems.length;
    const refundedSkus = Array.from(
      new Set(
        matchingRefundRecords.flatMap((refund) =>
          refund.lineItems
            .map((item) => item.sku ?? null)
            .filter((sku): sku is string => Boolean(sku)),
        ),
      ),
    );
    return {
      id: record.id,
      sourceShopifyOrderId: record.sourceShopifyOrderId,
      sourceShopifyOrderNumber: record.sourceShopifyOrderNumber,
      sourceShopifyRefundId: sourceRefundId,
      vendorId: record.vendorAllocation.assignedVendorId,
      assignedVendorId: record.vendorAllocation.assignedVendorId,
      status: record.status,
      refundAmount: toAmountString(refundAmount),
      refundedItemCount,
      refundedSkus,
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
            include: {
              lineItems: {
                include: {
                  shopifyOrderLineItem: true,
                },
              },
            },
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

  const matchingRefundRecords = record.sourceShopifyRefundId
    ? record.vendorAllocation.refundRecords.filter(
        (refund) => refund.sourceShopifyRefundId === record.sourceShopifyRefundId,
      )
    : record.vendorAllocation.refundRecords;
  const refundAmount = matchingRefundRecords.reduce(
    (sum, refund) => sum + toNumber(refund.amount),
    0,
  );
  const sourceRefundId = record.sourceShopifyRefundId ?? matchingRefundRecords[0]?.sourceShopifyRefundId ?? '';
  const refundLineItems = matchingRefundRecords.flatMap((refund) => refund.lineItems);
  const refundedItems =
    refundLineItems.length > 0
      ? refundLineItems.map((item) => ({
          id: item.id,
          sourceLineItemId: item.sourceLineItemId,
          sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
          sku: item.shopifyOrderLineItem.sku,
          title: item.title ?? item.shopifyOrderLineItem.title,
          quantity: item.quantity,
          refundAmount: toAmountString(toNumber(item.subtotal)),
        }))
      : record.vendorAllocation.lineItems.map((item) => ({
          id: item.id,
          sourceLineItemId: item.shopifyOrderLineItem.sourceLineItemId,
          sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
          sku: item.shopifyOrderLineItem.sku,
          title: item.shopifyOrderLineItem.title,
          quantity: item.quantity,
          refundAmount: toAmountString(toNumber(item.lineAmount)),
        }));
  const refundedSkus = Array.from(
    new Set(
      refundedItems
        .map((item) => item.sku)
        .filter((sku): sku is string => Boolean(sku)),
    ),
  );

  return {
    id: record.id,
    sourceShopifyOrderId: record.sourceShopifyOrderId,
    sourceShopifyOrderNumber: record.sourceShopifyOrderNumber,
    sourceShopifyRefundId: sourceRefundId,
    vendorId: record.vendorAllocation.assignedVendorId,
    assignedVendorId: record.vendorAllocation.assignedVendorId,
    status: record.status,
    refundAmount: toAmountString(refundAmount),
    refundedItemCount: refundLineItems.length || record.vendorAllocation.lineItems.length,
    refundedSkus,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    sourceShopifyInternalOrderId: record.vendorAllocation.sourceShopifyOrderId,
    originalVendorId: record.vendorAllocation.originalVendorId,
    refundedItems,
  };
}
