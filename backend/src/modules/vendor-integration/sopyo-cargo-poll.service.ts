import {
  Prisma, SopyoOrderPushStatus, SopyoShipmentIntentStatus,
  VendorIntegrationProviderCode, VendorOutboundMethod,
} from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { assertAllocationActionable } from '../orders/allocation-actionability-guard.service.js';
import { assertNoPendingCustomerCancellationHold } from '../orders/customer-cancellation-hold.service.js';
import { assertFullOrderOperationallyEligible } from '../orders/full-order-cancellation-policy.js';
import { canonicalSopyoOrderId } from '../shipping/allocation-delivered-observation.service.js';
import { getDecryptedSopyoCredentialForInternalUse } from './sopyo-credential.service.js';
import { createSopyoDeliveryClient } from './sopyo-delivery.client.js';
import { SOPYO_CARGO_SHOPIFY_SYNC_INTERVAL_MS } from './sopyo-delivery-poll.service.js';
import { recordVerifiedSopyoShipmentIntent } from './sopyo-shipment-intent.service.js';

const IN_TRANSIT = 'In Transit';
const PRE_SHIPMENT = new Set(['awaiting shipment', 'awaiting_shipment', 'pending', 'label created', 'label_created']);
const IN_TRANSIT_VALUES = new Set(['in transit', 'in_transit', 'shipped', 'partially_shipped', 'out_for_delivery']);
const DELIVERED = new Set(['delivered']);

function statusKey(value: string) { return value.trim().toLowerCase(); }

const candidateSelect = {
  id: true, assignedVendorId: true, outboundMethodSnapshot: true,
  outboundIntegrationProviderSnapshot: true, shopifyLocationGidSnapshot: true,
  carrier: true, trackingNumber: true, shippingStatus: true,
  sopyoShipmentIntent: { select: {
    id: true, sopyoOrderPushId: true, assignedVendorId: true, sopyoOrderId: true,
    orderCode: true, carrier: true, trackingNumber: true, shopifyLocationGid: true, status: true,
  } },
} satisfies Prisma.VendorAllocationSelect;

type CandidateAllocation = Prisma.VendorAllocationGetPayload<{ select: typeof candidateSelect }>;

function projected(allocation: CandidateAllocation): boolean {
  const intent = allocation.sopyoShipmentIntent;
  return Boolean(intent && intent.status !== SopyoShipmentIntentStatus.CONFLICT &&
    allocation.carrier === intent.carrier && allocation.trackingNumber === intent.trackingNumber &&
    !PRE_SHIPMENT.has(statusKey(allocation.shippingStatus)));
}

function validPush(push: {
  vendorAllocationId: string; assignedVendorId: string; orderCode: string;
  status: SopyoOrderPushStatus; sopyoOrderId: string | null;
  vendorAllocation: CandidateAllocation;
}): boolean {
  const allocation = push.vendorAllocation;
  return push.status === SopyoOrderPushStatus.SUCCEEDED &&
    push.vendorAllocationId === allocation.id && push.assignedVendorId === allocation.assignedVendorId &&
    push.orderCode === allocation.id && Boolean(canonicalSopyoOrderId(push.sopyoOrderId));
}

/** No Shopify or other provider calls. The order lock serializes local shipment identity writes. */
export async function projectVerifiedSopyoCargo(
  input: { allocationId: string; pushId: string; intentId: string },
  db: typeof prisma = prisma,
): Promise<'PROJECTED' | 'UNCHANGED' | 'CONFLICT'> {
  return db.$transaction(async (tx) => {
    await assertAllocationActionable(tx, input.allocationId);
    // Not every existing shipment writer takes the order advisory lock. These
    // row locks prevent a write between the local identity check and projection.
    await tx.$queryRaw`SELECT "id" FROM "VendorAllocation" WHERE "id" = ${input.allocationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "SopyoShipmentIntent" WHERE "id" = ${input.intentId} FOR UPDATE`;
    const allocation = await tx.vendorAllocation.findUnique({
      where: { id: input.allocationId },
      select: { ...candidateSelect, allocationStatus: true, cancellationReason: true,
        reassignmentRequired: true, order: { select: { cancelledAt: true } },
        sopyoOrderPush: { select: { id: true, vendorAllocationId: true, assignedVendorId: true,
          orderCode: true, status: true, sopyoOrderId: true } } },
    });
    const intent = allocation?.sopyoShipmentIntent;
    const push = allocation?.sopyoOrderPush;
    if (!allocation || !intent || !push || intent.id !== input.intentId ||
        intent.status === SopyoShipmentIntentStatus.CONFLICT ||
        allocation.allocationStatus !== 'ACTIVE' || allocation.cancellationReason ||
        allocation.reassignmentRequired ||
        allocation.outboundMethodSnapshot !== VendorOutboundMethod.VENDOR_INTEGRATION ||
        allocation.outboundIntegrationProviderSnapshot !== VendorIntegrationProviderCode.SOPYO ||
        push.id !== input.pushId || !validPush({ ...push, vendorAllocation: allocation }) ||
        intent.sopyoOrderPushId !== push.id || intent.assignedVendorId !== allocation.assignedVendorId ||
        intent.sopyoOrderId !== push.sopyoOrderId || intent.orderCode !== push.orderCode) {
      throw new Error('Sopyo cargo projection authority changed.');
    }
    assertFullOrderOperationallyEligible(allocation.order);
    await assertNoPendingCustomerCancellationHold(allocation.id, tx);

    const currentCarrier = allocation.carrier?.trim() || null;
    const currentTracking = allocation.trackingNumber?.trim() || null;
    const exact = currentCarrier === intent.carrier && currentTracking === intent.trackingNumber;
    const empty = !currentCarrier && !currentTracking;
    const status = statusKey(allocation.shippingStatus);
    if ((!empty && !exact) || (!PRE_SHIPMENT.has(status) && !IN_TRANSIT_VALUES.has(status) &&
        !DELIVERED.has(status))) {
      await tx.sopyoShipmentIntent.update({ where: { id: intent.id }, data: {
        status: SopyoShipmentIntentStatus.CONFLICT,
        conflictReasonCode: !empty && !exact ? 'LOCAL_CARGO_MISMATCH' : 'LOCAL_SHIPPING_STATUS_CONFLICT',
        conflictObservedAt: new Date(),
      } });
      return 'CONFLICT';
    }
    if (exact && !PRE_SHIPMENT.has(status)) return 'UNCHANGED';
    await tx.vendorAllocation.update({ where: { id: allocation.id }, data: {
      carrier: intent.carrier, trackingNumber: intent.trackingNumber,
      ...(PRE_SHIPMENT.has(status) ? { shippingStatus: IN_TRANSIT } : {}),
    } });
    return 'PROJECTED';
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export type SopyoCargoPollReport = {
  candidateCount: number; detailChecks: number; noCargo: number;
  projected: number; unchanged: number; conflicts: number; failedVendors: number; failedCandidates: number;
};

/** Cargo discovery is independent of the status-6 delivered-observation lifecycle. */
export async function pollSopyoCargo(
  options: { db?: typeof prisma; fetcher?: typeof fetch } = {},
): Promise<SopyoCargoPollReport> {
  const db = options.db ?? prisma;
  const client = createSopyoDeliveryClient(options.fetcher);
  const report: SopyoCargoPollReport = {
    candidateCount: 0, detailChecks: 0, noCargo: 0, projected: 0,
    unchanged: 0, conflicts: 0, failedVendors: 0, failedCandidates: 0,
  };
  const pushes = await db.sopyoOrderPush.findMany({
    where: { status: SopyoOrderPushStatus.SUCCEEDED,
      vendorAllocation: { outboundMethodSnapshot: VendorOutboundMethod.VENDOR_INTEGRATION,
        outboundIntegrationProviderSnapshot: VendorIntegrationProviderCode.SOPYO } },
    select: { id: true, vendorAllocationId: true, assignedVendorId: true, orderCode: true,
      status: true, sopyoOrderId: true, vendorAllocation: { select: candidateSelect } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const byVendor = new Map<string, typeof pushes>();
  for (const push of pushes) {
    if (!validPush(push) || push.vendorAllocation.sopyoShipmentIntent?.status === SopyoShipmentIntentStatus.CONFLICT ||
        projected(push.vendorAllocation)) continue;
    const group = byVendor.get(push.assignedVendorId) ?? [];
    group.push(push);
    byVendor.set(push.assignedVendorId, group);
    report.candidateCount += 1;
  }
  for (const [vendorId, vendorPushes] of byVendor) {
    let bearer: string | null = null;
    for (const push of vendorPushes) {
      try {
        let intent = push.vendorAllocation.sopyoShipmentIntent;
        if (!intent) {
          if (!bearer) {
            try {
              const apiToken = await getDecryptedSopyoCredentialForInternalUse(vendorId, db);
              bearer = await client.authenticate(apiToken);
            } catch {
              report.failedVendors += 1;
              break;
            }
          }
          report.detailChecks += 1;
          const detail = await client.orderById(bearer, push.sopyoOrderId!, { includeCargo: true });
          if (!detail.cargoCompany || !detail.cargoTrackingNumber) {
            report.noCargo += 1;
            continue;
          }
          intent = await recordVerifiedSopyoShipmentIntent({
            allocationId: push.vendorAllocationId, pushId: push.id,
            detail: { id: detail.id, orderCode: detail.orderCode, orderType: detail.orderType,
              cargoCompany: detail.cargoCompany, cargoTrackingNumber: detail.cargoTrackingNumber },
          }, db);
        }
        if (intent.status === SopyoShipmentIntentStatus.CONFLICT) {
          report.conflicts += 1;
          continue;
        }
        const result = await projectVerifiedSopyoCargo({
          allocationId: push.vendorAllocationId, pushId: push.id, intentId: intent.id,
        }, db);
        if (result === 'PROJECTED') report.projected += 1;
        else if (result === 'UNCHANGED') report.unchanged += 1;
        else report.conflicts += 1;
      } catch {
        // Do not log Sopyo responses, exception messages, cargo or credential material.
        report.failedCandidates += 1;
      }
    }
  }
  return report;
}

export function createSopyoCargoPollWorker(input: {
  logger: Pick<FastifyInstance['log'], 'info' | 'error'>;
  poll?: typeof pollSopyoCargo;
}) {
  const poll = input.poll ?? pollSopyoCargo;
  let timer: ReturnType<typeof globalThis.setInterval> | null = null;
  let activeCycle: Promise<void> | null = null;
  let stopping = false;

  function runCycle(): Promise<void> {
    if (stopping || activeCycle) return activeCycle ?? Promise.resolve();
    const cycle = poll()
      .then((report) => { input.logger.info(report, 'Sopyo cargo polling completed.'); })
      .catch(() => { input.logger.error({ category: 'POLL_FAILED' }, 'Sopyo cargo polling failed.'); });
    activeCycle = cycle;
    void cycle.finally(() => { activeCycle = null; });
    return cycle;
  }

  function start() {
    if (timer || stopping) return;
    timer = globalThis.setInterval(() => { void runCycle(); }, SOPYO_CARGO_SHOPIFY_SYNC_INTERVAL_MS);
    timer.unref?.();
  }

  async function close() {
    stopping = true;
    if (timer) globalThis.clearInterval(timer);
    timer = null;
    await activeCycle;
  }

  return { runCycle, start, close };
}

export function registerSopyoCargoPollScheduler(app: FastifyInstance, env: AppEnv) {
  if (!env.SOPYO_DELIVERY_POLLING_ENABLED) return null;
  const worker = createSopyoCargoPollWorker({ logger: app.log });
  app.addHook('onReady', async () => { worker.start(); });
  app.addHook('onClose', async () => { await worker.close(); });
  return worker;
}
