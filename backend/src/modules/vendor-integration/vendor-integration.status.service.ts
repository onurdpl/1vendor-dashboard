import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { isFullOrderCancelled } from '../orders/full-order-cancellation-policy.js';
import { VendorIntegrationOrderStateError } from './vendor-integration.errors.js';
import type { VendorIntegrationContext } from './vendor-integration.types.js';

export const VENDOR_INTEGRATION_STATUSES = [
  'acknowledged',
  'processing',
  'ready_to_ship',
  'failed',
  'cancelled',
] as const;

export type VendorIntegrationStatus = (typeof VENDOR_INTEGRATION_STATUSES)[number];

export type VendorIntegrationStatusInput = {
  allocationId: string;
  context: VendorIntegrationContext;
  idempotencyKey: string;
  status: string;
  message?: string | null;
  requestId?: string | null;
};

export type VendorIntegrationStatusResult = {
  idempotent: boolean;
  allocation: {
    id: string;
    vendorIdentifier: string;
    vendorIntegrationStatus: string | null;
    vendorIntegrationStatusMessage: string | null;
    vendorIntegrationStatusUpdatedAt: string | null;
    vendorIntegrationProvider: string | null;
    lastVendorIntegrationRequestId: string | null;
  };
};

const ALLOWED_STATUS_SET = new Set<string>(VENDOR_INTEGRATION_STATUSES);

export function isVendorIntegrationStatus(value: string): value is VendorIntegrationStatus {
  return ALLOWED_STATUS_SET.has(value);
}

function normalizeMessage(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 500) : null;
}

function serializeAllocationStatus(allocation: {
  id: string;
  assignedVendorId: string;
  vendorIntegrationStatus: string | null;
  vendorIntegrationStatusMessage: string | null;
  vendorIntegrationStatusUpdatedAt: Date | null;
  vendorIntegrationProvider: string | null;
  lastVendorIntegrationRequestId: string | null;
}) {
  return {
    id: allocation.id,
    vendorIdentifier: allocation.assignedVendorId,
    vendorIntegrationStatus: allocation.vendorIntegrationStatus,
    vendorIntegrationStatusMessage: allocation.vendorIntegrationStatusMessage,
    vendorIntegrationStatusUpdatedAt: allocation.vendorIntegrationStatusUpdatedAt?.toISOString() ?? null,
    vendorIntegrationProvider: allocation.vendorIntegrationProvider,
    lastVendorIntegrationRequestId: allocation.lastVendorIntegrationRequestId,
  };
}

function assertAllocationIsOperational(allocation: {
  cancellationReason?: string | null;
  order?: { cancelledAt?: Date | null } | null;
}) {
  if (isFullOrderCancelled(allocation.order) || allocation.cancellationReason) {
    throw new VendorIntegrationOrderStateError('Order is cancelled and cannot be updated.');
  }
}

export async function updateVendorIntegrationOrderStatus(
  input: VendorIntegrationStatusInput,
  db: Pick<Prisma.TransactionClient, 'vendorAllocation' | 'vendorIntegrationStatusEvent'> = prisma,
): Promise<VendorIntegrationStatusResult | null> {
  const existingEvent = await db.vendorIntegrationStatusEvent.findUnique({
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
          vendorIntegrationStatus: true,
          vendorIntegrationStatusMessage: true,
          vendorIntegrationStatusUpdatedAt: true,
          vendorIntegrationProvider: true,
          lastVendorIntegrationRequestId: true,
          cancellationReason: true,
          order: {
            select: {
              cancelledAt: true,
            },
          },
        },
      },
    },
  });

  if (existingEvent) {
    return {
      idempotent: true,
      allocation: serializeAllocationStatus(existingEvent.vendorAllocation),
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
      cancellationReason: true,
      order: {
        select: {
          cancelledAt: true,
        },
      },
    },
  });

  if (!allocation) {
    return null;
  }
  assertAllocationIsOperational(allocation);

  const now = new Date();
  const message = normalizeMessage(input.message);
  const updated = await db.vendorAllocation.update({
    where: {
      id: allocation.id,
    },
    data: {
      vendorIntegrationStatus: input.status,
      vendorIntegrationStatusMessage: message,
      vendorIntegrationStatusUpdatedAt: now,
      vendorIntegrationProvider: input.context.providerName,
      lastVendorIntegrationRequestId: input.requestId ?? null,
    },
    select: {
      id: true,
      assignedVendorId: true,
      vendorIntegrationStatus: true,
      vendorIntegrationStatusMessage: true,
      vendorIntegrationStatusUpdatedAt: true,
      vendorIntegrationProvider: true,
      lastVendorIntegrationRequestId: true,
    },
  });

  await db.vendorIntegrationStatusEvent.create({
    data: {
      clientId: input.context.clientId,
      vendorAllocationId: allocation.id,
      vendorIdentifier: input.context.vendorIdentifier,
      providerName: input.context.providerName,
      status: input.status,
      message,
      idempotencyKey: input.idempotencyKey,
      requestId: input.requestId ?? null,
    },
    select: {
      id: true,
    },
  });

  return {
    idempotent: false,
    allocation: serializeAllocationStatus(updated),
  };
}
