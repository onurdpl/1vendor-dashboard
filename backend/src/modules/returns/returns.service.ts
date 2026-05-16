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

function isReturnRequestRecord(record: { returnRequestSource: string | null }) {
  return record.returnRequestSource === 'shopify_return_request';
}

function readText(value: string | null | undefined) {
  const text = value?.trim();
  if (!text || text === 'Return item' || /^gid:\/\//i.test(text) || /^unknown-sku$/i.test(text)) {
    return null;
  }

  return text;
}

function readProductText(value: string | null | undefined, sku: string | null | undefined) {
  const text = readText(value);
  const normalizedSku = readText(sku);
  if (!text || (normalizedSku && text === normalizedSku) || /^\d{6,}$/.test(text)) {
    return null;
  }

  return text;
}

function resolveReturnedItemDisplayTitle(item: {
  sku: string | null;
  title: string | null;
  orderLineItemTitle?: string | null;
}) {
  return (
    readProductText(item.title, item.sku) ??
    readProductText(item.orderLineItemTitle, item.sku) ??
    readText(item.sku) ??
    null
  );
}

function resolveReturnedItemVariantTitle(item: {
  sku: string | null;
  title: string | null;
  orderLineItemTitle?: string | null;
}) {
  const displayTitle = resolveReturnedItemDisplayTitle(item);
  const variantTitle = readProductText(item.orderLineItemTitle, item.sku);
  return variantTitle && variantTitle !== displayTitle ? variantTitle : null;
}

function withReturnedItemDisplayFields<T extends {
  sku: string | null;
  title: string | null;
  orderLineItemTitle?: string | null;
}>(item: T) {
  const displayTitle = resolveReturnedItemDisplayTitle(item);
  return {
    ...item,
    itemTitle: displayTitle,
    displayTitle,
    variantTitle: resolveReturnedItemVariantTitle(item),
  };
}

function filterReturnRequestAllocationLineItems<
  T extends {
    shopifyOrderLineItem: {
      sourceLineItemId: string;
    };
  },
>(record: { returnRequestSource: string | null; sourceShopifyLineItemId: string | null }, lineItems: T[]) {
  if (!isReturnRequestRecord(record)) {
    return lineItems;
  }

  if (!record.sourceShopifyLineItemId) {
    return [];
  }

  return lineItems.filter(
    (item) => item.shopifyOrderLineItem.sourceLineItemId === record.sourceShopifyLineItemId,
  );
}

export async function listVendorReturns(
  vendorId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<ReturnSummaryDto[]> {
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
          lineItems: {
            include: {
              shopifyOrderLineItem: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: options.limit ?? 100,
    skip: options.offset ?? 0,
  });

  return records.map((record) => {
    const matchingRefundRecords = isReturnRequestRecord(record)
      ? []
      : record.sourceShopifyRefundId
        ? record.vendorAllocation.refundRecords.filter(
            (refund) => refund.sourceShopifyRefundId === record.sourceShopifyRefundId,
          )
        : record.vendorAllocation.refundRecords;
    const refundAmount = matchingRefundRecords.reduce(
      (sum, refund) => sum + toNumber(refund.amount),
      0,
    );
    const sourceRefundId = isReturnRequestRecord(record) ? '' : getRefundSourceId(record);
    const returnRequestLineItems = filterReturnRequestAllocationLineItems(record, record.vendorAllocation.lineItems);
    const refundLineItemCount = matchingRefundRecords.reduce((sum, refund) => {
      return sum + (refund.lineItems.length > 0 ? refund.lineItems.length : 0);
    }, 0);
    const refundedItemCount = isReturnRequestRecord(record)
      ? returnRequestLineItems.length
      : refundLineItemCount || record.vendorAllocation.lineItems.length;
    const refundedSkus = isReturnRequestRecord(record)
      ? Array.from(
          new Set(
            returnRequestLineItems
              .map((item) => item.shopifyOrderLineItem.sku ?? null)
              .filter((sku): sku is string => Boolean(sku)),
          ),
        )
      : Array.from(
          new Set(
            matchingRefundRecords.flatMap((refund) =>
              refund.lineItems
                .map((item) => item.sku ?? null)
                .filter((sku): sku is string => Boolean(sku)),
            ),
          ),
        );
    const refundedItems = isReturnRequestRecord(record)
      ? returnRequestLineItems.map((item) => ({
          id: item.id,
          sourceLineItemId: item.shopifyOrderLineItem.sourceLineItemId,
          sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
          sku: item.shopifyOrderLineItem.sku,
          title: item.shopifyOrderLineItem.title,
          orderLineItemTitle: item.shopifyOrderLineItem.title,
          quantity: item.quantity,
          refundAmount: toAmountString(toNumber(item.lineAmount)),
        }))
      : matchingRefundRecords.flatMap((refund) =>
          refund.lineItems.map((item) => ({
            id: item.id,
            sourceLineItemId: item.sourceLineItemId,
            sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
            sku: item.shopifyOrderLineItem.sku,
            title: item.title,
            orderLineItemTitle: item.shopifyOrderLineItem.title,
            quantity: item.quantity,
            refundAmount: toAmountString(toNumber(item.subtotal)),
          })),
        );
    const fallbackRefundedItems =
      refundedItems.length > 0
        ? refundedItems
        : record.vendorAllocation.lineItems.map((item) => ({
            id: item.id,
            sourceLineItemId: item.shopifyOrderLineItem.sourceLineItemId,
            sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
            sku: item.shopifyOrderLineItem.sku,
            title: item.shopifyOrderLineItem.title,
            orderLineItemTitle: item.shopifyOrderLineItem.title,
            quantity: item.quantity,
            refundAmount: toAmountString(toNumber(item.lineAmount)),
          }));
    const summaryRefundedItems = fallbackRefundedItems.map(withReturnedItemDisplayFields);
    const primaryReturnedItem = summaryRefundedItems[0] ?? null;
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
      itemTitle: primaryReturnedItem?.itemTitle ?? null,
      displayTitle: primaryReturnedItem?.displayTitle ?? null,
      variantTitle: primaryReturnedItem?.variantTitle ?? null,
      refundedItems: summaryRefundedItems,
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

  const matchingRefundRecords = isReturnRequestRecord(record)
    ? []
    : record.sourceShopifyRefundId
      ? record.vendorAllocation.refundRecords.filter(
          (refund) => refund.sourceShopifyRefundId === record.sourceShopifyRefundId,
        )
      : record.vendorAllocation.refundRecords;
  const refundAmount = matchingRefundRecords.reduce(
    (sum, refund) => sum + toNumber(refund.amount),
    0,
  );
  const sourceRefundId = isReturnRequestRecord(record) ? '' : getRefundSourceId(record);
  const refundLineItems = matchingRefundRecords.flatMap((refund) => refund.lineItems);
  const returnRequestLineItems = filterReturnRequestAllocationLineItems(record, record.vendorAllocation.lineItems);
  const refundedItems =
    isReturnRequestRecord(record)
      ? returnRequestLineItems.map((item) => ({
          id: item.id,
          sourceLineItemId: item.shopifyOrderLineItem.sourceLineItemId,
          sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
          sku: item.shopifyOrderLineItem.sku,
          title: item.shopifyOrderLineItem.title,
          orderLineItemTitle: item.shopifyOrderLineItem.title,
          quantity: item.quantity,
          refundAmount: toAmountString(toNumber(item.lineAmount)),
        }))
      : refundLineItems.length > 0
      ? refundLineItems.map((item) => ({
          id: item.id,
          sourceLineItemId: item.sourceLineItemId,
          sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
          sku: item.shopifyOrderLineItem.sku,
          title: item.title,
          orderLineItemTitle: item.shopifyOrderLineItem.title,
          quantity: item.quantity,
          refundAmount: toAmountString(toNumber(item.subtotal)),
        }))
      : record.vendorAllocation.lineItems.map((item) => ({
          id: item.id,
          sourceLineItemId: item.shopifyOrderLineItem.sourceLineItemId,
          sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
          sku: item.shopifyOrderLineItem.sku,
          title: item.shopifyOrderLineItem.title,
          orderLineItemTitle: item.shopifyOrderLineItem.title,
          quantity: item.quantity,
          refundAmount: toAmountString(toNumber(item.lineAmount)),
        }));
  const detailRefundedItems = refundedItems.map(withReturnedItemDisplayFields);
  const refundedSkus = Array.from(
    new Set(
      detailRefundedItems
        .map((item) => item.sku)
        .filter((sku): sku is string => Boolean(sku)),
    ),
  );
  const primaryReturnedItem = detailRefundedItems[0] ?? null;

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
    refundedItemCount: detailRefundedItems.length,
    refundedSkus,
    itemTitle: primaryReturnedItem?.itemTitle ?? null,
    displayTitle: primaryReturnedItem?.displayTitle ?? null,
    variantTitle: primaryReturnedItem?.variantTitle ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    sourceShopifyInternalOrderId: record.vendorAllocation.sourceShopifyOrderId,
    originalVendorId: record.vendorAllocation.originalVendorId,
    requestCreatedAt: record.requestCreatedAt ? record.requestCreatedAt.toISOString() : null,
    requestUpdatedAt: record.requestUpdatedAt ? record.requestUpdatedAt.toISOString() : null,
    refundedItems: detailRefundedItems,
  };
}
