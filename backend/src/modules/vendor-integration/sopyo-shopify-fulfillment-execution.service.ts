import { Prisma, SopyoShipmentIntentStatus } from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import type { ShopifySopyoFulfillmentCreateInput, ShopifySopyoFulfillmentCreateResult,
  ShopifySopyoFulfillmentEvidence, ShopifySopyoFulfillmentPlanRead } from '../shopify/shopify-admin.types.js';
import { buildSopyoShopifyExecutionLines, loadSopyoShopifyPlanningContext }
  from './sopyo-shopify-fulfillment-plan.service.js';

type ShopifyPort = Pick<ReturnType<typeof createShopifyAdminService>,
  'fetchFulfillmentOrdersForSopyoPlanning' | 'createSopyoFulfillment' |
  'fetchSopyoFulfillmentsForReconciliation'>;
type StoredPlan = Prisma.SopyoShopifyExecutionPlanGetPayload<{ include: { lines: true } }>;

export class SopyoShopifyExecutionError extends Error {
  constructor(readonly code: 'NOT_READY' | 'IDENTITY_MISMATCH' | 'SHOPIFY_PLAN_CHANGED' |
    'SHOPIFY_READ_INCOMPLETE' | 'SHOPIFY_NOT_CONFIGURED') {
    super(`Sopyo Shopify execution rejected: ${code}.`);
    this.name = 'SopyoShopifyExecutionError';
  }
}

function expectedOrderGid(sourceId: string): string {
  return sourceId.startsWith('gid://shopify/Order/') ? sourceId : `gid://shopify/Order/${sourceId}`;
}

function sortedPlanLines(plan: StoredPlan) {
  return plan.lines.map((line) => ({
    vendorAllocationLineItemId: line.vendorAllocationLineItemId,
    fulfillmentOrderGid: line.fulfillmentOrderGid,
    fulfillmentOrderLineItemGid: line.fulfillmentOrderLineItemGid,
    shopifyOrderLineItemGid: line.shopifyOrderLineItemGid,
    quantity: line.quantity,
  })).sort((a, b) => a.fulfillmentOrderLineItemGid.localeCompare(b.fulfillmentOrderLineItemGid));
}

function assertPlanMatchesCanonical(input: {
  plan: StoredPlan;
  sourceOrderId: string;
  locationGid: string;
  allocationLineItems: Array<{ id: string; shopifyLineItemId: string; sourceLineItemId: string; quantity: number }>;
  otherAllocationLineItemIds: string[];
  canonical: ShopifySopyoFulfillmentPlanRead;
}) {
  if (input.plan.shopifyOrderGid !== expectedOrderGid(input.sourceOrderId) ||
      input.plan.shopifyLocationGid !== input.locationGid ||
      input.plan.baselineFulfillmentIds.length !== 0 || input.plan.lines.length === 0 ||
      input.plan.lines.some((line) => !Number.isSafeInteger(line.quantity) || line.quantity <= 0) ||
      input.canonical.orderGid !== input.plan.shopifyOrderGid) {
    throw new SopyoShopifyExecutionError('SHOPIFY_PLAN_CHANGED');
  }
  let fresh;
  try {
    fresh = buildSopyoShopifyExecutionLines({
      allocationLineItems: input.allocationLineItems,
      otherAllocationLineItemIds: input.otherAllocationLineItemIds,
      frozenLocationGid: input.locationGid,
      canonical: input.canonical,
    });
  } catch {
    throw new SopyoShopifyExecutionError('SHOPIFY_PLAN_CHANGED');
  }
  if (JSON.stringify(fresh) !== JSON.stringify(sortedPlanLines(input.plan))) {
    throw new SopyoShopifyExecutionError('SHOPIFY_PLAN_CHANGED');
  }
}

function createInput(plan: StoredPlan, carrier: string, trackingNumber: string): ShopifySopyoFulfillmentCreateInput {
  const grouped = new Map<string, Array<{ id: string; quantity: number }>>();
  for (const line of sortedPlanLines(plan)) {
    const items = grouped.get(line.fulfillmentOrderGid) ?? [];
    items.push({ id: line.fulfillmentOrderLineItemGid, quantity: line.quantity });
    grouped.set(line.fulfillmentOrderGid, items);
  }
  return { orderGid: plan.shopifyOrderGid,
    lineItemsByFulfillmentOrder: [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(
      ([fulfillmentOrderId, fulfillmentOrderLineItems]) =>
        ({ fulfillmentOrderId, fulfillmentOrderLineItems })),
    company: carrier, trackingNumber,
  };
}

function quantities(lines: Array<{ shopifyOrderLineItemGid: string; quantity: number }>): string {
  const sums = new Map<string, number>();
  for (const line of lines) sums.set(line.shopifyOrderLineItemGid,
    (sums.get(line.shopifyOrderLineItemGid) ?? 0) + line.quantity);
  return JSON.stringify([...sums].sort(([a], [b]) => a.localeCompare(b)));
}

/** A fulfillment has to prove the entire immutable plan, not just the tracking pair. */
export function matchesSopyoShopifyExecutionPlan(evidence: ShopifySopyoFulfillmentEvidence,
  plan: StoredPlan, carrier: string, trackingNumber: string): boolean {
  const plannedOrders = [...new Set(plan.lines.map((line) => line.fulfillmentOrderGid))].sort();
  const actualOrders = [...new Set(evidence.fulfillmentOrderGids)].sort();
  return evidence.orderGid === plan.shopifyOrderGid &&
    evidence.locationGid === plan.shopifyLocationGid &&
    !['CANCELLED', 'ERROR', 'FAILURE'].includes(evidence.status) &&
    actualOrders.length === evidence.fulfillmentOrderGids.length &&
    JSON.stringify(actualOrders) === JSON.stringify(plannedOrders) &&
    evidence.tracking.length === 1 && evidence.tracking[0]?.company === carrier &&
    evidence.tracking[0]?.number === trackingNumber &&
    quantities(evidence.lines) === quantities(plan.lines);
}

async function transition(db: typeof prisma, intentId: string,
  from: SopyoShipmentIntentStatus[], status: SopyoShipmentIntentStatus,
  extra: Prisma.SopyoShipmentIntentUpdateManyMutationInput = {}) {
  return db.sopyoShipmentIntent.updateMany({ where: { id: intentId, status: { in: from } },
    data: { status, ...extra } });
}

async function markPreSubmissionConflict(db: typeof prisma, intentId: string,
  reason: 'SHOPIFY_PLAN_CHANGED' | 'SHOPIFY_READ_INCOMPLETE') {
  await transition(db, intentId, [SopyoShipmentIntentStatus.PLAN_READY],
    SopyoShipmentIntentStatus.CONFLICT,
    { conflictReasonCode: reason, conflictObservedAt: new Date() });
}

async function reconcile(intentId: string, read: ShopifyPort, db: typeof prisma) {
  const intent = await db.sopyoShipmentIntent.findUnique({ where: { id: intentId },
    include: { executionPlan: { include: { lines: true } } } });
  if (!intent?.executionPlan) throw new SopyoShopifyExecutionError('NOT_READY');
  if (intent.status === SopyoShipmentIntentStatus.CONFIRMED || intent.shopifyFulfillmentId) return intent;
  const cargoConflictWithSubmission = intent.status === SopyoShipmentIntentStatus.CONFLICT &&
    intent.conflictReasonCode === 'CARGO_MISMATCH' && Boolean(intent.submissionStartedAt);
  const reconcilable: SopyoShipmentIntentStatus[] = [SopyoShipmentIntentStatus.SUBMISSION_PENDING,
    SopyoShipmentIntentStatus.OUTCOME_UNKNOWN, SopyoShipmentIntentStatus.RECONCILIATION_PENDING];
  if (!reconcilable.includes(intent.status) && !cargoConflictWithSubmission) {
    throw new SopyoShopifyExecutionError('NOT_READY');
  }

  let evidence: ShopifySopyoFulfillmentEvidence[];
  try { evidence = await read.fetchSopyoFulfillmentsForReconciliation(intent.executionPlan.shopifyOrderGid); }
  catch {
    await transition(db, intentId, reconcilable, SopyoShipmentIntentStatus.OUTCOME_UNKNOWN);
    return db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: intentId } });
  }
  const baseline = new Set(intent.executionPlan.baselineFulfillmentIds);
  const plannedOrders = new Set(intent.executionPlan.lines.map((line) => line.fulfillmentOrderGid));
  const candidates = evidence.filter((item) => !baseline.has(item.id) &&
    (item.fulfillmentOrderGids.some((id) => plannedOrders.has(id)) ||
      item.tracking.some((track) => track.company === intent.carrier && track.number === intent.trackingNumber)));
  const exact = candidates.filter((item) => matchesSopyoShopifyExecutionPlan(item,
    intent.executionPlan!, intent.carrier, intent.trackingNumber));
  if (candidates.length === 1 && exact.length === 1) {
    if (cargoConflictWithSubmission) {
      await db.sopyoShipmentIntent.updateMany({
        where: { id: intentId, status: SopyoShipmentIntentStatus.CONFLICT,
          conflictReasonCode: 'CARGO_MISMATCH', shopifyFulfillmentId: null },
        data: { shopifyFulfillmentId: exact[0]!.id, confirmedAt: new Date() },
      });
    } else {
      await transition(db, intentId, reconcilable, SopyoShipmentIntentStatus.CONFIRMED,
        { shopifyFulfillmentId: exact[0]!.id, confirmedAt: new Date() });
    }
  } else if (candidates.length > 0) {
    await transition(db, intentId, reconcilable, SopyoShipmentIntentStatus.CONFLICT,
      { conflictReasonCode: 'SHOPIFY_RECONCILIATION_AMBIGUOUS', conflictObservedAt: new Date() });
  } else if (!cargoConflictWithSubmission) {
    // No visible match is not proof the mutation was never applied.
    await transition(db, intentId, reconcilable, SopyoShipmentIntentStatus.OUTCOME_UNKNOWN);
  }
  return db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: intentId } });
}

/** Operator/internal entry point only. The persisted claim fences a single local create attempt. */
export async function executeSopyoShopifyFulfillment(input: {
  intentId: string;
  env: AppEnv;
  shopifyAdminService?: ShopifyPort;
}, db: typeof prisma = prisma) {
  if (input.env.SHOPIFY_API_VERSION !== '2026-10' || !input.env.SHOPIFY_SHOP_DOMAIN ||
      !input.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    throw new SopyoShopifyExecutionError('SHOPIFY_NOT_CONFIGURED');
  }
  const read = input.shopifyAdminService ?? createShopifyAdminService(input.env);
  const initial = await db.sopyoShipmentIntent.findUnique({ where: { id: input.intentId },
    include: { executionPlan: { include: { lines: true } } } });
  if (!initial?.executionPlan) throw new SopyoShopifyExecutionError('NOT_READY');
  if (initial.status === SopyoShipmentIntentStatus.CONFIRMED || initial.shopifyFulfillmentId) return initial;
  if (initial.status === SopyoShipmentIntentStatus.CONFLICT) {
    return initial.conflictReasonCode === 'CARGO_MISMATCH' && initial.submissionStartedAt
      ? reconcile(input.intentId, read, db) : initial;
  }
  if (([SopyoShipmentIntentStatus.SUBMISSION_PENDING, SopyoShipmentIntentStatus.OUTCOME_UNKNOWN,
      SopyoShipmentIntentStatus.RECONCILIATION_PENDING] as SopyoShipmentIntentStatus[]).includes(initial.status)) {
    return reconcile(input.intentId, read, db);
  }
  if (initial.status !== SopyoShipmentIntentStatus.PLAN_READY) {
    throw new SopyoShopifyExecutionError('NOT_READY');
  }

  let canonical: ShopifySopyoFulfillmentPlanRead;
  try {
    canonical = await read.fetchFulfillmentOrdersForSopyoPlanning(initial.executionPlan.shopifyOrderGid);
  } catch {
    await markPreSubmissionConflict(db, input.intentId, 'SHOPIFY_READ_INCOMPLETE');
    throw new SopyoShopifyExecutionError('SHOPIFY_READ_INCOMPLETE');
  }

  let persisted: { plan: StoredPlan; carrier: string; trackingNumber: string } | null;
  try {
    persisted = await db.$transaction(async (tx) => {
      // The existing planning guard acquires the order-scoped advisory lock and rechecks all local authority.
      const context = await loadSopyoShopifyPlanningContext(tx, input.intentId);
      if (context.intent.status !== SopyoShipmentIntentStatus.PLAN_READY) return null;
      const plan = await tx.sopyoShopifyExecutionPlan.findUnique({
        where: { sopyoShipmentIntentId: input.intentId }, include: { lines: true },
      });
      if (!plan || plan.id !== initial.executionPlan?.id ||
          context.intent.carrier !== initial.carrier ||
          context.intent.trackingNumber !== initial.trackingNumber) {
        throw new SopyoShopifyExecutionError('SHOPIFY_PLAN_CHANGED');
      }
      assertPlanMatchesCanonical({ plan,
        sourceOrderId: context.allocation.order.sourceShopifyOrderId,
        locationGid: context.intent.shopifyLocationGid,
        allocationLineItems: context.allocationLineItems,
        otherAllocationLineItemIds: context.otherAllocationLineItemIds,
        canonical,
      });
      const existingFulfillment = await tx.fulfillment.findUnique({
        where: { vendorAllocationId: context.allocation.id },
        select: { shopifyFulfillmentId: true, syncStatus: true },
      });
      if (existingFulfillment?.shopifyFulfillmentId ||
          existingFulfillment?.syncStatus === 'fulfillment_submission_pending') {
        throw new SopyoShopifyExecutionError('SHOPIFY_PLAN_CHANGED');
      }
      const claimed = await tx.sopyoShipmentIntent.updateMany({
        where: { id: input.intentId, status: SopyoShipmentIntentStatus.PLAN_READY,
          submissionStartedAt: null, shopifyFulfillmentId: null },
        data: { status: SopyoShipmentIntentStatus.SUBMISSION_PENDING,
          submissionStartedAt: new Date() },
      });
      return claimed.count === 1 ? { plan, carrier: context.intent.carrier,
        trackingNumber: context.intent.trackingNumber } : null;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    await markPreSubmissionConflict(db, input.intentId, 'SHOPIFY_PLAN_CHANGED');
    if (error instanceof SopyoShopifyExecutionError) throw error;
    throw new SopyoShopifyExecutionError('IDENTITY_MISMATCH');
  }
  if (!persisted) return db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: input.intentId } });

  let result: ShopifySopyoFulfillmentCreateResult;
  try { result = await read.createSopyoFulfillment(createInput(persisted.plan,
    persisted.carrier, persisted.trackingNumber)); }
  catch { result = { outcome: 'unknown' }; }
  if (result.outcome === 'success' && matchesSopyoShopifyExecutionPlan(result.fulfillment,
      persisted.plan, persisted.carrier, persisted.trackingNumber)) {
    const confirmed = await transition(db, input.intentId, [SopyoShipmentIntentStatus.SUBMISSION_PENDING,
      SopyoShipmentIntentStatus.OUTCOME_UNKNOWN], SopyoShipmentIntentStatus.CONFIRMED,
      { shopifyFulfillmentId: result.fulfillment.id, confirmedAt: new Date() });
    if (confirmed.count === 0) {
      // Cargo may have conflicted while the external mutation was in flight. Preserve that
      // conflict but never lose a proven Shopify identity.
      await db.sopyoShipmentIntent.updateMany({
        where: { id: input.intentId, status: SopyoShipmentIntentStatus.CONFLICT,
          conflictReasonCode: 'CARGO_MISMATCH', shopifyFulfillmentId: null },
        data: { shopifyFulfillmentId: result.fulfillment.id, confirmedAt: new Date() },
      });
    }
  } else if (result.outcome === 'rejected') {
    await transition(db, input.intentId, [SopyoShipmentIntentStatus.SUBMISSION_PENDING],
      SopyoShipmentIntentStatus.CONFLICT,
      { conflictReasonCode: 'SHOPIFY_CREATE_REJECTED', conflictObservedAt: new Date() });
  } else {
    await transition(db, input.intentId, [SopyoShipmentIntentStatus.SUBMISSION_PENDING],
      SopyoShipmentIntentStatus.OUTCOME_UNKNOWN);
  }
  return db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: input.intentId } });
}
