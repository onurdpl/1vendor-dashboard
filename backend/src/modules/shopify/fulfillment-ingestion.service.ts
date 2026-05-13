import { prisma } from '../../db/prisma.js';
import { createShopifyAdminService } from './shopify-admin.service.js';
import type { AppEnv } from '../../config/env.js';
import type {
  FulfillmentIngestionInput,
  FulfillmentIngestionResult,
} from './fulfillment-ingestion.types.js';
import type { ShopifyOrderFulfillment } from './shopify-admin.types.js';

function toIdString(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return null;
}

function extractShopifyGidTail(gid: string) {
  const tail = gid.split('/').at(-1)?.trim() ?? '';
  return tail || null;
}

function findNestedId(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const directValue = toIdString(record[key]);
    if (directValue) {
      return directValue;
    }
  }

  for (const childValue of Object.values(record)) {
    if (childValue && typeof childValue === 'object') {
      const nestedValue = findNestedId(childValue, keys);
      if (nestedValue) {
        return nestedValue;
      }
    }
  }

  return null;
}

function resolveShopifyOrderId(payload: Record<string, unknown>) {
  const directOrderId = findNestedId(payload, ['order_id']);
  if (directOrderId) {
    return extractShopifyGidTail(directOrderId) ?? directOrderId;
  }

  const orderGid = findNestedId(payload, ['order_admin_graphql_api_id', 'orderGid']);
  if (orderGid?.startsWith('gid://shopify/Order/')) {
    return extractShopifyGidTail(orderGid);
  }

  return null;
}

function resolveFulfillmentEventStatus(payload: Record<string, unknown>) {
  const status = (toIdString(payload.status) ?? toIdString(payload.shipment_status) ?? '').toLowerCase();
  return normalizeFulfillmentEventStatus(status);
}

function normalizeFulfillmentEventStatus(status: string) {
  if (status === 'delivered') {
    return 'delivered';
  }

  if (status === 'in_transit' || status === 'out_for_delivery' || status === 'confirmed') {
    return 'in_transit';
  }

  if (status === 'failure' || status === 'failed' || status === 'attempted_delivery') {
    return 'failure';
  }

  return null;
}

function resolveShopifyFulfillmentId(payload: Record<string, unknown>) {
  const directFulfillmentId = findNestedId(payload, ['fulfillment_id']);
  if (directFulfillmentId) {
    return extractShopifyGidTail(directFulfillmentId) ?? directFulfillmentId;
  }

  const fulfillmentGid = findNestedId(payload, ['fulfillment_admin_graphql_api_id', 'fulfillmentGid']);
  if (fulfillmentGid?.startsWith('gid://shopify/Fulfillment/')) {
    return extractShopifyGidTail(fulfillmentGid);
  }

  return null;
}

function normalizeLineItemId(value: string) {
  return extractShopifyGidTail(value) ?? value;
}

function getTrackingInfo(fulfillment: ShopifyOrderFulfillment) {
  return fulfillment.trackingInfo.find((tracking) => tracking.number || tracking.company || tracking.url) ?? null;
}

function toDate(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function latestDate(values: Array<Date | null>) {
  return values
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
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

function isCancelledStatus(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase() === 'cancelled' || (value ?? '').trim().toLowerCase() === 'canceled';
}

async function failWebhook(eventId: string, errorMessage: string): Promise<FulfillmentIngestionResult> {
  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: {
      status: 'FAILED',
      errorMessage,
    },
  });

  return {
    ok: false,
    action: 'received_needs_attention',
    processingStatus: 'needs_attention',
    error: errorMessage,
  };
}

export async function ingestFulfillmentWebhook(
  env: AppEnv,
  input: FulfillmentIngestionInput,
): Promise<FulfillmentIngestionResult> {
  const sourceShopifyOrderId = resolveShopifyOrderId(input.payload);
  if (!sourceShopifyOrderId) {
    return failWebhook(input.event.id, `Shopify ${input.topic} payload did not include a usable order id.`);
  }

  const shopifyAdminService = createShopifyAdminService(env);

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.webhookEvent.update({
        where: { id: input.event.id },
        data: {
          status: 'PROCESSING',
          errorMessage: null,
        },
      });

      const fulfillmentState = await shopifyAdminService.fetchOrderFulfillmentState(sourceShopifyOrderId);

      const shopifyOrder = await tx.shopifyOrder.findUnique({
        where: { sourceShopifyOrderId },
        include: {
          allocations: {
            include: {
              lineItems: {
                include: {
                  shopifyOrderLineItem: true,
                },
              },
              fulfillment: true,
            },
          },
        },
      });

      if (!shopifyOrder) {
        throw new Error(`No ingested Shopify order found for fulfillment sync order id ${sourceShopifyOrderId}.`);
      }

      const fulfilledLineItemIds = new Set<string>();
      const cancelledLineItemIds = new Set<string>();
      const fulfillmentByLineItemId = new Map<string, ShopifyOrderFulfillment>();

      for (const fulfillment of fulfillmentState.fulfillments) {
        if (fulfillment.lineItems.length === 0) {
          throw new Error(`Shopify fulfillment ${fulfillment.id} did not include fulfillment line items.`);
        }

        for (const lineItem of fulfillment.lineItems) {
          const normalizedId = normalizeLineItemId(lineItem.sourceLineItemId || lineItem.lineItemGid);
          if (!normalizedId) {
            throw new Error(`Shopify fulfillment ${fulfillment.id} has a line item without a usable id.`);
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

      if (fulfilledLineItemIds.size === 0 && cancelledLineItemIds.size === 0) {
        throw new Error(`Shopify order ${sourceShopifyOrderId} has no canonical fulfillment or cancellation line items to sync.`);
      }

      const deliveryEventStatus =
        input.topic === 'fulfillment_events/create' ? resolveFulfillmentEventStatus(input.payload) : null;
      const eventFulfillmentId =
        input.topic === 'fulfillment_events/create' ? resolveShopifyFulfillmentId(input.payload) : null;

      let affectedAllocationCount = 0;

      for (const allocation of shopifyOrder.allocations) {
        const allocationLineItemIds = allocation.lineItems.map((lineItem) =>
          normalizeLineItemId(lineItem.shopifyOrderLineItem.sourceLineItemId),
        );
        const matchedLineItemIds = allocationLineItemIds.filter((lineItemId) => fulfilledLineItemIds.has(lineItemId));
        const cancelledMatchedLineItemIds = allocationLineItemIds.filter((lineItemId) =>
          cancelledLineItemIds.has(lineItemId),
        );

        if (matchedLineItemIds.length === 0 && cancelledMatchedLineItemIds.length === 0) {
          continue;
        }

        if (matchedLineItemIds.length === 0 && cancelledMatchedLineItemIds.length > 0) {
          await tx.vendorAllocation.update({
            where: { id: allocation.id },
            data: {
              fulfillmentStatus: 'pending',
              shippingStatus: 'awaiting_shipment',
              trackingNumber: null,
              carrier: null,
            },
          });

          await tx.fulfillment.upsert({
            where: { vendorAllocationId: allocation.id },
            update: {
              fulfillmentStatus: 'cancelled',
              trackingNumber: null,
              carrier: null,
              trackingUrl: null,
              fulfilledAt: null,
              shipmentCreatedAt: null,
              shipmentUpdatedAt: new Date(),
              syncStatus: 'shopify_inbound_cancelled',
              errorMessage: null,
            },
            create: {
              vendorAllocationId: allocation.id,
              fulfillmentStatus: 'cancelled',
              trackingNumber: null,
              carrier: null,
              trackingUrl: null,
              notifyCustomer: false,
              fulfilledAt: null,
              shipmentCreatedAt: null,
              shipmentUpdatedAt: new Date(),
              syncStatus: 'shopify_inbound_cancelled',
              errorMessage: null,
            },
          });

          affectedAllocationCount += 1;
          continue;
        }

        const allAllocationItemsFulfilled = matchedLineItemIds.length === allocationLineItemIds.length;
        const representativeFulfillment = fulfillmentByLineItemId.get(matchedLineItemIds[0]);
        if (!representativeFulfillment) {
          throw new Error(`Unable to resolve Shopify fulfillment for allocation ${allocation.id}.`);
        }

        const tracking = getTrackingInfo(representativeFulfillment);
        const canonicalEventStatus = getCanonicalEventStatus(representativeFulfillment);
        const eventAppliesToFulfillment =
          Boolean(deliveryEventStatus) &&
          Boolean(eventFulfillmentId) &&
          eventFulfillmentId === representativeFulfillment.sourceFulfillmentId;
        const effectiveDeliveryStatus = eventAppliesToFulfillment ? deliveryEventStatus : canonicalEventStatus;
        const fulfillmentStatus = allAllocationItemsFulfilled ? 'fulfilled' : 'partially_fulfilled';
        const shippingStatus =
          effectiveDeliveryStatus === 'delivered'
            ? 'delivered'
            : effectiveDeliveryStatus === 'in_transit'
              ? 'in_transit'
              : effectiveDeliveryStatus === 'failure'
                ? 'fulfillment_event_attention'
                : allAllocationItemsFulfilled
                  ? 'shipped'
                  : 'partially_shipped';
        const fulfilledAt = toDate(representativeFulfillment.createdAt);
        const latestEvent = getLatestFulfillmentEvent(representativeFulfillment);
        const shipmentCreatedAt = fulfilledAt;
        const shipmentUpdatedAt = latestDate([
          toDate(latestEvent?.happenedAt ?? null),
          toDate(representativeFulfillment.updatedAt),
          fulfilledAt,
        ]);

        await tx.vendorAllocation.update({
          where: { id: allocation.id },
          data: {
            fulfillmentStatus,
            shippingStatus,
            trackingNumber: tracking?.number ?? null,
            carrier: tracking?.company ?? null,
          },
        });

        await tx.fulfillment.upsert({
          where: { vendorAllocationId: allocation.id },
          update: {
            fulfillmentStatus,
            trackingNumber: tracking?.number ?? null,
            carrier: tracking?.company ?? null,
            trackingUrl: tracking?.url ?? null,
            shopifyFulfillmentId: representativeFulfillment.sourceFulfillmentId,
            fulfilledAt,
            shipmentCreatedAt,
            shipmentUpdatedAt,
            syncStatus: 'shopify_inbound_synced',
            errorMessage: null,
          },
          create: {
            vendorAllocationId: allocation.id,
            fulfillmentStatus,
            trackingNumber: tracking?.number ?? null,
            carrier: tracking?.company ?? null,
            trackingUrl: tracking?.url ?? null,
            notifyCustomer: false,
            shopifyFulfillmentId: representativeFulfillment.sourceFulfillmentId,
            fulfilledAt,
            shipmentCreatedAt,
            shipmentUpdatedAt,
            syncStatus: 'shopify_inbound_synced',
            errorMessage: null,
          },
        });

        affectedAllocationCount += 1;
      }

      if (affectedAllocationCount === 0) {
        throw new Error(`Shopify fulfillment state for order ${sourceShopifyOrderId} did not match any allocation line items.`);
      }

      await tx.webhookEvent.update({
        where: { id: input.event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          errorMessage: null,
          shopifyOrderId: shopifyOrder.id,
        },
      });

      return {
        shopifyOrderId: sourceShopifyOrderId,
        affectedAllocationCount,
      };
    });

    return {
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyOrderId: result.shopifyOrderId,
      affectedAllocationCount: result.affectedAllocationCount,
    };
  } catch (error) {
    return failWebhook(
      input.event.id,
      error instanceof Error ? error.message : `Shopify ${input.topic} fulfillment sync failed.`,
    );
  }
}
