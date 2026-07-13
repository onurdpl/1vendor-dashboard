import { prisma } from '../../db/prisma.js';
import type { AuthUserContext } from '../auth/auth.types.js';
import type { RequestVendorContext } from '../vendor-access/vendor-access.types.js';
import type { UpdateAllocationTrackingBody, UpdateAllocationTrackingResult } from './fulfillment.types.js';
import type { AppEnv } from '../../config/env.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import {
  FULL_ORDER_CANCELLATION_BLOCKED_MESSAGE,
  isFullOrderCancelled,
} from '../orders/full-order-cancellation-policy.js';

function normalizeOptionalString(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeShopifyIdentifier(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const gidTail = raw.startsWith('gid://shopify/') ? raw.split('/').at(-1)?.trim() : null;
  return gidTail || raw;
}

function sameShopifyIdentifier(left: string | number | null | undefined, right: string | number | null | undefined) {
  const normalizedLeft = normalizeShopifyIdentifier(left);
  const normalizedRight = normalizeShopifyIdentifier(right);

  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function isOpenFulfillmentOrderStatus(status: string | null | undefined) {
  return (status ?? '').trim().toLowerCase() === 'open';
}

export function createFulfillmentService(env: AppEnv) {
  const shopifyAdminService = createShopifyAdminService(env);

  async function updateAllocationTracking(input: {
    allocationId: string;
    body: UpdateAllocationTrackingBody;
    authUser: AuthUserContext;
    vendorContext: RequestVendorContext;
  }): Promise<UpdateAllocationTrackingResult> {
    const trackingNumber = normalizeOptionalString(input.body.trackingNumber);
    const carrier = normalizeOptionalString(input.body.carrier);
    const trackingUrl = normalizeOptionalString(input.body.trackingUrl ?? null);
    const notifyCustomer = input.body.notifyCustomer ?? true;

    if (!trackingNumber) {
      return {
        ok: false,
        code: 400,
        message: 'Tracking number is required.',
      };
    }

    if (!carrier) {
      return {
        ok: false,
        code: 400,
        message: 'Carrier is required.',
      };
    }

    const allocation = await prisma.vendorAllocation.findUnique({
      where: {
        id: input.allocationId,
      },
      include: {
        order: true,
        lineItems: {
          include: {
            shopifyOrderLineItem: true,
          },
        },
        fulfillment: true,
      },
    });

    if (!allocation) {
      return {
        ok: false,
        code: 404,
        message: 'Allocation not found.',
      };
    }

    if (allocation.assignedVendorId !== input.vendorContext.vendorId) {
      return {
        ok: false,
        code: 403,
        message: 'Requested allocation is not allowed for the current vendor context.',
      };
    }

    if (!allocation.order?.sourceShopifyOrderId) {
      return {
        ok: false,
        code: 400,
        message: 'Allocation is missing Shopify order linkage.',
      };
    }

    if (isFullOrderCancelled(allocation.order)) {
      return {
        ok: false,
        code: 409,
        message: FULL_ORDER_CANCELLATION_BLOCKED_MESSAGE,
      };
    }

    if (allocation.cancellationReason || allocation.allocationStatus !== 'ACTIVE') {
      return {
        ok: false,
        code: 409,
        message: 'Allocation is not eligible for fulfillment tracking updates.',
      };
    }

    if (allocation.fulfillment?.shopifyFulfillmentId) {
      const existingTrackingMatches = allocation.fulfillment.trackingNumber === trackingNumber;
      const existingCarrierMatches = allocation.fulfillment.carrier === carrier;
      const existingTrackingUrlMatches = (allocation.fulfillment.trackingUrl ?? null) === (trackingUrl ?? null);

      if (existingTrackingMatches && existingCarrierMatches && existingTrackingUrlMatches) {
        const fulfilledAt = allocation.fulfillment.fulfilledAt ?? new Date();
        const shipmentCreatedAt = allocation.fulfillment.shipmentCreatedAt ?? fulfilledAt;
        const shipmentUpdatedAt = allocation.fulfillment.shipmentUpdatedAt ?? fulfilledAt;

        return {
          ok: true,
          allocationId: allocation.id,
          trackingNumber,
          carrier,
          trackingUrl,
          notifyCustomer,
          fulfillmentStatus: allocation.fulfillment.fulfillmentStatus,
          shippingStatus: allocation.shippingStatus,
          shopifySyncSource: 'shopify_admin',
          shopifyFulfillmentId: allocation.fulfillment.shopifyFulfillmentId,
          shopifyFulfillmentOrderId: allocation.fulfillment.shopifyFulfillmentOrderId,
          shopifyFulfillmentCreated: false,
          shopifyFulfillmentSkippedReason: 'already_synced',
          shopifyFulfillmentOrderIdPresent: Boolean(allocation.fulfillment.shopifyFulfillmentOrderId),
          shopifyFulfillmentIdPresent: true,
          shopifyFulfillmentOrderLookupAttempted: false,
          shopifyFulfillmentOrderLookupSuccess: Boolean(allocation.fulfillment.shopifyFulfillmentOrderId),
          shopifyFulfillmentOrderCount: allocation.fulfillment.shopifyFulfillmentOrderId ? 1 : 0,
          shopifySelectedFulfillmentOrderIdPresent: Boolean(allocation.fulfillment.shopifyFulfillmentOrderId),
          fulfilledAt: fulfilledAt.toISOString(),
          shipmentCreatedAt: shipmentCreatedAt.toISOString(),
          shipmentUpdatedAt: shipmentUpdatedAt.toISOString(),
        };
      }

      return {
        ok: false,
        code: 409,
        message: 'Shopify fulfillment already exists for this allocation; tracking sync was not duplicated.',
      };
    }

    const fulfillmentOrdersResponse = await shopifyAdminService.fetchFulfillmentOrders(
      allocation.order.sourceShopifyOrderId,
    );

    const allocationLineItemIds = allocation.lineItems
      .map((lineItem) => lineItem.shopifyOrderLineItem.sourceLineItemId)
      .filter((lineItemId): lineItemId is string => Boolean(lineItemId));

    const fulfillmentOrderCount = fulfillmentOrdersResponse.fulfillmentOrders.length;
    const matchedFulfillmentOrders = fulfillmentOrdersResponse.fulfillmentOrders
      .filter((fulfillmentOrder) => isOpenFulfillmentOrderStatus(fulfillmentOrder.status))
      .map((fulfillmentOrder) => ({
        fulfillmentOrderId: fulfillmentOrder.id,
        fulfillmentOrderLineItems: fulfillmentOrder.lineItems
          .filter((lineItem) =>
            allocationLineItemIds.some((allocationLineItemId) =>
              sameShopifyIdentifier(allocationLineItemId, lineItem.lineItemId),
            ),
          )
          .map((lineItem) => ({
            id: lineItem.id,
            quantity: lineItem.quantity,
          })),
      }))
      .filter((entry) => entry.fulfillmentOrderLineItems.length > 0);
    const primaryFulfillmentOrderId = matchedFulfillmentOrders[0]?.fulfillmentOrderId ?? null;

    if (matchedFulfillmentOrders.length === 0) {
      const missingFulfillmentOrderMessage = 'Shopify fulfillment order data is missing; cannot sync tracking automatically.';
      await prisma.fulfillment.upsert({
        where: {
          vendorAllocationId: allocation.id,
        },
        update: {
          fulfillmentStatus: 'fulfillment_sync_failed',
          trackingNumber,
          carrier,
          trackingUrl,
          notifyCustomer,
          shopifyFulfillmentOrderId: null,
          syncStatus: 'fulfillment_sync_failed',
          errorMessage: missingFulfillmentOrderMessage,
        },
        create: {
          vendorAllocationId: allocation.id,
          fulfillmentStatus: 'fulfillment_sync_failed',
          trackingNumber,
          carrier,
          trackingUrl,
          notifyCustomer,
          shopifyFulfillmentOrderId: null,
          syncStatus: 'fulfillment_sync_failed',
          errorMessage: missingFulfillmentOrderMessage,
        },
      });

      await prisma.vendorAllocation.update({
        where: { id: allocation.id },
        data: {
          fulfillmentStatus: 'fulfillment_sync_failed',
          shippingStatus: 'awaiting_shipment',
          trackingNumber,
          carrier,
        },
      });

      return {
        ok: false,
        code: 502,
        message: missingFulfillmentOrderMessage,
      };
    }

    try {
      const fulfillmentResult = await shopifyAdminService.createFulfillmentTracking({
        allocationId: allocation.id,
        shopifyOrderId: allocation.order.sourceShopifyOrderId,
        trackingNumber,
        carrier,
        trackingUrl,
        notifyCustomer,
        lineItemsByFulfillmentOrder: matchedFulfillmentOrders,
      });

      if (!normalizeOptionalString(fulfillmentResult.fulfillmentId)) {
        throw new Error('Shopify fulfillment creation response did not include a fulfillment id.');
      }

      const submittedAt = new Date();

      await prisma.$transaction(async (tx) => {
        await tx.fulfillment.upsert({
          where: {
            vendorAllocationId: allocation.id,
          },
          update: {
            fulfillmentStatus: 'fulfillment_submitted',
            trackingNumber,
            carrier,
            trackingUrl,
            notifyCustomer,
            shopifyFulfillmentId: fulfillmentResult.fulfillmentId,
            shopifyFulfillmentOrderId: primaryFulfillmentOrderId,
            fulfilledAt: submittedAt,
            shipmentCreatedAt: submittedAt,
            shipmentUpdatedAt: submittedAt,
            syncStatus: fulfillmentResult.status,
            errorMessage: null,
          },
          create: {
            vendorAllocationId: allocation.id,
            fulfillmentStatus: 'fulfillment_submitted',
            trackingNumber,
            carrier,
            trackingUrl,
            notifyCustomer,
            shopifyFulfillmentId: fulfillmentResult.fulfillmentId,
            shopifyFulfillmentOrderId: primaryFulfillmentOrderId,
            fulfilledAt: submittedAt,
            shipmentCreatedAt: submittedAt,
            shipmentUpdatedAt: submittedAt,
            syncStatus: fulfillmentResult.status,
          },
        });

        await tx.vendorAllocation.update({
          where: { id: allocation.id },
          data: {
            fulfillmentStatus: 'fulfillment_submitted',
            shippingStatus: 'shipped',
            trackingNumber,
            carrier,
          },
        });
      });

      return {
        ok: true,
        allocationId: allocation.id,
        trackingNumber,
        carrier,
        trackingUrl,
        notifyCustomer,
        fulfillmentStatus: 'fulfillment_submitted',
        shippingStatus: 'shipped',
        shopifySyncSource: fulfillmentResult.source,
        shopifyFulfillmentId: fulfillmentResult.fulfillmentId,
        shopifyFulfillmentOrderId: primaryFulfillmentOrderId,
        shopifyFulfillmentCreated: fulfillmentResult.fulfillmentCreated,
        shopifyFulfillmentSkippedReason: fulfillmentResult.skippedReason,
        shopifyFulfillmentOrderIdPresent: fulfillmentResult.fulfillmentOrderIdPresent,
        shopifyFulfillmentIdPresent: fulfillmentResult.fulfillmentIdPresent,
        shopifyFulfillmentOrderLookupAttempted: true,
        shopifyFulfillmentOrderLookupSuccess: true,
        shopifyFulfillmentOrderCount: fulfillmentOrderCount,
        shopifySelectedFulfillmentOrderIdPresent: Boolean(primaryFulfillmentOrderId),
        fulfilledAt: submittedAt.toISOString(),
        shipmentCreatedAt: submittedAt.toISOString(),
        shipmentUpdatedAt: submittedAt.toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Shopify fulfillment sync failed.';

      await prisma.$transaction(async (tx) => {
        await tx.fulfillment.upsert({
          where: {
            vendorAllocationId: allocation.id,
          },
          update: {
            fulfillmentStatus: 'fulfillment_sync_failed',
            trackingNumber,
            carrier,
            trackingUrl,
            notifyCustomer,
            shopifyFulfillmentOrderId: primaryFulfillmentOrderId,
            syncStatus: 'fulfillment_sync_failed',
            errorMessage: message,
          },
          create: {
            vendorAllocationId: allocation.id,
            fulfillmentStatus: 'fulfillment_sync_failed',
            trackingNumber,
            carrier,
            trackingUrl,
            notifyCustomer,
            shopifyFulfillmentOrderId: primaryFulfillmentOrderId,
            syncStatus: 'fulfillment_sync_failed',
            errorMessage: message,
          },
        });

        await tx.vendorAllocation.update({
          where: { id: allocation.id },
          data: {
            fulfillmentStatus: 'fulfillment_sync_failed',
            shippingStatus: 'awaiting_shipment',
            trackingNumber,
            carrier,
          },
        });
      });

      return {
        ok: false,
        code: 502,
        message,
      };
    }
  }

  return {
    updateAllocationTracking,
  };
}
