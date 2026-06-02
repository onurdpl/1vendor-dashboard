import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { VendorIntegrationContext } from './vendor-integration.types.js';

const SHIPPED_STATUS = 'In Transit';

export type VendorIntegrationShipmentInput = {
  allocationId: string;
  context: VendorIntegrationContext;
  idempotencyKey: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string | null;
  shippedAt?: string | null;
  requestId?: string | null;
};

export type VendorIntegrationShipmentResult = {
  idempotent: boolean;
  allocation: {
    id: string;
    vendorIdentifier: string;
    carrier: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    shippedAt: string | null;
    shippingStatus: string;
    lastVendorIntegrationShipmentRequestId: string | null;
  };
};

type VendorIntegrationShipmentDb = Pick<
  Prisma.TransactionClient,
  'vendorAllocation' | 'vendorIntegrationShipmentEvent'
>;

function normalizeRequiredText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 200) : null;
}

function normalizeTrackingUrl(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 1000) : null;
}

function parseShippedAt(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function serializeShipment(allocation: {
  id: string;
  assignedVendorId: string;
  carrier: string | null;
  trackingNumber: string | null;
  vendorIntegrationTrackingUrl: string | null;
  vendorIntegrationShippedAt: Date | null;
  shippingStatus: string;
  lastVendorIntegrationShipmentRequestId: string | null;
}) {
  return {
    id: allocation.id,
    vendorIdentifier: allocation.assignedVendorId,
    carrier: allocation.carrier,
    trackingNumber: allocation.trackingNumber,
    trackingUrl: allocation.vendorIntegrationTrackingUrl,
    shippedAt: allocation.vendorIntegrationShippedAt?.toISOString() ?? null,
    shippingStatus: allocation.shippingStatus,
    lastVendorIntegrationShipmentRequestId: allocation.lastVendorIntegrationShipmentRequestId,
  };
}

export function validateVendorIntegrationShipmentPayload(input: {
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  shippedAt?: string | null;
}) {
  const carrier = normalizeRequiredText(input.carrier);
  const trackingNumber = normalizeRequiredText(input.trackingNumber);
  const trackingUrl = normalizeTrackingUrl(input.trackingUrl);
  const shippedAt = parseShippedAt(input.shippedAt);

  if (!carrier) {
    return { ok: false as const, message: 'carrier is required.' };
  }

  if (!trackingNumber) {
    return { ok: false as const, message: 'trackingNumber is required.' };
  }

  if (shippedAt === undefined) {
    return { ok: false as const, message: 'shippedAt must be a valid ISO date when provided.' };
  }

  return {
    ok: true as const,
    shipment: {
      carrier,
      trackingNumber,
      trackingUrl,
      shippedAt,
    },
  };
}

export async function updateVendorIntegrationOrderShipment(
  input: VendorIntegrationShipmentInput,
  db: VendorIntegrationShipmentDb = prisma,
): Promise<VendorIntegrationShipmentResult | null> {
  const existingEvent = await db.vendorIntegrationShipmentEvent.findUnique({
    where: {
      clientId_vendorAllocationId_idempotencyKey: {
        clientId: input.context.clientId,
        vendorAllocationId: input.allocationId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: {
      vendorAllocation: {
        select: {
          id: true,
          assignedVendorId: true,
          carrier: true,
          trackingNumber: true,
          vendorIntegrationTrackingUrl: true,
          vendorIntegrationShippedAt: true,
          shippingStatus: true,
          lastVendorIntegrationShipmentRequestId: true,
        },
      },
    },
  });

  if (existingEvent) {
    return {
      idempotent: true,
      allocation: serializeShipment(existingEvent.vendorAllocation),
    };
  }

  const allocation = await db.vendorAllocation.findFirst({
    where: {
      id: input.allocationId,
      assignedVendorId: input.context.vendorIdentifier,
    },
    select: {
      id: true,
      assignedVendorId: true,
    },
  });

  if (!allocation) {
    return null;
  }

  const shippedAt = parseShippedAt(input.shippedAt);
  const updated = await db.vendorAllocation.update({
    where: {
      id: allocation.id,
    },
    data: {
      carrier: normalizeRequiredText(input.carrier),
      trackingNumber: normalizeRequiredText(input.trackingNumber),
      vendorIntegrationTrackingUrl: normalizeTrackingUrl(input.trackingUrl),
      vendorIntegrationShippedAt: shippedAt ?? null,
      shippingStatus: SHIPPED_STATUS,
      lastVendorIntegrationShipmentRequestId: input.requestId ?? null,
    },
    select: {
      id: true,
      assignedVendorId: true,
      carrier: true,
      trackingNumber: true,
      vendorIntegrationTrackingUrl: true,
      vendorIntegrationShippedAt: true,
      shippingStatus: true,
      lastVendorIntegrationShipmentRequestId: true,
    },
  });

  await db.vendorIntegrationShipmentEvent.create({
    data: {
      clientId: input.context.clientId,
      vendorAllocationId: allocation.id,
      vendorIdentifier: input.context.vendorIdentifier,
      providerName: input.context.providerName,
      carrier: updated.carrier ?? '',
      trackingNumber: updated.trackingNumber ?? '',
      trackingUrl: updated.vendorIntegrationTrackingUrl,
      shippedAt: updated.vendorIntegrationShippedAt,
      idempotencyKey: input.idempotencyKey,
      requestId: input.requestId ?? null,
    },
    select: {
      id: true,
    },
  });

  return {
    idempotent: false,
    allocation: serializeShipment(updated),
  };
}
