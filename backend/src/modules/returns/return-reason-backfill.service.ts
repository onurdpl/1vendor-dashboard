import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import type { ShopifyReturnLineItem } from '../shopify/shopify-admin.types.js';

type ReturnReasonBackfillOptions = {
  dryRun?: boolean;
  limit?: number;
};

type ReturnReasonBackfillStatus =
  | 'eligible'
  | 'updated'
  | 'skipped_missing_return_id'
  | 'skipped_existing_reason'
  | 'skipped_no_reason'
  | 'failed';

type ReturnReasonBackfillRow = {
  id: string;
  sourceShopifyOrderNumber: string;
  sourceShopifyReturnId: string | null;
  sourceShopifyReturnGid: string | null;
  status: ReturnReasonBackfillStatus;
  reasonPreview: string | null;
  notePreview: string | null;
  message?: string;
};

const GENERIC_REASON_VALUES = [
  'return requested',
  'Return requested',
  'requested',
  'Requested',
  'shopify return lifecycle event',
  'Shopify return lifecycle event',
  'shopify return lifecycle status: requested',
  'Shopify return lifecycle status: requested',
];

const GENERIC_REASONS = new Set(GENERIC_REASON_VALUES.map((value) => value.toLowerCase()));

function normalizeReason(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function isGenericReturnReason(value: string | null | undefined) {
  const normalized = normalizeReason(value);
  return !normalized || GENERIC_REASONS.has(normalized);
}

function toReturnGid(record: { sourceShopifyReturnGid: string | null; sourceShopifyReturnId: string | null }) {
  if (record.sourceShopifyReturnGid?.trim()) {
    return record.sourceShopifyReturnGid.trim();
  }

  const id = record.sourceShopifyReturnId?.trim();
  return id ? `gid://shopify/Return/${id}` : null;
}

function extractShopifyGidTail(gid: string) {
  const tail = gid.split('/').at(-1)?.trim() ?? '';
  return tail || null;
}

function readReturnReason(value: string | null | undefined) {
  const text = value?.trim();
  if (!text || text.toLowerCase() === 'unknown') {
    return null;
  }

  return text;
}

function resolveReturnReasonNote(lineItem: { returnReasonNote: string | null; customerNote: string | null }) {
  return readReturnReason(lineItem.returnReasonNote) ?? readReturnReason(lineItem.customerNote);
}

function chooseLineItem(
  lineItems: ShopifyReturnLineItem[],
  sourceShopifyLineItemId: string | null,
) {
  if (!sourceShopifyLineItemId) {
    return lineItems.length === 1 ? lineItems[0] : null;
  }

  return lineItems.find((item) => {
    const lineItemTail = item.lineItemGid ? extractShopifyGidTail(item.lineItemGid) : null;
    const returnLineItemTail = extractShopifyGidTail(item.returnLineItemGid);
    return lineItemTail === sourceShopifyLineItemId || returnLineItemTail === sourceShopifyLineItemId;
  }) ?? null;
}

export async function backfillShopifyReturnReasons(env: AppEnv, options: ReturnReasonBackfillOptions = {}) {
  const dryRun = options.dryRun !== false;
  const limit = Math.max(1, Math.min(Number(options.limit ?? 50), 200));
  const shopifyAdminService = createShopifyAdminService(env);
  const records = await prisma.returnRecord.findMany({
    where: {
      returnRequestSource: 'shopify_return_request',
      AND: [
        {
          OR: [
            { sourceShopifyReturnGid: { not: null } },
            { sourceShopifyReturnId: { not: null } },
          ],
        },
        {
          OR: [
            { reason: null },
            { reason: { in: GENERIC_REASON_VALUES } },
          ],
        },
      ],
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: limit,
  });
  const results: ReturnReasonBackfillRow[] = [];

  for (const record of records) {
    if (!toReturnGid(record)) {
      results.push({
        id: record.id,
        sourceShopifyOrderNumber: record.sourceShopifyOrderNumber,
        sourceShopifyReturnId: record.sourceShopifyReturnId,
        sourceShopifyReturnGid: record.sourceShopifyReturnGid,
        status: 'skipped_missing_return_id',
        reasonPreview: null,
        notePreview: null,
      });
      continue;
    }

    if (!isGenericReturnReason(record.reason)) {
      results.push({
        id: record.id,
        sourceShopifyOrderNumber: record.sourceShopifyOrderNumber,
        sourceShopifyReturnId: record.sourceShopifyReturnId,
        sourceShopifyReturnGid: record.sourceShopifyReturnGid,
        status: 'skipped_existing_reason',
        reasonPreview: record.reason,
        notePreview: record.returnReasonNote,
      });
      continue;
    }

    const returnGid = toReturnGid(record);
    if (!returnGid) {
      continue;
    }

    try {
      const returnDetails = await shopifyAdminService.fetchReturnDetails(returnGid);
      const lineItem = chooseLineItem(returnDetails.lineItems, record.sourceShopifyLineItemId);
      const reason = readReturnReason(lineItem?.returnReason);
      const note = lineItem ? resolveReturnReasonNote(lineItem) : null;

      if (!reason && !note) {
        results.push({
          id: record.id,
          sourceShopifyOrderNumber: record.sourceShopifyOrderNumber,
          sourceShopifyReturnId: record.sourceShopifyReturnId,
          sourceShopifyReturnGid: record.sourceShopifyReturnGid,
          status: 'skipped_no_reason',
          reasonPreview: null,
          notePreview: null,
          message: lineItem ? 'Shopify return line item did not include a customer reason.' : 'No matching Shopify return line item found.',
        });
        continue;
      }

      if (!dryRun) {
        await prisma.returnRecord.update({
          where: { id: record.id },
          data: {
            reason: reason ?? record.reason,
            returnReasonNote: note,
          },
        });
      }

      results.push({
        id: record.id,
        sourceShopifyOrderNumber: record.sourceShopifyOrderNumber,
        sourceShopifyReturnId: record.sourceShopifyReturnId,
        sourceShopifyReturnGid: record.sourceShopifyReturnGid,
        status: dryRun ? 'eligible' : 'updated',
        reasonPreview: reason,
        notePreview: note,
      });
    } catch (error) {
      results.push({
        id: record.id,
        sourceShopifyOrderNumber: record.sourceShopifyOrderNumber,
        sourceShopifyReturnId: record.sourceShopifyReturnId,
        sourceShopifyReturnGid: record.sourceShopifyReturnGid,
        status: 'failed',
        reasonPreview: null,
        notePreview: null,
        message: error instanceof Error ? error.message : 'Return reason backfill failed.',
      });
    }
  }

  return {
    dryRun,
    scanned: records.length,
    eligible: results.filter((row) => row.status === 'eligible' || row.status === 'updated').length,
    updated: results.filter((row) => row.status === 'updated').length,
    skipped: results.filter((row) => row.status.startsWith('skipped')).length,
    failed: results.filter((row) => row.status === 'failed').length,
    results,
  };
}
