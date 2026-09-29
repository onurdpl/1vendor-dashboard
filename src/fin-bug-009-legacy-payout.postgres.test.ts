import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('FIN-BUG-009 legacy payout lineage with isolated PostgreSQL', () => {
  let db: PrismaClient;
  let review: typeof import('../backend/src/modules/finance/finance.service.js')['markPayoutBatchReview'];
  let paid: typeof import('../backend/src/modules/finance/finance.service.js')['markPayoutBatchPaid'];
  let prepare: typeof import('../backend/src/modules/finance/finance.service.js')['preparePayoutBatch'];
  let cancelPayout: typeof import('../backend/src/modules/finance/finance.service.js')['cancelPayoutBatch'];
  let cancelApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['cancelSettlementApproval'];
  let ids: Record<string, string>;
  const runPrefix = `fin-bug-009-${process.pid}-${Date.now()}`;
  let counter = 0;

  async function seed(input: { batch?: boolean; direct?: boolean } = {}) {
    await db.vendor.create({ data: { id: ids.vendor, name: 'Legacy Lineage Test Vendor' } });
    await db.shopifyOrder.create({ data: { id: ids.order, sourceShopifyOrderId: ids.shopifyOrder,
      sourceShopifyOrderNumber: `#${ids.run}` } });
    await db.vendorAllocation.create({ data: { id: ids.allocation, sourceShopifyOrderId: ids.order,
      sourceShopifyOrderNumber: `#${ids.run}`, originalVendorId: ids.vendor, assignedVendorId: ids.vendor,
      fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered' } });
    await db.fulfillment.create({ data: { id: ids.fulfillment, vendorAllocationId: ids.allocation,
      fulfillmentStatus: 'Fulfilled', fulfilledAt: new Date('2026-08-01T00:00:00Z'),
      shipmentUpdatedAt: new Date('2026-08-01T00:00:00Z') } });
    await db.financeLedgerEntry.create({ data: { id: ids.ledger, vendorAllocationId: ids.allocation,
      vendorId: ids.vendor, entryType: 'sale', amount: '100.00', payoutStatus: 'APPROVED',
      settlementStatus: 'PAYABLE', settlementEligibleAt: new Date('2026-08-01T00:00:00Z'),
      commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '0.00',
      settlementDelayDaysSnapshot: 0 } });
    await db.settlementApproval.create({ data: { id: ids.approval, vendorId: ids.vendor,
      status: 'APPROVED', currency: 'TRY', grossSalesMinor: 10000, refundTotalMinor: 0,
      commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 10000,
      sourceSnapshotJson: {}, approvedBy: ids.admin, approvedAt: new Date('2026-08-02T00:00:00Z'),
      lines: { create: { id: ids.approvalLine, financeLedgerEntryId: ids.ledger,
        lineType: 'SALE', amountMinor: 10000, commissionMinor: 0, commissionVatMinor: 0,
        payableImpactMinor: 10000, sourceSnapshotJson: {} } } } });
    if (input.batch !== false) {
      await db.payoutBatch.create({ data: { id: ids.batch, vendorId: ids.vendor, status: 'DRAFT',
        grossAmount: '100.00', netAmount: '100.00', currency: 'TRY', createdByUserId: ids.admin,
        lines: { create: { id: ids.batchLine, financeLedgerEntryId: ids.ledger,
          settlementApprovalLineId: input.direct ? ids.approvalLine : null,
          amountSnapshot: '100.00' } } } });
    }
  }

  async function addSecondSettlement(sameApproval = false) {
    const ledgerId = `${ids.run}-ledger-2`;
    const lineId = `${ids.run}-approval-line-2`;
    await db.financeLedgerEntry.create({ data: { id: ledgerId, vendorAllocationId: ids.allocation,
      vendorId: ids.vendor, entryType: 'sale', amount: '100.00', payoutStatus: 'APPROVED',
      settlementStatus: 'PAYABLE', settlementEligibleAt: new Date('2026-08-01T00:00:00Z'),
      commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '0.00',
      settlementDelayDaysSnapshot: 0 } });
    if (sameApproval) {
      await db.settlementApprovalLine.create({ data: { id: lineId,
        settlementApprovalId: ids.approval, financeLedgerEntryId: ledgerId, lineType: 'SALE',
        amountMinor: 10000, commissionMinor: 0, commissionVatMinor: 0,
        payableImpactMinor: 10000, sourceSnapshotJson: {} } });
    } else {
      await db.settlementApproval.create({ data: { id: `${ids.run}-approval-2`, vendorId: ids.vendor,
        status: 'APPROVED', currency: 'TRY', grossSalesMinor: 10000, refundTotalMinor: 0,
        commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 10000,
        sourceSnapshotJson: {}, approvedBy: ids.admin, approvedAt: new Date('2026-08-02T00:00:00Z'),
        lines: { create: { id: lineId, financeLedgerEntryId: ledgerId,
          lineType: 'SALE', amountMinor: 10000, commissionMinor: 0, commissionVatMinor: 0,
          payableImpactMinor: 10000, sourceSnapshotJson: {} } } } });
    }
    return { ledgerId, lineId };
  }

  beforeEach(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.FIN_BUG_009_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'fin_bug_009_validation') {
      throw new Error('FIN-BUG-009 PostgreSQL test requires isolated local fin_bug_009_validation.');
    }
    process.env.DATABASE_URL = databaseUrl;
    ({ markPayoutBatchReview: review, markPayoutBatchPaid: paid, preparePayoutBatch: prepare,
      cancelPayoutBatch: cancelPayout } =
      await import('../backend/src/modules/finance/finance.service.js'));
    ({ cancelSettlementApproval: cancelApproval } =
      await import('../backend/src/modules/finance/settlement-approval.service.js'));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    const run = `${runPrefix}-${++counter}`;
    ids = Object.fromEntries(['vendor', 'order', 'allocation', 'fulfillment', 'ledger', 'approval',
      'approvalLine', 'batch', 'batchLine', 'admin'].map((key) => [key, `${run}-${key}`]));
    ids.run = run;
    ids.shopifyOrder = `gid://shopify/Order/${run}`;
  });

  afterEach(async () => {
    if (!db) return;
    await db.financeEvent.deleteMany({ where: { vendorId: ids.vendor } });
    await db.payoutBatchLine.deleteMany({ where: { payoutBatch: { vendorId: ids.vendor } } });
    await db.payoutBatch.deleteMany({ where: { vendorId: ids.vendor } });
    await db.settlementApprovalLine.deleteMany({ where: { settlementApproval: { vendorId: ids.vendor } } });
    await db.settlementApproval.deleteMany({ where: { vendorId: ids.vendor } });
    await db.financeLedgerEntry.deleteMany({ where: { vendorId: ids.vendor } });
    await db.fulfillment.deleteMany({ where: { id: ids.fulfillment } });
    await db.vendorAllocation.deleteMany({ where: { id: ids.allocation } });
    await db.shopifyOrder.deleteMany({ where: { id: ids.order } });
    await db.vendor.deleteMany({ where: { id: ids.vendor } });
    await db.$disconnect();
  });

  it('reviews and marks a uniquely proven legacy payout paid without filling its NULL link', async () => {
    await seed();
    expect((await review(ids.batch)).status).toBe('review');
    expect((await db.payoutBatchLine.findUniqueOrThrow({ where: { id: ids.batchLine } })).settlementApprovalLineId)
      .toBeNull();
    expect((await paid(ids.batch, { paidAt: '2026-09-01T00:00:00Z' }, ids.admin)).status).toBe('paid');
    const events = await db.financeEvent.findMany({ where: { referenceId: ids.batch, eventType: 'PAYOUT_PAID' } });
    expect(events).toHaveLength(1);
    expect(events[0].idempotencyKey).toBe(`payout-batch:${ids.batch}:mark-paid:${ids.approvalLine}`);
    expect((events[0].metadataJson as Record<string, unknown>).settlementApprovalLineId).toBe(ids.approvalLine);
    expect((await db.payoutBatchLine.findUniqueOrThrow({ where: { id: ids.batchLine } })).settlementApprovalLineId)
      .toBeNull();
    await expect(paid(ids.batch, { paidAt: '2026-09-01T00:00:00Z' }, ids.admin))
      .rejects.toThrow('already paid');
    expect(await db.financeEvent.count({ where: { referenceId: ids.batch, eventType: 'PAYOUT_PAID' } })).toBe(1);
  });

  it('does not cancel a settlement backing a paid legacy payout', async () => {
    await seed();
    await review(ids.batch);
    await paid(ids.batch, { paidAt: '2026-09-01T00:00:00Z' }, ids.admin);
    const payoutBefore = await db.payoutBatch.findUniqueOrThrow({ where: { id: ids.batch } });
    const ledgerBefore = await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.ledger } });
    await expect(cancelApproval(ids.approval, ids.admin)).rejects.toThrow('paid payout batch');
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.approval } })).status)
      .toBe('APPROVED');
    expect(await db.payoutBatch.findUniqueOrThrow({ where: { id: ids.batch } })).toEqual(payoutBefore);
    expect(await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.ledger } })).toEqual(ledgerBefore);
    expect((await db.payoutBatchLine.findUniqueOrThrow({ where: { id: ids.batchLine } })).settlementApprovalLineId)
      .toBeNull();
  });

  it('keeps the existing direct-linked PAID cancellation protection', async () => {
    await seed({ direct: true });
    await review(ids.batch);
    await paid(ids.batch, { paidAt: '2026-09-01T00:00:00Z' }, ids.admin);
    await expect(cancelApproval(ids.approval, ids.admin)).rejects.toThrow('paid payout batch');
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.approval } })).status)
      .toBe('APPROVED');
  });

  it.each(['DRAFT', 'REVIEW'] as const)('does not treat a legacy %s payout as PAID on cancellation', async (status) => {
    await seed();
    if (status === 'REVIEW') await review(ids.batch);
    expect((await cancelApproval(ids.approval, ids.admin)).status).toBe('cancelled');
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: ids.batch } })).status).toBe(status);
  });

  it('does not invent settlement membership when legacy lineage is missing', async () => {
    await seed();
    await db.settlementApprovalLine.delete({ where: { id: ids.approvalLine } });
    expect((await cancelApproval(ids.approval, ids.admin)).status).toBe('cancelled');
  });

  it('does not treat a CANCELLED legacy payout as PAID', async () => {
    await seed();
    await cancelPayout(ids.batch);
    expect((await cancelApproval(ids.approval, ids.admin)).status).toBe('cancelled');
  });

  it('fails closed if a PAID legacy ledger gains ambiguous settlement lineage', async () => {
    await seed();
    await review(ids.batch);
    await paid(ids.batch, { paidAt: '2026-09-01T00:00:00Z' }, ids.admin);
    await db.settlementApproval.create({ data: { id: `${ids.run}-ambiguous-approval`, vendorId: ids.vendor,
      status: 'CANCELLED', currency: 'TRY', grossSalesMinor: 10000, refundTotalMinor: 0,
      commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 10000, sourceSnapshotJson: {},
      lines: { create: { financeLedgerEntryId: ids.ledger, lineType: 'SALE', amountMinor: 10000,
        commissionMinor: 0, commissionVatMinor: 0, payableImpactMinor: 10000, sourceSnapshotJson: {} } } } });
    await expect(cancelApproval(ids.approval, ids.admin)).rejects.toThrow('lineage is ambiguous');
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.approval } })).status)
      .toBe('APPROVED');
  });

  it('does not derive a second settlement from a modern payout direct link', async () => {
    await seed({ direct: true });
    await review(ids.batch);
    await paid(ids.batch, { paidAt: '2026-09-01T00:00:00Z' }, ids.admin);
    await db.settlementApproval.create({ data: { id: `${ids.run}-other-approval`, vendorId: ids.vendor,
      status: 'APPROVED', currency: 'TRY', grossSalesMinor: 10000, refundTotalMinor: 0,
      commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 10000, sourceSnapshotJson: {},
      lines: { create: { financeLedgerEntryId: ids.ledger, lineType: 'SALE', amountMinor: 10000,
        commissionMinor: 0, commissionVatMinor: 0, payableImpactMinor: 10000, sourceSnapshotJson: {} } } } });
    expect((await cancelApproval(`${ids.run}-other-approval`, ids.admin)).status).toBe('cancelled');
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.approval } })).status)
      .toBe('APPROVED');
  });

  it('allows cancellation of an unrelated settlement while a legacy payout is PAID', async () => {
    await seed();
    await review(ids.batch);
    await paid(ids.batch, { paidAt: '2026-09-01T00:00:00Z' }, ids.admin);
    await addSecondSettlement();
    expect((await cancelApproval(`${ids.run}-approval-2`, ids.admin)).status).toBe('cancelled');
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: ids.batch } })).status).toBe('PAID');
  });

  it('fails closed when a paid legacy line no longer matches its frozen settlement amount', async () => {
    await seed();
    await review(ids.batch);
    await paid(ids.batch, { paidAt: '2026-09-01T00:00:00Z' }, ids.admin);
    await db.payoutBatchLine.update({ where: { id: ids.batchLine }, data: { amountSnapshot: '99.00' } });
    await expect(cancelApproval(ids.approval, ids.admin)).rejects.toThrow('lineage is inconsistent');
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.approval } })).status)
      .toBe('APPROVED');
  });

  it('blocks cancellation of both settlements backing one PAID legacy pooled payout', async () => {
    await seed();
    const second = await addSecondSettlement();
    await db.payoutBatchLine.create({ data: { payoutBatchId: ids.batch,
      financeLedgerEntryId: second.ledgerId, settlementApprovalLineId: null,
      amountSnapshot: '100.00' } });
    await review(ids.batch);
    await paid(ids.batch, { paidAt: '2026-09-01T00:00:00Z' }, ids.admin);
    await expect(cancelApproval(ids.approval, ids.admin)).rejects.toThrow('paid payout batch');
    await expect(cancelApproval(`${ids.run}-approval-2`, ids.admin)).rejects.toThrow('paid payout batch');
  });

  it('does not commit PAID and CANCELLED together when Mark Paid races settlement cancellation', async () => {
    await seed();
    await review(ids.batch);
    const results = await Promise.allSettled([
      paid(ids.batch, { paidAt: '2026-09-01T00:00:00Z' }, ids.admin),
      cancelApproval(ids.approval, ids.admin),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const payout = await db.payoutBatch.findUniqueOrThrow({ where: { id: ids.batch } });
    const approval = await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.approval } });
    expect(payout.status === 'PAID' && approval.status === 'CANCELLED').toBe(false);
    if (payout.status === 'PAID') expect(approval.status).toBe('APPROVED');
    if (approval.status === 'CANCELLED') expect(payout.status).toBe('REVIEW');
  });

  it('keeps the same invariant when settlement cancellation starts before Mark Paid', async () => {
    await seed();
    await review(ids.batch);
    const results = await Promise.allSettled([
      cancelApproval(ids.approval, ids.admin),
      paid(ids.batch, { paidAt: '2026-09-01T00:00:00Z' }, ids.admin),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const payout = await db.payoutBatch.findUniqueOrThrow({ where: { id: ids.batch } });
    const approval = await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.approval } });
    expect(payout.status === 'PAID' && approval.status === 'CANCELLED').toBe(false);
    if (payout.status === 'PAID') expect(approval.status).toBe('APPROVED');
    if (approval.status === 'CANCELLED') expect(payout.status).toBe('REVIEW');
  });

  it('rejects a NULL line with no settlement candidate', async () => {
    await seed();
    await db.settlementApprovalLine.delete({ where: { id: ids.approvalLine } });
    await expect(review(ids.batch)).rejects.toMatchObject({
      blockers: expect.arrayContaining([expect.objectContaining({ code: 'settlement_approval_line_missing' })]),
    });
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: ids.batch } })).status).toBe('DRAFT');
  });

  it('rejects two settlement candidates for one ledger, even if one is cancelled', async () => {
    await seed();
    await db.settlementApproval.create({ data: { id: `${ids.run}-cancelled-approval`, vendorId: ids.vendor,
      status: 'CANCELLED', currency: 'TRY', grossSalesMinor: 10000, refundTotalMinor: 0,
      commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 10000, sourceSnapshotJson: {},
      lines: { create: { id: `${ids.run}-cancelled-line`, financeLedgerEntryId: ids.ledger,
        lineType: 'SALE', amountMinor: 10000, commissionMinor: 0, commissionVatMinor: 0,
        payableImpactMinor: 10000, sourceSnapshotJson: {} } } } });
    await expect(review(ids.batch)).rejects.toMatchObject({
      blockers: expect.arrayContaining([expect.objectContaining({ code: 'settlement_approval_line_ambiguous' })]),
    });
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: ids.batch } })).status).toBe('DRAFT');
    await db.settlementApproval.delete({ where: { id: `${ids.run}-cancelled-approval` } });
  });

  it('keeps modern direct lineage and the current payout writer authoritative', async () => {
    await seed({ batch: false });
    const prepared = await prepare({ vendorId: ids.vendor }, ids.admin);
    ids.batch = prepared.id;
    const line = await db.payoutBatchLine.findFirstOrThrow({ where: { payoutBatchId: prepared.id } });
    expect(line.settlementApprovalLineId).toBe(ids.approvalLine);
    expect((await review(prepared.id)).status).toBe('review');
  });

  it('does not fall back from a present direct link that points to the wrong ledger', async () => {
    await seed({ direct: true });
    const second = await addSecondSettlement(true);
    await db.payoutBatchLine.update({ where: { id: ids.batchLine },
      data: { financeLedgerEntryId: second.ledgerId } });
    await expect(review(ids.batch)).rejects.toMatchObject({
      blockers: expect.arrayContaining([expect.objectContaining({
        code: 'settlement_approval_line_ledger_mismatch',
      })]),
    });
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: ids.batch } })).status).toBe('DRAFT');
  });

  it('resolves ordinary NULL payout lines across two different approved settlements', async () => {
    await seed();
    const second = await addSecondSettlement();
    await db.payoutBatchLine.create({ data: { payoutBatchId: ids.batch,
      financeLedgerEntryId: second.ledgerId, settlementApprovalLineId: null,
      amountSnapshot: '100.00' } });
    expect((await review(ids.batch)).status).toBe('review');
    expect(await db.payoutBatchLine.count({ where: { payoutBatchId: ids.batch,
      settlementApprovalLineId: null } })).toBe(2);
  });

  it('blocks an active second payout claim on the same legacy ledger', async () => {
    await seed();
    await db.payoutBatch.create({ data: { vendorId: ids.vendor, status: 'DRAFT',
      grossAmount: '100.00', netAmount: '100.00', currency: 'TRY',
      lines: { create: { financeLedgerEntryId: ids.ledger,
        settlementApprovalLineId: null, amountSnapshot: '100.00' } } } });
    await expect(review(ids.batch)).rejects.toMatchObject({
      blockers: expect.arrayContaining([expect.objectContaining({
        code: 'settlement_approval_line_membership_conflict',
      })]),
    });
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: ids.batch } })).status).toBe('DRAFT');
  });

  it('allows only one concurrent DRAFT to REVIEW transition for a legacy batch', async () => {
    await seed();
    const outcomes = await Promise.allSettled([review(ids.batch), review(ids.batch)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: ids.batch } })).status).toBe('REVIEW');
    expect((await db.payoutBatchLine.findUniqueOrThrow({ where: { id: ids.batchLine } })).settlementApprovalLineId)
      .toBeNull();
  });
});
