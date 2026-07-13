import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { isFullOrderCancelled } from '../orders/full-order-cancellation-policy.js';
import { VendorIntegrationOrderStateError } from './vendor-integration.errors.js';
import type { VendorIntegrationContext } from './vendor-integration.types.js';

export type VendorIntegrationInvoiceInput = {
  allocationId: string;
  context: VendorIntegrationContext;
  idempotencyKey: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceUrl?: string | null;
  invoiceAmount: string;
  requestId?: string | null;
};

export type VendorIntegrationInvoiceResult = {
  idempotent: boolean;
  allocation: {
    id: string;
    vendorIdentifier: string;
    vendorInvoiceNumber: string | null;
    vendorInvoiceDate: string | null;
    vendorInvoiceUrl: string | null;
    vendorInvoiceAmount: string | null;
    vendorInvoiceReceivedAt: string | null;
    lastVendorIntegrationInvoiceRequestId: string | null;
  };
};

type VendorIntegrationInvoiceDb = Pick<
  Prisma.TransactionClient,
  'vendorAllocation' | 'vendorIntegrationInvoiceEvent'
>;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;

function normalizeRequiredText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 200) : null;
}

function normalizeUrl(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 1000) : null;
}

function parseInvoiceDate(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || !DATE_ONLY_PATTERN.test(normalized)) {
    return undefined;
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    return undefined;
  }

  return parsed;
}

function normalizeInvoiceAmount(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || !AMOUNT_PATTERN.test(normalized)) {
    return null;
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return normalized;
}

function toDateOnly(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toIsoDate(value: Date | null) {
  return value ? value.toISOString() : null;
}

function toDecimalString(value: Prisma.Decimal | null) {
  return value === null ? null : value.toString();
}

function serializeInvoice(allocation: {
  id: string;
  assignedVendorId: string;
  vendorInvoiceNumber: string | null;
  vendorInvoiceDate: Date | null;
  vendorInvoiceUrl: string | null;
  vendorInvoiceAmount: Prisma.Decimal | null;
  vendorInvoiceReceivedAt: Date | null;
  lastVendorIntegrationInvoiceRequestId: string | null;
}) {
  return {
    id: allocation.id,
    vendorIdentifier: allocation.assignedVendorId,
    vendorInvoiceNumber: allocation.vendorInvoiceNumber,
    vendorInvoiceDate: toDateOnly(allocation.vendorInvoiceDate),
    vendorInvoiceUrl: allocation.vendorInvoiceUrl,
    vendorInvoiceAmount: toDecimalString(allocation.vendorInvoiceAmount),
    vendorInvoiceReceivedAt: toIsoDate(allocation.vendorInvoiceReceivedAt),
    lastVendorIntegrationInvoiceRequestId: allocation.lastVendorIntegrationInvoiceRequestId,
  };
}

function assertAllocationIsOperational(allocation: {
  cancellationReason?: string | null;
  order?: { cancelledAt?: Date | null } | null;
}) {
  if (isFullOrderCancelled(allocation.order) || allocation.cancellationReason) {
    throw new VendorIntegrationOrderStateError('Order is cancelled and cannot receive invoice updates.');
  }
}

export function validateVendorIntegrationInvoicePayload(input: {
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  invoiceUrl?: string | null;
  invoiceAmount?: string | null;
}) {
  const invoiceNumber = normalizeRequiredText(input.invoiceNumber);
  const invoiceDate = parseInvoiceDate(input.invoiceDate);
  const invoiceUrl = normalizeUrl(input.invoiceUrl);
  const invoiceAmount = normalizeInvoiceAmount(input.invoiceAmount);

  if (!invoiceNumber) {
    return { ok: false as const, message: 'invoiceNumber is required.' };
  }

  if (!invoiceDate) {
    return { ok: false as const, message: 'invoiceDate must be a valid YYYY-MM-DD date.' };
  }

  if (!invoiceAmount) {
    return { ok: false as const, message: 'invoiceAmount must be a valid decimal amount.' };
  }

  return {
    ok: true as const,
    invoice: {
      invoiceNumber,
      invoiceDate,
      invoiceUrl,
      invoiceAmount,
    },
  };
}

export async function updateVendorIntegrationOrderInvoice(
  input: VendorIntegrationInvoiceInput,
  db: VendorIntegrationInvoiceDb = prisma,
): Promise<VendorIntegrationInvoiceResult | null> {
  const existingEvent = await db.vendorIntegrationInvoiceEvent.findUnique({
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
          vendorInvoiceNumber: true,
          vendorInvoiceDate: true,
          vendorInvoiceUrl: true,
          vendorInvoiceAmount: true,
          vendorInvoiceReceivedAt: true,
          lastVendorIntegrationInvoiceRequestId: true,
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
      allocation: serializeInvoice(existingEvent.vendorAllocation),
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

  const invoiceDate = parseInvoiceDate(input.invoiceDate);
  const invoiceAmount = normalizeInvoiceAmount(input.invoiceAmount);
  if (!invoiceDate || !invoiceAmount) {
    throw new Error('Validated invoice payload became invalid before persistence.');
  }

  const updated = await db.vendorAllocation.update({
    where: {
      id: allocation.id,
    },
    data: {
      vendorInvoiceNumber: normalizeRequiredText(input.invoiceNumber),
      vendorInvoiceDate: invoiceDate,
      vendorInvoiceUrl: normalizeUrl(input.invoiceUrl),
      vendorInvoiceAmount: new Prisma.Decimal(invoiceAmount),
      vendorInvoiceReceivedAt: new Date(),
      lastVendorIntegrationInvoiceRequestId: input.requestId ?? null,
    },
    select: {
      id: true,
      assignedVendorId: true,
      vendorInvoiceNumber: true,
      vendorInvoiceDate: true,
      vendorInvoiceUrl: true,
      vendorInvoiceAmount: true,
      vendorInvoiceReceivedAt: true,
      lastVendorIntegrationInvoiceRequestId: true,
    },
  });

  await db.vendorIntegrationInvoiceEvent.create({
    data: {
      clientId: input.context.clientId,
      vendorAllocationId: allocation.id,
      vendorIdentifier: input.context.vendorIdentifier,
      providerName: input.context.providerName,
      invoiceNumber: updated.vendorInvoiceNumber ?? '',
      invoiceDate: updated.vendorInvoiceDate ?? invoiceDate,
      invoiceUrl: updated.vendorInvoiceUrl,
      invoiceAmount: updated.vendorInvoiceAmount ?? new Prisma.Decimal(invoiceAmount),
      idempotencyKey: input.idempotencyKey,
      requestId: input.requestId ?? null,
    },
    select: {
      id: true,
    },
  });

  return {
    idempotent: false,
    allocation: serializeInvoice(updated),
  };
}
