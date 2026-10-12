import type { Prisma } from '@prisma/client';

export type R1EftRefundTiming = {
  beforeEftRefundLedgerIds: string[];
  afterEftRefundLedgerIds: string[];
  unknownRefundLedgerIds: string[];
};

/** Call only while holding the economic Vendor row lock shared with refund ingestion. */
export async function classifyR1EftRefundTiming(
  tx: Prisma.TransactionClient,
  payoutBatchId: string,
  eftExecutedAt: Date,
): Promise<R1EftRefundTiming> {
  const batch = await tx.payoutBatch.findUnique({
    where: { id: payoutBatchId },
    select: {
      vendorId: true,
      currency: true,
      lines: { select: { financeLedgerEntry: {
        select: { id: true, entryType: true, vendorId: true, vendorAllocationId: true },
      } } },
    },
  });
  if (!batch) throw new Error('R1_EFT_PAYOUT_BATCH_MISSING');
  const sales = batch.lines.map((line) => line.financeLedgerEntry)
    .filter((entry) => entry.entryType.toUpperCase() === 'SALE');
  if (sales.some((sale) => sale.vendorId !== batch.vendorId || !sale.vendorAllocationId)) {
    throw new Error('R1_EFT_SALE_AUTHORITY_CONFLICT');
  }
  const saleIds = new Set(sales.map((sale) => sale.id));
  const allocationIds = [...new Set(sales.map((sale) => sale.vendorAllocationId).filter((id): id is string => !!id))];
  if (!allocationIds.length) return { beforeEftRefundLedgerIds: [], afterEftRefundLedgerIds: [], unknownRefundLedgerIds: [] };

  const [records, ledgers] = await Promise.all([
    tx.refundRecord.findMany({
      where: { vendorAllocationId: { in: allocationIds } },
      select: { id: true, vendorAllocationId: true, sourceShopifyRefundId: true,
        sourceShopifyOrderId: true, status: true },
    }),
    tx.financeLedgerEntry.findMany({
      where: { vendorAllocationId: { in: allocationIds }, entryType: 'refund' },
      select: {
        id: true, vendorId: true, vendorAllocationId: true,
        refundEvidenceSnapshot: { select: {
          refundFinanceLedgerEntryId: true, refundRecordId: true, sourceShopifyRefundId: true,
          historicalEconomicVendorId: true, historicalSaleFinanceLedgerEntryId: true,
          vendorAllocationId: true, sourceShopifyOrderId: true, currency: true,
          monetaryClassification: true, capturedAt: true,
        } },
      },
    }),
  ]);
  const byRecord = new Map(records.map((record) => [record.id, record]));
  const linkedRecords = new Set<string>();
  const result: R1EftRefundTiming = {
    beforeEftRefundLedgerIds: [], afterEftRefundLedgerIds: [], unknownRefundLedgerIds: [],
  };
  for (const ledger of ledgers) {
    const evidence = ledger.refundEvidenceSnapshot;
    if (!evidence) {
      result.unknownRefundLedgerIds.push(ledger.id);
      continue;
    }
    const record = byRecord.get(evidence.refundRecordId);
    const aligned = record && record.vendorAllocationId === ledger.vendorAllocationId &&
      record.sourceShopifyRefundId === evidence.sourceShopifyRefundId &&
      record.sourceShopifyOrderId === evidence.sourceShopifyOrderId &&
      record.status === 'processed' &&
      ledger.id === evidence.refundFinanceLedgerEntryId &&
      ledger.vendorId === batch.vendorId && evidence.historicalEconomicVendorId === batch.vendorId &&
      evidence.currency === batch.currency && evidence.monetaryClassification === 'MONETARY_REFUND' &&
      evidence.vendorAllocationId === ledger.vendorAllocationId;
    if (!aligned) {
      result.unknownRefundLedgerIds.push(ledger.id);
      continue;
    }
    linkedRecords.add(evidence.refundRecordId);
    if (!saleIds.has(evidence.historicalSaleFinanceLedgerEntryId)) continue;
    const sale = sales.find((candidate) => candidate.id === evidence.historicalSaleFinanceLedgerEntryId);
    if (!sale || sale.vendorAllocationId !== ledger.vendorAllocationId ||
        !evidence.capturedAt || !Number.isFinite(evidence.capturedAt.getTime())) {
      result.unknownRefundLedgerIds.push(ledger.id);
      continue;
    }
    const delta = evidence.capturedAt.getTime() - eftExecutedAt.getTime();
    if (delta < 0) result.beforeEftRefundLedgerIds.push(ledger.id);
    else if (delta > 0) result.afterEftRefundLedgerIds.push(ledger.id);
    else result.unknownRefundLedgerIds.push(ledger.id);
  }
  for (const record of records) {
    if (!linkedRecords.has(record.id)) result.unknownRefundLedgerIds.push(`record:${record.id}`);
  }
  return result;
}
