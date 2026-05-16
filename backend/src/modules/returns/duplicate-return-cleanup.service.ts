import { prisma } from '../../db/prisma.js';

type DuplicateCleanupOptions = {
  dryRun?: boolean;
  limit?: number;
};

type DuplicateReturnRecord = {
  id: string;
  vendorAllocationId: string;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string;
  sourceShopifyRefundId: string | null;
  sourceShopifyReturnId: string | null;
  sourceShopifyReturnGid: string | null;
  sourceShopifyLineItemId: string | null;
  returnRequestSource: string | null;
  returnLifecycleStatus: string | null;
  status: string;
  reason: string | null;
  updatedAt: Date;
  vendorAllocation: {
    assignedVendorId: string;
    lineItems: Array<{
      shopifyOrderLineItem: {
        sourceLineItemId: string;
        sku: string | null;
        title: string | null;
      };
    }>;
    refundRecords: Array<{
      sourceShopifyRefundId: string;
      amount: unknown;
      status: string;
      updatedAt: Date;
      lineItems: Array<{
        sourceLineItemId: string;
        sku: string | null;
        title: string | null;
        shopifyOrderLineItem: {
          sourceLineItemId: string;
          sku: string | null;
          title: string | null;
        };
      }>;
    }>;
  };
};

type DuplicatePair = {
  canonicalRow: {
    id: string;
    sourceShopifyReturnId: string | null;
    sourceShopifyReturnGid: string | null;
    sourceShopifyRefundId: string | null;
    status: string;
    returnLifecycleStatus: string | null;
  };
  duplicateRow: {
    id: string;
    sourceShopifyRefundId: string | null;
    status: string;
  };
  match: {
    vendorId: string;
    sourceShopifyOrderId: string;
    sourceShopifyOrderNumber: string;
    sourceLineItemId: string | null;
    sku: string | null;
    title: string | null;
  };
  fieldsToCopy: {
    sourceShopifyRefundId: string | null;
    status: string | null;
    refundAmount: string | null;
    refundUpdatedAt: string | null;
  };
  safeToExecute: boolean;
  archiveAvailable: false;
  action: 'copy_refund_metadata_only';
};

function toAmountString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : String(value);
}

function sourceLineItemsForRecord(record: DuplicateReturnRecord) {
  if (record.sourceShopifyLineItemId) {
    return [record.sourceShopifyLineItemId];
  }

  return record.vendorAllocation.lineItems.map((item) => item.shopifyOrderLineItem.sourceLineItemId);
}

function getRefundRecordForDuplicate(record: DuplicateReturnRecord) {
  if (!record.sourceShopifyRefundId) {
    return null;
  }

  return record.vendorAllocation.refundRecords.find(
    (refund) => refund.sourceShopifyRefundId === record.sourceShopifyRefundId,
  ) ?? null;
}

function matchesDuplicate(canonical: DuplicateReturnRecord, duplicate: DuplicateReturnRecord) {
  if (canonical.id === duplicate.id) {
    return false;
  }

  if (canonical.returnRequestSource !== 'shopify_return_request' || duplicate.returnRequestSource === 'shopify_return_request') {
    return false;
  }

  if (!duplicate.sourceShopifyRefundId || canonical.sourceShopifyRefundId) {
    return false;
  }

  if (
    canonical.vendorAllocationId !== duplicate.vendorAllocationId ||
    canonical.sourceShopifyOrderId !== duplicate.sourceShopifyOrderId
  ) {
    return false;
  }

  const canonicalLineItemIds = new Set(sourceLineItemsForRecord(canonical));
  const duplicateRefund = getRefundRecordForDuplicate(duplicate);
  const duplicateLineItemIds = duplicateRefund?.lineItems.map((item) => item.sourceLineItemId) ?? [];

  return duplicateLineItemIds.some((sourceLineItemId) => canonicalLineItemIds.has(sourceLineItemId));
}

function buildDuplicatePair(canonical: DuplicateReturnRecord, duplicate: DuplicateReturnRecord): DuplicatePair {
  const refund = getRefundRecordForDuplicate(duplicate);
  const refundLine = refund?.lineItems[0] ?? null;
  const allocationLine = canonical.vendorAllocation.lineItems.find(
    (item) => item.shopifyOrderLineItem.sourceLineItemId === (canonical.sourceShopifyLineItemId ?? refundLine?.sourceLineItemId),
  );

  return {
    canonicalRow: {
      id: canonical.id,
      sourceShopifyReturnId: canonical.sourceShopifyReturnId,
      sourceShopifyReturnGid: canonical.sourceShopifyReturnGid,
      sourceShopifyRefundId: canonical.sourceShopifyRefundId,
      status: canonical.status,
      returnLifecycleStatus: canonical.returnLifecycleStatus,
    },
    duplicateRow: {
      id: duplicate.id,
      sourceShopifyRefundId: duplicate.sourceShopifyRefundId,
      status: duplicate.status,
    },
    match: {
      vendorId: canonical.vendorAllocation.assignedVendorId,
      sourceShopifyOrderId: canonical.sourceShopifyOrderId,
      sourceShopifyOrderNumber: canonical.sourceShopifyOrderNumber,
      sourceLineItemId: canonical.sourceShopifyLineItemId ?? refundLine?.sourceLineItemId ?? null,
      sku: refundLine?.sku ?? allocationLine?.shopifyOrderLineItem.sku ?? null,
      title: refundLine?.title ?? allocationLine?.shopifyOrderLineItem.title ?? null,
    },
    fieldsToCopy: {
      sourceShopifyRefundId: duplicate.sourceShopifyRefundId,
      status: duplicate.status,
      refundAmount: toAmountString(refund?.amount),
      refundUpdatedAt: refund?.updatedAt.toISOString() ?? duplicate.updatedAt.toISOString(),
    },
    safeToExecute: Boolean(duplicate.sourceShopifyRefundId),
    archiveAvailable: false,
    action: 'copy_refund_metadata_only',
  };
}

async function findDuplicatePairs(limit: number): Promise<DuplicatePair[]> {
  const records = await prisma.returnRecord.findMany({
    where: {
      OR: [
        { returnRequestSource: 'shopify_return_request' },
        { sourceShopifyRefundId: { not: null } },
      ],
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
          },
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
    take: Math.max(limit * 4, limit),
  });

  const canonicalRecords = records.filter((record) => record.returnRequestSource === 'shopify_return_request');
  const refundDerivedRecords = records.filter((record) => record.returnRequestSource !== 'shopify_return_request' && record.sourceShopifyRefundId);
  const pairs: DuplicatePair[] = [];

  for (const canonical of canonicalRecords) {
    for (const duplicate of refundDerivedRecords) {
      if (matchesDuplicate(canonical, duplicate)) {
        pairs.push(buildDuplicatePair(canonical, duplicate));
      }

      if (pairs.length >= limit) {
        return pairs;
      }
    }
  }

  return pairs;
}

export async function cleanupDuplicateReturnRecords(options: DuplicateCleanupOptions = {}) {
  const dryRun = options.dryRun !== false;
  const limit = options.limit ?? 100;
  const duplicatePairs = await findDuplicatePairs(limit);

  if (dryRun) {
    return {
      dryRun,
      scannedPairs: duplicatePairs.length,
      updated: 0,
      deleted: 0,
      archiveAvailable: false,
      duplicatePairs,
    };
  }

  let updated = 0;
  for (const pair of duplicatePairs.filter((candidate) => candidate.safeToExecute)) {
    await prisma.returnRecord.update({
      where: {
        id: pair.canonicalRow.id,
      },
      data: {
        sourceShopifyRefundId: pair.fieldsToCopy.sourceShopifyRefundId,
        status: pair.fieldsToCopy.status ?? pair.canonicalRow.status,
      },
    });
    updated += 1;
  }

  return {
    dryRun,
    scannedPairs: duplicatePairs.length,
    updated,
    deleted: 0,
    archiveAvailable: false,
    duplicatePairs,
  };
}
