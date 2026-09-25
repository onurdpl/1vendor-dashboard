import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Prisma } from '../backend/node_modules/@prisma/client/index.js';
import type { prisma } from '../backend/src/db/prisma.js';
import {
  FinancialCorrectionPreviewError,
  previewTerminalFinancialCorrection,
} from '../backend/src/modules/finance/financial-correction-preview.service.js';
import {
  acknowledgeZeroNetReconciliation,
  getZeroNetAcknowledgement,
} from '../backend/src/modules/finance/financial-correction-zero-net-acknowledgement.service.js';
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
    amount: new Prisma.Decimal('200.00'), updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    commissionPercentSnapshot: new Prisma.Decimal(commission),
    commissionVatPercentSnapshot: new Prisma.Decimal(commissionVat),
  };
  const refund = {
    id: 'refund-ledger-1', entryType: 'refund', vendorId: 'vendor-1', vendorAllocationId: 'allocation-1',
    amount: new Prisma.Decimal(acceptedAmount), voidedAt: null, supersededByLedgerId: null,
    payoutStatus: 'PENDING', settlementStatus: 'PENDING', updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    commissionPercentSnapshot: new Prisma.Decimal(commission),
    commissionVatPercentSnapshot: new Prisma.Decimal(commissionVat),
  };
  const snapshot = {
    id: 'snapshot-1', refundRecordId: 'record-1', refundFinanceLedgerEntryId: refund.id,
    refundFinanceLedgerEntry: refund, historicalSaleFinanceLedgerEntry: sale,
    ...accepted,
  };
  const conflict = {
    ...incoming, id: 'incoming-1', economicVendorId: incoming.historicalEconomicVendorId,
  };
  const review = {
    id: 'review-1', status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED',
    updatedAt: new Date('2026-09-02T00:00:00.000Z'), occurrenceCount: 1,
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
    expect(result.previewFingerprint).toMatch(/^financial-correction-preview-v1:[a-f0-9]{64}$/);
    expect(input.findUnique).toHaveBeenCalledTimes(1);
    expect(input.write).not.toHaveBeenCalled();
  });

  it('binds the fingerprint to review freshness, evidence, historical SALE, and accepted REFUND authority', async () => {
    const input = fixture();
    const initial = await previewTerminalFinancialCorrection('review-1', input.db);
    expect((await previewTerminalFinancialCorrection('review-1', input.db)).previewFingerprint).toBe(initial.previewFingerprint);

    input.review.occurrenceCount += 1;
    const afterObservation = await previewTerminalFinancialCorrection('review-1', input.db);
    expect(afterObservation.previewFingerprint).not.toBe(initial.previewFingerprint);

    input.sale.updatedAt = new Date('2026-09-03T00:00:00.000Z');
    const afterSaleUpdate = await previewTerminalFinancialCorrection('review-1', input.db);
    expect(afterSaleUpdate.previewFingerprint).not.toBe(afterObservation.previewFingerprint);

    input.refund.payoutStatus = 'PAID';
    const afterRefundUpdate = await previewTerminalFinancialCorrection('review-1', input.db);
    expect(afterRefundUpdate.previewFingerprint).not.toBe(afterSaleUpdate.previewFingerprint);

    input.conflict.id = 'incoming-2';
    const afterEvidenceReplacement = await previewTerminalFinancialCorrection('review-1', input.db);
    expect(afterEvidenceReplacement.previewFingerprint).not.toBe(afterRefundUpdate.previewFingerprint);
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

function zeroNetAcknowledgementFixture() {
  const input = fixture('100.00', '120.00', '100.00', '0.00');
  let saved: Record<string, unknown> | null = null;
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    saved = { id: 'zero-net-1', acknowledgedAt: new Date('2026-09-25T12:00:00.000Z'), ...data };
    return saved;
  });
  const findUnique = vi.fn(async ({ where }: { where: { reviewId?: string; acceptedEvidenceSnapshotId?: string } }) => {
    if (!saved) return null;
    if (where.reviewId && saved.reviewId === where.reviewId) return saved;
    if (where.acceptedEvidenceSnapshotId && saved.acceptedEvidenceSnapshotId === where.acceptedEvidenceSnapshotId) return saved;
    return null;
  });
  const findFirstEvent = vi.fn().mockResolvedValue({
    id: 'event-resolved', eventType: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED',
  });
  const tx = {
    refundTerminalEvidenceReview: input.db.refundTerminalEvidenceReview,
    refundTerminalEvidenceReviewEvent: { findFirst: findFirstEvent },
    financialCorrectionZeroNetAcknowledgement: { findUnique, create },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'review-1' }]),
  };
  const db = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    financialCorrectionZeroNetAcknowledgement: tx.financialCorrectionZeroNetAcknowledgement,
  } as unknown as typeof prisma;
  return { input, tx, db, create, findUnique, findFirstEvent, get saved() { return saved; } };
}

describe('zero-net correction reconciliation acknowledgement', () => {
  it('freezes the exact server preview, Admin actor and resolved event without a financial write', async () => {
    const test = zeroNetAcknowledgementFixture();
    const preview = await previewTerminalFinancialCorrection('review-1', test.input.db);
    const result = await acknowledgeZeroNetReconciliation({
      reviewId: 'review-1', previewFingerprint: preview.previewFingerprint, actorUserId: 'admin-1', note: '  Reconciled  ',
    }, test.db);
    expect(result).toMatchObject({ reviewId: 'review-1', resolvedReviewEventId: 'event-resolved',
      acknowledgedByUserId: 'admin-1', vendorPayableDifferenceMinor: 0, economicDirection: 'NONE', note: 'Reconciled' });
    expect(test.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      acceptedEvidenceSnapshotId: 'snapshot-1', incomingConflictEvidenceId: 'incoming-1',
      acceptedEvidenceHash: test.input.snapshot.evidenceHash, incomingEvidenceHash: test.input.conflict.evidenceHash,
      historicalSaleFinanceLedgerEntryId: 'sale-1', acceptedRefundFinanceLedgerEntryId: 'refund-ledger-1',
      acceptedRefundAmountMinor: 10000, correctedRefundAmountMinor: 12000,
      refundDifferenceMinor: 2000, commissionDifferenceMinor: 2000,
      vendorPayableDifferenceMinor: 0, previewFingerprint: preview.previewFingerprint,
    }) });
    expect(await getZeroNetAcknowledgement('review-1', test.db)).toMatchObject({ id: 'zero-net-1' });
    expect(test.input.write).not.toHaveBeenCalled();
  });

  it('returns the same historical record on an exact retry, including after Reopen', async () => {
    const test = zeroNetAcknowledgementFixture();
    const preview = await previewTerminalFinancialCorrection('review-1', test.input.db);
    const request = { reviewId: 'review-1', previewFingerprint: preview.previewFingerprint, actorUserId: 'admin-1' };
    const first = await acknowledgeZeroNetReconciliation(request, test.db);
    test.input.review.status = 'ACTIVE';
    const second = await acknowledgeZeroNetReconciliation(request, test.db);
    expect(second).toEqual(first);
    expect(test.create).toHaveBeenCalledTimes(1);
    await expect(acknowledgeZeroNetReconciliation({ ...request, previewFingerprint: `financial-correction-preview-v1:${'0'.repeat(64)}` }, test.db))
      .rejects.toMatchObject({ code: 'ALREADY_ACKNOWLEDGED' });
  });

  it('rejects stale, nonzero, invalid and missing authority without persistence', async () => {
    const stale = zeroNetAcknowledgementFixture();
    await expect(acknowledgeZeroNetReconciliation({ reviewId: 'review-1', previewFingerprint: `financial-correction-preview-v1:${'0'.repeat(64)}`, actorUserId: 'admin-1' }, stale.db))
      .rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    expect(stale.create).not.toHaveBeenCalled();

    const observed = zeroNetAcknowledgementFixture();
    const observedPreview = await previewTerminalFinancialCorrection('review-1', observed.input.db);
    observed.input.review.occurrenceCount += 1;
    await expect(acknowledgeZeroNetReconciliation({ reviewId: 'review-1', previewFingerprint: observedPreview.previewFingerprint, actorUserId: 'admin-1' }, observed.db))
      .rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    expect(observed.create).not.toHaveBeenCalled();

    const changedRate = zeroNetAcknowledgementFixture();
    const changedPreview = await previewTerminalFinancialCorrection('review-1', changedRate.input.db);
    changedRate.input.sale.commissionPercentSnapshot = new Prisma.Decimal('99.00');
    await expect(acknowledgeZeroNetReconciliation({ reviewId: 'review-1', previewFingerprint: changedPreview.previewFingerprint, actorUserId: 'admin-1' }, changedRate.db))
      .rejects.toMatchObject({ code: 'AUTHORITY_INVALID_REFUND_COMMISSION_SNAPSHOT_MISMATCH' });
    expect(changedRate.create).not.toHaveBeenCalled();

    const nonzero = zeroNetAcknowledgementFixture();
    nonzero.input.sale.commissionPercentSnapshot = new Prisma.Decimal('10.00');
    nonzero.input.refund.commissionPercentSnapshot = new Prisma.Decimal('10.00');
    const nonzeroPreview = await previewTerminalFinancialCorrection('review-1', nonzero.input.db);
    await expect(acknowledgeZeroNetReconciliation({ reviewId: 'review-1', previewFingerprint: nonzeroPreview.previewFingerprint, actorUserId: 'admin-1' }, nonzero.db))
      .rejects.toMatchObject({ code: 'NONZERO_CORRECTION_NOT_SUPPORTED' });
    expect(nonzero.create).not.toHaveBeenCalled();

    const invalid = zeroNetAcknowledgementFixture();
    invalid.input.review.incomingConflictEvidence = null as never;
    await expect(acknowledgeZeroNetReconciliation({ reviewId: 'review-1', previewFingerprint: `financial-correction-preview-v1:${'0'.repeat(64)}`, actorUserId: 'admin-1' }, invalid.db))
      .rejects.toMatchObject({ code: 'AUTHORITY_INVALID_INCOMING_EVIDENCE_MISSING' });
    expect(invalid.create).not.toHaveBeenCalled();
  });

  it('fails closed when the historical RESOLVED event is missing or persistence fails', async () => {
    const missingEvent = zeroNetAcknowledgementFixture();
    const preview = await previewTerminalFinancialCorrection('review-1', missingEvent.input.db);
    missingEvent.findFirstEvent.mockResolvedValue(null);
    await expect(acknowledgeZeroNetReconciliation({ reviewId: 'review-1', previewFingerprint: preview.previewFingerprint, actorUserId: 'admin-1' }, missingEvent.db))
      .rejects.toMatchObject({ code: 'REVIEW_NOT_ELIGIBLE' });
    expect(missingEvent.create).not.toHaveBeenCalled();

    const failure = zeroNetAcknowledgementFixture();
    failure.create.mockRejectedValue(new Error('database write failed'));
    await expect(acknowledgeZeroNetReconciliation({ reviewId: 'review-1', previewFingerprint: preview.previewFingerprint, actorUserId: 'admin-1' }, failure.db))
      .rejects.toThrow('database write failed');
    expect(failure.saved).toBeNull();
  });
});
