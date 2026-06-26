import {
  OperationalSignalSeverity,
  OperationalSignalSourceArea,
  OperationalSignalStatus,
  Prisma,
} from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { assertResolvedEconomicOwnerForMoneyMovement } from '../finance/economic-owner-resolution.service.js';
import { resolveAllocationForShopifyOrderLineItem } from '../orders/allocation-ownership-resolution.service.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import type {
  CanonicalShopifyReturnLineItemSnapshot,
  CanonicalShopifyReturnSnapshot,
} from '../shopify/shopify-admin.types.js';
import type {
  CanonicalReturnReconciliationItemResult,
  CanonicalReturnReconciliationReport,
} from './reconciliation.types.js';

const CANONICAL_RETURN_SIGNAL_RULE_KEYS = {
  missingLocalOrder: 'canonical_return_missing_local_order',
  lineItemUnmatched: 'canonical_return_line_item_unmatched',
  requiresManualReview: 'canonical_return_requires_manual_review',
  conflictsWithOperationalState: 'canonical_return_conflicts_with_operational_state',
  repaired: 'canonical_return_repaired',
  repairFailed: 'canonical_return_repair_failed',
} as const;

type CanonicalReturnSignalRuleKey =
  (typeof CANONICAL_RETURN_SIGNAL_RULE_KEYS)[keyof typeof CANONICAL_RETURN_SIGNAL_RULE_KEYS];

type LocalReturnRecord = {
  id: string;
  vendorAllocationId: string;
  ownerVendorId: string | null;
  sourceShopifyRefundId: string | null;
  sourceShopifyReturnId: string | null;
  sourceShopifyReturnGid: string | null;
  sourceShopifyLineItemId: string | null;
  returnLifecycleStatus: string | null;
  returnRequestSource: string | null;
  requestCreatedAt: Date | null;
  requestUpdatedAt: Date | null;
  status: string;
  reason: string | null;
  returnReasonNote: string | null;
  returnProviderShipmentId: string | null;
  returnLabel: string | null;
  returnReferenceId: string | null;
  vendorReceivedAt: Date | null;
  vendorDecision: string | null;
};

type ReconciledReturnRecord = {
  id: string;
  vendorAllocationId: string;
  ownerVendorId: string | null;
  created: boolean;
  repaired: boolean;
};

function sanitizeSignalPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function buildCanonicalReturnSignalId(input: {
  ruleKey: CanonicalReturnSignalRuleKey;
  sourceShopifyOrderId: string;
  sourceShopifyReturnId?: string | null;
}) {
  return [
    'signal',
    sanitizeSignalPart(input.ruleKey),
    sanitizeSignalPart(input.sourceShopifyOrderId),
    input.sourceShopifyReturnId ? sanitizeSignalPart(input.sourceShopifyReturnId) : null,
  ].filter(Boolean).join('-');
}

function toJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

async function upsertCanonicalReturnSignal(input: {
  ruleKey: CanonicalReturnSignalRuleKey;
  sourceShopifyOrderId: string;
  sourceShopifyReturnId?: string | null;
  severity?: OperationalSignalSeverity;
  title: string;
  description: string;
  suggestedAction: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.operationalSignal.upsert({
    where: {
      id: buildCanonicalReturnSignalId(input),
    },
    create: {
      id: buildCanonicalReturnSignalId(input),
      type: 'reconciliation_issue',
      severity: input.severity ?? OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.RECONCILIATION,
      title: input.title,
      description: input.description,
      suggestedAction: input.suggestedAction,
      status: OperationalSignalStatus.ACTIVE,
      ruleKey: input.ruleKey,
      triggeredAt: new Date(),
      metadata: toJsonObject({
        sourceShopifyOrderId: input.sourceShopifyOrderId,
        sourceShopifyReturnId: input.sourceShopifyReturnId ?? null,
        ...(input.metadata ?? {}),
      }),
    },
    update: {
      severity: input.severity ?? OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.RECONCILIATION,
      title: input.title,
      description: input.description,
      suggestedAction: input.suggestedAction,
      status: OperationalSignalStatus.ACTIVE,
      resolvedAt: null,
      triggeredAt: new Date(),
      metadata: toJsonObject({
        sourceShopifyOrderId: input.sourceShopifyOrderId,
        sourceShopifyReturnId: input.sourceShopifyReturnId ?? null,
        ...(input.metadata ?? {}),
      }),
    },
  });
}

async function resolveCanonicalReturnSignals(input: {
  sourceShopifyOrderId: string;
  sourceShopifyReturnId?: string | null;
  ruleKeys: CanonicalReturnSignalRuleKey[];
}) {
  await prisma.operationalSignal.updateMany({
    where: {
      id: {
        in: input.ruleKeys.map((ruleKey) =>
          buildCanonicalReturnSignalId({
            ruleKey,
            sourceShopifyOrderId: input.sourceShopifyOrderId,
            sourceShopifyReturnId: input.sourceShopifyReturnId,
          })
        ),
      },
      status: {
        in: [OperationalSignalStatus.ACTIVE, OperationalSignalStatus.ACKNOWLEDGED],
      },
    },
    data: {
      status: OperationalSignalStatus.RESOLVED,
      resolvedAt: new Date(),
    },
  });
}

function normalizeStatus(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/_/g, '-') ?? '';
}

function mapCanonicalReturnStatus(status: string) {
  const normalized = normalizeStatus(status);
  if (normalized === 'requested' || normalized === 'request') {
    return 'requested';
  }
  if (normalized === 'open' || normalized === 'approved') {
    return 'approved';
  }
  if (normalized === 'declined') {
    return 'declined';
  }
  if (normalized === 'closed' || normalized === 'complete' || normalized === 'completed') {
    return 'closed';
  }
  if (normalized === 'canceled' || normalized === 'cancelled') {
    return 'cancelled';
  }
  return null;
}

function statusRank(status: string | null | undefined) {
  const normalized = normalizeStatus(status);
  if (normalized === 'requested') {
    return 1;
  }
  if (normalized === 'approved' || normalized === 'open') {
    return 2;
  }
  if (['closed', 'complete', 'completed', 'declined', 'cancelled', 'canceled', 'processed', 'refunded'].includes(normalized)) {
    return 3;
  }
  return 0;
}

function readReturnReason(value: string | null | undefined) {
  const text = value?.trim();
  if (!text || text.toLowerCase() === 'unknown') {
    return null;
  }
  return text;
}

function resolveReturnReasonNote(lineItem: CanonicalShopifyReturnLineItemSnapshot) {
  return readReturnReason(lineItem.customerNote) ?? readReturnReason(lineItem.returnReasonNote);
}

function toDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildReturnRecordId(input: {
  sourceShopifyReturnId: string;
  vendorId: string;
  sourceLineItemId: string;
}) {
  return `return-request-${input.sourceShopifyReturnId}-${input.vendorId}-${input.sourceLineItemId}`;
}

function hasProtectedLocalReturnState(record: LocalReturnRecord | null) {
  if (!record) {
    return false;
  }
  return Boolean(
    record.sourceShopifyRefundId ||
    record.vendorReceivedAt ||
    record.vendorDecision ||
    record.returnProviderShipmentId ||
    record.returnLabel ||
    record.returnReferenceId,
  );
}

function hasCanonicalReturnRecordDrift(input: {
  existing: LocalReturnRecord | null;
  sourceShopifyReturnId: string;
  sourceShopifyReturnGid: string;
  sourceLineItemId: string;
  lifecycleStatus: string;
  reason: string | null;
  returnReasonNote: string | null;
}) {
  const { existing } = input;
  if (!existing) {
    return false;
  }

  return (
    existing.sourceShopifyReturnId !== input.sourceShopifyReturnId ||
    existing.sourceShopifyReturnGid !== input.sourceShopifyReturnGid ||
    existing.sourceShopifyLineItemId !== input.sourceLineItemId ||
    existing.returnLifecycleStatus !== input.lifecycleStatus ||
    existing.status !== input.lifecycleStatus ||
    existing.returnRequestSource !== 'shopify_return_request' ||
    (!existing.reason && Boolean(input.reason)) ||
    (!existing.returnReasonNote && Boolean(input.returnReasonNote))
  );
}

function canApplyCanonicalStatus(record: LocalReturnRecord | null, canonicalStatus: string) {
  if (!record) {
    return true;
  }
  const localRank = Math.max(statusRank(record.returnLifecycleStatus), statusRank(record.status));
  const canonicalRank = statusRank(canonicalStatus);
  return canonicalRank >= localRank;
}

async function findExistingReturnRecord(input: {
  tx: Prisma.TransactionClient;
  sourceShopifyReturnId: string;
  sourceShopifyReturnGid: string;
  sourceLineItemId: string;
}) {
  return input.tx.returnRecord.findFirst({
    where: {
      OR: [
        {
          sourceShopifyReturnId: input.sourceShopifyReturnId,
          sourceShopifyLineItemId: input.sourceLineItemId,
        },
        {
          sourceShopifyReturnGid: input.sourceShopifyReturnGid,
          sourceShopifyLineItemId: input.sourceLineItemId,
        },
      ],
    },
    orderBy: {
      createdAt: 'asc',
    },
  }) as Promise<LocalReturnRecord | null>;
}

async function reconcileReturnRecordForLineItem(input: {
  tx: Prisma.TransactionClient;
  shopifyOrder: {
    id: string;
    sourceShopifyOrderNumber: string;
    lineItems: Array<{
      id: string;
      sourceLineItemId: string | null;
      sku: string | null;
    }>;
  };
  canonicalReturn: CanonicalShopifyReturnSnapshot;
  lineItem: CanonicalShopifyReturnLineItemSnapshot;
  lifecycleStatus: string;
}): Promise<ReconciledReturnRecord> {
  const { tx, shopifyOrder, canonicalReturn, lineItem, lifecycleStatus } = input;
  const sourceLineItemId = lineItem.sourceLineItemId ?? null;
  const skuMatches = lineItem.sku
    ? shopifyOrder.lineItems.filter((orderLineItem) => orderLineItem.sku === lineItem.sku)
    : [];
  const matchedOrderLineItem = sourceLineItemId
    ? shopifyOrder.lineItems.find((orderLineItem) => orderLineItem.sourceLineItemId === sourceLineItemId)
    : skuMatches.length === 1
      ? skuMatches[0]
      : null;

  if (!matchedOrderLineItem) {
    if (skuMatches.length > 1) {
      throw new Error(`Return SKU ${lineItem.sku} matched multiple original order line items and could not be resolved safely.`);
    }
    throw new Error(`No original order mapping found for return line item ${lineItem.returnLineItemGid}.`);
  }

  const resolvedSourceLineItemId = matchedOrderLineItem.sourceLineItemId ?? sourceLineItemId;
  if (!resolvedSourceLineItemId) {
    throw new Error(`Return line item ${lineItem.returnLineItemGid} is missing Shopify line item id.`);
  }

  const ownership = await resolveAllocationForShopifyOrderLineItem({
    shopifyOrderId: shopifyOrder.id,
    shopifyOrderLineItemId: matchedOrderLineItem.id,
    sourceLineItemId: resolvedSourceLineItemId,
  }, tx);
  const ownerResolution = await assertResolvedEconomicOwnerForMoneyMovement({
    vendorAllocationId: ownership.allocation.id,
    db: tx,
  });
  const existing = await findExistingReturnRecord({
    tx,
    sourceShopifyReturnId: canonicalReturn.sourceShopifyReturnId,
    sourceShopifyReturnGid: canonicalReturn.returnGid,
    sourceLineItemId: resolvedSourceLineItemId,
  });

  if (!canApplyCanonicalStatus(existing, lifecycleStatus)) {
    throw new Error(
      `Canonical return status ${lifecycleStatus} would downgrade local return record ${existing?.id ?? 'unknown'}.`,
    );
  }

  const recordId = existing?.id ?? buildReturnRecordId({
    sourceShopifyReturnId: canonicalReturn.sourceShopifyReturnId,
    vendorId: ownership.allocation.originalVendorId,
    sourceLineItemId: resolvedSourceLineItemId,
  });
  const requestCreatedAt = toDate(canonicalReturn.createdAt) ?? existing?.requestCreatedAt ?? new Date();
  const requestUpdatedAt = toDate(canonicalReturn.closedAt) ?? toDate(canonicalReturn.requestApprovedAt) ?? new Date();
  const reason = readReturnReason(lineItem.returnReason) ?? existing?.reason ?? 'Shopify canonical return reconciliation';
  const returnReasonNote = resolveReturnReasonNote(lineItem) ?? existing?.returnReasonNote ?? null;
  const hasDrift = hasCanonicalReturnRecordDrift({
    existing,
    sourceShopifyReturnId: canonicalReturn.sourceShopifyReturnId,
    sourceShopifyReturnGid: canonicalReturn.returnGid,
    sourceLineItemId: resolvedSourceLineItemId,
    lifecycleStatus,
    reason,
    returnReasonNote,
  });

  await tx.returnRecord.upsert({
    where: {
      id: recordId,
    },
    update: {
      vendorAllocationId: ownership.allocation.id,
      ownerVendorId: existing?.ownerVendorId ?? ownerResolution.economicOwnerVendorId,
      sourceShopifyOrderId: ownership.allocation.sourceShopifyOrderId,
      sourceShopifyOrderNumber: ownership.allocation.sourceShopifyOrderNumber,
      sourceShopifyReturnId: canonicalReturn.sourceShopifyReturnId,
      sourceShopifyReturnGid: canonicalReturn.returnGid,
      sourceShopifyLineItemId: resolvedSourceLineItemId,
      returnLifecycleStatus: lifecycleStatus,
      returnRequestSource: 'shopify_return_request',
      requestCreatedAt,
      requestUpdatedAt,
      status: lifecycleStatus,
      reason,
      returnReasonNote,
    },
    create: {
      id: recordId,
      vendorAllocationId: ownership.allocation.id,
      ownerVendorId: ownerResolution.economicOwnerVendorId,
      sourceShopifyOrderId: ownership.allocation.sourceShopifyOrderId,
      sourceShopifyOrderNumber: ownership.allocation.sourceShopifyOrderNumber,
      sourceShopifyReturnId: canonicalReturn.sourceShopifyReturnId,
      sourceShopifyReturnGid: canonicalReturn.returnGid,
      sourceShopifyLineItemId: resolvedSourceLineItemId,
      returnLifecycleStatus: lifecycleStatus,
      returnRequestSource: 'shopify_return_request',
      requestCreatedAt,
      requestUpdatedAt,
      status: lifecycleStatus,
      reason,
      returnReasonNote,
    },
  });

  return {
    id: recordId,
    vendorAllocationId: ownership.allocation.id,
    ownerVendorId: ownerResolution.economicOwnerVendorId,
    created: !existing,
    repaired: Boolean(existing) && hasDrift && !hasProtectedLocalReturnState(existing),
  };
}

export function createCanonicalReturnReconciliationService(env: AppEnv) {
  const shopifyAdminService = createShopifyAdminService(env);

  async function reconcileShopifyOrderReturns(sourceShopifyOrderId: string): Promise<CanonicalReturnReconciliationReport | null> {
    const canonicalReturns = await shopifyAdminService.fetchCanonicalReturnsForOrder(sourceShopifyOrderId);
    if (!canonicalReturns) {
      return null;
    }

    const report: CanonicalReturnReconciliationReport = {
      shopifyOrderId: sourceShopifyOrderId,
      returnsFetched: canonicalReturns.returns.length,
      returnsAlreadyPresent: 0,
      returnsCreated: 0,
      returnRecordsRepaired: 0,
      skippedCount: 0,
      failedCount: 0,
      signalsCreatedOrUpdated: 0,
      results: [],
    };

    const localOrder = await prisma.shopifyOrder.findUnique({
      where: {
        sourceShopifyOrderId,
      },
      include: {
        lineItems: true,
      },
    });

    if (!localOrder) {
      for (const canonicalReturn of canonicalReturns.returns) {
        await upsertCanonicalReturnSignal({
          ruleKey: CANONICAL_RETURN_SIGNAL_RULE_KEYS.missingLocalOrder,
          sourceShopifyOrderId,
          sourceShopifyReturnId: canonicalReturn.sourceShopifyReturnId,
          severity: OperationalSignalSeverity.CRITICAL,
          title: 'Canonical return missing local order',
          description: 'Shopify return exists but the local order record is missing. Return commerce state was not recreated automatically.',
          suggestedAction: 'Replay or recover the missing order before return reconciliation.',
          metadata: {
            returnGid: canonicalReturn.returnGid,
            returnStatus: canonicalReturn.status,
            returnLineItemIds: canonicalReturn.returnLineItems.map((lineItem) => lineItem.returnLineItemGid),
          },
        });
        report.signalsCreatedOrUpdated += 1;
        report.skippedCount += 1;
        report.results.push({
          returnId: canonicalReturn.sourceShopifyReturnId,
          status: 'skipped',
          reason: 'canonical_return_missing_local_order',
          affectedAllocationIds: [],
          affectedVendorIds: [],
          affectedReturnRecordIds: [],
        });
      }
      return report;
    }

    for (const canonicalReturn of canonicalReturns.returns) {
      const lifecycleStatus = mapCanonicalReturnStatus(canonicalReturn.status);
      if (!lifecycleStatus) {
        await upsertCanonicalReturnSignal({
          ruleKey: CANONICAL_RETURN_SIGNAL_RULE_KEYS.requiresManualReview,
          sourceShopifyOrderId,
          sourceShopifyReturnId: canonicalReturn.sourceShopifyReturnId,
          severity: OperationalSignalSeverity.HIGH,
          title: 'Canonical return requires manual review',
          description: `Shopify returned an unsupported canonical return status: ${canonicalReturn.status}.`,
          suggestedAction: 'Review Shopify return state before retrying return reconciliation.',
          metadata: {
            returnGid: canonicalReturn.returnGid,
            returnStatus: canonicalReturn.status,
          },
        });
        report.signalsCreatedOrUpdated += 1;
        report.skippedCount += 1;
        report.results.push({
          returnId: canonicalReturn.sourceShopifyReturnId,
          status: 'skipped',
          reason: 'canonical_return_requires_manual_review',
          affectedAllocationIds: [],
          affectedVendorIds: [],
          affectedReturnRecordIds: [],
        });
        continue;
      }

      if (canonicalReturn.returnLineItems.length === 0) {
        await upsertCanonicalReturnSignal({
          ruleKey: CANONICAL_RETURN_SIGNAL_RULE_KEYS.requiresManualReview,
          sourceShopifyOrderId,
          sourceShopifyReturnId: canonicalReturn.sourceShopifyReturnId,
          severity: OperationalSignalSeverity.HIGH,
          title: 'Canonical return requires manual review',
          description: 'Shopify canonical return did not include return line items.',
          suggestedAction: 'Review Shopify return line items before retrying return reconciliation.',
          metadata: {
            returnGid: canonicalReturn.returnGid,
            returnStatus: canonicalReturn.status,
          },
        });
        report.signalsCreatedOrUpdated += 1;
        report.failedCount += 1;
        report.results.push({
          returnId: canonicalReturn.sourceShopifyReturnId,
          status: 'failed',
          reason: 'canonical_return_requires_manual_review',
          affectedAllocationIds: [],
          affectedVendorIds: [],
          affectedReturnRecordIds: [],
        });
        continue;
      }

      try {
        const reconciledRecords = await prisma.$transaction(async (tx) => {
          const records: ReconciledReturnRecord[] = [];
          for (const lineItem of canonicalReturn.returnLineItems) {
            records.push(await reconcileReturnRecordForLineItem({
              tx,
              shopifyOrder: localOrder,
              canonicalReturn,
              lineItem,
              lifecycleStatus,
            }));
          }
          return records;
        });

        const createdCount = reconciledRecords.filter((record) => record.created).length;
        const repairedCount = reconciledRecords.filter((record) => record.repaired && !record.created).length;
        const status = createdCount > 0
          ? 'created'
          : repairedCount > 0
            ? 'repaired'
            : 'already_present';

        if (status === 'created') {
          report.returnsCreated += 1;
        } else if (status === 'repaired') {
          report.returnRecordsRepaired += 1;
        } else {
          report.returnsAlreadyPresent += 1;
        }

        await resolveCanonicalReturnSignals({
          sourceShopifyOrderId,
          sourceShopifyReturnId: canonicalReturn.sourceShopifyReturnId,
          ruleKeys: [
            CANONICAL_RETURN_SIGNAL_RULE_KEYS.missingLocalOrder,
            CANONICAL_RETURN_SIGNAL_RULE_KEYS.lineItemUnmatched,
            CANONICAL_RETURN_SIGNAL_RULE_KEYS.requiresManualReview,
            CANONICAL_RETURN_SIGNAL_RULE_KEYS.conflictsWithOperationalState,
            CANONICAL_RETURN_SIGNAL_RULE_KEYS.repairFailed,
          ],
        });

        if (status === 'created' || status === 'repaired') {
          await upsertCanonicalReturnSignal({
            ruleKey: CANONICAL_RETURN_SIGNAL_RULE_KEYS.repaired,
            sourceShopifyOrderId,
            sourceShopifyReturnId: canonicalReturn.sourceShopifyReturnId,
            severity: OperationalSignalSeverity.INFO,
            title: 'Canonical return repaired',
            description: 'Canonical Shopify return reconciliation created or repaired local return records.',
            suggestedAction: 'No action required unless return operations still show open provider work.',
            metadata: {
              status,
              returnGid: canonicalReturn.returnGid,
              returnStatus: canonicalReturn.status,
              returnRecordIds: reconciledRecords.map((record) => record.id),
            },
          });
          report.signalsCreatedOrUpdated += 1;
        }

        report.results.push({
          returnId: canonicalReturn.sourceShopifyReturnId,
          status,
          reason: status === 'already_present' ? 'local_return_already_present' : null,
          affectedAllocationIds: [...new Set(reconciledRecords.map((record) => record.vendorAllocationId))],
          affectedVendorIds: [...new Set(reconciledRecords.map((record) => record.ownerVendorId).filter((vendorId): vendorId is string => Boolean(vendorId)))],
          affectedReturnRecordIds: reconciledRecords.map((record) => record.id),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Canonical return reconciliation failed.';
        const lineItemUnmatched = /line item|sku|mapping|allocated/i.test(message);
        const downgradeConflict = /downgrade|protected|conflict/i.test(message);
        await upsertCanonicalReturnSignal({
          ruleKey: lineItemUnmatched
            ? CANONICAL_RETURN_SIGNAL_RULE_KEYS.lineItemUnmatched
            : downgradeConflict
              ? CANONICAL_RETURN_SIGNAL_RULE_KEYS.conflictsWithOperationalState
              : CANONICAL_RETURN_SIGNAL_RULE_KEYS.repairFailed,
          sourceShopifyOrderId,
          sourceShopifyReturnId: canonicalReturn.sourceShopifyReturnId,
          severity: OperationalSignalSeverity.HIGH,
          title: lineItemUnmatched
            ? 'Canonical return line item unmatched'
            : downgradeConflict
              ? 'Canonical return conflicts with operational state'
              : 'Canonical return repair failed',
          description: 'Canonical Shopify return reconciliation could not safely map or repair the return record.',
          suggestedAction: 'Review Shopify return line items, local allocation ownership, and existing return provider state before retrying.',
          metadata: {
            error: message,
            returnGid: canonicalReturn.returnGid,
            returnStatus: canonicalReturn.status,
            returnLineItems: canonicalReturn.returnLineItems.map((lineItem) => ({
              returnLineItemGid: lineItem.returnLineItemGid,
              sourceLineItemId: lineItem.sourceLineItemId,
              sku: lineItem.sku,
            })),
          },
        });
        report.signalsCreatedOrUpdated += 1;
        report.failedCount += 1;
        report.results.push({
          returnId: canonicalReturn.sourceShopifyReturnId,
          status: 'failed',
          reason: message,
          affectedAllocationIds: [],
          affectedVendorIds: [],
          affectedReturnRecordIds: [],
        });
      }
    }

    return report;
  }

  return {
    reconcileShopifyOrderReturns,
  };
}

export const __canonicalReturnReconciliationTesting = {
  CANONICAL_RETURN_SIGNAL_RULE_KEYS,
  buildCanonicalReturnSignalId,
  mapCanonicalReturnStatus,
};
