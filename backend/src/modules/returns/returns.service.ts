import { prisma } from '../../db/prisma.js';
import type { ReturnDetailDto, ReturnSummaryDto } from './returns.types.js';

function toAmountString(value: number) {
  return value.toFixed(2);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getRefundSourceId(record: {
  sourceShopifyRefundId: string | null;
  vendorAllocation: {
    refundRecords: Array<{
      sourceShopifyRefundId: string;
    }>;
  };
}) {
  return record.sourceShopifyRefundId ?? record.vendorAllocation.refundRecords[0]?.sourceShopifyRefundId ?? '';
}

function getLifecycleStatus(status: string, lifecycleStatus: string | null) {
  return lifecycleStatus || status;
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
    const sourceRefundId = getRefundSourceId(record);
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
      sourceShopifyReturnId: record.sourceShopifyReturnId,
      sourceShopifyReturnGid: record.sourceShopifyReturnGid,
      returnLifecycleStatus: record.returnLifecycleStatus,
      returnRequestSource: record.returnRequestSource,
      vendorId: record.vendorAllocation.assignedVendorId,
      assignedVendorId: record.vendorAllocation.assignedVendorId,
      status: getLifecycleStatus(record.status, record.returnLifecycleStatus),
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
  const sourceRefundId = getRefundSourceId(record);
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
    sourceShopifyReturnId: record.sourceShopifyReturnId,
    sourceShopifyReturnGid: record.sourceShopifyReturnGid,
    returnLifecycleStatus: record.returnLifecycleStatus,
    returnRequestSource: record.returnRequestSource,
    vendorId: record.vendorAllocation.assignedVendorId,
    assignedVendorId: record.vendorAllocation.assignedVendorId,
    status: getLifecycleStatus(record.status, record.returnLifecycleStatus),
    refundAmount: toAmountString(refundAmount),
    refundedItemCount: refundLineItems.length || record.vendorAllocation.lineItems.length,
    refundedSkus,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    sourceShopifyInternalOrderId: record.vendorAllocation.sourceShopifyOrderId,
    originalVendorId: record.vendorAllocation.originalVendorId,
    requestCreatedAt: record.requestCreatedAt ? record.requestCreatedAt.toISOString() : null,
    requestUpdatedAt: record.requestUpdatedAt ? record.requestUpdatedAt.toISOString() : null,
    refundedItems,
  };
}
