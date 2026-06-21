import { FinanceEventType, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  expectedFinanceEventTypes,
  financeEventIdempotencyKeyFor,
} from './finance-event-backfill-planner.service.js';
import { isLedgerVoided } from './active-ledger-policy.service.js';

type FinanceEventRelinkTransaction = Prisma.TransactionClient;

type RelinkLedgerRow = {
  id: string;
  vendorId: string;
  entryType: string;
  voidedAt?: Date | string | null;
};

type RelinkEventRow = {
  id: string;
  vendorId: string;
  eventType: FinanceEventType;
  financeLedgerEntryId: string | null;
  idempotencyKey: string;
};

export type FinanceEventRelinkSample = {
  financeEventId: string;
  financeLedgerEntryId: string;
  idempotencyKey: string;
  vendorId: string;
  eventType: `${FinanceEventType}`;
  reason: string;
};

export type FinanceEventRelinkPlan = {
  ok: true;
  writesPerformed: false;
  summary: {
    relinkCandidateEvents: number;
    affectedLedgerRows: number;
  };
  samples: FinanceEventRelinkSample[];
};

export type FinanceEventRelinkExecutionResult = {
  ok: true;
  writesPerformed: boolean;
  summary: {
    relinkCandidateEvents: number;
    affectedLedgerRows: number;
    relinkedEvents: number;
    skippedEvents: number;
  };
  samples: FinanceEventRelinkSample[];
};

function buildExpectedEventKeyIndex(ledgerRows: RelinkLedgerRow[]) {
  const expectedRowsByKey = new Map<string, Array<{ ledgerRow: RelinkLedgerRow; eventType: FinanceEventType }>>();

  for (const ledgerRow of ledgerRows) {
    if (isLedgerVoided(ledgerRow)) {
      continue;
    }
    for (const eventType of expectedFinanceEventTypes(ledgerRow.entryType)) {
      const idempotencyKey = financeEventIdempotencyKeyFor(ledgerRow.id, eventType);
      const matches = expectedRowsByKey.get(idempotencyKey) ?? [];
      matches.push({ ledgerRow, eventType });
      expectedRowsByKey.set(idempotencyKey, matches);
    }
  }

  return expectedRowsByKey;
}

async function findRelinkCandidates(tx: FinanceEventRelinkTransaction = prisma) {
  const [ledgerRows, nullLinkedEvents] = await Promise.all([
    tx.financeLedgerEntry.findMany({
      where: {
        entryType: {
          in: ['sale', 'refund'],
        },
      },
      select: {
        id: true,
        vendorId: true,
        entryType: true,
        voidedAt: true,
      },
    }),
    tx.financeEvent.findMany({
      where: {
        financeLedgerEntryId: null,
      },
      select: {
        id: true,
        vendorId: true,
        eventType: true,
        financeLedgerEntryId: true,
        idempotencyKey: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    }),
  ]);

  const expectedRowsByKey = buildExpectedEventKeyIndex(ledgerRows as RelinkLedgerRow[]);
  const candidates: FinanceEventRelinkSample[] = [];

  for (const event of nullLinkedEvents as RelinkEventRow[]) {
    if (event.financeLedgerEntryId !== null) {
      continue;
    }

    const matches = expectedRowsByKey.get(event.idempotencyKey) ?? [];
    if (matches.length !== 1) {
      continue;
    }

    const match = matches[0];
    if (!match || match.ledgerRow.vendorId !== event.vendorId || match.eventType !== event.eventType) {
      continue;
    }

    candidates.push({
      financeEventId: event.id,
      financeLedgerEntryId: match.ledgerRow.id,
      idempotencyKey: event.idempotencyKey,
      vendorId: event.vendorId,
      eventType: event.eventType,
      reason: 'Existing FinanceEvent idempotency key, vendorId, and eventType match this ledger row; only financeLedgerEntryId is null.',
    });
  }

  return candidates;
}

function affectedLedgerRowCount(samples: FinanceEventRelinkSample[]) {
  return new Set(samples.map((sample) => sample.financeLedgerEntryId)).size;
}

export async function getFinanceEventRelinkPlan(): Promise<FinanceEventRelinkPlan> {
  const samples = await findRelinkCandidates();

  return {
    ok: true,
    writesPerformed: false,
    summary: {
      relinkCandidateEvents: samples.length,
      affectedLedgerRows: affectedLedgerRowCount(samples),
    },
    samples,
  };
}

export async function relinkExistingFinanceEvents(): Promise<FinanceEventRelinkExecutionResult> {
  return prisma.$transaction(async (tx) => {
    const samples = await findRelinkCandidates(tx);
    let relinkedEvents = 0;

    for (const sample of samples) {
      const result = await tx.financeEvent.updateMany({
        where: {
          id: sample.financeEventId,
          financeLedgerEntryId: null,
          idempotencyKey: sample.idempotencyKey,
          vendorId: sample.vendorId,
          eventType: sample.eventType,
        },
        data: {
          financeLedgerEntryId: sample.financeLedgerEntryId,
        },
      });
      relinkedEvents += result.count;
    }

    return {
      ok: true,
      writesPerformed: relinkedEvents > 0,
      summary: {
        relinkCandidateEvents: samples.length,
        affectedLedgerRows: affectedLedgerRowCount(samples),
        relinkedEvents,
        skippedEvents: samples.length - relinkedEvents,
      },
      samples,
    };
  });
}

export const __financeEventRelinkTesting = {
  findRelinkCandidates,
};
