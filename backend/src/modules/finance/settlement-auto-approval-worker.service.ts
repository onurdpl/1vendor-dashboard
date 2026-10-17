import { createHash, randomUUID } from 'node:crypto';
import { SettlementApprovalStatus, SettlementDraftCreationOrigin } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { assessSettlementApprovalReadiness } from './settlement-approval.service.js';
import {
  approveSettlementDraftInternally,
  reconcileAutomaticApprovalAttempt,
  type AutoApprovalReconciliation,
} from './settlement-auto-approval.service.js';
import { recordAutoApprovalOperationalErrorBestEffort } from
  './settlement-auto-approval-operational-error.service.js';

type WorkerOutcome = {
  settlementApprovalId: string;
  attemptId: string | null;
  classification: AutoApprovalReconciliation['classification'];
  reasonCode: string;
};

const approvedOrigins = [
  SettlementDraftCreationOrigin.AUTONOMOUS_SCHEDULER,
  SettlementDraftCreationOrigin.ADMIN_SCHEDULED,
  SettlementDraftCreationOrigin.ADMIN_MANUAL,
  SettlementDraftCreationOrigin.CONTROLLED_REPLACEMENT,
] as const;

type HeldLine = { lineId: string; ledgerId: string; allocationId: string };

/** Only a previously persisted, exact vendor-blocked hold can authorize this recovery probe. */
async function vendorHoldWasResolved(input: {
  settlementApprovalId: string; vendorId: string; reasonCode: string | null;
  reasonDetail: string | null; attemptId: string;
}): Promise<boolean> {
  if (!input.reasonDetail || !input.reasonCode) return false;
  const codes = input.reasonCode.split(',');
  if (!codes.includes('vendor_blocked_finance_hold_active') || codes.some((code) =>
    code !== 'vendor_blocked_finance_hold_active' && code !== 'settlement_row_not_eligible')) return false;
  let lines: HeldLine[];
  try {
    const evidence: unknown = JSON.parse(input.reasonDetail);
    if (!evidence || typeof evidence !== 'object' ||
        (evidence as { kind?: unknown }).kind !== 'VENDOR_BLOCKED_ALLOCATION_V1' ||
        !Array.isArray((evidence as { lines?: unknown }).lines)) return false;
    lines = (evidence as { lines: HeldLine[] }).lines;
  } catch { return false; }
  if (!lines.length || lines.some((line) => !line || typeof line.lineId !== 'string' ||
      !line.lineId || typeof line.ledgerId !== 'string' || !line.ledgerId ||
      typeof line.allocationId !== 'string' || !line.allocationId) ||
      new Set(lines.map((line) => line.lineId)).size !== lines.length) return false;
  const blockedEvent = await prisma.settlementAutoApprovalAttemptEvent.findFirst({
    where: { attemptId: input.attemptId, outcome: 'BLOCKED', reasonCode: input.reasonCode,
      reasonDetail: input.reasonDetail }, select: { id: true },
  });
  if (!blockedEvent) return false;
  const approval = await prisma.settlementApproval.findUnique({
    where: { id: input.settlementApprovalId },
    select: { vendorId: true, status: true, lines: { select: { id: true, financeLedgerEntryId: true } } },
  });
  if (!approval || approval.vendorId !== input.vendorId || approval.status !== 'DRAFT') return false;
  for (const line of lines) {
    if (!approval.lines.some((item) => item.id === line.lineId &&
        item.financeLedgerEntryId === line.ledgerId)) return false;
  }
  const ledgers = await prisma.financeLedgerEntry.findMany({
    where: { id: { in: lines.map((line) => line.ledgerId) } },
    select: { id: true, vendorId: true, vendorAllocationId: true,
      vendorAllocation: { select: { allocationStatus: true } } },
  });
  if (ledgers.length !== new Set(lines.map((line) => line.ledgerId)).size ||
      ledgers.some((ledger) => ledger.vendorId !== input.vendorId ||
        !lines.some((line) => line.ledgerId === ledger.id && line.allocationId === ledger.vendorAllocationId) ||
        ledger.vendorAllocation?.allocationStatus !== 'ACTIVE')) return false;
  const readiness = await assessSettlementApprovalReadiness(input.settlementApprovalId);
  return readiness?.vendorId === input.vendorId && readiness.status === 'DRAFT' &&
    readiness.sourceValidation.evaluated && readiness.sourceValidation.ok &&
    readiness.sourceValidation.reasons.length === 0;
}

/** Locally callable only. No startup, scheduler, route, or UI registers this worker. */
export async function runAutomaticSettlementApprovalWorker(input: { vendorId: string }): Promise<{
  vendorId: string;
  candidatesChecked: number;
  outcomes: WorkerOutcome[];
}> {
  const vendorId = input.vendorId?.trim();
  if (!vendorId || vendorId !== input.vendorId) {
    throw new Error('Automatic settlement approval worker requires an exact vendor identity.');
  }
  const drafts = await prisma.settlementApproval.findMany({
    where: { vendorId, status: SettlementApprovalStatus.DRAFT },
    select: { id: true, creationOrigin: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  }).catch(async (error: unknown) => {
    await recordAutoApprovalOperationalErrorBestEffort({ phase: 'WORKER_PRE_ATTEMPT',
      category: 'DATABASE_READ_FAILED', error, vendorId });
    throw error;
  });
  const outcomes: WorkerOutcome[] = [];
  for (const draft of drafts) {
    if (!draft.creationOrigin || !approvedOrigins.includes(draft.creationOrigin as typeof approvedOrigins[number])) {
      outcomes.push({ settlementApprovalId: draft.id, attemptId: null,
        classification: 'BLOCKED', reasonCode: 'UNAPPROVED_DRAFT_ORIGIN' });
      continue;
    }
    const unresolved = await prisma.settlementAutoApprovalAttempt.findFirst({
      where: { settlementApprovalId: draft.id, vendorId,
        outcome: { in: ['STARTED', 'UNKNOWN'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true },
    }).catch(async (error: unknown) => {
      await recordAutoApprovalOperationalErrorBestEffort({ phase: 'WORKER_PRE_ATTEMPT',
        category: 'DATABASE_READ_FAILED', error, vendorId, settlementApprovalId: draft.id });
      throw error;
    });
    const previous = await prisma.settlementAutoApprovalAttempt.findFirst({
      where: { settlementApprovalId: draft.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, outcome: true, reasonCode: true, reasonDetail: true },
    }).catch(async (error: unknown) => {
      await recordAutoApprovalOperationalErrorBestEffort({ phase: 'WORKER_PRE_ATTEMPT',
        category: 'DATABASE_READ_FAILED', error, vendorId, settlementApprovalId: draft.id });
      throw error;
    });
    let attemptId = unresolved?.id ?? previous?.id ?? randomUUID();
    let createAttempt = !previous;
    if (!unresolved && previous?.outcome === 'BLOCKED') {
      try {
        if (await vendorHoldWasResolved({ settlementApprovalId: draft.id, vendorId,
          attemptId: previous.id, reasonCode: previous.reasonCode, reasonDetail: previous.reasonDetail })) {
          attemptId = `recovery:${createHash('sha256').update(previous.id).digest('hex')}`;
          createAttempt = true;
        }
      } catch (error) {
        await recordAutoApprovalOperationalErrorBestEffort({ phase: 'BLOCKED_RECOVERY_PROBE',
          category: 'RECONCILIATION_FAILED', error, vendorId,
          settlementApprovalId: draft.id, attemptId: previous.id }, false);
        outcomes.push({ settlementApprovalId: draft.id, attemptId: previous.id,
          classification: 'UNKNOWN', reasonCode: 'BLOCKED_RECOVERY_EVIDENCE_UNAVAILABLE' });
        continue;
      }
    }
    if (createAttempt) {
      try {
        await approveSettlementDraftInternally({ settlementApprovalId: draft.id,
          expectedVendorId: vendorId, attemptId });
      } catch (error) {
        // The canonical service persists or reconciles its own outcome. Never infer
        // success or issue another financial attempt from an exception.
        try {
          const persisted = await prisma.settlementAutoApprovalAttempt.findUnique({
            where: { id: attemptId }, select: { id: true },
          });
          if (!persisted) await recordAutoApprovalOperationalErrorBestEffort({
            phase: 'WORKER_PRE_ATTEMPT', category: 'WORKER_FAILED', error,
            vendorId, settlementApprovalId: draft.id,
          }, false);
        } catch (lookupError) {
          await recordAutoApprovalOperationalErrorBestEffort({ phase: 'WORKER_PRE_ATTEMPT',
            category: 'DATABASE_READ_FAILED', error: lookupError, vendorId,
            settlementApprovalId: draft.id }, false);
        }
      }
    }
    try {
      const evidence = await reconcileAutomaticApprovalAttempt({
        settlementApprovalId: draft.id, expectedVendorId: vendorId, attemptId,
      });
      outcomes.push({ settlementApprovalId: draft.id, attemptId,
        classification: evidence.classification, reasonCode: evidence.reasonCode });
    } catch (error) {
      await recordAutoApprovalOperationalErrorBestEffort({ phase: 'WORKER_RECONCILIATION',
        category: 'RECONCILIATION_FAILED', error, vendorId, settlementApprovalId: draft.id,
        attemptId: createAttempt ? undefined : attemptId }, false);
      outcomes.push({ settlementApprovalId: draft.id, attemptId,
        classification: 'UNKNOWN', reasonCode: 'ATTEMPT_RECONCILIATION_UNAVAILABLE' });
    }
  }
  return { vendorId, candidatesChecked: drafts.length, outcomes };
}
