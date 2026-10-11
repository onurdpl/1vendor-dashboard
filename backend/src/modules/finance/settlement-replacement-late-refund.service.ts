import type { Prisma } from '@prisma/client';

export type LateRefundBridge = {
  refundFinanceLedgerEntryId: string;
  refundRecordId: string;
  historicalSaleFinanceLedgerEntryId: string;
};

/** Verify an accepted, post-cutoff refund before binding its later adjustment to a replacement SALE. */
export async function verifyReplacementLateRefundBridges(
  tx: Prisma.TransactionClient,
  input: { vendorId: string; cutoff: Date; saleLedgerIds: string[]; allocationIds: string[] },
): Promise<{ bridges: LateRefundBridge[]; unverifiedRefundLedgerIds: string[] }> {
  const snapshots = await tx.refundEvidenceSnapshot.findMany({
    where: { historicalSaleFinanceLedgerEntryId: { in: input.saleLedgerIds }, capturedAt: { gt: input.cutoff } },
    include: {
      refundRecord: { select: { id: true, vendorAllocationId: true, sourceShopifyRefundId: true, amount: true, status: true } },
      refundFinanceLedgerEntry: {
        select: { id: true, vendorId: true, vendorAllocationId: true, entryType: true, amount: true,
          createdAt: true, payoutStatus: true, settlementStatus: true, voidedAt: true,
          settlementApprovalLines: { where: { settlementApproval: { status: { in: ['DRAFT', 'APPROVED'] } } },
            select: { id: true } },
          refundAdjustments: { select: { id: true } },
          vendorBalanceEvents: { where: { type: 'VENDOR_DEBT_CREATED' }, select: { id: true } },
        },
      },
      historicalSaleFinanceLedgerEntry: {
        select: { id: true, vendorId: true, vendorAllocationId: true, entryType: true, voidedAt: true,
          payoutStatus: true, settlementStatus: true },
      },
    },
  });
  const unresolvedReviews = await tx.refundTerminalEvidenceReview.findMany({
    where: { economicVendorId: input.vendorId, vendorAllocationId: { in: input.allocationIds },
      status: { not: 'RESOLVED' } },
    select: { terminalRefundFinanceLedgerEntryId: true },
  });
  const conflictedRefundIds = new Set(unresolvedReviews.map((row) => row.terminalRefundFinanceLedgerEntryId));
  const bridges: LateRefundBridge[] = [];
  const unverifiedRefundLedgerIds: string[] = [...conflictedRefundIds];
  for (const snapshot of snapshots) {
    const refund = snapshot.refundFinanceLedgerEntry;
    const sale = snapshot.historicalSaleFinanceLedgerEntry;
    const record = snapshot.refundRecord;
    const valid = snapshot.monetaryClassification === 'MONETARY_REFUND' && snapshot.currency === 'TRY' &&
      snapshot.historicalEconomicVendorId === input.vendorId &&
      input.saleLedgerIds.includes(sale.id) && input.allocationIds.includes(snapshot.vendorAllocationId) &&
      sale.entryType.toLowerCase() === 'sale' && sale.vendorId === input.vendorId &&
      sale.vendorAllocationId === snapshot.vendorAllocationId && !sale.voidedAt &&
      sale.payoutStatus.toUpperCase() !== 'PAID' && sale.settlementStatus.toUpperCase() !== 'SETTLED' &&
      refund.id === snapshot.refundFinanceLedgerEntryId && refund.entryType.toLowerCase() === 'refund' &&
      refund.vendorId === input.vendorId && refund.vendorAllocationId === snapshot.vendorAllocationId &&
      refund.createdAt > input.cutoff && !refund.voidedAt && refund.payoutStatus.toUpperCase() !== 'PAID' &&
      refund.amount.equals(snapshot.refundTotalAmount) &&
      record.id === snapshot.refundRecordId && record.vendorAllocationId === snapshot.vendorAllocationId &&
      record.sourceShopifyRefundId === snapshot.sourceShopifyRefundId && record.status === 'processed' &&
      record.amount?.equals(snapshot.refundTotalAmount) === true &&
      !conflictedRefundIds.has(refund.id) &&
      refund.settlementApprovalLines.length === 0 && refund.refundAdjustments.length === 0 &&
      refund.vendorBalanceEvents.length === 0;
    if (!valid) {
      unverifiedRefundLedgerIds.push(snapshot.refundFinanceLedgerEntryId);
      continue;
    }
    bridges.push({ refundFinanceLedgerEntryId: refund.id, refundRecordId: record.id,
      historicalSaleFinanceLedgerEntryId: sale.id });
  }
  const lateLedgers = await tx.financeLedgerEntry.findMany({
    where: { vendorId: input.vendorId, vendorAllocationId: { in: input.allocationIds },
      entryType: 'refund', createdAt: { gt: input.cutoff } }, select: { id: true },
  });
  const verifiedIds = new Set(bridges.map((item) => item.refundFinanceLedgerEntryId));
  for (const row of lateLedgers) {
    if (!verifiedIds.has(row.id) && !unverifiedRefundLedgerIds.includes(row.id)) {
      unverifiedRefundLedgerIds.push(row.id);
    }
  }
  return { bridges, unverifiedRefundLedgerIds };
}
