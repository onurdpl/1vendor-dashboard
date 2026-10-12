import type { Prisma } from '@prisma/client';
import { reconcilePayoutOffsetAuthorityInTransaction } from './payout-offset-authority-diagnostics.service.js';
import { classifyR1EftRefundTiming } from './r1-eft-refund-timing.service.js';

export type R1MissedRefundProof = {
  bySaleLedgerId: Map<string, { refundLedgerIds: Set<string>; refundRecordIds: Set<string> }>;
  records: Array<{
    refundFinanceLedgerEntryId: string;
    settlementRefundAdjustmentId: string;
    acceptedAt: Date;
    outstandingAmountMinor: number;
  }>;
};

/** Exact same-approval refund claims already frozen into this R1 payout. */
export async function proveR1ClaimCoveredRefunds(
  tx: Prisma.TransactionClient,
  payoutBatchId: string,
): Promise<R1MissedRefundProof['bySaleLedgerId']> {
  const batch = await tx.payoutBatch.findUnique({ where: { id: payoutBatchId }, select: {
    vendorId: true, currency: true,
    lines: { select: { financeLedgerEntryId: true, settlementApprovalLineId: true } },
    payoutOffsetClaims: { where: { status: 'RESERVED', sourceType: 'REFUND_ADJUSTMENT' },
      select: { settlementRefundAdjustmentId: true, reservedAmountMinor: true } },
  } });
  if (!batch) throw new Error('R1_CLAIM_COVERED_REFUND_BATCH_MISSING');
  const lineBySale = new Map(batch.lines.map((line) => [line.financeLedgerEntryId,
    line.settlementApprovalLineId]));
  const result: R1MissedRefundProof['bySaleLedgerId'] = new Map();
  const claimAmountByAdjustment = new Map<string, number>();
  for (const claim of batch.payoutOffsetClaims) {
    if (!claim.settlementRefundAdjustmentId) throw new Error('R1_CLAIM_COVERED_REFUND_IDENTITY_MISSING');
    claimAmountByAdjustment.set(claim.settlementRefundAdjustmentId,
      (claimAmountByAdjustment.get(claim.settlementRefundAdjustmentId) ?? 0) + claim.reservedAmountMinor);
  }
  for (const claim of batch.payoutOffsetClaims) {
    if (!claim.settlementRefundAdjustmentId) throw new Error('R1_CLAIM_COVERED_REFUND_IDENTITY_MISSING');
    const adjustment = await tx.settlementRefundAdjustment.findUnique({
      where: { id: claim.settlementRefundAdjustmentId },
      select: { vendorId: true, currencyCode: true, refundRecordId: true,
        refundFinanceLedgerEntryId: true, originalSettlementApprovalLineId: true,
        remainingAmountMinor: true },
    });
    if (!adjustment || adjustment.vendorId !== batch.vendorId ||
        adjustment.currencyCode !== batch.currency) {
      throw new Error('R1_CLAIM_COVERED_REFUND_AUTHORITY_CHANGED');
    }
    if (![...lineBySale.values()].includes(adjustment.originalSettlementApprovalLineId)) continue;
    const snapshot = await tx.refundEvidenceSnapshot.findUnique({
      where: { refundFinanceLedgerEntryId: adjustment.refundFinanceLedgerEntryId },
      select: { refundRecordId: true, historicalSaleFinanceLedgerEntryId: true },
    });
    if (!snapshot || snapshot.refundRecordId !== adjustment.refundRecordId ||
        lineBySale.get(snapshot.historicalSaleFinanceLedgerEntryId) !== adjustment.originalSettlementApprovalLineId ||
        claimAmountByAdjustment.get(claim.settlementRefundAdjustmentId) !== adjustment.remainingAmountMinor) {
      throw new Error('R1_CLAIM_COVERED_REFUND_AUTHORITY_CHANGED');
    }
    const covered = result.get(snapshot.historicalSaleFinanceLedgerEntryId) ?? {
      refundLedgerIds: new Set<string>(), refundRecordIds: new Set<string>(),
    };
    covered.refundLedgerIds.add(adjustment.refundFinanceLedgerEntryId);
    covered.refundRecordIds.add(adjustment.refundRecordId);
    result.set(snapshot.historicalSaleFinanceLedgerEntryId, covered);
  }
  return result;
}

/** Read-only until the caller persists the returned proof in its locked Mark Paid transaction. */
export async function proveR1MissedRefundsForSentEft(
  tx: Prisma.TransactionClient,
  payoutBatchId: string,
  eftExecutedAt: Date,
): Promise<R1MissedRefundProof> {
  const batch = await tx.payoutBatch.findUnique({ where: { id: payoutBatchId }, select: {
    id: true, vendorId: true, currency: true, createdAt: true,
    lines: { select: { financeLedgerEntryId: true, settlementApprovalLineId: true,
      settlementApprovalLine: { select: { lineType: true } },
      financeLedgerEntry: { select: { entryType: true } } } },
  } });
  if (!batch || !batch.lines.length) throw new Error('R1_MISSED_REFUND_BATCH_MISSING');
  const saleLines = new Map(batch.lines.filter((line) => line.financeLedgerEntry.entryType.toLowerCase() === 'sale')
    .map((line) => [line.financeLedgerEntryId, line.settlementApprovalLineId]));
  const timing = await classifyR1EftRefundTiming(tx, payoutBatchId, eftExecutedAt);
  if (timing.unknownRefundLedgerIds.length) throw new Error('R1_EFT_REFUND_TIMING_UNKNOWN');
  const representedRefundIds = new Set(batch.lines.filter((line) =>
    ['REFUND', 'REFUND_ADJUSTMENT'].includes(line.settlementApprovalLine?.lineType ?? '') &&
    line.financeLedgerEntry.entryType.toLowerCase() === 'refund').map((line) => line.financeLedgerEntryId));
  const claimCovered = await proveR1ClaimCoveredRefunds(tx, payoutBatchId);
  for (const covered of claimCovered.values()) {
    for (const refundId of covered.refundLedgerIds) representedRefundIds.add(refundId);
  }
  const refundIds = [...timing.beforeEftRefundLedgerIds, ...timing.afterEftRefundLedgerIds]
    .filter((id) => !representedRefundIds.has(id));
  if (!refundIds.length) return { bySaleLedgerId: claimCovered, records: [] };
  const snapshots = await tx.refundEvidenceSnapshot.findMany({
    where: { refundFinanceLedgerEntryId: { in: refundIds } },
    select: { refundFinanceLedgerEntryId: true, refundRecordId: true,
      historicalSaleFinanceLedgerEntryId: true, capturedAt: true },
  });
  if (snapshots.length !== refundIds.length) throw new Error('R1_MISSED_REFUND_ACCEPTED_EVIDENCE_MISSING');
  const snapshotByLedger = new Map(snapshots.map((snapshot) => [snapshot.refundFinanceLedgerEntryId, snapshot]));
  const diagnostic = await reconcilePayoutOffsetAuthorityInTransaction(tx, {
    vendorId: batch.vendorId, currency: batch.currency,
  });
  if (diagnostic.status !== 'VERIFIED') throw new Error('R1_MISSED_REFUND_ROUTE_NOT_VERIFIED');
  const bySaleLedgerId: R1MissedRefundProof['bySaleLedgerId'] = claimCovered;
  const records: R1MissedRefundProof['records'] = [];
  for (const refundLedgerId of refundIds) {
    const snapshot = snapshotByLedger.get(refundLedgerId);
    if (!snapshot) throw new Error('R1_MISSED_REFUND_ACCEPTED_EVIDENCE_MISSING');
    const approvalLineId = saleLines.get(snapshot.historicalSaleFinanceLedgerEntryId);
    if (!approvalLineId) throw new Error('R1_MISSED_REFUND_SALE_LINEAGE_CHANGED');
    // Refunds already accepted at payout preparation must have been represented
    // in the frozen payout. They cannot become an after-the-fact exception.
    if (snapshot.capturedAt.getTime() <= batch.createdAt.getTime()) {
      throw new Error('R1_REFUND_PREDATES_PAYOUT_MISSING_OFFSET');
    }
    if (snapshot.capturedAt.getTime() === eftExecutedAt.getTime()) {
      throw new Error('R1_EFT_REFUND_TIMING_UNKNOWN');
    }
    const adjustment = await tx.settlementRefundAdjustment.findUnique({
      where: { refundFinanceLedgerEntryId: refundLedgerId },
      select: { id: true, vendorId: true, currencyCode: true, refundRecordId: true,
        originalSettlementApprovalLineId: true, remainingAmountMinor: true },
    });
    const route = diagnostic.sources.find((source) =>
      source.sourceType === 'REFUND_ADJUSTMENT' && source.sourceId === adjustment?.id);
    if (!adjustment || adjustment.vendorId !== batch.vendorId || adjustment.currencyCode !== batch.currency ||
        adjustment.refundRecordId !== snapshot.refundRecordId ||
        adjustment.originalSettlementApprovalLineId !== approvalLineId ||
        !route || route.status !== 'VERIFIED' || route.refundFinanceLedgerEntryId !== refundLedgerId ||
        route.remainingAmountMinor !== adjustment.remainingAmountMinor ||
        await tx.settlementApprovalLine.count({ where: { financeLedgerEntryId: refundLedgerId,
          lineType: 'REFUND', settlementApproval: { status: { not: 'CANCELLED' } } } }) ||
        await tx.vendorBalanceEvent.count({ where: { vendorId: batch.vendorId,
          financeLedgerEntryId: refundLedgerId, type: 'VENDOR_DEBT_CREATED' } })) {
      throw new Error('R1_MISSED_REFUND_ROUTE_NOT_VERIFIED');
    }
    const linked = bySaleLedgerId.get(snapshot.historicalSaleFinanceLedgerEntryId) ?? {
      refundLedgerIds: new Set<string>(), refundRecordIds: new Set<string>(),
    };
    linked.refundLedgerIds.add(refundLedgerId);
    linked.refundRecordIds.add(snapshot.refundRecordId);
    bySaleLedgerId.set(snapshot.historicalSaleFinanceLedgerEntryId, linked);
    records.push({ refundFinanceLedgerEntryId: refundLedgerId,
      settlementRefundAdjustmentId: adjustment.id, acceptedAt: snapshot.capturedAt,
      outstandingAmountMinor: adjustment.remainingAmountMinor });
  }
  return { bySaleLedgerId, records };
}
