import {
  OperationalSignalSeverity,
  OperationalSignalSourceArea,
  OperationalSignalStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';
import { buildSaleLedgerEntryId, upsertSaleLedgerForAllocation } from '../finance/sale-ledger.service.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import type { ShopifyOrderFulfillment, ShopifyOrderFulfillmentState } from '../shopify/shopify-admin.types.js';
import type {
  OrderReconciliationResult,
  ReconciliationAllocationResult,
  ReconciliationFieldChange,
} from './reconciliation.types.js';
import {
  classifyPostApprovalRefundRisk,
  getUnsettledRefundOffsetEligibility,
} from '../finance/refund-offset.service.js';
import {
  buildLegacyRefundLedgerEntryId,
  buildRefundLedgerEntryId,
  matchesRefundLedgerSource,
} from '../finance/refund-ledger-id.service.js';
import { createVendorDebtForPaidRefund } from '../finance/vendor-balance.service.js';
import { isLedgerVoided } from '../finance/active-ledger-policy.service.js';
import {
  classifySaleLedgerRepairReadiness,
  isTransferRepairBlocked,
  repairBlockerMessage,
  resolveActiveEconomicOwnerForRepair,
} from './reconciliation-transfer-policy.service.js';

function extractShopifyGidTail(gid: string) {
  const tail = gid.split('/').at(-1)?.trim() ?? '';
  return tail || null;
}

function normalizeLineItemId(value: string) {
  return extractShopifyGidTail(value) ?? value;
}

function buildExpectedSaleLedgerIdForReconciliation(input: {
  assignedVendorId: string;
  sourceShopifyOrderId: string;
  vendorAllocationId: string;
}) {
  return buildSaleLedgerEntryId(input.assignedVendorId, input.sourceShopifyOrderId, input.vendorAllocationId);
}

function buildExpectedRefundLedgerIdForReconciliation(input: {
  vendorId: string;
  sourceShopifyRefundId: string;
  vendorAllocationId: string;
}) {
  return buildRefundLedgerEntryId(input);
}

const CANONICAL_FULFILLMENT_MATCH_MISSING_RULE_KEY = 'canonical_fulfillment_match_missing';
const CANONICAL_FULFILLMENT_MATCH_MISSING_MESSAGE =
  'Canonical fulfillment line could not be matched. Local state preserved. Manual review recommended.';

function sanitizeSignalPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function buildCanonicalFulfillmentMatchMissingSignalId(allocationId: string) {
  return `signal-${sanitizeSignalPart(CANONICAL_FULFILLMENT_MATCH_MISSING_RULE_KEY)}-${sanitizeSignalPart(allocationId)}`;
}

function isCancelledStatus(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase() === 'cancelled' || (value ?? '').trim().toLowerCase() === 'canceled';
}

function normalizeFulfillmentEventStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'delivered') {
    return 'delivered';
  }
  if (normalized === 'in_transit' || normalized === 'out_for_delivery' || normalized === 'confirmed') {
    return 'in_transit';
  }
  if (normalized === 'failure' || normalized === 'failed' || normalized === 'attempted_delivery') {
    return 'fulfillment_event_attention';
  }
  return null;
}

function toDate(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function latestDate(values: Array<Date | null>) {
  return values
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}

function getTrackingInfo(fulfillment: ShopifyOrderFulfillment) {
  return fulfillment.trackingInfo.find((tracking) => tracking.number || tracking.company || tracking.url) ?? null;
}

function getLatestFulfillmentEvent(fulfillment: ShopifyOrderFulfillment) {
  return [...fulfillment.events]
    .filter((event) => event.status || event.happenedAt)
    .sort((a, b) => {
      const left = a.happenedAt ? new Date(a.happenedAt).getTime() : 0;
      const right = b.happenedAt ? new Date(b.happenedAt).getTime() : 0;
      return right - left;
    })[0] ?? null;
}

function getCanonicalEventStatus(fulfillment: ShopifyOrderFulfillment) {
  const latestEvent = getLatestFulfillmentEvent(fulfillment);
  return normalizeFulfillmentEventStatus((latestEvent?.status ?? '').toLowerCase());
}

function hasLocalFulfillmentEvidence(input: {
  fulfillmentStatus: string | null;
  shippingStatus: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  fulfillment?: {
    trackingUrl?: string | null;
    shopifyFulfillmentId?: string | null;
    fulfilledAt?: Date | null;
    shipmentCreatedAt?: Date | null;
    shipmentUpdatedAt?: Date | null;
  } | null;
}) {
  const lifecycle = `${input.fulfillmentStatus ?? ''} ${input.shippingStatus ?? ''}`.trim().toLowerCase();
  return Boolean(
    input.trackingNumber ||
      input.carrier ||
      input.fulfillment?.trackingUrl ||
      input.fulfillment?.shopifyFulfillmentId ||
      input.fulfillment?.fulfilledAt ||
      input.fulfillment?.shipmentCreatedAt ||
      input.fulfillment?.shipmentUpdatedAt ||
      lifecycle.includes('fulfilled') ||
      lifecycle.includes('shipped') ||
      lifecycle.includes('in_transit') ||
      lifecycle.includes('in transit') ||
      lifecycle.includes('delivered') ||
      lifecycle.includes('label_created') ||
      lifecycle.includes('label created'),
  );
}

async function upsertCanonicalFulfillmentMatchMissingSignal(input: {
  allocationId: string;
  vendorId: string;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string;
  fulfillmentState: ShopifyOrderFulfillmentState;
  localFulfillmentStatus: string | null;
  localShippingStatus: string | null;
  localTrackingNumber?: string | null;
  localCarrier?: string | null;
}) {
  const reconciledAt = new Date();
  const metadata: Prisma.InputJsonObject = {
    reason: CANONICAL_FULFILLMENT_MATCH_MISSING_RULE_KEY,
    diagnosticReason: CANONICAL_FULFILLMENT_MATCH_MISSING_MESSAGE,
    vendorId: input.vendorId,
    allocationId: input.allocationId,
    sourceShopifyOrderId: input.sourceShopifyOrderId,
    sourceShopifyOrderNumber: input.sourceShopifyOrderNumber,
    fulfillmentIds: input.fulfillmentState.fulfillments.map((fulfillment) => fulfillment.sourceFulfillmentId || fulfillment.id),
    fulfillmentOrderIds: input.fulfillmentState.fulfillmentOrders.map((fulfillmentOrder) => fulfillmentOrder.id),
    displayFulfillmentStatus: input.fulfillmentState.displayFulfillmentStatus,
    localFulfillmentStatus: input.localFulfillmentStatus,
    localShippingStatus: input.localShippingStatus,
    localTrackingNumber: input.localTrackingNumber ?? null,
    localCarrier: input.localCarrier ?? null,
    reconciledAt: reconciledAt.toISOString(),
  };

  await prisma.operationalSignal.upsert({
    where: {
      id: buildCanonicalFulfillmentMatchMissingSignalId(input.allocationId),
    },
    update: {
      type: 'reconciliation_issue',
      severity: OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.RECONCILIATION,
      vendorId: input.vendorId,
      allocationId: input.allocationId,
      title: 'Fulfillment reconciliation needs attention',
      description: CANONICAL_FULFILLMENT_MATCH_MISSING_MESSAGE,
      suggestedAction: 'Retry fulfillment reconciliation or review Shopify fulfillment line-item mapping.',
      status: OperationalSignalStatus.ACTIVE,
      ruleKey: CANONICAL_FULFILLMENT_MATCH_MISSING_RULE_KEY,
      triggeredAt: reconciledAt,
      resolvedAt: null,
      metadata,
    },
    create: {
      id: buildCanonicalFulfillmentMatchMissingSignalId(input.allocationId),
      type: 'reconciliation_issue',
      severity: OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.RECONCILIATION,
      vendorId: input.vendorId,
      allocationId: input.allocationId,
      title: 'Fulfillment reconciliation needs attention',
      description: CANONICAL_FULFILLMENT_MATCH_MISSING_MESSAGE,
      suggestedAction: 'Retry fulfillment reconciliation or review Shopify fulfillment line-item mapping.',
      ruleKey: CANONICAL_FULFILLMENT_MATCH_MISSING_RULE_KEY,
      triggeredAt: reconciledAt,
      metadata,
    },
  });
}

async function resolveCanonicalFulfillmentMatchMissingSignal(allocationId: string) {
  await prisma.operationalSignal.updateMany({
    where: {
      id: buildCanonicalFulfillmentMatchMissingSignalId(allocationId),
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

function recordChange(input: {
  scope: string;
  field: string;
  localValue: unknown;
  canonicalValue: unknown;
}) {
  const localValue = input.localValue === undefined || input.localValue === null ? null : String(input.localValue);
  const canonicalValue =
    input.canonicalValue === undefined || input.canonicalValue === null ? null : String(input.canonicalValue);

  if (localValue === canonicalValue) {
    return null;
  }

  return {
    scope: input.scope,
    field: input.field,
    localValue,
    canonicalValue,
  };
}

function recordSkippedRepair(input: {
  scope: string;
  field: string;
  localValue?: unknown;
  canonicalValue?: unknown;
  reason: string;
  skippedFields: ReconciliationFieldChange[];
  allocationResult: ReconciliationAllocationResult;
}) {
  const change = {
    scope: input.scope,
    field: input.field,
    localValue: input.localValue === undefined || input.localValue === null ? null : String(input.localValue),
    canonicalValue: input.canonicalValue === undefined || input.canonicalValue === null ? null : String(input.canonicalValue),
  };
  input.skippedFields.push(change);
  input.allocationResult.skippedFields.push(change);
  input.allocationResult.warnings.push(input.reason);
}

function buildCanonicalLineItemMaps(fulfillmentState: ShopifyOrderFulfillmentState) {
  const fulfilledLineItemIds = new Set<string>();
  const cancelledLineItemIds = new Set<string>();
  const fulfillmentByLineItemId = new Map<string, ShopifyOrderFulfillment>();

  for (const fulfillment of fulfillmentState.fulfillments) {
    for (const lineItem of fulfillment.lineItems) {
      const normalizedId = normalizeLineItemId(lineItem.sourceLineItemId || lineItem.lineItemGid);
      if (!normalizedId) {
        continue;
      }

      if (isCancelledStatus(fulfillment.status)) {
        cancelledLineItemIds.add(normalizedId);
        continue;
      }

      fulfilledLineItemIds.add(normalizedId);
      fulfillmentByLineItemId.set(normalizedId, fulfillment);
    }
  }

  for (const fulfillmentOrder of fulfillmentState.fulfillmentOrders) {
    if (!isCancelledStatus(fulfillmentOrder.status)) {
      continue;
    }

    for (const lineItem of fulfillmentOrder.lineItems) {
      const normalizedId = normalizeLineItemId(lineItem.lineItemId);
      if (normalizedId) {
        cancelledLineItemIds.add(normalizedId);
      }
    }
  }

  return {
    fulfilledLineItemIds,
    cancelledLineItemIds,
    fulfillmentByLineItemId,
  };
}

type ReconcileOrderOptions = {
  targetAllocationId?: string;
};

export function createReconciliationService(env: AppEnv) {
  const shopifyAdminService = createShopifyAdminService(env);

  async function reconcileShopifyOrder(
    sourceShopifyOrderId: string,
    options: ReconcileOrderOptions = {},
  ): Promise<OrderReconciliationResult | null> {
    const shopifyOrder = await prisma.shopifyOrder.findUnique({
      where: { sourceShopifyOrderId },
      include: {
        allocations: {
          include: {
            fulfillment: true,
            lineItems: {
              include: {
                shopifyOrderLineItem: true,
              },
            },
            refundRecords: true,
            returnRecords: true,
            economicTransfers: {
              select: {
                id: true,
                status: true,
                createdAt: true,
              },
              orderBy: {
                createdAt: 'desc',
              },
            },
            financeEntries: {
              include: {
                payoutBatchLines: {
                  include: {
                    payoutBatch: true,
                  },
                },
                settlementApprovalLines: {
                  include: {
                    settlementApproval: true,
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!shopifyOrder) {
      return null;
    }

    const fulfillmentState = await shopifyAdminService.fetchOrderFulfillmentState(sourceShopifyOrderId);
    const canonicalMaps = buildCanonicalLineItemMaps(fulfillmentState);

    const staleFields: ReconciliationFieldChange[] = [];
    const repairedFields: ReconciliationFieldChange[] = [];
    const skippedFields: ReconciliationFieldChange[] = [];
    const warnings: string[] = [];
    const affectedAllocations: ReconciliationAllocationResult[] = [];
    const affectedVendorIds = new Set<string>();

    const allocations = options.targetAllocationId
      ? shopifyOrder.allocations.filter((allocation) => allocation.id === options.targetAllocationId)
      : shopifyOrder.allocations;

    if (options.targetAllocationId && allocations.length === 0) {
      return null;
    }

    for (const allocation of allocations) {
      const allocationResult: ReconciliationAllocationResult = {
        allocationId: allocation.id,
        vendorId: allocation.assignedVendorId,
        staleFields: [],
        repairedFields: [],
        skippedFields: [],
        warnings: [],
      };
      const transferRepairStatus = isTransferRepairBlocked(allocation.economicTransfers);
      const transferRepairBlocked = transferRepairStatus !== 'allowed';
      const transferRepairBlockerReason = transferRepairBlocked
        ? repairBlockerMessage(transferRepairStatus)
        : null;
      if (transferRepairBlockerReason) {
        allocationResult.warnings.push(transferRepairBlockerReason);
      }

      const allocationLineItemIds = allocation.lineItems.map((lineItem) =>
        normalizeLineItemId(lineItem.shopifyOrderLineItem.sourceLineItemId),
      );
      const matchedFulfilledIds = allocationLineItemIds.filter((lineItemId) =>
        canonicalMaps.fulfilledLineItemIds.has(lineItemId),
      );
      const matchedCancelledIds = allocationLineItemIds.filter((lineItemId) =>
        canonicalMaps.cancelledLineItemIds.has(lineItemId),
      );
      const allItemsFulfilled =
        allocationLineItemIds.length > 0 && matchedFulfilledIds.length === allocationLineItemIds.length;
      const representativeFulfillment = matchedFulfilledIds.length > 0
        ? canonicalMaps.fulfillmentByLineItemId.get(matchedFulfilledIds[0])
        : null;
      const hasCanonicalFulfillmentTruth = Boolean(representativeFulfillment) || matchedCancelledIds.length > 0;

      if (!hasCanonicalFulfillmentTruth) {
        if (hasLocalFulfillmentEvidence(allocation)) {
          recordSkippedRepair({
            scope: allocation.id,
            field: 'canonicalFulfillmentMatch',
            localValue: 'local_fulfillment_state_preserved',
            canonicalValue: null,
            reason: CANONICAL_FULFILLMENT_MATCH_MISSING_MESSAGE,
            skippedFields,
            allocationResult,
          });
          await upsertCanonicalFulfillmentMatchMissingSignal({
            allocationId: allocation.id,
            vendorId: allocation.assignedVendorId,
            sourceShopifyOrderId: shopifyOrder.sourceShopifyOrderId,
            sourceShopifyOrderNumber: shopifyOrder.sourceShopifyOrderNumber,
            fulfillmentState,
            localFulfillmentStatus: allocation.fulfillmentStatus,
            localShippingStatus: allocation.shippingStatus,
            localTrackingNumber: allocation.trackingNumber,
            localCarrier: allocation.carrier,
          });
          affectedVendorIds.add(allocation.assignedVendorId);
        }
      } else {
        let desiredFulfillmentStatus = 'pending';
        let desiredShippingStatus = 'awaiting_shipment';
        let desiredTrackingNumber: string | null = null;
        let desiredCarrier: string | null = null;
        let desiredTrackingUrl: string | null = null;
        let desiredFulfilledAt: Date | null = null;
        let desiredShipmentCreatedAt: Date | null = null;
        let desiredShipmentUpdatedAt: Date | null = null;
        let desiredSyncStatus = matchedCancelledIds.length > 0 ? 'shopify_reconciled_cancelled' : 'shopify_reconciled';

        if (representativeFulfillment) {
          const tracking = getTrackingInfo(representativeFulfillment);
          const canonicalEventStatus = getCanonicalEventStatus(representativeFulfillment);
          desiredFulfillmentStatus = allItemsFulfilled ? 'fulfilled' : 'partially_fulfilled';
          desiredShippingStatus =
            canonicalEventStatus === 'delivered'
              ? 'delivered'
              : canonicalEventStatus === 'in_transit'
                ? 'in_transit'
                : canonicalEventStatus === 'fulfillment_event_attention'
                  ? 'fulfillment_event_attention'
                  : allItemsFulfilled
                    ? 'shipped'
                    : 'partially_shipped';
          desiredTrackingNumber = tracking?.number ?? null;
          desiredCarrier = tracking?.company ?? null;
          desiredTrackingUrl = tracking?.url ?? null;
          desiredFulfilledAt = toDate(representativeFulfillment.createdAt);
          const latestEvent = getLatestFulfillmentEvent(representativeFulfillment);
          desiredShipmentCreatedAt = desiredFulfilledAt;
          desiredShipmentUpdatedAt = latestDate([
            toDate(latestEvent?.happenedAt ?? null),
            toDate(representativeFulfillment.updatedAt),
            desiredFulfilledAt,
          ]);
        }

        if (!representativeFulfillment && matchedCancelledIds.length > 0) {
          desiredSyncStatus = 'shopify_reconciled_cancelled';
        }

        const fieldComparisons = [
          recordChange({
            scope: allocation.id,
            field: 'fulfillmentStatus',
            localValue: allocation.fulfillmentStatus,
            canonicalValue: desiredFulfillmentStatus,
          }),
          recordChange({
            scope: allocation.id,
            field: 'shippingStatus',
            localValue: allocation.shippingStatus,
            canonicalValue: desiredShippingStatus,
          }),
          recordChange({
            scope: allocation.id,
            field: 'trackingNumber',
            localValue: allocation.trackingNumber,
            canonicalValue: desiredTrackingNumber,
          }),
          recordChange({
            scope: allocation.id,
            field: 'carrier',
            localValue: allocation.carrier,
            canonicalValue: desiredCarrier,
          }),
          recordChange({
            scope: allocation.id,
            field: 'trackingUrl',
            localValue: allocation.fulfillment?.trackingUrl ?? null,
            canonicalValue: desiredTrackingUrl,
          }),
          recordChange({
            scope: allocation.id,
            field: 'fulfilledAt',
            localValue: toIso(allocation.fulfillment?.fulfilledAt),
            canonicalValue: toIso(desiredFulfilledAt),
          }),
          recordChange({
            scope: allocation.id,
            field: 'shipmentCreatedAt',
            localValue: toIso(allocation.fulfillment?.shipmentCreatedAt),
            canonicalValue: toIso(desiredShipmentCreatedAt),
          }),
          recordChange({
            scope: allocation.id,
            field: 'shipmentUpdatedAt',
            localValue: toIso(allocation.fulfillment?.shipmentUpdatedAt),
            canonicalValue: toIso(desiredShipmentUpdatedAt),
          }),
        ].filter((change): change is ReconciliationFieldChange => Boolean(change));

        allocationResult.staleFields.push(...fieldComparisons);
        staleFields.push(...fieldComparisons);

        if (fieldComparisons.length > 0 && transferRepairBlockerReason) {
          for (const change of fieldComparisons) {
            recordSkippedRepair({
              scope: change.scope,
              field: change.field,
              localValue: change.localValue,
              canonicalValue: change.canonicalValue,
              reason: transferRepairBlockerReason,
              skippedFields,
              allocationResult,
            });
          }
        } else if (fieldComparisons.length > 0) {
          await prisma.$transaction(async (tx) => {
            await tx.vendorAllocation.update({
              where: { id: allocation.id },
              data: {
                fulfillmentStatus: desiredFulfillmentStatus,
                shippingStatus: desiredShippingStatus,
                trackingNumber: desiredTrackingNumber,
                carrier: desiredCarrier,
              },
            });

            await tx.fulfillment.upsert({
              where: { vendorAllocationId: allocation.id },
              update: {
                fulfillmentStatus: desiredFulfillmentStatus,
                trackingNumber: desiredTrackingNumber,
                carrier: desiredCarrier,
                trackingUrl: desiredTrackingUrl,
                fulfilledAt: desiredFulfilledAt,
                shipmentCreatedAt: desiredShipmentCreatedAt,
                shipmentUpdatedAt: desiredShipmentUpdatedAt ?? new Date(),
                syncStatus: desiredSyncStatus,
                errorMessage: null,
              },
              create: {
                vendorAllocationId: allocation.id,
                fulfillmentStatus: desiredFulfillmentStatus,
                trackingNumber: desiredTrackingNumber,
                carrier: desiredCarrier,
                trackingUrl: desiredTrackingUrl,
                notifyCustomer: false,
                fulfilledAt: desiredFulfilledAt,
                shipmentCreatedAt: desiredShipmentCreatedAt,
                shipmentUpdatedAt: desiredShipmentUpdatedAt ?? new Date(),
                syncStatus: desiredSyncStatus,
              },
            });
          });

          allocationResult.repairedFields.push(...fieldComparisons);
          repairedFields.push(...fieldComparisons);
          affectedVendorIds.add(allocation.assignedVendorId);
        }

        await resolveCanonicalFulfillmentMatchMissingSignal(allocation.id);
      }
      for (const refundRecord of allocation.refundRecords) {
        if (refundRecord.status !== 'processed') {
          const change = recordChange({
            scope: refundRecord.id,
            field: 'refund.status',
            localValue: refundRecord.status,
            canonicalValue: 'processed',
          });
          if (change) {
            staleFields.push(change);
            allocationResult.staleFields.push(change);
            if (transferRepairBlockerReason) {
              recordSkippedRepair({
                scope: change.scope,
                field: change.field,
                localValue: change.localValue,
                canonicalValue: change.canonicalValue,
                reason: transferRepairBlockerReason,
                skippedFields,
                allocationResult,
              });
            } else {
              await prisma.refundRecord.update({
                where: { id: refundRecord.id },
                data: { status: 'processed' },
              });
              repairedFields.push(change);
              allocationResult.repairedFields.push(change);
              affectedVendorIds.add(allocation.assignedVendorId);
            }
          }
        }

        let expectedLedgerId: string | null = null;
        let legacyLedgerId: string | null = null;
        let economicOwnerVendorId: string | null = null;
        let activeSaleLedgerId: string | null = null;
        let refundLedgerRepairReason: string | null = transferRepairBlockerReason;
        if (!refundLedgerRepairReason) {
          try {
            const economicOwner = await resolveActiveEconomicOwnerForRepair({
              vendorAllocationId: allocation.id,
              transfers: allocation.economicTransfers,
            });
            economicOwnerVendorId = economicOwner.economicOwnerVendorId;
            activeSaleLedgerId = economicOwner.activeSaleLedgerId;
            expectedLedgerId = buildExpectedRefundLedgerIdForReconciliation({
              vendorId: economicOwnerVendorId,
              sourceShopifyRefundId: refundRecord.sourceShopifyRefundId,
              vendorAllocationId: allocation.id,
            });
            legacyLedgerId = buildLegacyRefundLedgerEntryId({
              vendorId: economicOwnerVendorId,
              sourceShopifyRefundId: refundRecord.sourceShopifyRefundId,
            });
          } catch (error) {
            refundLedgerRepairReason = error instanceof Error ? error.message : 'Refund ledger repair owner resolution failed.';
          }
        }

        const hasActiveLedger = expectedLedgerId
          ? allocation.financeEntries.some((entry) =>
              entry.id === expectedLedgerId &&
              entry.entryType === 'refund' &&
              entry.vendorId === economicOwnerVendorId &&
              !isLedgerVoided(entry)
            )
          : false;
        const legacyActiveLedger = legacyLedgerId
          ? allocation.financeEntries.find((entry) =>
              entry.id === legacyLedgerId &&
              entry.entryType === 'refund' &&
              entry.vendorId === economicOwnerVendorId &&
              !isLedgerVoided(entry)
            )
          : null;
        const conflictingActiveLedger = expectedLedgerId
          ? allocation.financeEntries.find((entry) =>
              entry.entryType === 'refund' &&
              matchesRefundLedgerSource({
                ledgerId: entry.id,
                sourceShopifyRefundId: refundRecord.sourceShopifyRefundId,
              }) &&
              entry.id !== expectedLedgerId &&
              entry.id !== legacyLedgerId &&
              !isLedgerVoided(entry)
            )
          : null;
        if (!hasActiveLedger && legacyActiveLedger) {
          refundLedgerRepairReason =
            `Legacy refund ledger ${legacyActiveLedger.id} already exists for allocation ${allocation.id}; manual migration/backfill is required before allocation-scoped repair.`;
        } else if (conflictingActiveLedger) {
          refundLedgerRepairReason =
            `Active refund ledger ${conflictingActiveLedger.id} already exists for allocation ${allocation.id} under a different economic owner.`;
        }
        const hasLedger = hasActiveLedger;
        if (!hasLedger && refundRecord.amount) {
          if (refundLedgerRepairReason || !expectedLedgerId || !economicOwnerVendorId || !activeSaleLedgerId) {
            recordSkippedRepair({
              scope: refundRecord.id,
              field: 'financeLedgerEntry',
              localValue: null,
              canonicalValue: expectedLedgerId,
              reason: refundLedgerRepairReason ?? 'Refund ledger repair owner resolution failed.',
              skippedFields,
              allocationResult,
            });
            continue;
          }

          const saleLedgerEntry = allocation.financeEntries.find((entry) =>
            entry.id === activeSaleLedgerId &&
            entry.entryType === 'sale' &&
            !isLedgerVoided(entry)
          ) ?? null;
          if (!saleLedgerEntry) {
            recordSkippedRepair({
              scope: refundRecord.id,
              field: 'financeLedgerEntry',
              localValue: null,
              canonicalValue: expectedLedgerId,
              reason: `Active sale ledger ${activeSaleLedgerId} could not be loaded for reconciliation repair.`,
              skippedFields,
              allocationResult,
            });
            continue;
          }
          const refundOffsetEligibility = getUnsettledRefundOffsetEligibility({
            refundRecord,
            relatedSaleLedgerEntry: saleLedgerEntry,
          });
          const postApprovalRefundRisk = classifyPostApprovalRefundRisk({
            refundRecord,
            relatedSaleLedgerEntry: saleLedgerEntry,
          });
          const change = {
            scope: refundRecord.id,
            field: 'financeLedgerEntry',
            localValue: null,
            canonicalValue: expectedLedgerId,
          };
          await prisma.financeLedgerEntry.create({
            data: {
              id: expectedLedgerId,
              vendorAllocationId: allocation.id,
              vendorId: economicOwnerVendorId,
              entryType: 'refund',
              amount: refundRecord.amount,
              payoutStatus: refundOffsetEligibility.eligible ? 'PENDING' : 'HOLD',
              commissionPercentSnapshot: saleLedgerEntry?.commissionPercentSnapshot ?? null,
              commissionVatPercentSnapshot: saleLedgerEntry?.commissionVatPercentSnapshot ?? null,
              settlementStatus: 'PARTIALLY_REFUNDED',
              settlementHoldReason: refundOffsetEligibility.eligible
                ? null
                : postApprovalRefundRisk.reason ?? refundOffsetEligibility.reason,
              description: `Reconciled refund ledger for Shopify refund ${refundRecord.sourceShopifyRefundId}`,
            },
          });
          if (postApprovalRefundRisk.state === 'already_paid_requires_vendor_debt') {
            await createVendorDebtForPaidRefund(prisma, {
              vendorId: economicOwnerVendorId,
              refundRecordId: refundRecord.id,
              sourceShopifyRefundId: refundRecord.sourceShopifyRefundId,
              financeLedgerEntryId: expectedLedgerId,
              refundAmount: refundRecord.amount,
              commissionPercentSnapshot: saleLedgerEntry?.commissionPercentSnapshot,
              commissionVatPercentSnapshot: saleLedgerEntry?.commissionVatPercentSnapshot,
              currency: shopifyOrder.currency ?? 'TRY',
              sourceShopifyOrderId: refundRecord.sourceShopifyOrderId,
              sourceShopifyOrderNumber: refundRecord.sourceShopifyOrderNumber,
              vendorAllocationId: allocation.id,
            });
          }
          staleFields.push(change);
          repairedFields.push(change);
          allocationResult.staleFields.push(change);
          allocationResult.repairedFields.push(change);
          affectedVendorIds.add(economicOwnerVendorId);
        }
      }

      for (const returnRecord of allocation.returnRecords) {
        if (returnRecord.returnLifecycleStatus && returnRecord.status !== returnRecord.returnLifecycleStatus) {
          const change = recordChange({
            scope: returnRecord.id,
            field: 'return.status',
            localValue: returnRecord.status,
            canonicalValue: returnRecord.returnLifecycleStatus,
          });
          if (change) {
            staleFields.push(change);
            allocationResult.staleFields.push(change);
            if (transferRepairBlockerReason) {
              recordSkippedRepair({
                scope: change.scope,
                field: change.field,
                localValue: change.localValue,
                canonicalValue: change.canonicalValue,
                reason: transferRepairBlockerReason,
                skippedFields,
                allocationResult,
              });
            } else {
              await prisma.returnRecord.update({
                where: { id: returnRecord.id },
                data: {
                  status: returnRecord.returnLifecycleStatus,
                  requestUpdatedAt: new Date(),
                },
              });
              repairedFields.push(change);
              allocationResult.repairedFields.push(change);
              affectedVendorIds.add(allocation.assignedVendorId);
            }
          }
        }
      }

      const saleLedgerRepairReadiness = classifySaleLedgerRepairReadiness({
        financeEntries: allocation.financeEntries,
        transfers: allocation.economicTransfers,
      });
      const expectedSaleLedgerId = buildExpectedSaleLedgerIdForReconciliation({
        assignedVendorId: allocation.assignedVendorId,
        sourceShopifyOrderId: shopifyOrder.sourceShopifyOrderId,
        vendorAllocationId: allocation.id,
      });
      if (saleLedgerRepairReadiness.status === 'missing_active_sale_ledger') {
        const change = {
          scope: allocation.id,
          field: 'saleFinanceLedgerEntry',
          localValue: null,
          canonicalValue: expectedSaleLedgerId,
        };
        await prisma.$transaction(async (tx) => {
          await upsertSaleLedgerForAllocation(tx, allocation.id);
        });
        staleFields.push(change);
        repairedFields.push(change);
        allocationResult.staleFields.push(change);
        allocationResult.repairedFields.push(change);
        affectedVendorIds.add(allocation.assignedVendorId);
      } else if (
        saleLedgerRepairReadiness.status !== 'active_sale_ledger_exists'
      ) {
        recordSkippedRepair({
          scope: allocation.id,
          field: 'saleFinanceLedgerEntry',
          localValue: saleLedgerRepairReadiness.voidedSaleLedgerIds.length > 0
            ? saleLedgerRepairReadiness.voidedSaleLedgerIds.join(',')
            : null,
          canonicalValue: expectedSaleLedgerId,
          reason: saleLedgerRepairReadiness.reason,
          skippedFields,
          allocationResult,
        });
      }

      if (
        allocationResult.staleFields.length > 0 ||
        allocationResult.skippedFields.length > 0 ||
        allocationResult.warnings.length > 0
      ) {
        affectedAllocations.push(allocationResult);
      }

      warnings.push(...allocationResult.warnings);
    }

    const requiresManualReview = skippedFields.length > 0 || warnings.length > 0;
    const reconciliationStatus = requiresManualReview
      ? 'needs_attention'
      : repairedFields.length > 0
        ? 'repaired'
        : 'in_sync';

    return {
      reconciliationStatus,
      staleFields,
      repairedFields,
      skippedFields,
      canonicalShopifySummary: {
        source: fulfillmentState.source,
        shopifyOrderId: sourceShopifyOrderId,
        orderName: fulfillmentState.orderName,
        displayFulfillmentStatus: fulfillmentState.displayFulfillmentStatus,
        fulfillmentCount: fulfillmentState.fulfillments.length,
        fulfillmentOrderCount: fulfillmentState.fulfillmentOrders.length,
        fulfilledLineItemIds: Array.from(canonicalMaps.fulfilledLineItemIds),
        cancelledLineItemIds: Array.from(canonicalMaps.cancelledLineItemIds),
      },
      localStateSummary: {
        shopifyOrderId: sourceShopifyOrderId,
        shopifyOrderNumber: shopifyOrder.sourceShopifyOrderNumber,
        allocationCount: allocations.length,
        refundRecordCount: allocations.reduce((sum, allocation) => sum + allocation.refundRecords.length, 0),
        returnRecordCount: allocations.reduce((sum, allocation) => sum + allocation.returnRecords.length, 0),
      },
      affectedAllocations,
      affectedVendorIds: Array.from(affectedVendorIds),
      warnings,
      requiresManualReview,
    };
  }

  async function reconcileAllocation(allocationId: string): Promise<OrderReconciliationResult | null> {
    const allocation = await prisma.vendorAllocation.findUnique({
      where: { id: allocationId },
      include: {
        order: true,
      },
    });

    if (!allocation?.order?.sourceShopifyOrderId) {
      return null;
    }

    return reconcileShopifyOrder(allocation.order.sourceShopifyOrderId, {
      targetAllocationId: allocationId,
    });
  }

  return {
    reconcileAllocation,
    reconcileShopifyOrder,
  };
}

export const __reconciliationTesting = {
  buildExpectedSaleLedgerIdForReconciliation,
  buildExpectedRefundLedgerIdForReconciliation,
  buildCanonicalFulfillmentMatchMissingSignalId,
  CANONICAL_FULFILLMENT_MATCH_MISSING_RULE_KEY,
};
