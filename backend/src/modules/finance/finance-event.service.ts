import { FinanceEventType, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

type FinanceEventTransaction = Prisma.TransactionClient;

export type CreateFinanceEventInput = {
  vendorId: string;
  shopifyOrderId?: string | null;
  financeLedgerEntryId?: string | null;
  eventType: FinanceEventType;
  amountMinor: number;
  currency?: string;
  referenceType: string;
  referenceId: string;
  metadataJson?: Prisma.InputJsonValue | null;
  createdBy: string;
  idempotencyKey: string;
};

function normalizeAmountMinor(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error('amountMinor must be finite.');
  }

  return Math.round(value);
}

function toCreateData(input: CreateFinanceEventInput) {
  return {
    vendorId: input.vendorId,
    shopifyOrderId: input.shopifyOrderId ?? null,
    financeLedgerEntryId: input.financeLedgerEntryId ?? null,
    eventType: input.eventType,
    amountMinor: normalizeAmountMinor(input.amountMinor),
    currency: input.currency ?? 'TRY',
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    metadataJson: input.metadataJson ?? Prisma.JsonNull,
    createdBy: input.createdBy,
    idempotencyKey: input.idempotencyKey,
  };
}

export async function createEvent(
  input: CreateFinanceEventInput,
  tx: FinanceEventTransaction = prisma,
) {
  return tx.financeEvent.create({
    data: toCreateData(input),
  });
}

export async function createEventsIdempotently(
  inputs: CreateFinanceEventInput[],
  tx: FinanceEventTransaction = prisma,
) {
  if (inputs.length === 0) {
    return { count: 0 };
  }

  return tx.financeEvent.createMany({
    data: inputs.map(toCreateData),
    skipDuplicates: true,
  });
}

export async function eventExistsByIdempotencyKey(
  idempotencyKey: string,
  tx: FinanceEventTransaction = prisma,
) {
  const event = await tx.financeEvent.findUnique({
    where: {
      idempotencyKey,
    },
    select: {
      id: true,
    },
  });

  return Boolean(event);
}

export async function getEventsForVendor(vendorId: string) {
  return prisma.financeEvent.findMany({
    where: {
      vendorId,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });
}

export async function getEventsForOrder(shopifyOrderId: string) {
  return prisma.financeEvent.findMany({
    where: {
      shopifyOrderId,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });
}

export const __financeEventTesting = {
  toCreateData,
};
