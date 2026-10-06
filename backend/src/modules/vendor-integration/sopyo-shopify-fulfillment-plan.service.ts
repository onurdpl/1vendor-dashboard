import { Prisma, SopyoOrderPushStatus, SopyoShipmentIntentStatus,
  VendorIntegrationProviderCode, VendorOutboundMethod } from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { assertAllocationActionable } from '../orders/allocation-actionability-guard.service.js';
import { assertNoPendingCustomerCancellationHold } from '../orders/customer-cancellation-hold.service.js';
import { assertFullOrderOperationallyEligible } from '../orders/full-order-cancellation-policy.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import type { ShopifySopyoFulfillmentPlanRead } from '../shopify/shopify-admin.types.js';

export class SopyoShopifyPlanningError extends Error {
  constructor(readonly code: 'IDENTITY_MISMATCH' | 'NOT_ACTIONABLE' | 'SHOPIFY_PLAN_UNSAFE' |
    'SHOPIFY_PLAN_CHANGED' | 'SHOPIFY_READ_INCOMPLETE') {
    super(`Sopyo Shopify planning rejected: ${code}.`);
    this.name = 'SopyoShopifyPlanningError';
  }
}

type LocalLine = { id: string; shopifyLineItemId: string; sourceLineItemId: string; quantity: number };
type PlanLine = {
  vendorAllocationLineItemId: string;
  fulfillmentOrderGid: string;
  fulfillmentOrderLineItemGid: string;
  shopifyOrderLineItemGid: string;
  quantity: number;
};

function canonicalOrderLineGid(value: string): string | null {
  const trimmed = value.trim();
  if (/^gid:\/\/shopify\/LineItem\/[1-9]\d*$/.test(trimmed)) return trimmed;
  if (/^[1-9]\d*$/.test(trimmed)) return `gid://shopify/LineItem/${trimmed}`;
  return null;
}

function sortedLines(lines: PlanLine[]): PlanLine[] {
  return [...lines].sort((a, b) =>
    a.fulfillmentOrderLineItemGid.localeCompare(b.fulfillmentOrderLineItemGid));
}

/** Deliberately narrow: only fully unfulfilled, uniquely owned local lines can be planned. */
export function buildSopyoShopifyExecutionLines(input: {
  allocationLineItems: LocalLine[];
  otherAllocationLineItemIds: string[];
  frozenLocationGid: string;
  canonical: ShopifySopyoFulfillmentPlanRead;
}): PlanLine[] {
  if (input.canonical.source !== 'shopify_admin' || input.allocationLineItems.length === 0 ||
      input.otherAllocationLineItemIds.length > 0) {
    throw new SopyoShopifyPlanningError('SHOPIFY_PLAN_UNSAFE');
  }
  const owned = new Map<string, LocalLine>();
  for (const line of input.allocationLineItems) {
    const gid = canonicalOrderLineGid(line.sourceLineItemId);
    if (!gid || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || owned.has(gid)) {
      throw new SopyoShopifyPlanningError('SHOPIFY_PLAN_UNSAFE');
    }
    owned.set(gid, line);
  }
  const totals = new Map<string, number>();
  const seenFulfillmentOrderLines = new Set<string>();
  const selected: PlanLine[] = [];
  for (const order of input.canonical.fulfillmentOrders) {
    if (!order.id.startsWith('gid://shopify/FulfillmentOrder/')) {
      throw new SopyoShopifyPlanningError('SHOPIFY_PLAN_UNSAFE');
    }
    for (const line of order.lineItems) {
      const local = owned.get(line.lineItemId);
      if (!local) continue;
      if (order.assignedLocationId !== input.frozenLocationGid ||
          order.existingFulfillmentIds.length > 0 ||
          !order.supportedActions?.includes('CREATE_FULFILLMENT') ||
          !line.id.startsWith('gid://shopify/FulfillmentOrderLineItem/') ||
          seenFulfillmentOrderLines.has(line.id) ||
          !Number.isSafeInteger(line.remainingQuantity) || (line.remainingQuantity ?? -1) < 0 ||
          !Number.isSafeInteger(line.totalQuantity) ||
          (line.totalQuantity ?? -1) < (line.remainingQuantity ?? 0)) {
        throw new SopyoShopifyPlanningError('SHOPIFY_PLAN_UNSAFE');
      }
      seenFulfillmentOrderLines.add(line.id);
      const quantity = line.remainingQuantity!;
      totals.set(line.lineItemId, (totals.get(line.lineItemId) ?? 0) + quantity);
      if (quantity > 0) selected.push({
        vendorAllocationLineItemId: local.id,
        fulfillmentOrderGid: order.id,
        fulfillmentOrderLineItemGid: line.id,
        shopifyOrderLineItemGid: line.lineItemId,
        quantity,
      });
    }
  }
  if (selected.length === 0 || [...owned].some(([gid, line]) => totals.get(gid) !== line.quantity)) {
    throw new SopyoShopifyPlanningError('SHOPIFY_PLAN_UNSAFE');
  }
  return sortedLines(selected);
}

async function loadContext(tx: Prisma.TransactionClient, intentId: string) {
  const intent = await tx.sopyoShipmentIntent.findUnique({
    where: { id: intentId },
    include: {
      sopyoOrderPush: { select: { id: true, vendorAllocationId: true, assignedVendorId: true,
        orderCode: true, status: true, sopyoOrderId: true } },
      vendorAllocation: {
        include: {
          order: { select: { id: true, sourceShopifyOrderId: true, cancelledAt: true } },
          lineItems: { select: { id: true, shopifyLineItemId: true, quantity: true,
            shopifyOrderLineItem: { select: { sourceLineItemId: true } } } },
        },
      },
    },
  });
  if (!intent || intent.status === SopyoShipmentIntentStatus.CONFLICT ||
      !(new Set<string>([SopyoShipmentIntentStatus.CARGO_VERIFIED, SopyoShipmentIntentStatus.SELECTION_PENDING,
        SopyoShipmentIntentStatus.PLAN_READY])).has(intent.status)) {
    throw new SopyoShopifyPlanningError('NOT_ACTIONABLE');
  }
  await assertAllocationActionable(tx, intent.vendorAllocationId);
  const allocation = intent.vendorAllocation;
  assertFullOrderOperationallyEligible(allocation.order);
  await assertNoPendingCustomerCancellationHold(allocation.id, tx);
  const push = intent.sopyoOrderPush;
  if (allocation.id !== intent.vendorAllocationId || allocation.assignedVendorId !== intent.assignedVendorId ||
      allocation.allocationStatus !== 'ACTIVE' || allocation.cancellationReason ||
      allocation.reassignmentRequired ||
      allocation.outboundMethodSnapshot !== VendorOutboundMethod.VENDOR_INTEGRATION ||
      allocation.outboundIntegrationProviderSnapshot !== VendorIntegrationProviderCode.SOPYO ||
      !allocation.shopifyLocationGidSnapshot ||
      allocation.shopifyLocationGidSnapshot !== intent.shopifyLocationGid ||
      !intent.carrier.trim() || !intent.trackingNumber.trim() ||
      push.status !== SopyoOrderPushStatus.SUCCEEDED || push.id !== intent.sopyoOrderPushId ||
      push.vendorAllocationId !== allocation.id || push.assignedVendorId !== allocation.assignedVendorId ||
      push.orderCode !== allocation.id || push.sopyoOrderId !== intent.sopyoOrderId) {
    throw new SopyoShopifyPlanningError('IDENTITY_MISMATCH');
  }
  const allocationLineItems = allocation.lineItems.map((line) => ({
    id: line.id, shopifyLineItemId: line.shopifyLineItemId,
    sourceLineItemId: line.shopifyOrderLineItem.sourceLineItemId, quantity: line.quantity,
  }));
  const otherAllocationLineItemIds = (await tx.vendorAllocationLineItem.findMany({
    where: { shopifyLineItemId: { in: allocationLineItems.map((line) => line.shopifyLineItemId) },
      vendorAllocationId: { not: allocation.id } },
    select: { id: true },
  })).map((line) => line.id);
  allocationLineItems.sort((a, b) => a.id.localeCompare(b.id));
  otherAllocationLineItemIds.sort();
  return { intent, allocation, allocationLineItems, otherAllocationLineItemIds };
}

async function markConflict(db: typeof prisma, intentId: string,
  reason: 'SHOPIFY_PLAN_UNSAFE' | 'SHOPIFY_PLAN_CHANGED' | 'SHOPIFY_READ_INCOMPLETE') {
  await db.sopyoShipmentIntent.updateMany({
    where: { id: intentId, status: { in: [SopyoShipmentIntentStatus.CARGO_VERIFIED,
      SopyoShipmentIntentStatus.SELECTION_PENDING, SopyoShipmentIntentStatus.PLAN_READY] } },
    data: { status: SopyoShipmentIntentStatus.CONFLICT, conflictReasonCode: reason,
      conflictObservedAt: new Date() },
  });
}

export async function planSopyoShopifyFulfillment(input: {
  intentId: string;
  env: AppEnv;
  shopifyAdminService?: Pick<ReturnType<typeof createShopifyAdminService>, 'fetchFulfillmentOrdersForSopyoPlanning'>;
}, db: typeof prisma = prisma) {
  const before = await db.$transaction((tx) => loadContext(tx, input.intentId));
  const read = input.shopifyAdminService ?? createShopifyAdminService(input.env);
  let canonical: ShopifySopyoFulfillmentPlanRead;
  try {
    canonical = await read.fetchFulfillmentOrdersForSopyoPlanning(before.allocation.order.sourceShopifyOrderId);
    const expectedOrderGid = before.allocation.order.sourceShopifyOrderId.startsWith('gid://shopify/Order/')
      ? before.allocation.order.sourceShopifyOrderId
      : `gid://shopify/Order/${before.allocation.order.sourceShopifyOrderId}`;
    if (canonical.orderGid !== expectedOrderGid) {
      throw new SopyoShopifyPlanningError('SHOPIFY_READ_INCOMPLETE');
    }
  } catch {
    await markConflict(db, input.intentId, 'SHOPIFY_READ_INCOMPLETE');
    throw new SopyoShopifyPlanningError('SHOPIFY_READ_INCOMPLETE');
  }
  let lines: PlanLine[];
  try {
    lines = buildSopyoShopifyExecutionLines({
      allocationLineItems: before.allocationLineItems,
      otherAllocationLineItemIds: before.otherAllocationLineItemIds,
      frozenLocationGid: before.intent.shopifyLocationGid,
      canonical,
    });
  } catch {
    await markConflict(db, input.intentId, 'SHOPIFY_PLAN_UNSAFE');
    throw new SopyoShopifyPlanningError('SHOPIFY_PLAN_UNSAFE');
  }

  try {
    return await db.$transaction(async (tx) => {
      const current = await loadContext(tx, input.intentId);
      if (JSON.stringify(current.allocationLineItems) !== JSON.stringify(before.allocationLineItems) ||
          JSON.stringify(current.otherAllocationLineItemIds) !== JSON.stringify(before.otherAllocationLineItemIds) ||
          current.allocation.order.sourceShopifyOrderId !== before.allocation.order.sourceShopifyOrderId ||
          current.intent.shopifyLocationGid !== before.intent.shopifyLocationGid) {
        throw new SopyoShopifyPlanningError('SHOPIFY_PLAN_CHANGED');
      }
      const existing = await tx.sopyoShopifyExecutionPlan.findUnique({
        where: { sopyoShipmentIntentId: input.intentId }, include: { lines: true },
      });
      if (existing) {
        const saved = sortedLines(existing.lines.map((line) => ({
          vendorAllocationLineItemId: line.vendorAllocationLineItemId,
          fulfillmentOrderGid: line.fulfillmentOrderGid,
          fulfillmentOrderLineItemGid: line.fulfillmentOrderLineItemGid,
          shopifyOrderLineItemGid: line.shopifyOrderLineItemGid,
          quantity: line.quantity,
        })));
        if (existing.shopifyOrderGid !== canonical.orderGid ||
            existing.shopifyLocationGid !== current.intent.shopifyLocationGid ||
            existing.baselineFulfillmentIds.length !== 0 ||
            JSON.stringify(saved) !== JSON.stringify(lines)) {
          throw new SopyoShopifyPlanningError('SHOPIFY_PLAN_CHANGED');
        }
        return existing;
      }
      if (current.intent.status === SopyoShipmentIntentStatus.PLAN_READY) {
        throw new SopyoShopifyPlanningError('SHOPIFY_PLAN_CHANGED');
      }
      const plan = await tx.sopyoShopifyExecutionPlan.create({
        data: {
          sopyoShipmentIntentId: input.intentId,
          shopifyOrderGid: canonical.orderGid,
          shopifyLocationGid: current.intent.shopifyLocationGid,
          baselineFulfillmentIds: [],
          lines: { create: lines },
        },
        include: { lines: true },
      });
      await tx.sopyoShipmentIntent.update({
        where: { id: input.intentId }, data: { status: SopyoShipmentIntentStatus.PLAN_READY },
      });
      return plan;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    if (error instanceof SopyoShopifyPlanningError && error.code === 'SHOPIFY_PLAN_CHANGED') {
      await markConflict(db, input.intentId, 'SHOPIFY_PLAN_CHANGED');
    }
    throw error;
  }
}
