import { prisma } from '../../db/prisma.js';
import { createShopifyAdminService } from './shopify-admin.service.js';
import type { AppEnv } from '../../config/env.js';
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
      const sourceShopifyOrderId = extractShopifyGidTail(returnDetails.orderGid);
      if (!sourceShopifyOrderId) {
        throw new Error('Shopify return detail did not include a usable order id.');
      }

      const sellerInfoResult = await shopifyAdminService.fetchOrderSellerInfo(sourceShopifyOrderId);
      if (!sellerInfoResult.sellerInfo) {
        throw new Error('Shopify seller_info mapping is missing for return request attribution.');
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

      const vendorIds = new Set((await tx.vendor.findMany({ select: { id: true } })).map((vendor) => vendor.id));

      const mappedItems = returnDetails.lineItems.map((lineItem) => {
        if (!lineItem.sku) {
          throw new Error(`Return line item ${lineItem.returnLineItemGid} is missing SKU.`);
        }

        const vendorSlug = sellerInfoResult.sellerInfo?.[lineItem.sku]?.trim().toLowerCase() ?? null;
        if (!vendorSlug) {
          throw new Error(`seller_info mapping not found for return SKU ${lineItem.sku}.`);
        }

        if (!vendorIds.has(vendorSlug)) {
          throw new Error(`seller_info mapped return SKU ${lineItem.sku} to unknown vendor ${vendorSlug}.`);
        }

        const allocation = shopifyOrder.allocations.find(
          (record) => record.originalVendorId === vendorSlug || record.assignedVendorId === vendorSlug,
        );
        if (!allocation) {
          throw new Error(`No allocation found for return SKU ${lineItem.sku} and vendor ${vendorSlug}.`);
        }

        const sourceLineItemId = lineItem.lineItemGid
          ? extractShopifyGidTail(lineItem.lineItemGid) ?? lineItem.lineItemGid
          : extractShopifyGidTail(lineItem.returnLineItemGid) ?? lineItem.returnLineItemGid;

        return {
          lineItem,
          allocation,
          vendorId: vendorSlug,
          sourceLineItemId,
        };
      });

      let affectedRecordCount = 0;
      const lifecycleStatus = mapLifecycleStatus('returns/request');

      for (const mappedItem of mappedItems) {
        const id = `return-request-${identity.sourceShopifyReturnId}-${mappedItem.vendorId}-${mappedItem.sourceLineItemId}`;

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
            reason: deriveReasonFromPayload(input.payload),
          },
          create: {
            id,
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
            reason: deriveReasonFromPayload(input.payload),
          },
        });

        affectedRecordCount += 1;
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
      };
    });

    return {
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyReturnGid: result.shopifyReturnGid,
      affectedRecordCount: result.affectedRecordCount,
    };
  } catch (error) {
    return failWebhook(
      input.event.id,
      error instanceof Error ? error.message : 'Shopify return request ingestion failed.',
    );
  }
}

export async function applyReturnLifecycleStatusWebhook(
  topic: ReturnLifecycleTopic,
  input: ReturnLifecycleIngestionInput,
): Promise<ReturnLifecycleIngestionResult> {
  const identity = resolveReturnIdentity(input.payload);
  if (!identity) {
    return failWebhook(input.event.id, `Shopify ${topic} payload did not include a return id.`);
  }

  try {
    const lifecycleStatus = mapLifecycleStatus(topic);
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
          reason: deriveReasonFromPayload(input.payload),
        },
      });

      if (updated.count === 0) {
        throw new Error(`No pending return request records found for Shopify return ${identity.sourceShopifyReturnGid}.`);
      }

      await tx.webhookEvent.update({
        where: { id: input.event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          errorMessage: null,
        },
      });

      return updated.count;
    });

    return {
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyReturnGid: identity.sourceShopifyReturnGid,
      affectedRecordCount: updateResult,
    };
  } catch (error) {
    return failWebhook(
      input.event.id,
      error instanceof Error ? error.message : `Shopify ${topic} lifecycle update failed.`,
    );
  }
}

