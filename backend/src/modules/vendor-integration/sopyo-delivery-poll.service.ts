import { Prisma, SopyoOrderPushStatus, VendorIntegrationProviderCode, VendorOutboundMethod } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { canonicalSopyoOrderId, recordVerifiedDeliveredObservation } from '../shipping/allocation-delivered-observation.service.js';
import { getDecryptedSopyoCredentialForInternalUse } from './sopyo-credential.service.js';
import { createSopyoDeliveryClient } from './sopyo-delivery.client.js';

export const SOPYO_DELIVERY_POLL_INTERVAL_MS = 60 * 1000;
export const SOPYO_CARGO_SHOPIFY_SYNC_INTERVAL_MS = 60 * 1000;

const candidateSelect = {
  id: true,
  assignedVendorId: true,
  trackingNumber: true,
  sopyoOrderPush: { select: {
    id: true, vendorAllocationId: true, assignedVendorId: true, orderCode: true,
    status: true, sopyoOrderId: true,
  } },
  vendorIntegrationShipmentEvents: {
    select: {
      id: true,
      trackingNumber: true,
      vendorIdentifier: true,
      client: { select: {
        id: true, vendorIdentifier: true, providerCode: true,
        enabled: true, revokedAt: true, scopes: true,
      } },
    },
  },
} satisfies Prisma.VendorAllocationSelect;

type Candidate = Prisma.VendorAllocationGetPayload<{ select: typeof candidateSelect }>;

function successfulPush(candidate: Candidate) {
  const push = candidate.sopyoOrderPush;
  if (!push || push.status !== SopyoOrderPushStatus.SUCCEEDED ||
      push.vendorAllocationId !== candidate.id || push.assignedVendorId !== candidate.assignedVendorId ||
      push.orderCode !== candidate.id || !canonicalSopyoOrderId(push.sopyoOrderId)) return null;
  return push;
}

function trackingMatchesPush(candidate: Candidate, orderId: number): boolean {
  if (!candidate.sopyoOrderPush) return true;
  const push = successfulPush(candidate);
  return push !== null && push.sopyoOrderId === String(orderId);
}

function tracking(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length <= 200 ? normalized : null;
}

function authority(candidate: Candidate): { trackingNumber: string; clientId: string | null } | null {
  const current = tracking(candidate.trackingNumber);
  if (!current) return null;
  const matches = candidate.vendorIntegrationShipmentEvents.filter((event) =>
    tracking(event.trackingNumber) === current &&
    event.vendorIdentifier === candidate.assignedVendorId &&
    event.client.vendorIdentifier === candidate.assignedVendorId &&
    event.client.providerCode === VendorIntegrationProviderCode.SOPYO &&
    event.client.enabled && event.client.revokedAt === null &&
    event.client.scopes.includes('shipment:write'));
  if (matches.length === 0) return null;
  // Keep ambiguous provenance in the tracking group: it must block a second
  // allocation with the same tracking from appearing uniquely correlated.
  return { trackingNumber: current, clientId: matches.length === 1 ? matches[0]!.client.id : null };
}

const sopyoUnobservedWhere = {
  outboundMethodSnapshot: VendorOutboundMethod.VENDOR_INTEGRATION,
  outboundIntegrationProviderSnapshot: VendorIntegrationProviderCode.SOPYO,
  deliveredObservation: null,
} satisfies Prisma.VendorAllocationWhereInput;

export type SopyoPollReport = {
  candidateCount: number;
  pushChecks: number;
  trackingChecks: number;
  observationsRecorded: number;
  ambiguousLocal: number;
  ambiguousProvider: number;
  failedVendors: number;
  failedLookups: number;
};

/** Poll only allocations whose frozen authority and shipment-event provenance are Sopyo. */
export async function pollSopyoDeliveredOrders(
  options: { db?: typeof prisma; fetcher?: typeof fetch } = {},
): Promise<SopyoPollReport> {
  const db = options.db ?? prisma;
  const client = createSopyoDeliveryClient(options.fetcher);
  const report: SopyoPollReport = {
    candidateCount: 0, pushChecks: 0, trackingChecks: 0, observationsRecorded: 0,
    ambiguousLocal: 0, ambiguousProvider: 0, failedVendors: 0, failedLookups: 0,
  };
  const credentials = await db.sopyoVendorCredential.findMany({ select: { vendorId: true } });
  if (credentials.length === 0) return report;
  const allocations = await db.vendorAllocation.findMany({
    where: { ...sopyoUnobservedWhere, assignedVendorId: { in: credentials.map((row) => row.vendorId) } },
    select: candidateSelect,
  });
  const byVendor = new Map<string, Map<string, Candidate[]>>();
  const pushByVendor = new Map<string, Candidate[]>();
  for (const allocation of allocations) {
    if (successfulPush(allocation)) {
      const group = pushByVendor.get(allocation.assignedVendorId) ?? [];
      group.push(allocation);
      pushByVendor.set(allocation.assignedVendorId, group);
      report.candidateCount += 1;
    }
    const proven = authority(allocation);
    if (!proven) continue;
    if (!allocation.sopyoOrderPush) report.candidateCount += 1;
    const byTracking = byVendor.get(allocation.assignedVendorId) ?? new Map<string, Candidate[]>();
    const group = byTracking.get(proven.trackingNumber) ?? [];
    group.push(allocation);
    byTracking.set(proven.trackingNumber, group);
    byVendor.set(allocation.assignedVendorId, byTracking);
  }

  const vendorIds = new Set([...pushByVendor.keys(), ...byVendor.keys()]);
  for (const vendorId of vendorIds) {
    const byTracking = byVendor.get(vendorId) ?? new Map<string, Candidate[]>();
    let bearer: string;
    try {
      const apiToken = await getDecryptedSopyoCredentialForInternalUse(vendorId, db);
      bearer = await client.authenticate(apiToken);
    } catch {
      report.failedVendors += 1;
      continue;
    }
    for (const candidate of pushByVendor.get(vendorId) ?? []) {
      const push = successfulPush(candidate);
      if (!push) continue;
      report.pushChecks += 1;
      try {
        const order = await client.orderById(bearer, push.sopyoOrderId!);
        if (String(order.id) !== push.sopyoOrderId || order.orderCode !== push.orderCode ||
            order.orderType !== 'SOPYOAPI' || order.orderStatus !== 6) continue;
        const inserted = await db.$transaction(async (tx) => {
          const current = await tx.vendorAllocation.findFirst({
            where: { ...sopyoUnobservedWhere, id: candidate.id }, select: candidateSelect,
          });
          const currentPush = current && successfulPush(current);
          if (!currentPush || currentPush.id !== push.id ||
              currentPush.sopyoOrderId !== String(order.id)) return false;
          await recordVerifiedDeliveredObservation({
            allocationId: current.id,
            source: { method: 'VENDOR_INTEGRATION', providerCode: 'SOPYO',
              pushId: currentPush.id, sourceReference: String(order.id) },
          }, tx);
          return true;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        if (inserted) report.observationsRecorded += 1;
      } catch {
        report.failedLookups += 1;
      }
    }
    for (const [number, localMatches] of byTracking) {
      if (localMatches.length !== 1 || !authority(localMatches[0]!)?.clientId) {
        report.ambiguousLocal += 1;
        continue;
      }
      if (localMatches[0]!.sopyoOrderPush && !successfulPush(localMatches[0]!)) continue;
      report.trackingChecks += 1;
      try {
        const orders = await client.ordersByTracking(bearer, number);
        if (orders.length > 1) {
          report.ambiguousProvider += 1;
          continue;
        }
        if (orders.length !== 1 || orders[0]!.orderStatus !== 6 ||
            !trackingMatchesPush(localMatches[0]!, orders[0]!.id)) continue;
        // Recheck current tracking and provenance at the write boundary. The
        // canonical recorder supplies the unique immutable database claim.
        const inserted = await db.$transaction(async (tx) => {
          const current = await tx.vendorAllocation.findMany({
            where: { ...sopyoUnobservedWhere, assignedVendorId: vendorId },
            select: candidateSelect,
          });
          const exact = current.map((row) => ({ row, proven: authority(row) }))
            .filter((item) => item.proven?.trackingNumber === number);
          if (exact.length !== 1 || !exact[0]!.proven?.clientId ||
              !trackingMatchesPush(exact[0]!.row, orders[0]!.id)) return false;
          await recordVerifiedDeliveredObservation({
            allocationId: exact[0]!.row.id,
            source: {
              method: 'VENDOR_INTEGRATION', providerCode: 'SOPYO',
              clientId: exact[0]!.proven.clientId,
              sourceReference: String(orders[0]!.id),
            },
          }, tx);
          return true;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        if (inserted) report.observationsRecorded += 1;
      } catch {
        // Never include provider errors, raw responses, credentials or tracking in diagnostics.
        report.failedLookups += 1;
      }
    }
  }
  return report;
}

/** Dedicated Sopyo scheduler: other providers may have different intake mechanisms. */
export function registerSopyoDeliveryPollScheduler(app: FastifyInstance, env: AppEnv) {
  if (!env.SOPYO_DELIVERY_POLLING_ENABLED) return;
  let running = false;
  const interval = globalThis.setInterval(() => {
    if (running) return;
    running = true;
    void pollSopyoDeliveredOrders()
      .then((report) => app.log.info(report, 'Sopyo delivery polling completed.'))
      .catch(() => app.log.error({ category: 'POLL_FAILED' }, 'Sopyo delivery polling failed.'))
      .finally(() => { running = false; });
  }, SOPYO_DELIVERY_POLL_INTERVAL_MS);
  interval.unref?.();
  app.addHook('onClose', (_instance, done) => {
    globalThis.clearInterval(interval);
    done();
  });
}
