import { prisma } from '../../db/prisma.js';
import type { ReturnDetailDto, ReturnSummaryDto } from './returns.types.js';

export class ReturnReviewError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ReturnReviewError';
    this.statusCode = statusCode;
  }
}

export type ReturnActorScope = {
  role: 'admin' | 'vendor' | 'support' | 'finance';
  vendorId?: string | null;
};

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

function normalizeVendorDecision(value: string | null): 'approved' | 'rejected' | null {
  return value === 'approved' || value === 'rejected' ? value : null;
}

function canActOnReturn(record: { vendorAllocation: { assignedVendorId: string } }, actor: ReturnActorScope) {
  return actor.role === 'admin' || record.vendorAllocation.assignedVendorId === actor.vendorId;
}

function readText(value: string | null | undefined) {
  const text = value?.trim();
  const normalized = text?.toLowerCase();
  if (
    !text ||
    text === 'Return item' ||
    normalized === 'default' ||
    normalized === 'default title' ||
    /^gid:\/\//i.test(text) ||
    /^unknown-sku$/i.test(text)
  ) {
    return null;
  }

  return text;
}

function readProductText(value: string | null | undefined, sku: string | null | undefined) {
  const text = readText(value)
    ?.replace(/\s*\/\s*default(?:\s+title)?$/i, '')
    .trim();
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
    readProductText(item.orderLineItemTitle, item.sku) ??
    readProductText(item.title, item.sku) ??
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

type ReturnRecordLineItemSource = {
  id: string;
  sourceLineItemId: string;
  sourceVariantId: string | null;
  sku: string | null;
  title: string | null;
  orderLineItemTitle: string | null;
  quantity: number;
  refundAmount: string;
};

function toAllocationReturnedItem(item: {
  id: string;
  quantity: number;
  lineAmount: unknown;
  shopifyOrderLineItem: {
    sourceLineItemId: string;
    sourceVariantId: string | null;
    sku: string | null;
    title: string | null;
  };
}): ReturnRecordLineItemSource {
  return {
    id: item.id,
    sourceLineItemId: item.shopifyOrderLineItem.sourceLineItemId,
    sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
    sku: item.shopifyOrderLineItem.sku,
    title: item.shopifyOrderLineItem.title,
    orderLineItemTitle: item.shopifyOrderLineItem.title,
    quantity: item.quantity,
    refundAmount: toAmountString(toNumber(item.lineAmount)),
  };
}

function toRefundReturnedItem(item: {
  id: string;
  sourceLineItemId: string;
  sku: string | null;
  title: string | null;
  quantity: number;
  subtotal: unknown;
  shopifyOrderLineItem: {
    sourceVariantId: string | null;
    sku: string | null;
    title: string | null;
  };
}): ReturnRecordLineItemSource {
  return {
    id: item.id,
    sourceLineItemId: item.sourceLineItemId,
    sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
    sku: item.shopifyOrderLineItem.sku ?? item.sku,
    title: item.title,
    orderLineItemTitle: item.shopifyOrderLineItem.title,
    quantity: item.quantity,
    refundAmount: toAmountString(toNumber(item.subtotal)),
  };
}

function buildReturnedItemsForRecord(record: {
  returnRequestSource: string | null;
  sourceShopifyLineItemId: string | null;
  vendorAllocation: {
    lineItems: Array<Parameters<typeof toAllocationReturnedItem>[0]>;
  };
}, refundLineItems: Array<Parameters<typeof toRefundReturnedItem>[0]>) {
  const returnRequestLineItems = filterReturnRequestAllocationLineItems(record, record.vendorAllocation.lineItems);
  const itemSources = isReturnRequestRecord(record)
    ? returnRequestLineItems.map(toAllocationReturnedItem)
    : refundLineItems.length > 0
      ? refundLineItems.map(toRefundReturnedItem)
      : record.vendorAllocation.lineItems.map(toAllocationReturnedItem);

  return itemSources.map(withReturnedItemDisplayFields);
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

function getMatchingRefundRecords(record: {
  sourceShopifyRefundId: string | null;
  returnRequestSource: string | null;
  vendorAllocation: {
    refundRecords: Array<{
      sourceShopifyRefundId: string;
      amount?: unknown;
      lineItems: Array<Parameters<typeof toRefundReturnedItem>[0]>;
    }>;
  };
}) {
  if (record.sourceShopifyRefundId) {
    return record.vendorAllocation.refundRecords.filter(
      (refund) => refund.sourceShopifyRefundId === record.sourceShopifyRefundId,
    );
  }

  return isReturnRequestRecord(record) ? [] : record.vendorAllocation.refundRecords;
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
    const matchingRefundRecords = getMatchingRefundRecords(record);
    const refundAmount = matchingRefundRecords.reduce(
      (sum, refund) => sum + toNumber(refund.amount),
      0,
    );
    const sourceRefundId = record.sourceShopifyRefundId ?? (isReturnRequestRecord(record) ? '' : getRefundSourceId(record));
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
    const refundLineItems = matchingRefundRecords.flatMap((refund) => refund.lineItems);
    const summaryRefundedItems = buildReturnedItemsForRecord(record, refundLineItems);
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
      reason: record.reason,
      returnReasonNote: record.returnReasonNote,
      returnCarrierName: record.returnCarrierName,
      returnTrackingNumber: record.returnTrackingNumber,
      returnTrackingUrl: record.returnTrackingUrl,
      vendorReceivedAt: record.vendorReceivedAt ? record.vendorReceivedAt.toISOString() : null,
      vendorReviewedAt: record.vendorReviewedAt ? record.vendorReviewedAt.toISOString() : null,
      vendorDecision: normalizeVendorDecision(record.vendorDecision),
      vendorDecisionReason: record.vendorDecisionReason,
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

  const matchingRefundRecords = getMatchingRefundRecords(record);
  const refundAmount = matchingRefundRecords.reduce(
    (sum, refund) => sum + toNumber(refund.amount),
    0,
  );
  const sourceRefundId = record.sourceShopifyRefundId ?? (isReturnRequestRecord(record) ? '' : getRefundSourceId(record));
  const refundLineItems = matchingRefundRecords.flatMap((refund) => refund.lineItems);
  const detailRefundedItems = buildReturnedItemsForRecord(record, refundLineItems);
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
    reason: record.reason,
    returnReasonNote: record.returnReasonNote,
    returnCarrierName: record.returnCarrierName,
    returnTrackingNumber: record.returnTrackingNumber,
    returnTrackingUrl: record.returnTrackingUrl,
    vendorReceivedAt: record.vendorReceivedAt ? record.vendorReceivedAt.toISOString() : null,
    vendorReviewedAt: record.vendorReviewedAt ? record.vendorReviewedAt.toISOString() : null,
    vendorDecision: normalizeVendorDecision(record.vendorDecision),
    vendorDecisionReason: record.vendorDecisionReason,
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

export async function getReturnByIdForActor(returnId: string, actor: ReturnActorScope): Promise<ReturnDetailDto | null> {
  if (actor.role !== 'admin' && !actor.vendorId) {
    return null;
  }

  const record = await prisma.returnRecord.findFirst({
    where: {
      id: returnId,
      ...(actor.role === 'admin'
        ? {}
        : {
            vendorAllocation: {
              assignedVendorId: actor.vendorId ?? '',
            },
          }),
    },
    select: {
      vendorAllocation: {
        select: {
          assignedVendorId: true,
        },
      },
    },
  });

  if (!record || !canActOnReturn(record, actor)) {
    return null;
  }

  return getVendorReturnById(record.vendorAllocation.assignedVendorId, returnId);
}

export async function markReturnReceived(returnId: string, actor: ReturnActorScope): Promise<ReturnDetailDto> {
  const record = await prisma.returnRecord.findUnique({
    where: { id: returnId },
    select: {
      id: true,
      vendorReceivedAt: true,
      vendorAllocation: {
        select: {
          assignedVendorId: true,
        },
      },
    },
  });

  if (!record || !canActOnReturn(record, actor)) {
    throw new ReturnReviewError('Return record not found.', 404);
  }

  if (!record.vendorReceivedAt) {
    await prisma.returnRecord.update({
      where: { id: returnId },
      data: {
        vendorReceivedAt: new Date(),
      },
    });
  }

  const updated = await getVendorReturnById(record.vendorAllocation.assignedVendorId, returnId);
  if (!updated) {
    throw new ReturnReviewError('Return record not found.', 404);
  }

  return updated;
}

export async function reviewReturn(
  returnId: string,
  actor: ReturnActorScope,
  input: { decision: 'approved' | 'rejected'; reason?: string | null },
): Promise<ReturnDetailDto> {
  const record = await prisma.returnRecord.findUnique({
    where: { id: returnId },
    select: {
      id: true,
      vendorReceivedAt: true,
      vendorAllocation: {
        select: {
          assignedVendorId: true,
        },
      },
    },
  });

  if (!record || !canActOnReturn(record, actor)) {
    throw new ReturnReviewError('Return record not found.', 404);
  }

  if (!record.vendorReceivedAt) {
    throw new ReturnReviewError('Return must be marked received before review.', 409);
  }

  if (input.decision !== 'approved' && input.decision !== 'rejected') {
    throw new ReturnReviewError('Return review decision must be approved or rejected.', 400);
  }

  const reason = input.reason?.trim() ?? '';
  if (input.decision === 'rejected' && !reason) {
    throw new ReturnReviewError('Rejected returns require a reason.', 400);
  }

  await prisma.returnRecord.update({
    where: { id: returnId },
    data: {
      vendorReviewedAt: new Date(),
      vendorDecision: input.decision,
      vendorDecisionReason: input.decision === 'rejected' ? reason : null,
    },
  });

  const updated = await getVendorReturnById(record.vendorAllocation.assignedVendorId, returnId);
  if (!updated) {
    throw new ReturnReviewError('Return record not found.', 404);
  }

  return updated;
}
