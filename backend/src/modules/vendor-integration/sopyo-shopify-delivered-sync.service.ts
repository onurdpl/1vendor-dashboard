import { Prisma, SopyoDeliveredSyncStatus, SopyoOrderPushStatus,
  SopyoShipmentIntentStatus, VendorIntegrationProviderCode, VendorOutboundMethod } from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import { canonicalSopyoOrderId } from '../shipping/allocation-delivered-observation.service.js';

type ShopifyPort = Pick<ReturnType<typeof createShopifyAdminService>,
  'readSopyoFulfillmentDelivered' | 'createSopyoDeliveredEvent'>;

const fulfillmentGid = /^gid:\/\/shopify\/Fulfillment\/\d+$/;
const orderGid = /^gid:\/\/shopify\/Order\/\d+$/;

function eligible(intent: Awaited<ReturnType<typeof loadIntent>>): intent is NonNullable<typeof intent> {
  if (!intent || intent.status !== SopyoShipmentIntentStatus.CONFIRMED ||
      !intent.shopifyFulfillmentId || !fulfillmentGid.test(intent.shopifyFulfillmentId)) return false;
  const allocation = intent.vendorAllocation;
  const push = intent.sopyoOrderPush;
  const observation = allocation.deliveredObservation;
  return allocation.id === intent.vendorAllocationId &&
    allocation.assignedVendorId === intent.assignedVendorId &&
    allocation.shippingStatus.trim().toLowerCase() === 'delivered' &&
    allocation.outboundMethodSnapshot === VendorOutboundMethod.VENDOR_INTEGRATION &&
    allocation.outboundIntegrationProviderSnapshot === VendorIntegrationProviderCode.SOPYO &&
    push.id === intent.sopyoOrderPushId && push.vendorAllocationId === allocation.id &&
    push.assignedVendorId === allocation.assignedVendorId &&
    push.status === SopyoOrderPushStatus.SUCCEEDED &&
    push.orderCode === allocation.id && intent.orderCode === allocation.id &&
    Boolean(canonicalSopyoOrderId(push.sopyoOrderId)) &&
    push.sopyoOrderId === intent.sopyoOrderId &&
    observation?.vendorAllocationId === allocation.id &&
    observation.outboundMethod === VendorOutboundMethod.VENDOR_INTEGRATION &&
    observation.outboundIntegrationProvider === VendorIntegrationProviderCode.SOPYO &&
    observation.sourceReference === push.sopyoOrderId &&
    (observation.sopyoOrderPushId === null || observation.sopyoOrderPushId === push.id) &&
    /^\d+$/.test(allocation.order.sourceShopifyOrderId);
}

function expectedOrderGid(intent: NonNullable<Awaited<ReturnType<typeof loadIntent>>>) {
  const value = `gid://shopify/Order/${intent.vendorAllocation.order.sourceShopifyOrderId}`;
  if (!orderGid.test(value)) throw new Error('Sopyo Shopify order identity is invalid.');
  return value;
}

async function loadIntent(db: Pick<typeof prisma, 'sopyoShipmentIntent'>, id: string) {
  return db.sopyoShipmentIntent.findUnique({ where: { id }, include: {
    sopyoOrderPush: true,
    vendorAllocation: { include: { order: true, deliveredObservation: true } },
  } });
}

export type SopyoDeliveredSyncResult = 'skipped' | 'confirmed' | 'rejected' | 'outcome_unknown';

/** One claimed Shopify Delivered attempt; submitted/unknown states only reconcile by read. */
export async function processSopyoShopifyDeliveredSync(input: {
  intentId: string; env: AppEnv; shopifyAdminService?: ShopifyPort;
}, db: typeof prisma = prisma): Promise<SopyoDeliveredSyncResult> {
  if (input.env.SHOPIFY_API_VERSION !== '2026-01' || !input.env.SHOPIFY_SHOP_DOMAIN ||
      !input.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return 'skipped';
  const read = input.shopifyAdminService ?? createShopifyAdminService(input.env);
  const initial = await loadIntent(db, input.intentId);
  if (!eligible(initial) || initial.deliveredSyncStatus === SopyoDeliveredSyncStatus.CONFIRMED ||
      initial.deliveredSyncStatus === SopyoDeliveredSyncStatus.REJECTED) return 'skipped';
  const exactFulfillmentId = initial.shopifyFulfillmentId!;
  const expectedOrder = expectedOrderGid(initial);

  // A failed or incomplete exact read cannot authorize an external write.
  const before = await read.readSopyoFulfillmentDelivered({
    fulfillmentId: exactFulfillmentId, orderGid: expectedOrder,
  });
  if (before.delivered) {
    const confirmed = await db.sopyoShipmentIntent.updateMany({
      where: { id: input.intentId, status: SopyoShipmentIntentStatus.CONFIRMED,
        shopifyFulfillmentId: exactFulfillmentId,
        deliveredSyncStatus: initial.deliveredSyncStatus },
      data: { deliveredSyncStatus: SopyoDeliveredSyncStatus.CONFIRMED,
        deliveredConfirmedAt: new Date() },
    });
    return confirmed.count === 1 ? 'confirmed' : 'skipped';
  }
  if (initial.deliveredSyncStatus !== null) {
    if (initial.deliveredSyncStatus === SopyoDeliveredSyncStatus.SUBMISSION_PENDING) {
      await db.sopyoShipmentIntent.updateMany({
        where: { id: input.intentId, deliveredSyncStatus: SopyoDeliveredSyncStatus.SUBMISSION_PENDING },
        data: { deliveredSyncStatus: SopyoDeliveredSyncStatus.OUTCOME_UNKNOWN },
      });
    }
    return 'outcome_unknown';
  }

  // Recheck canonical local identity in the same transaction as the null->pending CAS.
  const claimed = await db.$transaction(async (tx) => {
    const current = await loadIntent(tx, input.intentId);
    if (!eligible(current) || current.shopifyFulfillmentId !== exactFulfillmentId ||
        current.deliveredSyncStatus !== null || expectedOrderGid(current) !== expectedOrder) return false;
    const result = await tx.sopyoShipmentIntent.updateMany({
      where: { id: input.intentId, status: SopyoShipmentIntentStatus.CONFIRMED,
        shopifyFulfillmentId: exactFulfillmentId, deliveredSyncStatus: null },
      data: { deliveredSyncStatus: SopyoDeliveredSyncStatus.SUBMISSION_PENDING,
        deliveredSubmissionStartedAt: new Date() },
    });
    return result.count === 1;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  if (!claimed) return 'skipped';

  let outcome: 'success' | 'rejected' | 'unknown';
  try { outcome = (await read.createSopyoDeliveredEvent(exactFulfillmentId)).outcome; }
  catch { outcome = 'unknown'; }
  if (outcome === 'success') {
    // A mutation response alone is not the final read-back evidence.
    try {
      const after = await read.readSopyoFulfillmentDelivered({
        fulfillmentId: exactFulfillmentId, orderGid: expectedOrder,
      });
      if (after.delivered) {
        const confirmed = await db.sopyoShipmentIntent.updateMany({
          where: { id: input.intentId, deliveredSyncStatus: { in: [
            SopyoDeliveredSyncStatus.SUBMISSION_PENDING, SopyoDeliveredSyncStatus.OUTCOME_UNKNOWN,
          ] } },
          data: { deliveredSyncStatus: SopyoDeliveredSyncStatus.CONFIRMED,
            deliveredConfirmedAt: new Date() },
        });
        return confirmed.count === 1 ? 'confirmed' : 'skipped';
      }
    } catch { /* An incomplete read is not proof of failure. */ }
  }
  if (outcome === 'rejected') {
    await db.sopyoShipmentIntent.updateMany({
      where: { id: input.intentId, deliveredSyncStatus: { in: [
        SopyoDeliveredSyncStatus.SUBMISSION_PENDING, SopyoDeliveredSyncStatus.OUTCOME_UNKNOWN,
      ] } },
      data: { deliveredSyncStatus: SopyoDeliveredSyncStatus.REJECTED,
        deliveredRejectedAt: new Date(), deliveredRejectReasonCode: 'SHOPIFY_USER_ERROR' },
    });
    return 'rejected';
  }
  await db.sopyoShipmentIntent.updateMany({
    where: { id: input.intentId, deliveredSyncStatus: SopyoDeliveredSyncStatus.SUBMISSION_PENDING },
    data: { deliveredSyncStatus: SopyoDeliveredSyncStatus.OUTCOME_UNKNOWN },
  });
  return 'outcome_unknown';
}
