import { prisma } from '../../db/prisma.js';
import type { AuthUserContext } from '../auth/auth.types.js';
import type { RequestVendorContext } from '../vendor-access/vendor-access.types.js';
import type { UpdateAllocationTrackingBody, UpdateAllocationTrackingResult } from './fulfillment.types.js';
import type { AppEnv } from '../../config/env.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';

function normalizeOptionalString(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
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

    if (allocation.cancellationReason || allocation.allocationStatus !== 'ACTIVE') {
      return {
        ok: false,
        code: 409,
        message: 'Allocation is not eligible for fulfillment tracking updates.',
      };
    }

    const fulfillmentOrdersResponse = await shopifyAdminService.fetchFulfillmentOrders(
      allocation.order.sourceShopifyOrderId,
    );

    const allocationLineItemIds = new Set(
      allocation.lineItems.map((lineItem) => lineItem.shopifyOrderLineItem.sourceLineItemId),
    );

    const matchedFulfillmentOrders = fulfillmentOrdersResponse.fulfillmentOrders
      .map((fulfillmentOrder) => ({
        fulfillmentOrderId: fulfillmentOrder.id,
        fulfillmentOrderLineItems: fulfillmentOrder.lineItems
          .filter((lineItem) => allocationLineItemIds.has(lineItem.lineItemId))
          .map((lineItem) => ({
            id: lineItem.id,
            quantity: lineItem.quantity,
          })),
      }))
      .filter((entry) => entry.fulfillmentOrderLineItems.length > 0);

    if (matchedFulfillmentOrders.length === 0) {
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
          syncStatus: 'fulfillment_sync_failed',
          errorMessage: 'No matching Shopify fulfillment order line items were found for this allocation.',
        },
        create: {
          vendorAllocationId: allocation.id,
          fulfillmentStatus: 'fulfillment_sync_failed',
          trackingNumber,
          carrier,
          trackingUrl,
          notifyCustomer,
          syncStatus: 'fulfillment_sync_failed',
          errorMessage: 'No matching Shopify fulfillment order line items were found for this allocation.',
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
        message: 'No matching Shopify fulfillment order line items were found for this allocation.',
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

      const primaryFulfillmentOrderId = matchedFulfillmentOrders[0]?.fulfillmentOrderId ?? null;

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
