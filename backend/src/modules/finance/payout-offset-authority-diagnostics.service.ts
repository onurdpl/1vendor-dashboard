import { Prisma, VendorBalanceEventType } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export type PayoutOffsetReconciliationStatus = 'VERIFIED' | 'BLOCKED' | 'UNKNOWN';
export type PayoutOffsetSourceDiagnostic = {
  sourceType: 'REFUND_ADJUSTMENT' | 'VENDOR_DEBT';
  sourceId: string;
  refundFinanceLedgerEntryId: string | null;
  vendorId: string;
  currency: string;
  verifiedAt: string | null;
  originalAmountMinor: number;
  appliedAmountMinor: number | null;
  remainingAmountMinor: number | null;
  activeReservationMinor: number;
  unreservedAmountMinor: number | null;
  status: PayoutOffsetReconciliationStatus;
  reasons: string[];
};

export type PayoutOffsetAuthorityDiagnostics = {
  writesPerformed: false;
  vendorId: string;
  currency: string;
  status: PayoutOffsetReconciliationStatus;
  sources: PayoutOffsetSourceDiagnostic[];
  claims: Array<{
    id: string;
    sourceType: 'REFUND_ADJUSTMENT' | 'VENDOR_DEBT';
    sourceId: string;
    payoutBatchId: string;
    settlementApprovalId: string;
    reservedAmountMinor: number;
    status: 'RESERVED' | 'FINALIZED' | 'RELEASED';
  }>;
  reasons: string[];
};

/** Read-only Phase 1 evidence. UNKNOWN is never treated as available payout capacity. */
export async function reconcilePayoutOffsetAuthority(input: {
  vendorId: string;
  currency: string;
}): Promise<PayoutOffsetAuthorityDiagnostics> {
  if (!input.vendorId.trim() || !input.currency.trim()) {
    throw new Error('Vendor and currency are required for payout offset reconciliation.');
  }

  return prisma.$transaction((tx) => reconcilePayoutOffsetAuthorityInTransaction(tx, input), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

/** The writer calls this only after taking the vendor lock in a Serializable transaction. */
export async function reconcilePayoutOffsetAuthorityInTransaction(
  tx: Prisma.TransactionClient,
  input: { vendorId: string; currency: string },
): Promise<PayoutOffsetAuthorityDiagnostics> {
    const [adjustments, debtEvents, aggregateOffsets, ambiguousDebtChanges, claims] = await Promise.all([
      tx.settlementRefundAdjustment.findMany({
        where: { vendorId: input.vendorId, currencyCode: input.currency },
        select: {
          id: true, vendorId: true, currencyCode: true, status: true, refundRecordId: true,
          refundFinanceLedgerEntryId: true, originalAmountMinor: true,
          appliedAmountMinor: true, remainingAmountMinor: true,
          applications: { select: { amountMinor: true, status: true } },
        },
      }),
      tx.vendorBalanceEvent.findMany({
        where: { vendorId: input.vendorId, currency: input.currency, type: VendorBalanceEventType.VENDOR_DEBT_CREATED },
        select: {
          id: true, vendorId: true, currency: true, amountMinor: true, sourceType: true, sourceId: true, refundRecordId: true,
          financeLedgerEntryId: true, financialCorrectionAuthorityId: true,
          financialCorrectionAuthority: { select: { appliedAt: true, vendorId: true, currency: true, applicationRoute: true, vendorPayableDifferenceMinor: true } },
        },
      }),
      tx.vendorBalanceEvent.findMany({
        where: { vendorId: input.vendorId, currency: input.currency, type: VendorBalanceEventType.VENDOR_DEBT_OFFSET },
        select: { id: true, amountMinor: true, payoutBatchId: true },
      }),
      tx.vendorBalanceEvent.count({
        where: { vendorId: input.vendorId, currency: input.currency,
          type: { in: [VendorBalanceEventType.DEBT_WAIVED, VendorBalanceEventType.MANUAL_ADJUSTMENT,
            VendorBalanceEventType.PAYABLE_EARNED] } },
      }),
      tx.payoutOffsetClaim.findMany({
        where: { vendorId: input.vendorId, currency: input.currency },
        select: {
          id: true, sourceType: true, settlementRefundAdjustmentId: true,
          vendorDebtOriginEventId: true, payoutBatchId: true, settlementApprovalId: true,
          reservedAmountMinor: true, status: true,
        },
      }),
    ]);

    const refundLedgerIds = [...new Set([
      ...adjustments.map((item) => item.refundFinanceLedgerEntryId),
      ...debtEvents.flatMap((item) => item.financeLedgerEntryId ? [item.financeLedgerEntryId] : []),
    ])];
    const snapshots = refundLedgerIds.length > 0
      ? await tx.refundEvidenceSnapshot.findMany({
        where: { refundFinanceLedgerEntryId: { in: refundLedgerIds } },
        select: {
          refundFinanceLedgerEntryId: true, refundRecordId: true, historicalEconomicVendorId: true,
          currency: true, capturedAt: true, vendorAllocationId: true,
          refundRecord: { select: { vendorAllocationId: true } },
          refundFinanceLedgerEntry: { select: { vendorId: true, vendorAllocationId: true, entryType: true } },
          historicalSaleFinanceLedgerEntry: { select: { vendorId: true, vendorAllocationId: true, entryType: true } },
        },
      })
      : [];
    const snapshotByLedger = new Map(snapshots.map((item) => [item.refundFinanceLedgerEntryId, item]));
    const directRefundLines = refundLedgerIds.length > 0
      ? await tx.settlementApprovalLine.findMany({
        where: { financeLedgerEntryId: { in: refundLedgerIds }, lineType: 'REFUND',
          settlementApproval: { status: { not: 'CANCELLED' } } },
        select: { financeLedgerEntryId: true, settlementApprovalId: true },
      })
      : [];
    const directRefundLedgerIds = new Set(directRefundLines.map((line) => line.financeLedgerEntryId));
    const claimRows = claims.map((item) => ({
      id: item.id,
      sourceType: item.sourceType,
      sourceId: item.settlementRefundAdjustmentId ?? item.vendorDebtOriginEventId ?? '',
      payoutBatchId: item.payoutBatchId,
      settlementApprovalId: item.settlementApprovalId,
      reservedAmountMinor: item.reservedAmountMinor,
      status: item.status,
    }));
    const reservedFor = (sourceType: 'REFUND_ADJUSTMENT' | 'VENDOR_DEBT', sourceId: string) =>
      claimRows.filter((claim) => claim.sourceType === sourceType && claim.sourceId === sourceId && claim.status === 'RESERVED')
        .reduce((total, claim) => total + claim.reservedAmountMinor, 0);
    const finalizedFor = (sourceType: 'REFUND_ADJUSTMENT' | 'VENDOR_DEBT', sourceId: string) =>
      claimRows.filter((claim) => claim.sourceType === sourceType && claim.sourceId === sourceId && claim.status === 'FINALIZED')
        .reduce((total, claim) => total + claim.reservedAmountMinor, 0);
    const debtByRefundLedger = new Map<string, string[]>();
    for (const event of debtEvents) {
      if (!event.financeLedgerEntryId) continue;
      debtByRefundLedger.set(event.financeLedgerEntryId, [
        ...(debtByRefundLedger.get(event.financeLedgerEntryId) ?? []), event.id,
      ]);
    }

    const sources: PayoutOffsetSourceDiagnostic[] = [];
    for (const adjustment of adjustments) {
      const snapshot = snapshotByLedger.get(adjustment.refundFinanceLedgerEntryId);
      const reasons: string[] = [];
      if (adjustment.status === 'BLOCKED' || adjustment.status === 'CANCELLED') {
        reasons.push('ADJUSTMENT_NOT_AVAILABLE');
      }
      if (!snapshot) reasons.push('ACCEPTED_REFUND_SNAPSHOT_MISSING');
      else if (snapshot.refundRecordId !== adjustment.refundRecordId ||
        snapshot.historicalEconomicVendorId !== adjustment.vendorId ||
        snapshot.currency !== adjustment.currencyCode || !snapshot.capturedAt ||
        snapshot.refundRecord.vendorAllocationId !== snapshot.vendorAllocationId ||
        snapshot.refundFinanceLedgerEntry.vendorId !== adjustment.vendorId ||
        snapshot.refundFinanceLedgerEntry.vendorAllocationId !== snapshot.vendorAllocationId ||
        snapshot.refundFinanceLedgerEntry.entryType.toLowerCase() !== 'refund' ||
        snapshot.historicalSaleFinanceLedgerEntry.vendorId !== adjustment.vendorId ||
        snapshot.historicalSaleFinanceLedgerEntry.vendorAllocationId !== snapshot.vendorAllocationId ||
        snapshot.historicalSaleFinanceLedgerEntry.entryType.toLowerCase() !== 'sale') {
        reasons.push('ACCEPTED_REFUND_SNAPSHOT_CONFLICT');
      }
      if (debtByRefundLedger.has(adjustment.refundFinanceLedgerEntryId)) reasons.push('REFUND_ADJUSTMENT_AND_DEBT_CONFLICT');
      if (directRefundLedgerIds.has(adjustment.refundFinanceLedgerEntryId)) reasons.push('DIRECT_REFUND_AND_ADJUSTMENT_CONFLICT');
      if (adjustment.applications.filter((application) => application.status === 'ACTIVE')
        .reduce((total, application) => total + application.amountMinor, 0) !== adjustment.appliedAmountMinor) {
        reasons.push('ADJUSTMENT_APPLICATION_TOTAL_CONFLICT');
      }
      if (adjustment.originalAmountMinor < 0 || adjustment.appliedAmountMinor < 0 || adjustment.remainingAmountMinor < 0 ||
        adjustment.originalAmountMinor !== adjustment.appliedAmountMinor + adjustment.remainingAmountMinor) {
        reasons.push('ADJUSTMENT_AMOUNT_RECONCILIATION_FAILED');
      }
      const activeReservationMinor = reservedFor('REFUND_ADJUSTMENT', adjustment.id);
      if (finalizedFor('REFUND_ADJUSTMENT', adjustment.id) > 0) {
        reasons.push('PAYOUT_FINALIZATION_RECONCILIATION_NOT_ENABLED');
      }
      if (activeReservationMinor > adjustment.remainingAmountMinor) reasons.push('RESERVATION_EXCEEDS_REMAINING');
      sources.push({
        sourceType: 'REFUND_ADJUSTMENT', sourceId: adjustment.id,
        refundFinanceLedgerEntryId: adjustment.refundFinanceLedgerEntryId,
        vendorId: adjustment.vendorId, currency: adjustment.currencyCode,
        verifiedAt: reasons.includes('ACCEPTED_REFUND_SNAPSHOT_MISSING') || reasons.includes('ACCEPTED_REFUND_SNAPSHOT_CONFLICT')
          ? null : snapshot!.capturedAt.toISOString(),
        originalAmountMinor: adjustment.originalAmountMinor,
        appliedAmountMinor: adjustment.appliedAmountMinor,
        remainingAmountMinor: adjustment.remainingAmountMinor,
        activeReservationMinor,
        unreservedAmountMinor: reasons.length === 0 ? adjustment.remainingAmountMinor - activeReservationMinor : null,
        status: reasons.length === 0 ? 'VERIFIED' : reasons.includes('ADJUSTMENT_NOT_AVAILABLE') ||
          reasons.includes('REFUND_ADJUSTMENT_AND_DEBT_CONFLICT') ||
          reasons.includes('DIRECT_REFUND_AND_ADJUSTMENT_CONFLICT') ||
          reasons.includes('RESERVATION_EXCEEDS_REMAINING') ? 'BLOCKED' : 'UNKNOWN',
        reasons,
      });
    }

    for (const event of debtEvents) {
      const reasons: string[] = [];
      let verifiedAt: string | null = null;
      if (event.financeLedgerEntryId && event.refundRecordId && !event.financialCorrectionAuthorityId) {
        if (event.sourceType !== 'shopify_refund' || event.sourceId !== event.refundRecordId) {
          reasons.push('DEBT_SOURCE_PROVENANCE_CONFLICT');
        }
        const snapshot = snapshotByLedger.get(event.financeLedgerEntryId);
        if (!snapshot) reasons.push('ACCEPTED_REFUND_SNAPSHOT_MISSING');
        else if (snapshot.refundRecordId !== event.refundRecordId || snapshot.historicalEconomicVendorId !== event.vendorId ||
          snapshot.currency !== event.currency || !snapshot.capturedAt ||
          snapshot.refundRecord.vendorAllocationId !== snapshot.vendorAllocationId ||
          snapshot.refundFinanceLedgerEntry.vendorId !== event.vendorId ||
          snapshot.refundFinanceLedgerEntry.vendorAllocationId !== snapshot.vendorAllocationId ||
          snapshot.refundFinanceLedgerEntry.entryType.toLowerCase() !== 'refund' ||
          snapshot.historicalSaleFinanceLedgerEntry.vendorId !== event.vendorId ||
          snapshot.historicalSaleFinanceLedgerEntry.vendorAllocationId !== snapshot.vendorAllocationId ||
          snapshot.historicalSaleFinanceLedgerEntry.entryType.toLowerCase() !== 'sale') reasons.push('ACCEPTED_REFUND_SNAPSHOT_CONFLICT');
        else verifiedAt = snapshot.capturedAt.toISOString();
        if (adjustments.some((adjustment) => adjustment.refundFinanceLedgerEntryId === event.financeLedgerEntryId)) {
          reasons.push('REFUND_ADJUSTMENT_AND_DEBT_CONFLICT');
        }
        if (directRefundLedgerIds.has(event.financeLedgerEntryId)) reasons.push('DIRECT_REFUND_AND_DEBT_CONFLICT');
      } else if (event.financialCorrectionAuthorityId && !event.financeLedgerEntryId && !event.refundRecordId) {
        const authority = event.financialCorrectionAuthority;
        if (!authority || authority.vendorId !== event.vendorId || authority.currency !== event.currency || !authority.appliedAt ||
          authority.applicationRoute !== 'PAID_VENDOR_DEBT' || authority.vendorPayableDifferenceMinor !== -event.amountMinor ||
          event.sourceType !== 'financial_correction' || event.sourceId !== event.financialCorrectionAuthorityId) {
          reasons.push('FINANCIAL_CORRECTION_AUTHORITY_CONFLICT');
        } else verifiedAt = authority.appliedAt.toISOString();
      } else reasons.push('DEBT_SOURCE_AUTHORITY_AMBIGUOUS');
      if (event.amountMinor >= 0) reasons.push('DEBT_AMOUNT_INVALID');
      if (aggregateOffsets.length > 0) reasons.push('HISTORICAL_DEBT_OFFSET_SOURCE_ALLOCATION_UNKNOWN');
      if (ambiguousDebtChanges > 0) reasons.push('HISTORICAL_DEBT_BALANCE_CHANGE_SOURCE_ALLOCATION_UNKNOWN');
      const activeReservationMinor = reservedFor('VENDOR_DEBT', event.id);
      if (finalizedFor('VENDOR_DEBT', event.id) > 0) reasons.push('PAYOUT_FINALIZATION_RECONCILIATION_NOT_ENABLED');
      if (activeReservationMinor > -event.amountMinor) reasons.push('RESERVATION_EXCEEDS_SOURCE');
      const unreservedAmountMinor = reasons.length === 0 ? -event.amountMinor - activeReservationMinor : null;
      sources.push({
        sourceType: 'VENDOR_DEBT', sourceId: event.id,
        refundFinanceLedgerEntryId: event.financeLedgerEntryId,
        vendorId: event.vendorId, currency: event.currency, verifiedAt,
        originalAmountMinor: -event.amountMinor,
        appliedAmountMinor: reasons.length === 0 ? 0 : null,
        remainingAmountMinor: reasons.length === 0 ? -event.amountMinor : null,
        activeReservationMinor, unreservedAmountMinor,
        status: reasons.includes('REFUND_ADJUSTMENT_AND_DEBT_CONFLICT') ||
          reasons.includes('DIRECT_REFUND_AND_DEBT_CONFLICT') || reasons.includes('RESERVATION_EXCEEDS_SOURCE')
          ? 'BLOCKED' : reasons.length === 0 ? 'VERIFIED' : 'UNKNOWN',
        reasons,
      });
    }

    sources.sort((a, b) => a.verifiedAt && b.verifiedAt
      ? a.verifiedAt.localeCompare(b.verifiedAt) || a.sourceType.localeCompare(b.sourceType) || a.sourceId.localeCompare(b.sourceId)
      : a.verifiedAt ? -1 : b.verifiedAt ? 1 : a.sourceType.localeCompare(b.sourceType) || a.sourceId.localeCompare(b.sourceId));
    const reasons: string[] = [];
    if (aggregateOffsets.length > 0) reasons.push('AGGREGATE_DEBT_OFFSETS_NOT_SOURCE_ATTRIBUTED');
    if (ambiguousDebtChanges > 0) reasons.push('DEBT_BALANCE_CHANGES_NOT_SOURCE_ATTRIBUTED');
    if (sources.some((source) => source.status === 'BLOCKED')) reasons.push('SOURCE_CONFLICT_OR_OVERSUBSCRIPTION');
    if (sources.some((source) => source.status === 'UNKNOWN')) reasons.push('SOURCE_AUTHORITY_INCOMPLETE');
    return {
      writesPerformed: false,
      vendorId: input.vendorId, currency: input.currency,
      status: reasons.includes('SOURCE_CONFLICT_OR_OVERSUBSCRIPTION') ? 'BLOCKED' : reasons.length > 0 ? 'UNKNOWN' : 'VERIFIED',
      sources, claims: claimRows, reasons,
    };
}
