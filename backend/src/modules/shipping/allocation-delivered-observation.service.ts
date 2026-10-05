import {
  Prisma,
  ShipmentExecutionStatus,
  ShippingProvider,
  SopyoOrderPushStatus,
  VendorIntegrationProviderCode,
  VendorOutboundMethod,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';

// Internal boundary only: callers must have verified DELIVERED from the named source.
// No public status/tracking value is normalized here.
export type VerifiedDeliveredSource =
  | { method: 'KARGONOMI'; shipmentExecutionId: string; sourceReference: string }
  | { method: 'VENDOR_INTEGRATION'; providerCode: 'SOPYO'; clientId: string; pushId?: never; sourceReference: string }
  | { method: 'VENDOR_INTEGRATION'; providerCode: 'SOPYO'; pushId: string; clientId?: never; sourceReference: string };

export class DeliveredObservationSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveredObservationSourceError';
  }
}

type ObservationDb = Pick<
  Prisma.TransactionClient,
  'vendorAllocation' | 'shipmentExecution' | 'vendorIntegrationClient' | 'sopyoOrderPush' | 'allocationDeliveredObservation'
>;

export function canonicalSopyoOrderId(value: string | null | undefined): string | null {
  if (!value || !/^[1-9]\d{0,15}$/.test(value)) return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && String(numeric) === value ? value : null;
}

export async function recordVerifiedDeliveredObservation(
  input: { allocationId: string; source: VerifiedDeliveredSource },
  db: ObservationDb = prisma,
) {
  const sourceReference = input.source.sourceReference.trim();
  if (!sourceReference || sourceReference.length > 256) {
    throw new DeliveredObservationSourceError('A bounded provider source reference is required.');
  }

  const allocation = await db.vendorAllocation.findUnique({
    where: { id: input.allocationId },
    select: {
      assignedVendorId: true,
      outboundMethodSnapshot: true,
      outboundIntegrationProviderSnapshot: true,
    },
  });
  if (!allocation || allocation.outboundMethodSnapshot !== input.source.method ||
      (input.source.method === 'KARGONOMI' && allocation.outboundIntegrationProviderSnapshot !== null) ||
      (input.source.method === 'VENDOR_INTEGRATION' && allocation.outboundIntegrationProviderSnapshot !== input.source.providerCode)) {
    throw new DeliveredObservationSourceError('Delivered source does not match the allocation outbound snapshot.');
  }

  let shipmentExecutionId: string | null = null;
  let vendorIntegrationClientId: string | null = null;
  let sopyoOrderPushId: string | null = null;
  let providerCode: VendorIntegrationProviderCode | null = null;
  if (input.source.method === 'KARGONOMI') {
    const execution = await db.shipmentExecution.findUnique({
      where: { id: input.source.shipmentExecutionId },
      select: { allocationId: true, vendorId: true, provider: true, shipmentStatus: true, providerShipmentId: true },
    });
    if (!execution || execution.allocationId !== input.allocationId ||
        execution.vendorId !== allocation.assignedVendorId ||
        execution.provider !== ShippingProvider.KARGONOMI ||
        execution.shipmentStatus !== ShipmentExecutionStatus.DELIVERED ||
        execution.providerShipmentId !== sourceReference) {
      throw new DeliveredObservationSourceError('Matching delivered Kargonomi execution is required.');
    }
    shipmentExecutionId = input.source.shipmentExecutionId;
  } else if (input.source.pushId) {
    const push = await db.sopyoOrderPush.findUnique({
      where: { id: input.source.pushId },
      select: { vendorAllocationId: true, assignedVendorId: true, orderCode: true, status: true, sopyoOrderId: true },
    });
    if (!push || push.vendorAllocationId !== input.allocationId ||
        push.assignedVendorId !== allocation.assignedVendorId || push.orderCode !== input.allocationId ||
        push.status !== SopyoOrderPushStatus.SUCCEEDED ||
        canonicalSopyoOrderId(push.sopyoOrderId) !== sourceReference) {
      throw new DeliveredObservationSourceError('Matching successful Sopyo push is required.');
    }
    providerCode = input.source.providerCode;
    sopyoOrderPushId = input.source.pushId;
  } else {
    const client = await db.vendorIntegrationClient.findUnique({
      where: { id: input.source.clientId },
      select: { vendorIdentifier: true, providerCode: true, enabled: true, revokedAt: true, scopes: true },
    });
    if (!client || client.vendorIdentifier !== allocation.assignedVendorId ||
        client.providerCode !== input.source.providerCode || !client.enabled ||
        client.revokedAt !== null || !client.scopes.includes('shipment:write')) {
      throw new DeliveredObservationSourceError('Matching active coded integration client is required.');
    }
    const push = await db.sopyoOrderPush.findUnique({
      where: { vendorAllocationId: input.allocationId },
      select: { assignedVendorId: true, orderCode: true, status: true, sopyoOrderId: true },
    });
    if (push && (push.status !== SopyoOrderPushStatus.SUCCEEDED ||
        push.assignedVendorId !== allocation.assignedVendorId || push.orderCode !== input.allocationId ||
        canonicalSopyoOrderId(push.sopyoOrderId) !== sourceReference)) {
      throw new DeliveredObservationSourceError('Tracking observation conflicts with Sopyo push identity.');
    }
    providerCode = input.source.providerCode;
    vendorIntegrationClientId = input.source.clientId!;
  }

  // PostgreSQL's allocation-unique index is the claim. ON CONFLICT DO NOTHING
  // waits for a concurrent winner without aborting the surrounding transaction.
  await db.allocationDeliveredObservation.createMany({
    data: [{
      vendorAllocationId: input.allocationId,
      outboundMethod: input.source.method as VendorOutboundMethod,
      outboundIntegrationProvider: providerCode,
      sourceReference,
      shipmentExecutionId,
      vendorIntegrationClientId,
      sopyoOrderPushId,
    }],
    skipDuplicates: true,
  });
  const observation = await db.allocationDeliveredObservation.findUniqueOrThrow({
    where: { vendorAllocationId: input.allocationId },
  });
  const sameSource = observation.outboundMethod === input.source.method &&
    observation.outboundIntegrationProvider === providerCode &&
    observation.sourceReference === sourceReference &&
    (input.source.method === 'VENDOR_INTEGRATION' || observation.shipmentExecutionId === shipmentExecutionId);
  if (!sameSource) {
    throw new DeliveredObservationSourceError('Conflicting delivered observation already exists for allocation.');
  }
  return observation;
}
