import { prisma } from '../../db/prisma.js';
import { createShopifyAdminService } from './shopify-admin.service.js';
import type { AppEnv } from '../../config/env.js';
import {
  autoCreateKargonomiReturnShipmentForApprovedReturn,
  autoCreateNavlungoReturnPickupForApprovedReturn,
} from '../returns/returns.service.js';
import { assertResolvedEconomicOwnerForMoneyMovement } from '../finance/economic-owner-resolution.service.js';
import { resolveAllocationForShopifyOrderLineItem } from '../orders/allocation-ownership-resolution.service.js';
import type {
  ReturnLifecycleIngestionInput,
  ReturnLifecycleIngestionResult,
  ReturnLifecycleTopic,
} from './return-lifecycle-ingestion.types.js';

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

function resolveReturnIdentity(payload: Record<string, unknown>) {
  const gidRaw = toIdString(payload.admin_graphql_api_id);
  if (gidRaw && gidRaw.startsWith('gid://shopify/Return/')) {
    const idTail = extractShopifyGidTail(gidRaw);
    if (idTail) {
      return {
        sourceShopifyReturnId: idTail,
        sourceShopifyReturnGid: gidRaw,
      };
    }
  }

  const numericId = toIdString(payload.id);
  if (numericId) {
    return {
      sourceShopifyReturnId: numericId,
      sourceShopifyReturnGid: `gid://shopify/Return/${numericId}`,
    };
  }

  return null;
}

function mapLifecycleStatus(topic: ReturnLifecycleTopic) {
  switch (topic) {
    case 'returns/request':
      return 'requested';
    case 'returns/approve':
      return 'approved';
    case 'returns/decline':
      return 'declined';
    case 'returns/close':
      return 'closed';
    case 'returns/cancel':
      return 'cancelled';
    default:
      return 'requested';
  }
}

function deriveReasonFromPayload(payload: Record<string, unknown>) {
  const status = toIdString(payload.status);
  if (status) {
    return `Shopify return lifecycle status: ${status}`;
  }

  return 'Shopify return lifecycle event';
}

function readReturnReason(value: string | null | undefined) {
  const text = value?.trim();
  if (!text || text.toLowerCase() === 'unknown') {
    return null;
  }

  return text;
}

function resolveReturnReasonNote(lineItem: { returnReasonNote: string | null; customerNote: string | null }) {
  return readReturnReason(lineItem.customerNote) ?? readReturnReason(lineItem.returnReasonNote);
}

function toReturnTrackingUpdate(returnDetails: {
  returnTracking: {
    carrierName: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
  } | null;
}) {
  return {
    returnCarrierName: returnDetails.returnTracking?.carrierName ?? null,
    returnTrackingNumber: returnDetails.returnTracking?.trackingNumber ?? null,
    returnTrackingUrl: returnDetails.returnTracking?.trackingUrl ?? null,
  };
}

async function failWebhook(eventId: string, errorMessage: string): Promise<ReturnLifecycleIngestionResult> {
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

async function autoCreateReturnPickupsForApprovedRecords(env: AppEnv, returnRecordIds: string[]) {
  let attempted = 0;
  let skipped = 0;

  for (const returnRecordId of returnRecordIds) {
    const kargonomiResult = await autoCreateKargonomiReturnShipmentForApprovedReturn(returnRecordId, env);
    const result =
      kargonomiResult.skippedReason === 'provider_not_kargonomi'
        ? await autoCreateNavlungoReturnPickupForApprovedReturn(returnRecordId, env)
        : kargonomiResult;
    if (result.attempted) {
      attempted += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    attempted,
    skipped,
  };
}

export async function ingestReturnRequestWebhook(
  env: AppEnv,
  input: ReturnLifecycleIngestionInput,
): Promise<ReturnLifecycleIngestionResult> {
  const identity = resolveReturnIdentity(input.payload);
  if (!identity) {
    return failWebhook(input.event.id, 'Shopify returns/request payload did not include a return id.');
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

      const returnDetails = await shopifyAdminService.fetchReturnDetails(identity.sourceShopifyReturnGid);
      const returnTrackingUpdate = toReturnTrackingUpdate(returnDetails);
      const sourceShopifyOrderId = extractShopifyGidTail(returnDetails.orderGid);
      if (!sourceShopifyOrderId) {
        throw new Error('Shopify return detail did not include a usable order id.');
      }

      const shopifyOrder = await tx.shopifyOrder.findUnique({
        where: {
          sourceShopifyOrderId,
        },
        include: {
          allocations: true,
          lineItems: true,
        },
      });
      if (!shopifyOrder) {
        throw new Error(`No ingested Shopify order found for return request order id ${sourceShopifyOrderId}.`);
      }

      const mappedItems = [];
      for (const lineItem of returnDetails.lineItems) {
        if (!lineItem.sku) {
          throw new Error(`Return line item ${lineItem.returnLineItemGid} is missing SKU.`);
        }

        const sourceLineItemId = lineItem.lineItemGid
          ? extractShopifyGidTail(lineItem.lineItemGid) ?? lineItem.lineItemGid
          : extractShopifyGidTail(lineItem.returnLineItemGid) ?? lineItem.returnLineItemGid;
        const matchingOrderLineItems = shopifyOrder.lineItems.filter((orderLineItem) => orderLineItem.sku === lineItem.sku);
        const matchedOrderLineItem = sourceLineItemId
          ? matchingOrderLineItems.find((orderLineItem) => orderLineItem.sourceLineItemId === sourceLineItemId)
          : matchingOrderLineItems.length === 1
            ? matchingOrderLineItems[0]
            : null;

        if (!matchedOrderLineItem) {
          if (matchingOrderLineItems.length > 1) {
            throw new Error(`Return SKU ${lineItem.sku} matched multiple original order line items and could not be resolved safely.`);
          }

          throw new Error(`No original order mapping found for return SKU ${lineItem.sku}.`);
        }

        const ownership = await resolveAllocationForShopifyOrderLineItem({
          shopifyOrderId: shopifyOrder.id,
          shopifyOrderLineItemId: matchedOrderLineItem.id,
          sourceLineItemId: matchedOrderLineItem.sourceLineItemId ?? sourceLineItemId,
        }, tx);

        mappedItems.push({
          lineItem,
          allocation: ownership.allocation,
          vendorId: ownership.allocation.originalVendorId,
          sourceLineItemId,
        });
      }

      let affectedRecordCount = 0;
      const affectedReturnRecordIds: string[] = [];
      const lifecycleStatus = mapLifecycleStatus('returns/request');

      for (const mappedItem of mappedItems) {
        const id = `return-request-${identity.sourceShopifyReturnId}-${mappedItem.vendorId}-${mappedItem.sourceLineItemId}`;
        const ownerResolution = await assertResolvedEconomicOwnerForMoneyMovement({
          vendorAllocationId: mappedItem.allocation.id,
          db: tx,
        });

        await tx.returnRecord.upsert({
          where: {
            id,
          },
          update: {
            vendorAllocationId: mappedItem.allocation.id,
            sourceShopifyOrderId,
            sourceShopifyOrderNumber: mappedItem.allocation.sourceShopifyOrderNumber,
            sourceShopifyRefundId: null,
            sourceShopifyReturnId: identity.sourceShopifyReturnId,
            sourceShopifyReturnGid: identity.sourceShopifyReturnGid,
            sourceShopifyLineItemId: mappedItem.sourceLineItemId,
            returnLifecycleStatus: lifecycleStatus,
            returnRequestSource: 'shopify_return_request',
            requestCreatedAt: new Date(),
            requestUpdatedAt: new Date(),
            status: lifecycleStatus,
            reason: readReturnReason(mappedItem.lineItem.returnReason) ?? deriveReasonFromPayload(input.payload),
            returnReasonNote: resolveReturnReasonNote(mappedItem.lineItem),
            ...returnTrackingUpdate,
          },
          create: {
            id,
            vendorAllocationId: mappedItem.allocation.id,
            ownerVendorId: ownerResolution.economicOwnerVendorId,
            sourceShopifyOrderId,
            sourceShopifyOrderNumber: mappedItem.allocation.sourceShopifyOrderNumber,
            sourceShopifyRefundId: null,
            sourceShopifyReturnId: identity.sourceShopifyReturnId,
            sourceShopifyReturnGid: identity.sourceShopifyReturnGid,
            sourceShopifyLineItemId: mappedItem.sourceLineItemId,
            returnLifecycleStatus: lifecycleStatus,
            returnRequestSource: 'shopify_return_request',
            requestCreatedAt: new Date(),
            requestUpdatedAt: new Date(),
            status: lifecycleStatus,
            reason: readReturnReason(mappedItem.lineItem.returnReason) ?? deriveReasonFromPayload(input.payload),
            returnReasonNote: resolveReturnReasonNote(mappedItem.lineItem),
            ...returnTrackingUpdate,
          },
        });

        affectedRecordCount += 1;
        affectedReturnRecordIds.push(id);
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
        shopifyReturnGid: identity.sourceShopifyReturnGid,
        affectedRecordCount,
        affectedReturnRecordIds,
      };
    });

    const autoCreateResult = await autoCreateReturnPickupsForApprovedRecords(env, result.affectedReturnRecordIds);

    return {
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyReturnGid: result.shopifyReturnGid,
      affectedRecordCount: result.affectedRecordCount,
      navlungoReturnAutoCreateAttemptedCount: autoCreateResult.attempted,
      navlungoReturnAutoCreateSkippedCount: autoCreateResult.skipped,
    };
  } catch (error) {
    return failWebhook(
      input.event.id,
      error instanceof Error ? error.message : 'Shopify return request ingestion failed.',
    );
  }
}

export async function applyReturnLifecycleStatusWebhook(
  env: AppEnv,
  topic: ReturnLifecycleTopic,
  input: ReturnLifecycleIngestionInput,
): Promise<ReturnLifecycleIngestionResult> {
  const identity = resolveReturnIdentity(input.payload);
  if (!identity) {
    return failWebhook(input.event.id, `Shopify ${topic} payload did not include a return id.`);
  }

  try {
    const lifecycleStatus = mapLifecycleStatus(topic);
    const shopifyAdminService = createShopifyAdminService(env);
    const returnTrackingUpdate = await shopifyAdminService
      .fetchReturnDetails(identity.sourceShopifyReturnGid)
      .then(toReturnTrackingUpdate)
      .catch(() => ({}));
    const updateResult = await prisma.$transaction(async (tx) => {
      await tx.webhookEvent.update({
        where: { id: input.event.id },
        data: {
          status: 'PROCESSING',
          errorMessage: null,
        },
      });

      const updated = await tx.returnRecord.updateMany({
        where: {
          OR: [
            { sourceShopifyReturnGid: identity.sourceShopifyReturnGid },
            { sourceShopifyReturnId: identity.sourceShopifyReturnId },
          ],
        },
        data: {
          returnLifecycleStatus: lifecycleStatus,
          requestUpdatedAt: new Date(),
          status: lifecycleStatus,
          ...returnTrackingUpdate,
        },
      });

      if (updated.count === 0) {
        throw new Error(`No pending return request records found for Shopify return ${identity.sourceShopifyReturnGid}.`);
      }

      const updatedRecords = await tx.returnRecord.findMany({
        where: {
          OR: [
            { sourceShopifyReturnGid: identity.sourceShopifyReturnGid },
            { sourceShopifyReturnId: identity.sourceShopifyReturnId },
          ],
        },
        select: {
          id: true,
        },
      });

      await tx.webhookEvent.update({
        where: { id: input.event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          errorMessage: null,
        },
      });

      return {
        count: updated.count,
        returnRecordIds: updatedRecords.map((record) => record.id),
      };
    });

    const autoCreateResult = lifecycleStatus === 'approved'
      ? await autoCreateReturnPickupsForApprovedRecords(env, updateResult.returnRecordIds)
      : { attempted: 0, skipped: updateResult.returnRecordIds.length };

    return {
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyReturnGid: identity.sourceShopifyReturnGid,
      affectedRecordCount: updateResult.count,
      navlungoReturnAutoCreateAttemptedCount: autoCreateResult.attempted,
      navlungoReturnAutoCreateSkippedCount: autoCreateResult.skipped,
    };
  } catch (error) {
    return failWebhook(
      input.event.id,
      error instanceof Error ? error.message : `Shopify ${topic} lifecycle update failed.`,
    );
  }
}
