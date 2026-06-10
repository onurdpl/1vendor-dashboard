import { FinanceEventType } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

const SALE_EVENT_TYPES = [
  FinanceEventType.SALE_RECORDED,
  FinanceEventType.COMMISSION_RESERVED,
  FinanceEventType.COMMISSION_VAT_RESERVED,
  FinanceEventType.VENDOR_PAYABLE_RESERVED,
] as const;

const REFUND_EVENT_TYPES = [
  FinanceEventType.REFUND_RECORDED,
  FinanceEventType.COMMISSION_REVERSED,
  FinanceEventType.VENDOR_PAYABLE_REVERSED,
] as const;

type BackfillClassification =
  | 'safe_sale_backfill'
  | 'safe_refund_backfill_with_matching_sale'
  | 'unsafe_refund_missing_matching_sale'
  | 'existing_event_needs_relink_by_idempotency'
  | 'already_complete';

type FinanceEventTypeValue = `${FinanceEventType}`;

type FinanceEventBackfillSample = {
  financeLedgerEntryId: string;
  vendorId: string;
  type: string;
  shopifyOrderId: string | null;
  amount: string;
  missingEventTypes: FinanceEventTypeValue[];
  reason: string;
};

export type FinanceEventBackfillPlan = {
  ok: true;
  writesPerformed: false;
  summary: {
    financeLedgerRows: number;
    financeEvents: number;
    safeSaleBackfillRows: number;
    safeRefundBackfillRows: number;
    unsafeRefundRows: number;
    relinkCandidateEvents: number;
    alreadyCompleteRows: number;
  };
  samples: {
    safeSaleBackfill: FinanceEventBackfillSample[];
    safeRefundBackfill: FinanceEventBackfillSample[];
    unsafeRefundMissingSale: FinanceEventBackfillSample[];
    existingEventNeedsRelink: FinanceEventBackfillSample[];
  };
  warnings: string[];
};

type PlannerLedgerRow = {
  id: string;
  vendorId: string;
  entryType: string;
  amount: unknown;
  vendorAllocationId: string | null;
  commissionPercentSnapshot: unknown;
  commissionVatPercentSnapshot: unknown;
  vendorAllocation: {
    id: string;
    sourceShopifyOrderId: string;
    sourceShopifyOrderNumber: string;
    order: {
      id: string;
      sourceShopifyOrderId: string;
      currency: string | null;
    } | null;
  } | null;
  financeEvents: Array<{
    eventType: FinanceEventType;
    idempotencyKey: string;
    financeLedgerEntryId: string | null;
  }>;
};

type PlannerEventRow = {
  id: string;
  eventType: FinanceEventType;
  financeLedgerEntryId: string | null;
  idempotencyKey: string;
};

function normalizeEntryType(value: string) {
  return value.trim().toLowerCase();
}

function amountToString(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '0.00';
}

function expectedEventTypes(entryType: string): FinanceEventType[] {
  const normalized = normalizeEntryType(entryType);
  if (normalized === 'sale') {
    return [...SALE_EVENT_TYPES];
  }
  if (normalized === 'refund') {
    return [...REFUND_EVENT_TYPES];
  }
  return [];
}

function idempotencyKeyFor(financeLedgerEntryId: string, eventType: FinanceEventType) {
  return `${financeLedgerEntryId}:${eventType}`;
}

function toSample(input: {
  row: PlannerLedgerRow;
  missingEventTypes: FinanceEventType[];
  reason: string;
}): FinanceEventBackfillSample {
  return {
    financeLedgerEntryId: input.row.id,
    vendorId: input.row.vendorId,
    type: normalizeEntryType(input.row.entryType),
    shopifyOrderId:
      input.row.vendorAllocation?.order?.sourceShopifyOrderId ??
      input.row.vendorAllocation?.sourceShopifyOrderId ??
      null,
    amount: amountToString(input.row.amount),
    missingEventTypes: input.missingEventTypes.map((eventType) => eventType),
    reason: input.reason,
  };
}

function pushSample<T>(items: T[], item: T) {
  if (items.length < 10) {
    items.push(item);
  }
}

export async function getFinanceEventBackfillPlan(): Promise<FinanceEventBackfillPlan> {
  const [ledgerRows, financeEvents] = await Promise.all([
    prisma.financeLedgerEntry.findMany({
      where: {
        entryType: {
          in: ['sale', 'refund'],
        },
      },
      select: {
        id: true,
        vendorId: true,
        entryType: true,
        amount: true,
        vendorAllocationId: true,
        commissionPercentSnapshot: true,
        commissionVatPercentSnapshot: true,
        vendorAllocation: {
          select: {
            id: true,
            sourceShopifyOrderId: true,
            sourceShopifyOrderNumber: true,
            order: {
              select: {
                id: true,
                sourceShopifyOrderId: true,
                currency: true,
              },
            },
          },
        },
        financeEvents: {
          select: {
            eventType: true,
            idempotencyKey: true,
            financeLedgerEntryId: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    }),
    prisma.financeEvent.findMany({
      select: {
        id: true,
        eventType: true,
        financeLedgerEntryId: true,
        idempotencyKey: true,
      },
    }),
  ]);

  const saleRowsByVendorAllocation = new Map<string, PlannerLedgerRow>();
  for (const row of ledgerRows as PlannerLedgerRow[]) {
    if (normalizeEntryType(row.entryType) === 'sale' && row.vendorAllocationId) {
      saleRowsByVendorAllocation.set(`${row.vendorId}:${row.vendorAllocationId}`, row);
    }
  }

  const eventByIdempotencyKey = new Map<string, PlannerEventRow>();
  let relinkCandidateEvents = 0;
  for (const event of financeEvents as PlannerEventRow[]) {
    eventByIdempotencyKey.set(event.idempotencyKey, event);
  }

  let safeSaleBackfillRows = 0;
  let safeRefundBackfillRows = 0;
  let unsafeRefundRows = 0;
  let alreadyCompleteRows = 0;
  let rowsRequiringCurrencyFallback = 0;
  const classifications = new Map<string, Set<BackfillClassification>>();
  const samples: FinanceEventBackfillPlan['samples'] = {
    safeSaleBackfill: [],
    safeRefundBackfill: [],
    unsafeRefundMissingSale: [],
    existingEventNeedsRelink: [],
  };

  for (const row of ledgerRows as PlannerLedgerRow[]) {
    const expectedTypes = expectedEventTypes(row.entryType);
    const linkedEventTypes = new Set(row.financeEvents.map((event) => event.eventType));
    const missingLinkedEventTypes = expectedTypes.filter((eventType) => !linkedEventTypes.has(eventType));
    const existingByKey = expectedTypes
      .map((eventType) => eventByIdempotencyKey.get(idempotencyKeyFor(row.id, eventType)))
      .filter((event): event is PlannerEventRow => Boolean(event));
    const nullLinkedEvents = existingByKey.filter((event) => event.financeLedgerEntryId === null);
    const missingByIdempotency = expectedTypes.filter(
      (eventType) => !eventByIdempotencyKey.has(idempotencyKeyFor(row.id, eventType)),
    );
    const rowClasses = new Set<BackfillClassification>();
    classifications.set(row.id, rowClasses);

    if (row.vendorAllocation?.order?.currency === null || row.vendorAllocation?.order?.currency === undefined) {
      rowsRequiringCurrencyFallback += 1;
    }

    if (missingLinkedEventTypes.length === 0) {
      alreadyCompleteRows += 1;
      rowClasses.add('already_complete');
      continue;
    }

    if (nullLinkedEvents.length > 0) {
      relinkCandidateEvents += nullLinkedEvents.length;
      rowClasses.add('existing_event_needs_relink_by_idempotency');
      pushSample(
        samples.existingEventNeedsRelink,
        toSample({
          row,
          missingEventTypes: nullLinkedEvents.map((event) => event.eventType),
          reason: 'Existing FinanceEvent idempotency keys match this ledger row, but financeLedgerEntryId is null.',
        }),
      );
    }

    const type = normalizeEntryType(row.entryType);
    if (type === 'sale' && missingByIdempotency.length > 0) {
      safeSaleBackfillRows += 1;
      rowClasses.add('safe_sale_backfill');
      pushSample(
        samples.safeSaleBackfill,
        toSample({
          row,
          missingEventTypes: missingByIdempotency,
          reason: row.vendorAllocation?.order?.currency
            ? 'Sale amount and immutable commission snapshots are available.'
            : 'Sale amount and immutable commission snapshots are available; currency would use TRY fallback.',
        }),
      );
    }

    if (type === 'refund') {
      const matchingSale = row.vendorAllocationId
        ? saleRowsByVendorAllocation.get(`${row.vendorId}:${row.vendorAllocationId}`)
        : null;

      if (!matchingSale) {
        unsafeRefundRows += 1;
        rowClasses.add('unsafe_refund_missing_matching_sale');
        pushSample(
          samples.unsafeRefundMissingSale,
          toSample({
            row,
            missingEventTypes: missingByIdempotency,
            reason: 'Refund commission reversal cannot be reconstructed because no matching sale ledger row exists for this vendor allocation.',
          }),
        );
      } else if (missingByIdempotency.length > 0) {
        safeRefundBackfillRows += 1;
        rowClasses.add('safe_refund_backfill_with_matching_sale');
        pushSample(
          samples.safeRefundBackfill,
          toSample({
            row,
            missingEventTypes: missingByIdempotency,
            reason: row.vendorAllocation?.order?.currency
              ? 'Refund amount and matching sale commission snapshots are available.'
              : 'Refund amount and matching sale commission snapshots are available; currency would use TRY fallback.',
          }),
        );
      }
    }
  }

  const warnings: string[] = [];
  if (rowsRequiringCurrencyFallback > 0) {
    warnings.push(`${rowsRequiringCurrencyFallback} ledger rows would require TRY currency fallback.`);
  }
  if (unsafeRefundRows > 0) {
    warnings.push(`${unsafeRefundRows} refund rows cannot be safely backfilled until matching sale ledger evidence is available or a fallback policy is approved.`);
  }
  if (relinkCandidateEvents > 0) {
    warnings.push(`${relinkCandidateEvents} existing FinanceEvent rows match ledger rows by idempotency key but have null financeLedgerEntryId.`);
  }

  return {
    ok: true,
    writesPerformed: false,
    summary: {
      financeLedgerRows: ledgerRows.length,
      financeEvents: financeEvents.length,
      safeSaleBackfillRows,
      safeRefundBackfillRows,
      unsafeRefundRows,
      relinkCandidateEvents,
      alreadyCompleteRows,
    },
    samples,
    warnings,
  };
}

export const __financeEventBackfillPlannerTesting = {
  expectedEventTypes,
  idempotencyKeyFor,
};
