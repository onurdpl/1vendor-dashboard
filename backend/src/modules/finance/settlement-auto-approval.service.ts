import { randomUUID } from 'node:crypto';
import { Prisma, SettlementAutoApprovalAttemptOutcome } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { approveSettlementApprovalAsTrustedSystem, getSettlementApproval,
  SettlementApprovalRevalidationError } from './settlement-approval.service.js';

const ACTOR = 'system:settlement_auto_approval';
type AttemptIdentity = { attemptId: string; settlementApprovalId: string; expectedVendorId: string };
export type AutoApprovalReconciliation = {
  attemptId: string;
  settlementApprovalId: string;
  vendorId: string;
  attemptOutcome: SettlementAutoApprovalAttemptOutcome;
  classification: 'VERIFIED_COMPLETED' | 'BLOCKED' | 'TECHNICAL_FAILURE' | 'UNKNOWN' | 'EVIDENCE_CONFLICT';
  reasonCode: string;
  settlementStatus: 'DRAFT' | 'APPROVED' | 'CANCELLED';
};

function assertIdentity(input: AttemptIdentity) {
  if (!input.attemptId?.trim() || !input.settlementApprovalId?.trim() || !input.expectedVendorId?.trim() ||
      input.attemptId.length > 128) {
    throw new Error('Automatic approval requires bounded exact attempt, settlement and vendor identities.');
  }
}

async function appendOutcome(input: AttemptIdentity, outcome: SettlementAutoApprovalAttemptOutcome,
  reasonCode: string, reasonDetail?: string) {
  await prisma.$transaction(async (tx) => {
    const attempt = await tx.settlementAutoApprovalAttempt.findUnique({ where: { id: input.attemptId } });
    if (!attempt || attempt.settlementApprovalId !== input.settlementApprovalId ||
        attempt.vendorId !== input.expectedVendorId || attempt.actorId !== ACTOR) {
      throw new Error('Automatic approval attempt identity does not match.');
    }
    if (attempt.outcome === outcome && attempt.reasonCode === reasonCode) return;
    if (!['STARTED', 'UNKNOWN'].includes(attempt.outcome) || outcome === 'APPROVED') {
      throw new Error('Automatic approval attempt outcome transition is not permitted.');
    }
    await tx.settlementAutoApprovalAttempt.update({
      where: { id: input.attemptId },
      data: { outcome, reasonCode, reasonDetail: reasonDetail ?? null,
        completedAt: outcome === 'UNKNOWN' ? null : new Date() },
    });
    await tx.settlementAutoApprovalAttemptEvent.create({
      data: { attemptId: input.attemptId, outcome, reasonCode, reasonDetail: reasonDetail ?? null },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function vendorHoldBlockerEvidence(error: SettlementApprovalRevalidationError): string | undefined {
  const holds = error.reasons.filter((reason) => reason.code === 'vendor_blocked_finance_hold_active');
  if (!holds.length || holds.some((reason) => reason.details?.allocationStatus !== 'VENDOR_BLOCKED' ||
      typeof reason.details?.vendorAllocationId !== 'string' || !reason.details.vendorAllocationId)) return;
  const heldLines = new Set(holds.map((reason) => reason.settlementApprovalLineId));
  if (error.reasons.some((reason) => reason.code !== 'vendor_blocked_finance_hold_active' &&
      (reason.code !== 'settlement_row_not_eligible' || !heldLines.has(reason.settlementApprovalLineId)))) return;
  return JSON.stringify({ kind: 'VENDOR_BLOCKED_ALLOCATION_V1',
    lines: holds.map((reason) => ({ lineId: reason.settlementApprovalLineId,
      ledgerId: reason.financeLedgerEntryId, allocationId: reason.details!.vendorAllocationId }))
      .sort((a, b) => a.lineId.localeCompare(b.lineId)) });
}

/** Reconcile persisted authority; never authorizes or retries a financial approval. */
export async function reconcileAutomaticApprovalAttempt(input: AttemptIdentity): Promise<AutoApprovalReconciliation> {
  assertIdentity(input);
  const attempt = await prisma.settlementAutoApprovalAttempt.findUnique({ where: { id: input.attemptId } });
  if (!attempt || attempt.settlementApprovalId !== input.settlementApprovalId ||
      attempt.vendorId !== input.expectedVendorId || attempt.actorId !== ACTOR) {
    throw new Error('Automatic approval attempt identity does not match.');
  }
  const settlement = await prisma.settlementApproval.findUnique({
    where: { id: input.settlementApprovalId },
    select: { id: true, vendorId: true, status: true, cancelledFromStatus: true,
      approvedBy: true, approvedAt: true, successfulAutoApprovalAttemptId: true,
      replacesSettlementApprovalId: true, sourceSnapshotJson: true },
  });
  if (!settlement || settlement.vendorId !== input.expectedVendorId) {
    throw new Error('Automatic approval settlement ownership is unavailable.');
  }
  const result = (classification: AutoApprovalReconciliation['classification'], reasonCode: string): AutoApprovalReconciliation => ({
    attemptId: input.attemptId, settlementApprovalId: input.settlementApprovalId,
    vendorId: input.expectedVendorId, attemptOutcome: attempt.outcome,
    classification, reasonCode, settlementStatus: settlement.status,
  });
  const historicallyApproved = settlement.status === 'APPROVED' ||
    settlement.status === 'CANCELLED' && settlement.cancelledFromStatus === 'APPROVED';
  if (settlement.successfulAutoApprovalAttemptId === input.attemptId) {
    if (!historicallyApproved || settlement.approvedBy !== ACTOR || !settlement.approvedAt ||
        attempt.outcome !== 'APPROVED') return result('EVIDENCE_CONFLICT', 'SUCCESS_EVIDENCE_MISMATCH');
    if (settlement.replacesSettlementApprovalId) {
      const frozen = (settlement.sourceSnapshotJson as Record<string, unknown> | null)?.lateRefundLedgerIds;
      if (frozen !== undefined && (!Array.isArray(frozen) || !frozen.every((id) => typeof id === 'string'))) {
        return result('EVIDENCE_CONFLICT', 'REPLACEMENT_REFUND_EVIDENCE_MISSING');
      }
      const frozenIds = Array.isArray(frozen) ? frozen as string[] : [];
      const adjustments = await prisma.settlementRefundAdjustment.findMany({
        where: { originalSettlementApprovalId: settlement.id,
          refundFinanceLedgerEntryId: { in: frozenIds } },
        select: { refundFinanceLedgerEntryId: true, refundRecordId: true, vendorId: true,
          originalAmountMinor: true },
      });
      const snapshots = await prisma.refundEvidenceSnapshot.findMany({
        where: { refundFinanceLedgerEntryId: { in: frozenIds } },
        select: { refundFinanceLedgerEntryId: true, refundRecordId: true, historicalEconomicVendorId: true },
      });
      const evidence = new Map(snapshots.map((row) => [row.refundFinanceLedgerEntryId, row]));
      if (adjustments.length !== frozenIds.length || adjustments.some((row) =>
        row.vendorId !== settlement.vendorId || row.originalAmountMinor <= 0 ||
        evidence.get(row.refundFinanceLedgerEntryId)?.refundRecordId !== row.refundRecordId ||
        evidence.get(row.refundFinanceLedgerEntryId)?.historicalEconomicVendorId !== row.vendorId) ||
        new Set(adjustments.map((row) => row.refundFinanceLedgerEntryId)).size !== frozenIds.length) {
        return result('EVIDENCE_CONFLICT', 'REPLACEMENT_REFUND_OBLIGATION_MISMATCH');
      }
    }
    return result('VERIFIED_COMPLETED', settlement.status === 'CANCELLED' ?
      'APPROVED_THEN_CANCELLED' : 'EXACT_ATTEMPT_APPROVED');
  }
  if (attempt.outcome === 'APPROVED') return result('EVIDENCE_CONFLICT', 'APPROVED_ATTEMPT_LINK_MISSING');
  if (settlement.status === 'APPROVED' || settlement.status === 'CANCELLED') {
    const reasonCode = settlement.status === 'CANCELLED' ? 'SETTLEMENT_CANCELLED' :
      settlement.approvedBy === ACTOR ? 'APPROVED_BY_OTHER_SYSTEM_ATTEMPT' : 'APPROVED_BY_OTHER_ACTOR';
    if (attempt.outcome === 'STARTED' || attempt.outcome === 'UNKNOWN') {
      await appendOutcome(input, 'BLOCKED', reasonCode);
      return { ...result('BLOCKED', reasonCode), attemptOutcome: 'BLOCKED' };
    }
    return result('BLOCKED', reasonCode);
  }
  if (attempt.outcome === 'BLOCKED') return result('BLOCKED', attempt.reasonCode ?? 'CANONICAL_APPROVAL_BLOCKED');
  if (attempt.outcome === 'TECHNICAL_FAILURE') return result('TECHNICAL_FAILURE', attempt.reasonCode ?? 'TECHNICAL_FAILURE');
  return result('UNKNOWN', 'STARTED_OR_COMMIT_OUTCOME_UNCONFIRMED');
}

/** Trusted backend-only entry point. No HTTP route or scheduler calls this service. */
export async function approveSettlementDraftInternally(input: {
  settlementApprovalId: string;
  expectedVendorId: string;
  attemptId?: string;
}) {
  const identity = { settlementApprovalId: input.settlementApprovalId,
    expectedVendorId: input.expectedVendorId, attemptId: input.attemptId ?? randomUUID() };
  assertIdentity(identity);
  const settlement = await prisma.settlementApproval.findUnique({
    where: { id: identity.settlementApprovalId }, select: { vendorId: true },
  });
  if (!settlement || settlement.vendorId !== identity.expectedVendorId) {
    throw new Error('System settlement approval vendor identity does not match.');
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.settlementAutoApprovalAttempt.create({ data: {
        id: identity.attemptId, settlementApprovalId: identity.settlementApprovalId,
        vendorId: identity.expectedVendorId, actorId: ACTOR,
      } });
      await tx.settlementAutoApprovalAttemptEvent.create({ data: {
        attemptId: identity.attemptId, outcome: 'STARTED', reasonCode: 'ATTEMPT_CREATED',
      } });
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    const previous = await reconcileAutomaticApprovalAttempt(identity);
    if (previous.classification === 'VERIFIED_COMPLETED' && previous.settlementStatus === 'APPROVED') {
      const approved = await getSettlementApproval(identity.settlementApprovalId);
      if (approved?.status === 'approved' && approved.approvedBy === ACTOR) return approved;
    }
    throw new Error(`Automatic approval attempt already exists: ${previous.classification}/${previous.reasonCode}.`);
  }
  try {
    // P2034 is PostgreSQL's rolled-back write conflict/deadlock outcome, not an
    // ambiguous commit acknowledgement. Revalidate in a fresh canonical
    // Serializable transaction under the same durable attempt identity.
    for (let retry = 0; ; retry += 1) {
      try {
        return await approveSettlementApprovalAsTrustedSystem(identity);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') ||
            retry >= 2) throw error;
        const attempt = await prisma.settlementAutoApprovalAttempt.findUnique({
          where: { id: identity.attemptId }, select: { outcome: true, vendorId: true,
            settlementApprovalId: true, actorId: true },
        });
        if (attempt?.outcome !== 'STARTED' || attempt.vendorId !== identity.expectedVendorId ||
            attempt.settlementApprovalId !== identity.settlementApprovalId || attempt.actorId !== ACTOR) {
          throw error;
        }
        await prisma.settlementAutoApprovalAttemptEvent.create({ data: {
          attemptId: identity.attemptId, outcome: 'STARTED',
          reasonCode: 'SERIALIZABLE_TRANSACTION_ROLLED_BACK',
        } });
      }
    }
  } catch (error) {
    // An ambiguous commit response cannot be treated as success without persisted evidence.
    try {
      const persisted = await reconcileAutomaticApprovalAttempt(identity);
      if (persisted.classification === 'VERIFIED_COMPLETED' && persisted.settlementStatus === 'APPROVED') {
        const approved = await getSettlementApproval(identity.settlementApprovalId);
        if (approved?.status === 'approved' && approved.approvedBy === ACTOR) return approved;
      }
      if (persisted.attemptOutcome === 'STARTED') {
        const technical = error instanceof Prisma.PrismaClientKnownRequestError ||
          error instanceof Prisma.PrismaClientUnknownRequestError ||
          error instanceof Prisma.PrismaClientInitializationError;
        const blocked = !technical && (error instanceof SettlementApprovalRevalidationError ||
          error instanceof Error && /^(Only draft|Settlement approval monetary totals are inconsistent|Financial Correction|Replacement |System settlement approval)/.test(error.message));
        const outcome: SettlementAutoApprovalAttemptOutcome = technical ? 'TECHNICAL_FAILURE' :
          blocked ? 'BLOCKED' : 'UNKNOWN';
        const reasonCode = error instanceof SettlementApprovalRevalidationError ?
          error.reasons.map((reason) => reason.code).join(',').slice(0, 512) :
          technical ? 'DATABASE_TRANSACTION_FAILED' : blocked ? 'CANONICAL_APPROVAL_BLOCKED' : 'UNCLASSIFIED_FAILURE';
        await appendOutcome(identity, outcome, reasonCode,
          error instanceof SettlementApprovalRevalidationError ? vendorHoldBlockerEvidence(error) : undefined);
      }
    } catch {
      // Outage or conflict leaves STARTED for later explicit reconciliation.
    }
    throw error;
  }
}
