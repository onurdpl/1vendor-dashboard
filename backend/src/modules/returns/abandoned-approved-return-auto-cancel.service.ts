import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import type {
  CancelShopifyReturnResult,
  ShopifyReturnCancellationState,
} from '../shopify/shopify-admin.types.js';

export const APPROVED_RETURN_AUTO_CANCEL_DEFAULT_DAYS = 14;
const APPROVED_RETURN_AUTO_CANCEL_DEFAULT_LIMIT = 25;
const APPROVED_RETURN_AUTO_CANCEL_DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

type ReturnAutoCancelShopifyService = Pick<
  ReturnType<typeof createShopifyAdminService>,
  'fetchReturnCancellationState' | 'cancelReturn'
>;

type ReturnAutoCancelRecord = {
  id: string;
  vendorAllocationId: string;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string;
  sourceShopifyRefundId: string | null;
  sourceShopifyReturnId: string | null;
  sourceShopifyReturnGid: string | null;
  returnLifecycleStatus: string | null;
  returnRequestSource: string | null;
  requestUpdatedAt: Date | null;
  status: string;
  returnProvider: string | null;
  returnProviderShipmentId: string | null;
  returnTrackingNumber: string | null;
  returnLabel: string | null;
  returnProviderSnapshot: Prisma.JsonValue | null;
  vendorReceivedAt: Date | null;
  vendorDecision: string | null;
  createdAt: Date;
  updatedAt: Date;
  vendorAllocation: {
    assignedVendorId: string;
    assignedVendor: {
      id: string;
      name: string;
    };
    order: {
      id: string;
      sourceShopifyOrderId: string;
      sourceShopifyOrderNumber: string;
    };
    refundRecords: Array<{
      id: string;
      sourceShopifyRefundId: string;
    }>;
    financeEntries: Array<{
      id: string;
    }>;
  };
};

type AutoCancelStatus =
  | 'cancelled'
  | 'dry_run_ready'
  | 'skipped'
  | 'failed';

type AbandonedApprovedReturnAutoCancelRecordResultBase = {
  returnRecordId: string;
  shopifyReturnGid: string | null;
  status: AutoCancelStatus;
  skippedReason: string | null;
  affectedReturnRecordIds: string[];
  diagnostics?: AbandonedApprovedReturnDiagnostic;
};

export type AbandonedApprovedReturnAutoCancelRecordResult =
  AbandonedApprovedReturnAutoCancelRecordResultBase &
  Partial<AbandonedApprovedReturnDiagnostic>;

export type AbandonedApprovedReturnDiagnostic = {
  returnRecordId: string;
  vendorId: string;
  vendorName: string;
  orderId: string;
  shopifyOrderId: string;
  shopifyReturnGid: string | null;
  localReturnStatus: string;
  returnLifecycleStatus: string | null;
  approvedOpenTimestamp: string | null;
  ageInDays: number | null;
  vendorReceivedAt: string | null;
  vendorDecision: string | null;
  refundExists: boolean;
  refundRecordCount: number;
  reverseShipmentExists: boolean;
  trackingNumber: string | null;
  settlementCurrentlyHeld: boolean;
  skipReason: string | null;
};

export type AbandonedApprovedReturnAutoCancelResult = {
  policyDays: number;
  dryRun: boolean;
  candidatesFound: number;
  processedShopifyReturns: number;
  cancelledCount: number;
  skippedCount: number;
  failedCount: number;
  results: AbandonedApprovedReturnAutoCancelRecordResult[];
};

type RunAbandonedApprovedReturnAutoCancelOptions = {
  now?: Date;
  limit?: number;
  autoCancelDays?: number;
  dryRun?: boolean;
  shopifyAdminService?: ReturnAutoCancelShopifyService;
};

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function normalizeShopifyStatus(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? '';
}

function isApprovedLocalReturn(record: Pick<ReturnAutoCancelRecord, 'returnLifecycleStatus' | 'status'>) {
  return normalize(record.returnLifecycleStatus) === 'approved' || normalize(record.status) === 'approved';
}

function isCancelledLocalReturn(record: Pick<ReturnAutoCancelRecord, 'returnLifecycleStatus' | 'status'>) {
  return normalize(record.returnLifecycleStatus) === 'cancelled' ||
    normalize(record.returnLifecycleStatus) === 'canceled' ||
    normalize(record.status) === 'cancelled' ||
    normalize(record.status) === 'canceled';
}

function getApprovalTimestamp(record: Pick<ReturnAutoCancelRecord, 'requestUpdatedAt' | 'updatedAt' | 'createdAt'>) {
  return record.requestUpdatedAt ?? record.updatedAt ?? record.createdAt;
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function getAgeInDays(timestamp: Date | null, now: Date) {
  if (!timestamp) {
    return null;
  }

  const ageMs = now.getTime() - timestamp.getTime();
  return Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
}

function getAutoCancelDays(env: AppEnv, override?: number) {
  return override ?? env.APPROVED_RETURN_AUTO_CANCEL_DAYS ?? APPROVED_RETURN_AUTO_CANCEL_DEFAULT_DAYS;
}

function getAutoCancelLimit(env: AppEnv, override?: number) {
  return override ?? env.APPROVED_RETURN_AUTO_CANCEL_LIMIT ?? APPROVED_RETURN_AUTO_CANCEL_DEFAULT_LIMIT;
}

function getAutoCancelIntervalMs(env: AppEnv) {
  return env.APPROVED_RETURN_AUTO_CANCEL_INTERVAL_MS ?? APPROVED_RETURN_AUTO_CANCEL_DEFAULT_INTERVAL_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readSnapshot(value: unknown) {
  return isRecord(value) ? value : {};
}

function readString(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return null;
  }

  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return String(raw);
    }
  }

  return null;
}

function readBoolean(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return false;
  }

  return keys.some((key) => value[key] === true);
}

function sanitizeShopifyUserErrors(errors: CancelShopifyReturnResult['userErrors']) {
  return errors.map((error) => ({
    field: error.field,
    message: error.message,
  }));
}

function hasLocalReturnShipmentEvidence(record: ReturnAutoCancelRecord) {
  const snapshot = readSnapshot(record.returnProviderSnapshot);
  return Boolean(
    record.returnProviderShipmentId?.trim() ||
      record.returnTrackingNumber?.trim() ||
      record.returnLabel?.trim() ||
      readString(snapshot, [
        'shopifyReverseDeliveryId',
        'reverseDeliveryId',
        'refreshedReturnProviderShipmentId',
        'navlungoReturnProviderTrackingId',
      ]) ||
      readBoolean(snapshot, [
        'returnProviderIdPresent',
        'returnTrackingPresent',
        'returnLabelPresent',
        'shopifyReturnTrackingSynced',
        'shopifyReturnLabelSynced',
        'kargonomiReturnShipmentSucceeded',
        'navlungoReturnPickupSucceeded',
        'reverseDeliveryIdPresent',
      ]),
  );
}

function getTrackingNumber(record: ReturnAutoCancelRecord, canonicalState?: ShopifyReturnCancellationState | null) {
  if (record.returnTrackingNumber?.trim()) {
    return record.returnTrackingNumber.trim();
  }

  const snapshotTracking = readString(record.returnProviderSnapshot, [
    'trackingNumber',
    'returnTrackingNumber',
    'providerTrackingId',
    'navlungoReturnProviderTrackingId',
  ]);
  if (snapshotTracking) {
    return snapshotTracking;
  }

  for (const order of canonicalState?.reverseFulfillmentOrders ?? []) {
    for (const delivery of order.reverseDeliveries) {
      if (delivery.trackingNumber?.trim()) {
        return delivery.trackingNumber.trim();
      }
    }
  }

  return null;
}

function getLocalSkipReason(record: ReturnAutoCancelRecord, input: {
  now: Date;
  autoCancelDays: number;
  allowCancelled?: boolean;
}) {
  if (record.returnRequestSource !== 'shopify_return_request') {
    return 'not_shopify_return_request';
  }

  if (!isApprovedLocalReturn(record)) {
    if (input.allowCancelled && isCancelledLocalReturn(record)) {
      return null;
    }
    return 'return_not_approved';
  }

  const approvalTimestamp = getApprovalTimestamp(record);
  const ageMs = input.now.getTime() - approvalTimestamp.getTime();
  if (ageMs < input.autoCancelDays * 24 * 60 * 60 * 1000) {
    return 'approved_return_too_recent';
  }

  if (record.sourceShopifyRefundId?.trim()) {
    return 'return_refund_id_present';
  }

  if (record.vendorAllocation.refundRecords.length > 0) {
    return 'refund_record_exists';
  }

  if (record.vendorAllocation.financeEntries.length > 0) {
    return 'refund_ledger_exists';
  }

  if (record.vendorReceivedAt) {
    return 'vendor_received';
  }

  if (record.vendorDecision?.trim()) {
    return 'vendor_decision_exists';
  }

  if (hasLocalReturnShipmentEvidence(record)) {
    return 'return_shipment_evidence_exists';
  }

  return null;
}

function getShopifyReturnKey(record: Pick<ReturnAutoCancelRecord, 'sourceShopifyReturnGid' | 'sourceShopifyReturnId'>) {
  return record.sourceShopifyReturnGid?.trim() || record.sourceShopifyReturnId?.trim() || null;
}

function resolveShopifyReturnGid(record: Pick<ReturnAutoCancelRecord, 'sourceShopifyReturnGid' | 'sourceShopifyReturnId'>) {
  const gid = record.sourceShopifyReturnGid?.trim();
  if (gid) {
    return gid;
  }

  const id = record.sourceShopifyReturnId?.trim();
  if (!id) {
    return null;
  }

  return id.startsWith('gid://shopify/Return/') ? id : `gid://shopify/Return/${id}`;
}

function hasCanonicalReturnShipmentEvidence(state: ShopifyReturnCancellationState) {
  return state.reverseFulfillmentOrders.some((order) => {
    if (order.status && normalizeShopifyStatus(order.status) !== 'OPEN') {
      return true;
    }

    return order.reverseDeliveries.some((delivery) =>
      Boolean(
        delivery.id ||
          delivery.labelPublicFileUrl?.trim() ||
          delivery.trackingNumber?.trim() ||
          delivery.trackingUrl?.trim(),
      ),
    );
  });
}

function isSettlementCurrentlyHeld(record: ReturnAutoCancelRecord) {
  return isApprovedLocalReturn(record) &&
    record.vendorAllocation.refundRecords.length === 0 &&
    !record.sourceShopifyRefundId?.trim();
}

function buildDryRunDiagnostics(input: {
  record: ReturnAutoCancelRecord;
  now: Date;
  shopifyReturnGid: string | null;
  skippedReason: string | null;
  canonicalState?: ShopifyReturnCancellationState | null;
}) {
  const approvalTimestamp = getApprovalTimestamp(input.record);
  const reverseShipmentExists =
    hasLocalReturnShipmentEvidence(input.record) ||
    (input.canonicalState ? hasCanonicalReturnShipmentEvidence(input.canonicalState) : false);
  const refundExists =
    Boolean(input.record.sourceShopifyRefundId?.trim()) ||
    input.record.vendorAllocation.refundRecords.length > 0 ||
    input.record.vendorAllocation.financeEntries.length > 0 ||
    Boolean(input.canonicalState && (input.canonicalState.refundIds.length > 0 || input.canonicalState.transactionIds.length > 0));

  return {
    returnRecordId: input.record.id,
    vendorId: input.record.vendorAllocation.assignedVendorId,
    vendorName: input.record.vendorAllocation.assignedVendor.name,
    orderId: input.record.sourceShopifyOrderNumber || input.record.vendorAllocation.order.sourceShopifyOrderNumber,
    shopifyOrderId: input.record.vendorAllocation.order.sourceShopifyOrderId || input.record.sourceShopifyOrderId,
    shopifyReturnGid: input.shopifyReturnGid,
    localReturnStatus: input.record.status,
    returnLifecycleStatus: input.record.returnLifecycleStatus,
    approvedOpenTimestamp: toIsoString(approvalTimestamp),
    ageInDays: getAgeInDays(approvalTimestamp, input.now),
    vendorReceivedAt: toIsoString(input.record.vendorReceivedAt),
    vendorDecision: input.record.vendorDecision,
    refundExists,
    refundRecordCount: input.record.vendorAllocation.refundRecords.length,
    reverseShipmentExists,
    trackingNumber: getTrackingNumber(input.record, input.canonicalState),
    settlementCurrentlyHeld: isSettlementCurrentlyHeld(input.record),
    skipReason: input.skippedReason,
  };
}

function attachDiagnostics(
  result: AbandonedApprovedReturnAutoCancelRecordResultBase,
  diagnostics: AbandonedApprovedReturnDiagnostic | undefined,
): AbandonedApprovedReturnAutoCancelRecordResult {
  return diagnostics ? { ...result, ...diagnostics, diagnostics } : result;
}

function buildAutoCancelSnapshot(existing: unknown, input: {
  status: AutoCancelStatus;
  skippedReason?: string | null;
  policyDays: number;
  attemptedAt: Date;
  shopifyReturnGid: string | null;
  canonicalStatus?: string | null;
  dryRun: boolean;
  affectedReturnRecordIds: string[];
  details?: Record<string, unknown>;
}) {
  return {
    ...readSnapshot(existing),
    abandonedApprovedReturnAutoCancel: {
      status: input.status,
      skippedReason: input.skippedReason ?? null,
      policyDays: input.policyDays,
      attemptedAt: input.attemptedAt.toISOString(),
      shopifyReturnGidPresent: Boolean(input.shopifyReturnGid),
      canonicalStatus: input.canonicalStatus ?? null,
      dryRun: input.dryRun,
      affectedReturnRecordIds: input.affectedReturnRecordIds,
      ...(input.details ?? {}),
    },
  };
}

async function persistAutoCancelSnapshot(record: ReturnAutoCancelRecord, input: {
  status: AutoCancelStatus;
  skippedReason?: string | null;
  policyDays: number;
  attemptedAt: Date;
  shopifyReturnGid: string | null;
  canonicalStatus?: string | null;
  dryRun: boolean;
  affectedReturnRecordIds?: string[];
  details?: Record<string, unknown>;
}) {
  await prisma.returnRecord.update({
    where: { id: record.id },
    data: {
      returnProviderSnapshot: buildAutoCancelSnapshot(record.returnProviderSnapshot, {
        ...input,
        affectedReturnRecordIds: input.affectedReturnRecordIds ?? [record.id],
      }) as Prisma.InputJsonValue,
    },
  });
}

async function markLocalReturnRecordsCancelled(records: ReturnAutoCancelRecord[], input: {
  policyDays: number;
  attemptedAt: Date;
  shopifyReturnGid: string | null;
  canonicalStatus: string | null;
  dryRun: boolean;
  skippedReason?: string | null;
}) {
  const affectedReturnRecordIds = records.map((record) => record.id);
  for (const record of records) {
    await prisma.returnRecord.update({
      where: { id: record.id },
      data: {
        returnLifecycleStatus: 'cancelled',
        status: 'cancelled',
        requestUpdatedAt: input.attemptedAt,
        returnProviderSnapshot: buildAutoCancelSnapshot(record.returnProviderSnapshot, {
          status: input.dryRun ? 'dry_run_ready' : 'cancelled',
          skippedReason: input.skippedReason ?? null,
          policyDays: input.policyDays,
          attemptedAt: input.attemptedAt,
          shopifyReturnGid: input.shopifyReturnGid,
          canonicalStatus: input.canonicalStatus,
          dryRun: input.dryRun,
          affectedReturnRecordIds,
        }) as Prisma.InputJsonValue,
      },
    });
  }
}

async function findRelatedReturnRecords(record: ReturnAutoCancelRecord) {
  const or = [
    record.sourceShopifyReturnGid ? { sourceShopifyReturnGid: record.sourceShopifyReturnGid } : null,
    record.sourceShopifyReturnId ? { sourceShopifyReturnId: record.sourceShopifyReturnId } : null,
  ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  if (or.length === 0) {
    return [record];
  }

  return prisma.returnRecord.findMany({
    where: {
      OR: or,
    },
    include: {
      vendorAllocation: {
        select: {
          assignedVendorId: true,
          assignedVendor: {
            select: {
              id: true,
              name: true,
            },
          },
          order: {
            select: {
              id: true,
              sourceShopifyOrderId: true,
              sourceShopifyOrderNumber: true,
            },
          },
          refundRecords: {
            select: {
              id: true,
              sourceShopifyRefundId: true,
            },
          },
          financeEntries: {
            where: {
              entryType: 'refund',
            },
            select: {
              id: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  });
}

export async function findAbandonedApprovedReturnAutoCancelCandidates(options: {
  now?: Date;
  autoCancelDays?: number;
  limit?: number;
  diagnosticsMode?: boolean;
} = {}) {
  const now = options.now ?? new Date();
  const autoCancelDays = options.autoCancelDays ?? APPROVED_RETURN_AUTO_CANCEL_DEFAULT_DAYS;
  const cutoff = new Date(now.getTime() - autoCancelDays * 24 * 60 * 60 * 1000);
  const diagnosticsMode = options.diagnosticsMode === true;

  return prisma.returnRecord.findMany({
    where: {
      returnRequestSource: 'shopify_return_request',
      ...(diagnosticsMode
        ? {}
        : {
            vendorReceivedAt: null,
            vendorDecision: null,
            sourceShopifyRefundId: null,
            returnProviderShipmentId: null,
            returnTrackingNumber: null,
            returnLabel: null,
          }),
      AND: [
        {
          OR: [
            { returnLifecycleStatus: 'approved' },
            { status: 'approved' },
          ],
        },
        {
          OR: [
            { sourceShopifyReturnGid: { not: null } },
            { sourceShopifyReturnId: { not: null } },
          ],
        },
        {
          OR: [
            { requestUpdatedAt: { lte: cutoff } },
            {
              requestUpdatedAt: null,
              updatedAt: { lte: cutoff },
            },
          ],
        },
      ],
    },
    include: {
      vendorAllocation: {
        select: {
          assignedVendorId: true,
          assignedVendor: {
            select: {
              id: true,
              name: true,
            },
          },
          order: {
            select: {
              id: true,
              sourceShopifyOrderId: true,
              sourceShopifyOrderNumber: true,
            },
          },
          refundRecords: {
            select: {
              id: true,
              sourceShopifyRefundId: true,
            },
          },
          financeEntries: {
            where: {
              entryType: 'refund',
            },
            select: {
              id: true,
            },
          },
        },
      },
    },
    orderBy: {
      requestUpdatedAt: 'asc',
    },
    take: options.limit ?? APPROVED_RETURN_AUTO_CANCEL_DEFAULT_LIMIT,
  });
}

async function processAutoCancelCandidate(
  record: ReturnAutoCancelRecord,
  input: {
    now: Date;
    autoCancelDays: number;
    dryRun: boolean;
    shopifyAdminService: ReturnAutoCancelShopifyService;
  },
): Promise<AbandonedApprovedReturnAutoCancelRecordResult> {
  const attemptedAt = input.now;
  const shopifyReturnGid = resolveShopifyReturnGid(record);
  if (!shopifyReturnGid) {
    if (!input.dryRun) {
      await persistAutoCancelSnapshot(record, {
        status: 'skipped',
        skippedReason: 'shopify_return_id_missing',
        policyDays: input.autoCancelDays,
        attemptedAt,
        shopifyReturnGid: null,
        dryRun: input.dryRun,
      });
    }
    const diagnostics = input.dryRun
      ? buildDryRunDiagnostics({
          record,
          now: input.now,
          shopifyReturnGid: null,
          skippedReason: 'shopify_return_id_missing',
        })
      : undefined;
    return attachDiagnostics({
      returnRecordId: record.id,
      shopifyReturnGid: null,
      status: 'skipped',
      skippedReason: 'shopify_return_id_missing',
      affectedReturnRecordIds: [record.id],
    }, diagnostics);
  }

  const relatedRecords = await findRelatedReturnRecords(record);
  const affectedReturnRecordIds = relatedRecords.map((related) => related.id);

  for (const relatedRecord of relatedRecords) {
    const skippedReason = getLocalSkipReason(relatedRecord, {
      now: input.now,
      autoCancelDays: input.autoCancelDays,
      allowCancelled: true,
    });
    if (skippedReason) {
      if (!input.dryRun) {
        await persistAutoCancelSnapshot(record, {
          status: 'skipped',
          skippedReason,
          policyDays: input.autoCancelDays,
          attemptedAt,
          shopifyReturnGid,
          dryRun: input.dryRun,
          affectedReturnRecordIds,
          details: {
            skippedReturnRecordId: relatedRecord.id,
          },
        });
      }
      const diagnostics = input.dryRun
        ? buildDryRunDiagnostics({
            record,
            now: input.now,
            shopifyReturnGid,
            skippedReason,
          })
        : undefined;
      return attachDiagnostics({
        returnRecordId: record.id,
        shopifyReturnGid,
        status: 'skipped',
        skippedReason,
        affectedReturnRecordIds,
      }, diagnostics);
    }
  }

  let canonicalState: ShopifyReturnCancellationState;
  try {
    canonicalState = await input.shopifyAdminService.fetchReturnCancellationState(shopifyReturnGid);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Shopify return canonical fetch failed.';
    if (!input.dryRun) {
      await persistAutoCancelSnapshot(record, {
        status: 'failed',
        skippedReason: 'canonical_fetch_failed',
        policyDays: input.autoCancelDays,
        attemptedAt,
        shopifyReturnGid,
        dryRun: input.dryRun,
        affectedReturnRecordIds,
        details: {
          errorMessage: message,
        },
      });
    }
    const diagnostics = input.dryRun
      ? buildDryRunDiagnostics({
          record,
          now: input.now,
          shopifyReturnGid,
          skippedReason: 'canonical_fetch_failed',
        })
      : undefined;
    return attachDiagnostics({
      returnRecordId: record.id,
      shopifyReturnGid,
      status: 'failed',
      skippedReason: 'canonical_fetch_failed',
      affectedReturnRecordIds,
    }, diagnostics);
  }

  const canonicalStatus = normalizeShopifyStatus(canonicalState.status);
  if (canonicalStatus === 'CANCELED' || canonicalStatus === 'CANCELLED') {
    if (!input.dryRun) {
      await markLocalReturnRecordsCancelled(relatedRecords, {
        policyDays: input.autoCancelDays,
        attemptedAt,
        shopifyReturnGid,
        canonicalStatus,
        dryRun: false,
        skippedReason: 'shopify_already_cancelled',
      });
    }
    return attachDiagnostics({
      returnRecordId: record.id,
      shopifyReturnGid,
      status: input.dryRun ? 'dry_run_ready' : 'cancelled',
      skippedReason: input.dryRun ? null : 'shopify_already_cancelled',
      affectedReturnRecordIds,
    }, input.dryRun
      ? buildDryRunDiagnostics({
          record,
          now: input.now,
          shopifyReturnGid,
          skippedReason: null,
          canonicalState,
        })
      : undefined);
  }

  if (canonicalStatus !== 'OPEN') {
    if (!input.dryRun) {
      await persistAutoCancelSnapshot(record, {
        status: 'skipped',
        skippedReason: 'shopify_return_not_open',
        policyDays: input.autoCancelDays,
        attemptedAt,
        shopifyReturnGid,
        canonicalStatus,
        dryRun: input.dryRun,
        affectedReturnRecordIds,
      });
    }
    const diagnostics = input.dryRun
      ? buildDryRunDiagnostics({
          record,
          now: input.now,
          shopifyReturnGid,
          skippedReason: 'shopify_return_not_open',
          canonicalState,
        })
      : undefined;
    return attachDiagnostics({
      returnRecordId: record.id,
      shopifyReturnGid,
      status: 'skipped',
      skippedReason: 'shopify_return_not_open',
      affectedReturnRecordIds,
    }, diagnostics);
  }

  if (canonicalState.refundIds.length > 0 || canonicalState.transactionIds.length > 0) {
    if (!input.dryRun) {
      await persistAutoCancelSnapshot(record, {
        status: 'skipped',
        skippedReason: 'shopify_refund_or_transaction_exists',
        policyDays: input.autoCancelDays,
        attemptedAt,
        shopifyReturnGid,
        canonicalStatus,
        dryRun: input.dryRun,
        affectedReturnRecordIds,
        details: {
          shopifyRefundCount: canonicalState.refundIds.length,
          shopifyTransactionCount: canonicalState.transactionIds.length,
        },
      });
    }
    const diagnostics = input.dryRun
      ? buildDryRunDiagnostics({
          record,
          now: input.now,
          shopifyReturnGid,
          skippedReason: 'shopify_refund_or_transaction_exists',
          canonicalState,
        })
      : undefined;
    return attachDiagnostics({
      returnRecordId: record.id,
      shopifyReturnGid,
      status: 'skipped',
      skippedReason: 'shopify_refund_or_transaction_exists',
      affectedReturnRecordIds,
    }, diagnostics);
  }

  if (canonicalState.requestApprovedAt) {
    const canonicalApprovedAt = new Date(canonicalState.requestApprovedAt);
    if (Number.isFinite(canonicalApprovedAt.getTime())) {
      const canonicalAgeMs = input.now.getTime() - canonicalApprovedAt.getTime();
      if (canonicalAgeMs < input.autoCancelDays * 24 * 60 * 60 * 1000) {
        if (!input.dryRun) {
          await persistAutoCancelSnapshot(record, {
            status: 'skipped',
            skippedReason: 'shopify_approval_too_recent',
            policyDays: input.autoCancelDays,
            attemptedAt,
            shopifyReturnGid,
            canonicalStatus,
            dryRun: input.dryRun,
            affectedReturnRecordIds,
          });
        }
        const diagnostics = input.dryRun
          ? buildDryRunDiagnostics({
              record,
              now: input.now,
              shopifyReturnGid,
              skippedReason: 'shopify_approval_too_recent',
              canonicalState,
            })
          : undefined;
        return attachDiagnostics({
          returnRecordId: record.id,
          shopifyReturnGid,
          status: 'skipped',
          skippedReason: 'shopify_approval_too_recent',
          affectedReturnRecordIds,
        }, diagnostics);
      }
    }
  }

  if (hasCanonicalReturnShipmentEvidence(canonicalState)) {
    if (!input.dryRun) {
      await persistAutoCancelSnapshot(record, {
        status: 'skipped',
        skippedReason: 'shopify_reverse_delivery_evidence_exists',
        policyDays: input.autoCancelDays,
        attemptedAt,
        shopifyReturnGid,
        canonicalStatus,
        dryRun: input.dryRun,
        affectedReturnRecordIds,
        details: {
          reverseFulfillmentOrderCount: canonicalState.reverseFulfillmentOrders.length,
          reverseDeliveryCount: canonicalState.reverseFulfillmentOrders.reduce(
            (count, order) => count + order.reverseDeliveries.length,
            0,
          ),
        },
      });
    }
    const diagnostics = input.dryRun
      ? buildDryRunDiagnostics({
          record,
          now: input.now,
          shopifyReturnGid,
          skippedReason: 'shopify_reverse_delivery_evidence_exists',
          canonicalState,
        })
      : undefined;
    return attachDiagnostics({
      returnRecordId: record.id,
      shopifyReturnGid,
      status: 'skipped',
      skippedReason: 'shopify_reverse_delivery_evidence_exists',
      affectedReturnRecordIds,
    }, diagnostics);
  }

  if (input.dryRun) {
    return attachDiagnostics({
      returnRecordId: record.id,
      shopifyReturnGid,
      status: 'dry_run_ready',
      skippedReason: null,
      affectedReturnRecordIds,
    }, buildDryRunDiagnostics({
        record,
        now: input.now,
        shopifyReturnGid,
        skippedReason: null,
        canonicalState,
      }));
  }

  let cancelResult: CancelShopifyReturnResult;
  try {
    cancelResult = await input.shopifyAdminService.cancelReturn(shopifyReturnGid);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Shopify return cancel failed.';
    await persistAutoCancelSnapshot(record, {
      status: 'failed',
      skippedReason: 'shopify_cancel_failed',
      policyDays: input.autoCancelDays,
      attemptedAt,
      shopifyReturnGid,
      canonicalStatus,
      dryRun: false,
      affectedReturnRecordIds,
      details: {
        errorMessage: message,
      },
    });
    return {
      returnRecordId: record.id,
      shopifyReturnGid,
      status: 'failed',
      skippedReason: 'shopify_cancel_failed',
      affectedReturnRecordIds,
    };
  }

  if (cancelResult.userErrors.length > 0 || normalizeShopifyStatus(cancelResult.status) !== 'CANCELED') {
    await persistAutoCancelSnapshot(record, {
      status: 'failed',
      skippedReason: 'shopify_cancel_user_errors',
      policyDays: input.autoCancelDays,
      attemptedAt,
      shopifyReturnGid,
      canonicalStatus: cancelResult.status ?? canonicalStatus,
      dryRun: false,
      affectedReturnRecordIds,
      details: {
        shopifyUserErrors: sanitizeShopifyUserErrors(cancelResult.userErrors),
      },
    });
    return {
      returnRecordId: record.id,
      shopifyReturnGid,
      status: 'failed',
      skippedReason: 'shopify_cancel_user_errors',
      affectedReturnRecordIds,
    };
  }

  await markLocalReturnRecordsCancelled(relatedRecords, {
    policyDays: input.autoCancelDays,
    attemptedAt,
    shopifyReturnGid,
    canonicalStatus: cancelResult.status,
    dryRun: false,
  });

  return {
    returnRecordId: record.id,
    shopifyReturnGid,
    status: 'cancelled',
    skippedReason: null,
    affectedReturnRecordIds,
  };
}

export async function runAbandonedApprovedReturnAutoCancel(
  env: AppEnv,
  options: RunAbandonedApprovedReturnAutoCancelOptions = {},
): Promise<AbandonedApprovedReturnAutoCancelResult> {
  const now = options.now ?? new Date();
  const autoCancelDays = getAutoCancelDays(env, options.autoCancelDays);
  const limit = getAutoCancelLimit(env, options.limit);
  const dryRun = options.dryRun === true;
  const candidates = await findAbandonedApprovedReturnAutoCancelCandidates({
    now,
    autoCancelDays,
    limit,
    diagnosticsMode: dryRun,
  });
  const shopifyAdminService = options.shopifyAdminService ?? createShopifyAdminService(env);
  const processedReturnKeys = new Set<string>();
  const results: AbandonedApprovedReturnAutoCancelRecordResult[] = [];

  for (const candidate of candidates) {
    const key = getShopifyReturnKey(candidate);
    if (!dryRun && key && processedReturnKeys.has(key)) {
      continue;
    }
    if (!dryRun && key) {
      processedReturnKeys.add(key);
    }

    results.push(await processAutoCancelCandidate(candidate, {
      now,
      autoCancelDays,
      dryRun,
      shopifyAdminService,
    }));
  }

  return {
    policyDays: autoCancelDays,
    dryRun,
    candidatesFound: candidates.length,
    processedShopifyReturns: results.length,
    cancelledCount: results.filter((result) => result.status === 'cancelled').length,
    skippedCount: results.filter((result) => result.status === 'skipped').length,
    failedCount: results.filter((result) => result.status === 'failed').length,
    results,
  };
}

export function registerAbandonedApprovedReturnAutoCancelScheduler(app: FastifyInstance, env: AppEnv) {
  if (!env.APPROVED_RETURN_AUTO_CANCEL_ENABLED) {
    return;
  }

  let running = false;
  const interval = globalThis.setInterval(() => {
    if (running) {
      return;
    }

    running = true;
    void runAbandonedApprovedReturnAutoCancel(env)
      .then((result) => {
        app.log.info(
          {
            policyDays: result.policyDays,
            candidatesFound: result.candidatesFound,
            processedShopifyReturns: result.processedShopifyReturns,
            cancelledCount: result.cancelledCount,
            skippedCount: result.skippedCount,
            failedCount: result.failedCount,
          },
          'Abandoned approved return auto-cancel cycle completed.',
        );
      })
      .catch((error) => {
        app.log.error({ error }, 'Abandoned approved return auto-cancel cycle failed.');
      })
      .finally(() => {
        running = false;
      });
  }, getAutoCancelIntervalMs(env));

  interval.unref?.();

  app.addHook('onClose', (_instance, done) => {
    globalThis.clearInterval(interval);
    done();
  });
}
