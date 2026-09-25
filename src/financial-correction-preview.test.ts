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
import {
  applyPaidFinancialCorrectionDebt,
  getPaidFinancialCorrectionState,
} from '../backend/src/modules/finance/financial-correction-paid-debt.service.js';
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
    storedEvidenceSnapshotId: 'snapshot-1',
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
    financialCorrectionAuthority: { findUnique: vi.fn().mockResolvedValue(null) },
    financialCorrectionBaselineClaim: { create: vi.fn().mockResolvedValue({ id: 'claim-1' }) },
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
    expect(await getZeroNetAcknowledgement('review-1', test.db)).toMatchObject({ id: result.id });
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

  it('does not acknowledge a baseline already consumed by a monetary correction', async () => {
    const test = zeroNetAcknowledgementFixture();
    const preview = await previewTerminalFinancialCorrection('review-1', test.input.db);
    test.tx.financialCorrectionAuthority.findUnique.mockResolvedValue({ id: 'paid-correction-1' });
    await expect(acknowledgeZeroNetReconciliation({ reviewId: 'review-1', previewFingerprint: preview.previewFingerprint,
      actorUserId: 'admin-1' }, test.db)).rejects.toMatchObject({ code: 'ACCEPTED_BASELINE_ALREADY_CONSUMED' });
    expect(test.create).not.toHaveBeenCalled();
    expect(test.tx.financialCorrectionBaselineClaim.create).not.toHaveBeenCalled();
  });
});

function paidCorrectionFixture() {
  const input = fixture();
  Object.assign(input.sale, { payoutStatus: 'PAID', settlementStatus: 'SETTLED', voidedAt: null });
  let authority: Record<string, unknown> | null = null;
  let debt: Record<string, unknown> | null = null;
  const paidAt = new Date('2026-09-03T00:00:00.000Z');
  const line = {
    financeLedgerEntryId: 'sale-1', settlementApprovalLineId: 'settlement-line-1',
    payoutBatch: { id: 'paid-batch-1', status: 'PAID', paidAt, vendorId: 'vendor-1', currency: 'TRY' },
    settlementApprovalLine: {
      id: 'settlement-line-1', financeLedgerEntryId: 'sale-1', lineType: 'SALE',
      settlementApproval: { id: 'settlement-1', status: 'APPROVED', vendorId: 'vendor-1', currency: 'TRY' },
    },
  };
  const payoutLines = vi.fn().mockResolvedValue([line]);
  const createAuthority = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    authority = { ...data, authorizedAt: new Date('2026-09-04T00:00:00.000Z'), appliedAt: new Date('2026-09-04T00:00:00.000Z'), debtEvent: null };
    return authority;
  });
  const createDebt = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    debt = { id: 'debt-1', ...data };
    if (authority) authority.debtEvent = debt;
    return debt;
  });
  const findAuthority = vi.fn(async ({ where }: { where: { reviewId?: string; id?: string } }) =>
    authority && (where.reviewId === authority.reviewId || where.id === authority.id) ? authority : null);
  const createClaim = vi.fn().mockResolvedValue({ id: 'claim-1' });
  const tx = {
    refundTerminalEvidenceReview: input.db.refundTerminalEvidenceReview,
    refundTerminalEvidenceReviewEvent: { findFirst: vi.fn().mockResolvedValue({ id: 'resolved-1', eventType: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' }) },
    financialCorrectionAuthority: { findUnique: findAuthority, create: createAuthority },
    financialCorrectionZeroNetAcknowledgement: { findUnique: vi.fn().mockResolvedValue(null) },
    financialCorrectionBaselineClaim: { findUnique: vi.fn().mockResolvedValue(null), create: createClaim },
    financeLedgerEntry: { findUnique: vi.fn().mockResolvedValue(input.sale) },
    payoutBatchLine: { findMany: payoutLines },
    vendorBalanceEvent: { create: createDebt },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked' }]),
  };
  const db = {
    ...tx,
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
      try { return await callback(tx); }
      catch (error) { authority = null; debt = null; throw error; }
    }),
  } as unknown as typeof prisma;
  return { input, tx, db, line, payoutLines, createAuthority, createDebt, createClaim,
    get authority() { return authority; }, get debt() { return debt; } };
}

describe('paid-payout financial correction vendor debt', () => {
  it('freezes the exact preview delta and PAID payout, then creates one correction-specific negative debt', async () => {
    const test = paidCorrectionFixture();
    const preview = await previewTerminalFinancialCorrection('review-1', test.input.db);
    const result = await applyPaidFinancialCorrectionDebt({
      reviewId: 'review-1', previewFingerprint: preview.previewFingerprint,
      actorUserId: 'admin-1', reason: '  Verified corrected evidence  ',
    }, test.db);
    expect(result).toMatchObject({ status: 'APPLIED', authorizedDebtMinor: 1760,
      historicalPayoutBatchId: 'paid-batch-1', vendorBalanceEventId: 'debt-1',
      authorizedByUserId: 'admin-1', reason: 'Verified corrected evidence' });
    expect(test.createAuthority).toHaveBeenCalledWith({ data: expect.objectContaining({
      acceptedEvidenceSnapshotId: 'snapshot-1', incomingConflictEvidenceId: 'incoming-1',
      acceptedRefundAmountMinor: 10000, correctedRefundAmountMinor: 12000,
      refundDifferenceMinor: 2000, commissionDifferenceMinor: 200, commissionVatDifferenceMinor: 40,
      vendorPayableDifferenceMinor: 1760, commissionPercent: new Prisma.Decimal('10'),
      commissionVatPercent: new Prisma.Decimal('20'), historicalPayoutBatchId: 'paid-batch-1',
      historicalPayoutPaidAt: test.line.payoutBatch.paidAt,
    }) });
    expect(test.createDebt).toHaveBeenCalledWith({ data: expect.objectContaining({
      type: 'VENDOR_DEBT_CREATED', amountMinor: -1760, sourceType: 'financial_correction',
      sourceId: result.id, financialCorrectionAuthorityId: result.id,
      idempotencyKey: `financial-correction:${result.id}:vendor-debt`,
    }) });
    expect(test.createClaim).toHaveBeenCalledWith({ data: expect.objectContaining({
      acceptedEvidenceSnapshotId: 'snapshot-1', consumerType: 'paid_vendor_debt', consumerId: result.id,
    }) });
    expect(test.input.write).not.toHaveBeenCalled();
  });

  it('returns the same applied authority on retry and after review Reopen', async () => {
    const test = paidCorrectionFixture();
    const preview = await previewTerminalFinancialCorrection('review-1', test.input.db);
    const request = { reviewId: 'review-1', previewFingerprint: preview.previewFingerprint, actorUserId: 'admin-1', reason: 'Verified' };
    const first = await applyPaidFinancialCorrectionDebt(request, test.db);
    test.input.review.status = 'ACTIVE';
    expect(await applyPaidFinancialCorrectionDebt(request, test.db)).toEqual(first);
    expect(test.createAuthority).toHaveBeenCalledTimes(1);
    expect(test.createDebt).toHaveBeenCalledTimes(1);
    await expect(applyPaidFinancialCorrectionDebt({ ...request, actorUserId: 'admin-2' }, test.db))
      .rejects.toMatchObject({ code: 'ALREADY_APPLIED' });
    expect(test.createDebt).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['PAID_PAYOUT_NOT_FOUND', (x: ReturnType<typeof paidCorrectionFixture>) => x.payoutLines.mockResolvedValue([])],
    ['PAYOUT_NOT_PAID', (x: ReturnType<typeof paidCorrectionFixture>) => { x.line.payoutBatch.status = 'REVIEW'; }],
    ['PAYOUT_PAID_AT_MISSING', (x: ReturnType<typeof paidCorrectionFixture>) => { x.line.payoutBatch.paidAt = null as never; }],
    ['PAID_PAYOUT_MISMATCH', (x: ReturnType<typeof paidCorrectionFixture>) => { x.line.settlementApprovalLine.financeLedgerEntryId = 'other'; }],
    ['HISTORICAL_FINANCE_MISMATCH', (x: ReturnType<typeof paidCorrectionFixture>) => { x.input.sale.payoutStatus = 'PENDING' as never; }],
  ])('fails closed for %s without creating money', async (code, mutate) => {
    const test = paidCorrectionFixture();
    const preview = await previewTerminalFinancialCorrection('review-1', test.input.db);
    mutate(test);
    await expect(applyPaidFinancialCorrectionDebt({ reviewId: 'review-1', previewFingerprint: preview.previewFingerprint,
      actorUserId: 'admin-1', reason: 'Verified' }, test.db)).rejects.toMatchObject({ code });
    expect(test.createAuthority).not.toHaveBeenCalled();
    expect(test.createDebt).not.toHaveBeenCalled();
  });

  it('rejects stale fingerprint, missing reason, consumed baseline, zero effect and credit', async () => {
    const stale = paidCorrectionFixture();
    await expect(applyPaidFinancialCorrectionDebt({ reviewId: 'review-1', previewFingerprint: `financial-correction-preview-v1:${'0'.repeat(64)}`,
      actorUserId: 'admin-1', reason: 'Verified' }, stale.db)).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    await expect(applyPaidFinancialCorrectionDebt({ reviewId: 'review-1', previewFingerprint: `financial-correction-preview-v1:${'0'.repeat(64)}`,
      actorUserId: 'admin-1', reason: '' }, stale.db)).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    const consumed = paidCorrectionFixture();
    const preview = await previewTerminalFinancialCorrection('review-1', consumed.input.db);
    consumed.tx.financialCorrectionZeroNetAcknowledgement.findUnique.mockResolvedValue({ id: 'zero-net-1' });
    await expect(applyPaidFinancialCorrectionDebt({ reviewId: 'review-1', previewFingerprint: preview.previewFingerprint,
      actorUserId: 'admin-1', reason: 'Verified' }, consumed.db)).rejects.toMatchObject({ code: 'BASELINE_ALREADY_CONSUMED' });
    expect(consumed.createDebt).not.toHaveBeenCalled();
    const credit = paidCorrectionFixture();
    const creditInput = fixture('120.00', '100.00');
    Object.assign(creditInput.sale, { payoutStatus: 'PAID', settlementStatus: 'SETTLED', voidedAt: null });
    credit.input.findUnique.mockResolvedValue(creditInput.review);
    const creditPreview = await previewTerminalFinancialCorrection('review-1', creditInput.db);
    await expect(applyPaidFinancialCorrectionDebt({ reviewId: 'review-1', previewFingerprint: creditPreview.previewFingerprint,
      actorUserId: 'admin-1', reason: 'Verified' }, credit.db)).rejects.toMatchObject({ code: 'VENDOR_CREDIT_NOT_SUPPORTED' });
    expect(credit.createDebt).not.toHaveBeenCalled();
    const zero = paidCorrectionFixture();
    const zeroInput = fixture('100.00', '120.00', '100.00', '0.00');
    Object.assign(zeroInput.sale, { payoutStatus: 'PAID', settlementStatus: 'SETTLED', voidedAt: null });
    zero.input.findUnique.mockResolvedValue(zeroInput.review);
    const zeroPreview = await previewTerminalFinancialCorrection('review-1', zeroInput.db);
    await expect(applyPaidFinancialCorrectionDebt({ reviewId: 'review-1', previewFingerprint: zeroPreview.previewFingerprint,
      actorUserId: 'admin-1', reason: 'Verified' }, zero.db)).rejects.toMatchObject({ code: 'NONZERO_ROUTE_UNSUPPORTED' });
    expect(zero.createDebt).not.toHaveBeenCalled();
  });

  it('rolls the application transaction back when authority or debt writing fails', async () => {
    const authorityFailure = paidCorrectionFixture();
    const preview = await previewTerminalFinancialCorrection('review-1', authorityFailure.input.db);
    authorityFailure.createAuthority.mockRejectedValueOnce(new Error('authority write failed'));
    await expect(applyPaidFinancialCorrectionDebt({ reviewId: 'review-1', previewFingerprint: preview.previewFingerprint,
      actorUserId: 'admin-1', reason: 'Verified' }, authorityFailure.db)).rejects.toThrow('authority write failed');
    expect(authorityFailure.authority).toBeNull();
    expect(authorityFailure.debt).toBeNull();
    expect(authorityFailure.createDebt).not.toHaveBeenCalled();

    const debtFailure = paidCorrectionFixture();
    const debtPreview = await previewTerminalFinancialCorrection('review-1', debtFailure.input.db);
    debtFailure.createDebt.mockRejectedValueOnce(new Error('debt write failed'));
    await expect(applyPaidFinancialCorrectionDebt({ reviewId: 'review-1', previewFingerprint: debtPreview.previewFingerprint,
      actorUserId: 'admin-1', reason: 'Verified' }, debtFailure.db)).rejects.toMatchObject({ code: 'EFFECT_WRITE_FAILED' });
    expect(debtFailure.authority).toBeNull();
    expect(debtFailure.debt).toBeNull();
  });

  it('exposes server-verified paid-route eligibility without writing', async () => {
    const test = paidCorrectionFixture();
    expect(await getPaidFinancialCorrectionState('review-1', test.db)).toMatchObject({ eligible: true, application: null });
    expect(test.createAuthority).not.toHaveBeenCalled();
    expect(test.createDebt).not.toHaveBeenCalled();
  });

  it('maps unique-key and Serializable losers to safe conflicts without a second effect', async () => {
    for (const [prismaCode, expectedCode] of [['P2002', 'BASELINE_ALREADY_CONSUMED'], ['P2034', 'CONCURRENT_APPLICATION']] as const) {
      const test = paidCorrectionFixture();
      const preview = await previewTerminalFinancialCorrection('review-1', test.input.db);
      vi.mocked(test.db.$transaction).mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('collision', {
        code: prismaCode, clientVersion: '6.19.3',
      }));
      await expect(applyPaidFinancialCorrectionDebt({ reviewId: 'review-1', previewFingerprint: preview.previewFingerprint,
        actorUserId: 'admin-1', reason: 'Verified' }, test.db)).rejects.toMatchObject({ code: expectedCode });
      expect(test.createDebt).not.toHaveBeenCalled();
    }
  });
});
