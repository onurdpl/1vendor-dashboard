import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Prisma } from '../backend/node_modules/@prisma/client/index.js';
import type { prisma } from '../backend/src/db/prisma.js';
import {
  FinancialCorrectionPreviewError,
  previewTerminalFinancialCorrection,
} from '../backend/src/modules/finance/financial-correction-preview.service.js';
import { normalizeRefundEvidence } from '../backend/src/modules/finance/refund-evidence-normalizer.service.js';

function fixture(acceptedAmount = '100.00', correctedAmount = '120.00', commission = '10.00', commissionVat = '20.00') {
  function normalized(amount: string) {
    return normalizeRefundEvidence({
      sourceShopifyRefundId: 'refund-1',
      sourceShopifyOrderId: 'order-1',
      vendorAllocationId: 'allocation-1',
      monetaryClassification: 'MONETARY_REFUND',
      refundTotalAmount: '150.00', // Refund-wide; never used as allocation amount.
      currency: 'TRY',
      transactions: [{ transactionGid: 'transaction-1', kind: 'REFUND', status: 'SUCCESS', amount: '150.00', currency: 'TRY' }],
      refundLines: [{ sourceLineItemId: 'line-1', quantity: 2, subtotalAmount: amount, currency: 'TRY' }],
      historicalEconomicVendorId: 'vendor-1',
      historicalSaleFinanceLedgerEntryId: 'sale-1',
      supersededSaleLedgerIds: ['sale-old'],
    });
  }
  const accepted = normalized(acceptedAmount);
  const incoming = normalized(correctedAmount);
  const sale = {
    id: 'sale-1', entryType: 'sale', vendorId: 'vendor-1', vendorAllocationId: 'allocation-1',
    commissionPercentSnapshot: new Prisma.Decimal(commission),
    commissionVatPercentSnapshot: new Prisma.Decimal(commissionVat),
  };
  const refund = {
    id: 'refund-ledger-1', entryType: 'refund', vendorId: 'vendor-1', vendorAllocationId: 'allocation-1',
    amount: new Prisma.Decimal(acceptedAmount), voidedAt: null, supersededByLedgerId: null,
    commissionPercentSnapshot: new Prisma.Decimal(commission),
    commissionVatPercentSnapshot: new Prisma.Decimal(commissionVat),
  };
  const snapshot = {
    id: 'snapshot-1', refundRecordId: 'record-1', refundFinanceLedgerEntryId: refund.id,
    refundFinanceLedgerEntry: refund, historicalSaleFinanceLedgerEntry: sale,
    ...accepted,
  };
  const conflict = {
    ...incoming, economicVendorId: incoming.historicalEconomicVendorId,
  };
  const review = {
    id: 'review-1', status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED',
    sourceShopifyRefundId: 'refund-1', sourceShopifyOrderId: 'order-1',
    vendorAllocationId: 'allocation-1', economicVendorId: 'vendor-1',
    refundRecordId: 'record-1',
    terminalRefundFinanceLedgerEntryId: refund.id, terminalRefundFinanceLedgerEntry: refund,
    storedEvidenceHash: accepted.evidenceHash, incomingEvidenceHash: incoming.evidenceHash,
    storedEvidenceSnapshot: snapshot, incomingConflictEvidence: conflict,
  };
  const findUnique = vi.fn().mockResolvedValue(review);
  const write = vi.fn();
  const db = {
    refundTerminalEvidenceReview: { findUnique, update: write, create: write },
    financeLedgerEntry: { create: write, update: write }, financeEvent: { create: write },
    settlementRefundAdjustment: { create: write }, vendorBalanceEvent: { create: write },
    settlementApproval: { update: write }, payoutBatch: { update: write },
  };
  return { review, snapshot, conflict, sale, refund, findUnique, write, db: db as unknown as Pick<typeof prisma, 'refundTerminalEvidenceReview'> };
}

async function rejectReason(input: ReturnType<typeof fixture>, reason: string) {
  await expect(previewTerminalFinancialCorrection('review-1', input.db))
    .rejects.toMatchObject({ name: FinancialCorrectionPreviewError.name, reasonCode: reason });
  expect(input.write).not.toHaveBeenCalled();
}

describe('terminal financial correction calculation preview', () => {
  it('calculates accepted and corrected positive states independently; never uses refund-wide total or quantity twice', async () => {
    const input = fixture();
    const result = await previewTerminalFinancialCorrection('review-1', input.db);
    expect(result).toMatchObject({
      reviewId: 'review-1', sourceShopifyRefundId: 'refund-1', vendorAllocationId: 'allocation-1',
      currency: 'TRY', economicDirection: 'VENDOR_DEDUCTION',
      accepted: { refundAmountMinor: 10000, commissionReversalMinor: 1000, commissionVatReversalMinor: 200, vendorPayableReversalMinor: 8800 },
      corrected: { refundAmountMinor: 12000, commissionReversalMinor: 1200, commissionVatReversalMinor: 240, vendorPayableReversalMinor: 10560 },
      difference: { refundAmountMinor: 2000, commissionReversalMinor: 200, commissionVatReversalMinor: 40, vendorPayableReversalMinor: 1760 },
    });
    expect(result?.acceptedEvidence.hash).toBe(input.snapshot.evidenceHash);
    expect(result?.incomingEvidence.hash).toBe(input.conflict.evidenceHash);
    expect(input.findUnique).toHaveBeenCalledTimes(1);
    expect(input.write).not.toHaveBeenCalled();
  });

  it('reports vendor credit and zero effect without any financial writer', async () => {
    const credit = fixture('120.00', '100.00');
    expect((await previewTerminalFinancialCorrection('review-1', credit.db)).economicDirection).toBe('VENDOR_CREDIT');
    const correctedToZero = fixture('100.00', '0.00');
    expect((await previewTerminalFinancialCorrection('review-1', correctedToZero.db)).corrected.refundAmountMinor).toBe(0);
    const zero = fixture('100.00', '120.00', '100.00', '0.00');
    const result = await previewTerminalFinancialCorrection('review-1', zero.db);
    expect(result.economicDirection).toBe('NONE');
    expect(result.difference).toMatchObject({ refundAmountMinor: 2000, commissionReversalMinor: 2000, vendorPayableReversalMinor: 0 });
    expect(credit.write).not.toHaveBeenCalled();
    expect(zero.write).not.toHaveBeenCalled();
  });

  it('uses existing per-state minor-unit rounding before subtracting', async () => {
    const input = fixture('0.04', '0.05', '10.00', '20.00');
    const result = await previewTerminalFinancialCorrection('review-1', input.db);
    expect(result.accepted.commissionReversalMinor).toBe(0);
    expect(result.corrected.commissionReversalMinor).toBe(1);
    expect(result.difference).toMatchObject({ refundAmountMinor: 1, commissionReversalMinor: 1, vendorPayableReversalMinor: 0 });
    expect(result.economicDirection).toBe('NONE');
  });

  it('rejects old or non-correction terminal reviews and unknown review identities', async () => {
    const old = fixture(); old.review.incomingConflictEvidence = null as never;
    await rejectReason(old, 'incoming_evidence_missing');
    const active = fixture(); active.review.status = 'ACTIVE';
    await rejectReason(active, 'correction_required_outcome_missing');
    const legacy = fixture(); legacy.findUnique.mockResolvedValue(null);
    await rejectReason(legacy, 'terminal_review_missing');
  });

  it.each([
    ['accepted_evidence_missing', (x: ReturnType<typeof fixture>) => { x.review.storedEvidenceSnapshot = null as never; }],
    ['accepted_evidence_hash', (x: ReturnType<typeof fixture>) => { x.snapshot.evidenceHash = 'bad'; x.review.storedEvidenceHash = 'bad'; }],
    ['incoming_evidence_hash', (x: ReturnType<typeof fixture>) => { x.conflict.evidenceHash = 'bad'; x.review.incomingEvidenceHash = 'bad'; }],
    ['incoming_evidence_version', (x: ReturnType<typeof fixture>) => { x.conflict.evidenceVersion = 99; }],
    ['refund_identity_mismatch', (x: ReturnType<typeof fixture>) => { x.conflict.sourceShopifyRefundId = 'other'; }],
    ['order_identity_mismatch', (x: ReturnType<typeof fixture>) => { x.conflict.sourceShopifyOrderId = 'other'; }],
    ['allocation_identity_mismatch', (x: ReturnType<typeof fixture>) => { x.conflict.vendorAllocationId = 'other'; }],
    ['economic_vendor_mismatch', (x: ReturnType<typeof fixture>) => { x.conflict.economicVendorId = 'other'; }],
    ['sale_lineage_mismatch', (x: ReturnType<typeof fixture>) => { x.conflict.historicalSaleFinanceLedgerEntryId = 'other'; }],
    ['historical_sale_authority_mismatch', (x: ReturnType<typeof fixture>) => { x.sale.vendorId = 'other'; }],
    ['accepted_refund_ledger_mismatch', (x: ReturnType<typeof fixture>) => { x.refund.entryType = 'sale'; }],
    ['accepted_refund_ledger_amount_mismatch', (x: ReturnType<typeof fixture>) => { x.refund.amount = new Prisma.Decimal('99.00'); }],
    ['historical_commission_missing', (x: ReturnType<typeof fixture>) => { x.sale.commissionPercentSnapshot = null as never; }],
    ['historical_commission_vat_missing', (x: ReturnType<typeof fixture>) => { x.sale.commissionVatPercentSnapshot = null as never; }],
    ['refund_commission_snapshot_mismatch', (x: ReturnType<typeof fixture>) => { x.refund.commissionPercentSnapshot = new Prisma.Decimal('11.00'); }],
    ['currency_not_try', (x: ReturnType<typeof fixture>) => { x.conflict.currency = 'USD'; }],
    ['incoming_evidence_malformed', (x: ReturnType<typeof fixture>) => {
      x.conflict.normalizedEvidenceJson = { bad: true } as never;
      x.conflict.evidenceHash = createHash('sha256').update('{"bad":true}').digest('hex');
      x.review.incomingEvidenceHash = x.conflict.evidenceHash;
    }],
  ])('fails closed: %s', async (reason, mutate) => {
    const input = fixture();
    mutate(input);
    await rejectReason(input, reason);
  });
});
