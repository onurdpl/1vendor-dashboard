import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('settlement approval readiness on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let assessment: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['assessSettlementApprovalReadiness'];
  let candidateAssessment: typeof import('../backend/src/modules/finance/settlement-auto-approval-candidate.service.js')['assessAutomaticApprovalCandidate'];
  let approvalId: string;
  let allocationId: string;
  let saleId: string;
  let orderId: string;
  let sequence = 0;

  beforeEach(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SETTLEMENT_APPROVAL_READINESS_TEST_DATABASE_ISOLATED !== '1' ||
        target.hostname !== '127.0.0.1' ||
        !['5432', '5433', process.env.SETTLEMENT_APPROVAL_READINESS_TEST_PORT].includes(target.port) ||
        target.pathname !== '/settlement_approval_readiness_validation') {
      throw new Error('Settlement approval readiness test requires its isolated local PostgreSQL database.');
    }
    process.env.DATABASE_URL = databaseUrl;
    const [{ createDraftApproval, assessSettlementApprovalReadiness },
      { assessAutomaticApprovalCandidate },
      { recordVerifiedDeliveredObservation }] = await Promise.all([
      import('../backend/src/modules/finance/settlement-approval.service.js'),
      import('../backend/src/modules/finance/settlement-auto-approval-candidate.service.js'),
      import('../backend/src/modules/shipping/allocation-delivered-observation.service.js'),
    ]);
    assessment = assessSettlementApprovalReadiness;
    candidateAssessment = assessAutomaticApprovalCandidate;
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();

    const prefix = `approval-readiness-${process.pid}-${Date.now()}-${++sequence}`;
    const vendorId = `${prefix}-vendor`;
    orderId = `${prefix}-order`;
    allocationId = `${prefix}-allocation`;
    saleId = `${prefix}-sale`;
    const executionId = `${prefix}-execution`;
    await db.vendor.create({ data: { id: vendorId, name: 'Readiness Test Vendor' } });
    await db.vendorFinancialProfile.create({ data: {
      vendorId, settlementDelayDays: 0, settlementFrequencyType: 'WEEKLY',
      weeklySettlementDay: 'WEDNESDAY', autoSettlementDraftEnabled: false,
    } });
    await db.shopifyOrder.create({ data: {
      id: orderId, sourceShopifyOrderId: `gid://shopify/Order/${orderId}`,
      sourceShopifyOrderNumber: `#${orderId}`,
    } });
    await db.vendorAllocation.create({ data: {
      id: allocationId, sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: `#${orderId}`,
      originalVendorId: vendorId, assignedVendorId: vendorId,
      outboundMethodSnapshot: 'KARGONOMI', fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered',
    } });
    await db.shipmentExecution.create({ data: {
      id: executionId, allocationId, vendorId, provider: 'KARGONOMI',
      providerShipmentId: `${prefix}-shipment`, shipmentStatus: 'DELIVERED', requestSnapshot: {},
    } });
    const observation = await recordVerifiedDeliveredObservation({
      allocationId,
      source: { method: 'KARGONOMI', shipmentExecutionId: executionId,
        sourceReference: `${prefix}-shipment` },
    }, db as never);
    await db.fulfillment.create({ data: {
      id: `${prefix}-fulfillment`, vendorAllocationId: allocationId,
      fulfillmentStatus: 'Delivered', shipmentUpdatedAt: observation.firstObservedDeliveredAt,
    } });
    await db.financeLedgerEntry.create({ data: {
      id: saleId, vendorAllocationId: allocationId, vendorId, entryType: 'sale',
      amount: '100.00', payoutStatus: 'PENDING', settlementStatus: 'PENDING',
      commissionPercentSnapshot: '10.00', commissionVatPercentSnapshot: '20.00',
      settlementDelayDaysSnapshot: 0,
    } });
    const draft = await createDraftApproval({ vendorId, candidateScope: 'vendor_wide' });
    approvalId = draft.id;
    expect(draft.status).toBe('draft');
    expect(draft.lines.map((line) => line.financeLedgerEntryId)).toEqual([saleId]);
  });

  afterEach(async () => {
    await db?.$disconnect();
    // Immutable observation and financial fixture rows are disposed with this dedicated database.
  });

  it('reports a clean DRAFT without changing financial state', async () => {
    const before = await db.settlementApproval.findUniqueOrThrow({
      where: { id: approvalId }, include: { lines: true },
    });
    const result = await assessment(approvalId);
    const after = await db.settlementApproval.findUniqueOrThrow({
      where: { id: approvalId }, include: { lines: true },
    });

    expect(result).toMatchObject({
      writesPerformed: false, settlementApprovalId: approvalId, vendorId: before.vendorId,
      currency: 'TRY', status: 'DRAFT', classification: 'VERIFIED_BY_EXISTING_CHECKS',
      sourceValidation: { evaluated: true, ok: true, reasons: [] }, adminReviewRequired: true,
    });
    expect(after).toEqual(before);
    expect(await db.payoutBatch.count({ where: { vendorId: before.vendorId } })).toBe(0);
  });

  it('reports a new allocation hold through the existing approval predicate', async () => {
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'VENDOR_BLOCKED' } });
    const result = await assessment(approvalId);

    expect(result).toMatchObject({
      classification: 'BLOCKED', sourceValidation: { evaluated: true, ok: false, reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'vendor_blocked_finance_hold_active', financeLedgerEntryId: saleId }),
      ]) }, adminReviewRequired: true,
    });
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
  });

  it('blocks a post-DRAFT unresolved refund record without changing the DRAFT', async () => {
    await db.refundRecord.create({ data: {
      id: `${orderId}-refund`, vendorAllocationId: allocationId,
      sourceShopifyOrderId: `gid://shopify/Order/${orderId}`,
      sourceShopifyOrderNumber: `#${orderId}`,
      sourceShopifyRefundId: `gid://shopify/Refund/${orderId}`,
      amount: '10.00', status: 'pending',
    } });
    const result = await assessment(approvalId);

    expect(result?.classification).toBe('BLOCKED');
    expect(result?.sourceValidation.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'refund_arrived_after_draft', financeLedgerEntryId: saleId }),
    ]));
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
    expect(await db.payoutBatch.count({ where: { vendorId: result!.vendorId } })).toBe(0);
    expect(await candidateAssessment({ settlementApprovalId: approvalId, vendorId: result!.vendorId })).toMatchObject({
      classification: 'BLOCKED', approvalAuthorized: false,
      reasonCodes: expect.arrayContaining(['refund_arrived_after_draft']),
    });
  });

  it('classifies an ordinary verified SALE as evidence-only without financial writes or approval authority', async () => {
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    const beforeCounts = await Promise.all([
      db.financeLedgerEntry.count({ where: { vendorId: before.vendorId } }),
      db.settlementRefundAdjustment.count({ where: { vendorId: before.vendorId } }),
      db.payoutBatch.count({ where: { vendorId: before.vendorId } }),
      db.vendorBalanceEvent.count({ where: { vendorId: before.vendorId } }),
      db.settlementCommissionInvoice.count({ where: { vendorId: before.vendorId } }),
    ]);

    const result = await candidateAssessment({ settlementApprovalId: approvalId, vendorId: before.vendorId });

    expect(result).toMatchObject({
      settlementApprovalId: approvalId, vendorId: before.vendorId,
      classification: 'ELIGIBLE_EVIDENCE_ONLY', writesPerformed: false, approvalAuthorized: false,
      requiresWriteTimeRevalidation: true, readinessClassification: 'VERIFIED_BY_EXISTING_CHECKS',
      adminReviewRequiredByExistingReadiness: true,
      vendorProfile: { active: true, autoSettlementApproveEnabled: false },
      reasonCodes: ['ORDINARY_SALE_SOURCE_CHECKS_VERIFIED'], blockers: [], unresolvedAuthority: [],
    });
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } })).toEqual(before);
    expect(await Promise.all([
      db.financeLedgerEntry.count({ where: { vendorId: before.vendorId } }),
      db.settlementRefundAdjustment.count({ where: { vendorId: before.vendorId } }),
      db.payoutBatch.count({ where: { vendorId: before.vendorId } }),
      db.vendorBalanceEvent.count({ where: { vendorId: before.vendorId } }),
      db.settlementCommissionInvoice.count({ where: { vendorId: before.vendorId } }),
    ])).toEqual(beforeCounts);
  });

  it('does not reveal another vendor settlement through candidate assessment', async () => {
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, select: { vendorId: true } });
    expect(await candidateAssessment({ settlementApprovalId: approvalId, vendorId: `${row.vendorId}-other` })).toBeNull();
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
  });

  it('keeps an open integrity alert blocked in both readiness and candidate evidence', async () => {
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, select: { vendorId: true } });
    await db.financeIntegrityAlert.create({ data: {
      dedupeKey: `candidate-alert-${allocationId}`, severity: 'warning', category: 'multiple_active_sale_ledgers',
      vendorAllocationId: allocationId, reason: 'Synthetic test integrity hold', status: 'open',
    } });

    const result = await candidateAssessment({ settlementApprovalId: approvalId, vendorId: row.vendorId });
    expect(result).toMatchObject({
      classification: 'BLOCKED', approvalAuthorized: false,
      reasonCodes: expect.arrayContaining(['finance_integrity_alert_open']),
    });
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
  });

  it('returns UNKNOWN for correction and controlled replacement authority', async () => {
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, select: { vendorId: true } });
    await db.settlementApproval.update({ where: { id: approvalId }, data: { correctionCreditMinor: 100 } });
    const correction = await candidateAssessment({ settlementApprovalId: approvalId, vendorId: row.vendorId });
    expect(correction).toMatchObject({
      classification: 'UNKNOWN', approvalAuthorized: false,
      reasonCodes: expect.arrayContaining(['CORRECTION_AUTHORITY_UNVERIFIED']),
      adminReviewRequiredByExistingReadiness: true,
    });

    const original = await db.settlementApproval.create({ data: {
      vendorId: row.vendorId, status: 'CANCELLED', currency: 'TRY', grossSalesMinor: 0,
      refundTotalMinor: 0, commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 0,
      sourceSnapshotJson: {},
    } });
    await db.settlementApproval.update({ where: { id: approvalId }, data: {
      correctionCreditMinor: 0, replacesSettlementApprovalId: original.id,
      replacementRequestId: `${approvalId}-request`, replacementRequestedBy: 'readiness-test-admin',
      replacementReason: 'Synthetic read-only candidate classification test', replacementRequestedAt: new Date(),
    } });
    const replacement = await candidateAssessment({ settlementApprovalId: approvalId, vendorId: row.vendorId });
    expect(replacement).toMatchObject({
      classification: 'UNKNOWN', approvalAuthorized: false,
      reasonCodes: expect.arrayContaining(['REPLACEMENT_AUTHORITY_UNVERIFIED']),
      adminReviewRequiredByExistingReadiness: true,
    });
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
    expect(await db.settlementRefundAdjustment.count({ where: { vendorId: row.vendorId } })).toBe(0);
  });

  it('never treats a non-DRAFT settlement as an automatic candidate', async () => {
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, select: { vendorId: true } });
    const { approveSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js');
    await approveSettlementApproval(approvalId, 'readiness-test-admin');

    expect(await candidateAssessment({ settlementApprovalId: approvalId, vendorId: row.vendorId })).toMatchObject({
      classification: 'BLOCKED', approvalAuthorized: false, reasonCodes: ['NOT_DRAFT'],
      readinessClassification: 'BLOCKED', adminReviewRequiredByExistingReadiness: true,
    });
  });

  it.each([
    'grossSalesMinor', 'refundTotalMinor', 'commissionMinor', 'commissionVatMinor', 'netPayableMinor',
  ] as const)('rejects a one-minor-unit %s header mismatch before approving an ordinary SALE', async (field) => {
    const { approveSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js');
    const before = await db.settlementApproval.findUniqueOrThrow({
      where: { id: approvalId }, include: { lines: true },
    });
    await db.settlementApproval.update({ where: { id: approvalId }, data: { [field]: before[field] + 1 } });

    await expect(approveSettlementApproval(approvalId, 'monetary-reconciliation-test'))
      .rejects.toThrow(`Settlement approval monetary totals are inconsistent: ${field}.`);
    const after = await db.settlementApproval.findUniqueOrThrow({
      where: { id: approvalId }, include: { lines: true },
    });
    expect(after).toMatchObject({ status: 'DRAFT', approvedBy: null, approvedAt: null });
    expect(after[field]).toBe(before[field] + 1);
    expect(after.lines).toEqual(before.lines);
    expect(await db.payoutBatch.count({ where: { vendorId: before.vendorId } })).toBe(0);
    expect(await db.settlementRefundAdjustment.count({ where: { vendorId: before.vendorId } })).toBe(0);
  });
});
