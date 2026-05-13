import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import type { ShopifyOrderFulfillment, ShopifyOrderFulfillmentState } from '../shopify/shopify-admin.types.js';
import type {
  OrderReconciliationResult,
  ReconciliationAllocationResult,
  ReconciliationFieldChange,
} from './reconciliation.types.js';

function extractShopifyGidTail(gid: string) {
  const tail = gid.split('/').at(-1)?.trim() ?? '';
  return tail || null;
}

function normalizeLineItemId(value: string) {
  return extractShopifyGidTail(value) ?? value;
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
            financeEntries: true,
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

      if (
        allocation.fulfillmentStatus.toLowerCase().includes('fulfilled') &&
        matchedFulfilledIds.length === 0 &&
        matchedCancelledIds.length === 0
      ) {
        allocationResult.warnings.push('Local allocation is fulfilled, but canonical Shopify state has no active fulfillment line items.');
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

      if (fieldComparisons.length > 0) {
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

      for (const refundRecord of allocation.refundRecords) {
        if (refundRecord.status !== 'processed') {
          const change = recordChange({
            scope: refundRecord.id,
            field: 'refund.status',
            localValue: refundRecord.status,
            canonicalValue: 'processed',
          });
          if (change) {
            await prisma.refundRecord.update({
              where: { id: refundRecord.id },
              data: { status: 'processed' },
            });
            staleFields.push(change);
            repairedFields.push(change);
            allocationResult.staleFields.push(change);
            allocationResult.repairedFields.push(change);
            affectedVendorIds.add(allocation.assignedVendorId);
          }
        }

        const expectedLedgerId = `fin-${allocation.assignedVendorId}-refund-${refundRecord.sourceShopifyRefundId}`;
        const hasLedger = allocation.financeEntries.some((entry) => entry.id === expectedLedgerId);
        if (!hasLedger && refundRecord.amount) {
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
              vendorId: allocation.assignedVendorId,
              entryType: 'refund',
              amount: refundRecord.amount,
              payoutStatus: 'HOLD',
              description: `Reconciled refund ledger for Shopify refund ${refundRecord.sourceShopifyRefundId}`,
            },
          });
          staleFields.push(change);
          repairedFields.push(change);
          allocationResult.staleFields.push(change);
          allocationResult.repairedFields.push(change);
          affectedVendorIds.add(allocation.assignedVendorId);
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
            await prisma.returnRecord.update({
              where: { id: returnRecord.id },
              data: {
                status: returnRecord.returnLifecycleStatus,
                requestUpdatedAt: new Date(),
              },
            });
            staleFields.push(change);
            repairedFields.push(change);
            allocationResult.staleFields.push(change);
            allocationResult.repairedFields.push(change);
            affectedVendorIds.add(allocation.assignedVendorId);
          }
        }
      }

      if (allocationResult.staleFields.length > 0 || allocationResult.warnings.length > 0) {
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
