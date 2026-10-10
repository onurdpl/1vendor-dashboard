import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { previewApproval } from './settlement-approval.service.js';
import { buildScheduledSettlementCycleKey } from './settlement-schedule.service.js';
import { getAvailableFinancialCorrectionCredits } from './financial-correction-credit-consumption.service.js';
import { getAvailableFinancialCorrectionDeductions } from './financial-correction-deduction-consumption.service.js';

type Finding = { code: string; detail: string; sourceId?: string };
type Source = {
  financeLedgerEntryId: string;
  lineType: string;
  amountMinor: number;
  commissionMinor: number;
  commissionVatMinor: number;
  payableImpactMinor: number;
  vendorAllocationId: string;
};

export type SettlementReplacementAssessment = {
  outcome: 'ELIGIBLE' | 'BLOCKED' | 'UNKNOWN';
  writesPerformed: false;
  safeForAdminConsideration: boolean;
  originalSettlementApprovalId: string;
  vendorId: string;
  originalCutoff: string | null;
  cancellationProvenance: 'VERIFIED_DRAFT' | 'UNVERIFIED' | 'INELIGIBLE';
  replacementLineage: 'CLEAR' | 'CLAIMED' | 'UNKNOWN';
  sourceComparison: { original: Source[]; current: Source[]; sharedIds: string[]; originalOnlyIds: string[]; currentOnlyIds: string[] };
  refundEvidence: Array<{ refundFinanceLedgerEntryId: string; historicalSaleFinanceLedgerEntryId: string; capturedAt: string; afterCutoff: boolean }>;
  pendingAdjustments: Array<{ id: string; refundFinanceLedgerEntryId: string; remainingAmountMinor: number; status: string }>;
  correctionEvidence: { availableCreditIds: string[]; availableDeductionIds: string[] };
  blockers: Finding[];
  unknowns: Finding[];
};

function snapshot(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function source(line: { financeLedgerEntryId: string; lineType: string; amountMinor: number; commissionMinor: number;
  commissionVatMinor: number; payableImpactMinor: number; sourceSnapshotJson: unknown }): Source | null {
  const evidence = snapshot(line.sourceSnapshotJson);
  if (!evidence || evidence.financeLedgerEntryId !== line.financeLedgerEntryId ||
      typeof evidence.vendorAllocationId !== 'string' || !['SALE', 'REFUND'].includes(line.lineType)) return null;
  return {
    financeLedgerEntryId: line.financeLedgerEntryId, lineType: line.lineType,
    amountMinor: line.amountMinor, commissionMinor: line.commissionMinor,
    commissionVatMinor: line.commissionVatMinor, payableImpactMinor: line.payableImpactMinor,
    vendorAllocationId: evidence.vendorAllocationId,
  };
}

/** Informational only. A later write must revalidate everything in its own transaction. */
export async function assessCancelledScheduledSettlementReplacement(input: {
  originalSettlementApprovalId: string;
  vendorId: string;
}, transactionClient?: Prisma.TransactionClient): Promise<SettlementReplacementAssessment> {
  const assess = async (tx: Prisma.TransactionClient): Promise<SettlementReplacementAssessment> => {
    const blockers: Finding[] = [];
    const unknowns: Finding[] = [];
    const original = await tx.settlementApproval.findUnique({
      where: { id: input.originalSettlementApprovalId },
      include: { lines: true, replacementSettlementApproval: { select: { id: true } },
        commissionInvoices: { select: { id: true } }, correctionCreditLines: { select: { id: true } },
        correctionDeductionLines: { select: { id: true } }, refundAdjustmentApplications: { select: { id: true } } },
    });
    const result: SettlementReplacementAssessment = {
      outcome: 'UNKNOWN', writesPerformed: false, safeForAdminConsideration: false,
      originalSettlementApprovalId: input.originalSettlementApprovalId, vendorId: input.vendorId,
      originalCutoff: original?.scheduledPeriodEnd?.toISOString() ?? null,
      cancellationProvenance: 'UNVERIFIED', replacementLineage: 'UNKNOWN',
      sourceComparison: { original: [], current: [], sharedIds: [], originalOnlyIds: [], currentOnlyIds: [] },
      refundEvidence: [], pendingAdjustments: [],
      correctionEvidence: { availableCreditIds: [], availableDeductionIds: [] }, blockers, unknowns,
    };
    const finish = () => {
      result.outcome = blockers.length ? 'BLOCKED' : unknowns.length ? 'UNKNOWN' : 'ELIGIBLE';
      result.safeForAdminConsideration = result.outcome === 'ELIGIBLE';
      return result;
    };
    if (!original) {
      unknowns.push({ code: 'ORIGINAL_NOT_FOUND', detail: 'Original settlement approval does not exist.' });
      return finish();
    }
    if (original.vendorId !== input.vendorId) {
      blockers.push({ code: 'VENDOR_MISMATCH', detail: 'Original settlement belongs to another vendor.' });
      return finish();
    }
    if (original.status !== 'CANCELLED') blockers.push({ code: 'NOT_CANCELLED', detail: 'Original settlement is not cancelled.' });
    if (!original.cancelledAt || !original.cancelledBy) unknowns.push({ code: 'CANCELLATION_AUDIT_MISSING', detail: 'Cancellation time or actor is missing.' });
    if (original.approvedAt || original.approvedBy) blockers.push({ code: 'ORIGINAL_APPROVAL_HISTORY', detail: 'Original has approval history.' });
    if (original.cancelledFromStatus === 'DRAFT' && original.status === 'CANCELLED') {
      result.cancellationProvenance = 'VERIFIED_DRAFT';
    } else if (original.cancelledFromStatus) {
      result.cancellationProvenance = 'INELIGIBLE';
      blockers.push({ code: 'NOT_ORIGINALLY_DRAFT', detail: `Original was cancelled from ${original.cancelledFromStatus}.` });
    } else {
      unknowns.push({ code: 'CANCELLATION_PROVENANCE_MISSING', detail: 'Pre-cancellation status is not recorded.' });
    }
    if (original.replacementSettlementApproval) {
      result.replacementLineage = 'CLAIMED';
      blockers.push({ code: 'REPLACEMENT_EXISTS', detail: 'A replacement already claims this settlement.',
        sourceId: original.replacementSettlementApproval.id });
    } else result.replacementLineage = 'CLEAR';
    if (original.commissionInvoices.length || original.correctionCreditLines.length ||
        original.correctionDeductionLines.length || original.refundAdjustmentApplications.length) {
      blockers.push({ code: 'ORIGINAL_FINANCIAL_LINKS', detail: 'Original has invoice, correction or adjustment lineage.' });
    }
    if (await tx.payoutBatchLine.count({ where: { settlementApprovalLine: { settlementApprovalId: original.id } } })) {
      blockers.push({ code: 'ORIGINAL_PAYOUT_LINK', detail: 'Original lines are linked to a payout.' });
    }
    const runDate = original.scheduledRunDate;
    const cutoff = original.scheduledPeriodEnd;
    if (!runDate || !cutoff || !original.scheduledCycleKey || !original.periodEnd) {
      unknowns.push({ code: 'SCHEDULED_PROVENANCE_MISSING', detail: 'Scheduled run date, cutoff, cycle key or period end is missing.' });
      return finish();
    }
    const expectedCutoff = new Date(Date.UTC(runDate.getUTCFullYear(), runDate.getUTCMonth(), runDate.getUTCDate(), 23, 59, 59, 999));
    const metadata = snapshot(original.sourceSnapshotJson);
    if (runDate.getTime() !== Date.UTC(runDate.getUTCFullYear(), runDate.getUTCMonth(), runDate.getUTCDate()) ||
        cutoff.getTime() !== expectedCutoff.getTime() || original.periodEnd.getTime() !== cutoff.getTime() ||
        original.scheduledCycleKey !== buildScheduledSettlementCycleKey(original.vendorId, runDate) ||
        !metadata || metadata.vendorId !== original.vendorId || metadata.periodEnd !== cutoff.toISOString() ||
        metadata.asOfDate !== cutoff.toISOString() || metadata.scheduledPeriodEnd !== cutoff.toISOString() ||
        metadata.scheduledRunDate !== runDate.toISOString() || metadata.scheduledCycleKey !== original.scheduledCycleKey ||
        metadata.candidateScope !== 'date_range') {
      unknowns.push({ code: 'SCHEDULED_METADATA_CONFLICT', detail: 'Frozen UTC schedule fields or creation snapshot disagree.' });
      return finish();
    }
    const originalSources = original.lines.map(source);
    if (!originalSources.length || originalSources.some((item) => item === null) ||
        new Set(original.lines.map((line) => line.financeLedgerEntryId)).size !== original.lines.length) {
      unknowns.push({ code: 'ORIGINAL_SOURCE_EVIDENCE_MISSING', detail: 'Original source identity or monetary snapshot cannot be interpreted.' });
      return finish();
    }
    result.sourceComparison.original = originalSources as Source[];
    const frozenTotals = result.sourceComparison.original.reduce((totals, item) => ({
      grossSalesMinor: totals.grossSalesMinor + (item.lineType === 'SALE' ? item.amountMinor : 0),
      refundTotalMinor: totals.refundTotalMinor + (item.lineType === 'REFUND' ? item.amountMinor : 0),
      commissionMinor: totals.commissionMinor + item.commissionMinor,
      commissionVatMinor: totals.commissionVatMinor + item.commissionVatMinor,
      netPayableMinor: totals.netPayableMinor + item.payableImpactMinor,
    }), { grossSalesMinor: 0, refundTotalMinor: 0, commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 0 });
    if (original.correctionCreditMinor || original.correctionDeductionMinor ||
        Object.entries(frozenTotals).some(([key, value]) => original[key as keyof typeof frozenTotals] !== value)) {
      unknowns.push({ code: 'ORIGINAL_TOTALS_UNVERIFIED', detail: 'Original totals do not match interpretable frozen source lines.' });
    }
    const originalIds = result.sourceComparison.original.map((item) => item.financeLedgerEntryId);
    const saleIds = result.sourceComparison.original.filter((item) => item.lineType === 'SALE').map((item) => item.financeLedgerEntryId);
    const allocationIds = [...new Set(result.sourceComparison.original.map((item) => item.vendorAllocationId))];
    const [ledgers, activeClaims, refundEvidence, lateRefunds, adjustments, terminalReviews] = await Promise.all([
      tx.financeLedgerEntry.findMany({ where: { id: { in: originalIds } }, select: { id: true, vendorId: true, vendorAllocationId: true, entryType: true, createdAt: true } }),
      tx.settlementApprovalLine.findMany({ where: { financeLedgerEntryId: { in: originalIds },
        settlementApproval: { status: { in: ['DRAFT', 'APPROVED'] } } }, select: { financeLedgerEntryId: true } }),
      tx.refundEvidenceSnapshot.findMany({ where: { historicalSaleFinanceLedgerEntryId: { in: saleIds } },
        select: { refundFinanceLedgerEntryId: true, historicalSaleFinanceLedgerEntryId: true, capturedAt: true } }),
      tx.financeLedgerEntry.findMany({ where: { vendorId: input.vendorId, entryType: 'refund',
        vendorAllocationId: { in: allocationIds }, createdAt: { gt: cutoff } }, select: { id: true } }),
      tx.settlementRefundAdjustment.findMany({ where: { vendorId: input.vendorId,
        status: { in: ['PENDING', 'PARTIALLY_APPLIED'] }, remainingAmountMinor: { gt: 0 } },
        select: { id: true, refundFinanceLedgerEntryId: true, remainingAmountMinor: true, status: true } }),
      tx.refundTerminalEvidenceReview.findMany({ where: { economicVendorId: input.vendorId,
        vendorAllocationId: { in: allocationIds }, status: { not: 'RESOLVED' } },
        select: { id: true, terminalRefundFinanceLedgerEntryId: true } }),
    ]);
    for (const item of result.sourceComparison.original) {
      const ledger = ledgers.find((row) => row.id === item.financeLedgerEntryId);
      if (!ledger || ledger.vendorId !== input.vendorId || ledger.vendorAllocationId !== item.vendorAllocationId ||
          ledger.entryType.toUpperCase() !== item.lineType || ledger.createdAt > cutoff) {
        unknowns.push({ code: 'ORIGINAL_SOURCE_AUTHORITY_CONFLICT', detail: 'Original ledger ownership or type cannot be verified.', sourceId: item.financeLedgerEntryId });
      }
    }
    for (const claim of activeClaims) blockers.push({ code: 'ACTIVE_SOURCE_CLAIM', detail: 'An active settlement claims an original source.', sourceId: claim.financeLedgerEntryId });
    for (const review of terminalReviews) blockers.push({ code: 'UNRESOLVED_REFUND_EVIDENCE',
      detail: 'A terminal refund evidence conflict remains unresolved for an original allocation.',
      sourceId: review.terminalRefundFinanceLedgerEntryId });
    result.refundEvidence = refundEvidence.map((item) => ({ refundFinanceLedgerEntryId: item.refundFinanceLedgerEntryId,
      historicalSaleFinanceLedgerEntryId: item.historicalSaleFinanceLedgerEntryId,
      capturedAt: item.capturedAt.toISOString(), afterCutoff: item.capturedAt > cutoff }));
    const evidencedRefundIds = new Set(refundEvidence.map((item) => item.refundFinanceLedgerEntryId));
    for (const evidence of result.refundEvidence.filter((item) => item.afterCutoff)) {
      unknowns.push({ code: 'LATE_REFUND_ROUTE_UNVERIFIED',
        detail: 'The post-cutoff refund is excluded from this period, but its later economic route is not proven by this assessment.',
        sourceId: evidence.refundFinanceLedgerEntryId });
    }
    for (const refund of lateRefunds) {
      if (!result.refundEvidence.some((item) => item.refundFinanceLedgerEntryId === refund.id && item.afterCutoff)) {
        unknowns.push({ code: 'LATE_REFUND_TIME_CONFLICT',
          detail: 'A post-cutoff refund ledger has no matching post-cutoff captured evidence.', sourceId: refund.id });
      }
      if (!evidencedRefundIds.has(refund.id)) unknowns.push({ code: 'LATE_REFUND_EVIDENCE_MISSING',
        detail: 'A post-cutoff refund on an original allocation lacks matched evidence.', sourceId: refund.id });
    }
    result.pendingAdjustments = adjustments;
    for (const adjustment of adjustments) blockers.push({ code: 'PENDING_REFUND_ADJUSTMENT',
      detail: 'A vendor-wide pending refund adjustment has no proven attribution to the frozen cutoff.', sourceId: adjustment.id });
    try {
      const [credits, deductions] = await Promise.all([
        getAvailableFinancialCorrectionCredits(tx, input.vendorId),
        getAvailableFinancialCorrectionDeductions(tx, input.vendorId),
      ]);
      result.correctionEvidence.availableCreditIds = credits.map((item) => item.id);
      result.correctionEvidence.availableDeductionIds = deductions.map((item) => item.id);
      for (const credit of credits) blockers.push({ code: 'VENDOR_WIDE_CREDIT_SCOPE',
        detail: 'An available vendor-wide credit is not selected by date-range preview.', sourceId: credit.id });
      for (const deduction of deductions) blockers.push({ code: 'VENDOR_WIDE_DEDUCTION_SCOPE',
        detail: 'An available vendor-wide deduction requires a vendor-wide draft.', sourceId: deduction.id });
    } catch (error) {
      unknowns.push({ code: 'CORRECTION_AUTHORITY_UNVERIFIED', detail: error instanceof Error ? error.message : 'Correction authority could not be verified.' });
    }
    try {
      const preview = await previewApproval(input.vendorId, null, cutoff,
        { candidateScope: 'date_range', asOfDate: cutoff }, tx);
      if (preview.writesPerformed !== false || preview.candidateScope !== 'date_range' || preview.periodEnd !== cutoff.toISOString()) {
        unknowns.push({ code: 'PREVIEW_SCOPE_CONFLICT', detail: 'The finance preview did not use the frozen date-range cutoff.' });
        return finish();
      }
      const current = preview.lines.map(source);
      if (current.some((item) => item === null)) unknowns.push({ code: 'CURRENT_SOURCE_EVIDENCE_MISSING', detail: 'A current source snapshot is incomplete.' });
      result.sourceComparison.current = current.filter((item): item is Source => item !== null);
      const oldMap = new Map(result.sourceComparison.original.map((item) => [item.financeLedgerEntryId, item]));
      const newMap = new Map(result.sourceComparison.current.map((item) => [item.financeLedgerEntryId, item]));
      result.sourceComparison.sharedIds = originalIds.filter((id) => newMap.has(id));
      result.sourceComparison.originalOnlyIds = originalIds.filter((id) => !newMap.has(id));
      result.sourceComparison.currentOnlyIds = result.sourceComparison.current.map((item) => item.financeLedgerEntryId).filter((id) => !oldMap.has(id));
      for (const id of result.sourceComparison.sharedIds) {
        if (JSON.stringify(oldMap.get(id)) !== JSON.stringify(newMap.get(id))) unknowns.push({ code: 'SOURCE_SNAPSHOT_CHANGED',
          detail: 'Frozen monetary or ownership source differs from the current preview.', sourceId: id });
      }
      if (result.sourceComparison.originalOnlyIds.length || result.sourceComparison.currentOnlyIds.length) {
        unknowns.push({ code: 'SOURCE_SET_CHANGED', detail: 'The eligible source set differs at the same frozen cutoff.' });
      }
      if (preview.pendingRefundAdjustments.pendingAdjustmentCount || preview.correctionCredits.length || preview.correctionDeductions.length) {
        blockers.push({ code: 'NON_PERIOD_FINANCIAL_SOURCE', detail: 'Date-range preview includes or encounters vendor-wide financial sources.' });
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'A pending Financial Correction deduction requires a vendor-wide settlement draft.') {
        blockers.push({ code: 'VENDOR_WIDE_DEDUCTION_SCOPE', detail: error.message });
      } else {
        unknowns.push({ code: 'PREVIEW_UNAVAILABLE', detail: error instanceof Error ? error.message : 'Finance preview failed.' });
      }
    }
    return finish();
  };
  return transactionClient
    ? assess(transactionClient)
    : prisma.$transaction(assess, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
