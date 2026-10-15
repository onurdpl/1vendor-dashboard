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

  it('approves through the trusted internal adapter with exact vendor and frozen authority', async () => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    expect((await db.vendorFinancialProfile.findUniqueOrThrow({ where: { vendorId: before.vendorId } }))
      .autoSettlementApproveEnabled).toBe(false);

    const forgedCaller = {
      settlementApprovalId: approvalId, expectedVendorId: before.vendorId, approvedBy: 'forged-admin',
    };
    const approved = await approveSettlementDraftInternally(forgedCaller);
    const after = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    expect(approved.status).toBe('approved');
    expect(after).toMatchObject({ status: 'APPROVED', approvedBy: 'system:settlement_auto_approval' });
    expect(after.approvedAt).toBeInstanceOf(Date);
    expect(after.lines).toEqual(before.lines);
    for (const field of ['grossSalesMinor', 'refundTotalMinor', 'commissionMinor', 'commissionVatMinor',
      'netPayableMinor', 'correctionCreditMinor', 'correctionDeductionMinor'] as const) {
      expect(after[field]).toBe(before[field]);
    }
    expect(after.lines.map((line) => line.financeLedgerEntryId)).toEqual([saleId]);
    const attempt = await db.settlementAutoApprovalAttempt.findFirstOrThrow({
      where: { settlementApprovalId: approvalId }, include: { events: true },
    });
    expect(attempt).toMatchObject({ vendorId: before.vendorId, actorId: 'system:settlement_auto_approval',
      outcome: 'APPROVED', completedAt: expect.any(Date) });
    expect(after.successfulAutoApprovalAttemptId).toBe(attempt.id);
    expect(attempt.events.map((event) => event.outcome)).toEqual(['STARTED', 'APPROVED']);
    expect(await db.payoutBatch.count({ where: { vendorId: before.vendorId } })).toBe(0);
    expect(await db.settlementCommissionInvoice.count({ where: { settlementApprovalId: approvalId } })).toBe(0);
    await expect(approveSettlementDraftInternally({ settlementApprovalId: approvalId, expectedVendorId: before.vendorId }))
      .rejects.toThrow('Only draft settlement approvals can be approved.');
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).approvedAt)
      .toEqual(after.approvedAt);
  });

  it('replays the exact successful attempt without a second financial write', async () => {
    const { approveSettlementDraftInternally, reconcileAutomaticApprovalAttempt } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const input = { settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
      attemptId: `${approvalId}-attempt` };
    const first = await approveSettlementDraftInternally(input);
    const second = await approveSettlementDraftInternally(input);
    expect(second.id).toBe(first.id);
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).approvedAt?.toISOString())
      .toBe(first.approvedAt);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(1);
    expect(await db.settlementAutoApprovalAttemptEvent.count({ where: { attemptId: input.attemptId } })).toBe(2);
    expect(await reconcileAutomaticApprovalAttempt(input)).toMatchObject({
      classification: 'VERIFIED_COMPLETED', reasonCode: 'EXACT_ATTEMPT_APPROVED',
      attemptOutcome: 'APPROVED', settlementStatus: 'APPROVED',
    });
    expect(await db.payoutBatch.count({ where: { vendorId: row.vendorId } })).toBe(0);
  });

  it('keeps a pre-commit STARTED attempt uncertain and refuses blind replay', async () => {
    const { approveSettlementDraftInternally, reconcileAutomaticApprovalAttempt } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const input = { settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
      attemptId: `${approvalId}-interrupted` };
    await db.settlementAutoApprovalAttempt.create({ data: {
      id: input.attemptId, settlementApprovalId: approvalId, vendorId: row.vendorId,
    } });
    expect(await reconcileAutomaticApprovalAttempt(input)).toMatchObject({
      classification: 'UNKNOWN', reasonCode: 'STARTED_OR_COMMIT_OUTCOME_UNCONFIRMED',
    });
    await expect(approveSettlementDraftInternally(input)).rejects.toThrow('already exists: UNKNOWN');
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
  });

  it('fails closed on forged success, changed ownership and immutable attempt events', async () => {
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const attemptId = `${approvalId}-guard`;
    await db.settlementAutoApprovalAttempt.create({ data: {
      id: attemptId, settlementApprovalId: approvalId, vendorId: row.vendorId,
    } });
    await expect(db.settlementAutoApprovalAttempt.update({ where: { id: attemptId }, data: {
      outcome: 'APPROVED', completedAt: new Date(),
    } })).rejects.toThrow();
    await expect(db.settlementAutoApprovalAttempt.update({ where: { id: attemptId }, data: {
      vendorId: `${row.vendorId}-other`,
    } })).rejects.toThrow();
    await expect(db.settlementAutoApprovalAttempt.create({ data: {
      id: `${attemptId}-wrong-vendor`, settlementApprovalId: approvalId,
      vendorId: `${row.vendorId}-other`,
    } })).rejects.toThrow();
    await expect(db.settlementAutoApprovalAttempt.create({ data: {
      id: `${attemptId}-forged-actor`, settlementApprovalId: approvalId,
      vendorId: row.vendorId, actorId: 'forged-admin',
    } })).rejects.toThrow();
    const event = await db.settlementAutoApprovalAttemptEvent.create({ data: {
      attemptId, outcome: 'STARTED', reasonCode: 'GUARD_TEST',
    } });
    await expect(db.settlementAutoApprovalAttemptEvent.delete({ where: { id: event.id } })).rejects.toThrow();
    expect((await db.settlementAutoApprovalAttempt.findUniqueOrThrow({ where: { id: attemptId } })).outcome)
      .toBe('STARTED');
  });

  it('records a canonical validation blocker without false success or financial side effects', async () => {
    const { approveSettlementDraftInternally, reconcileAutomaticApprovalAttempt } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'VENDOR_BLOCKED' } });
    const input = { settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
      attemptId: `${approvalId}-blocked` };
    await expect(approveSettlementDraftInternally(input)).rejects.toMatchObject({
      name: 'SettlementApprovalRevalidationError',
    });
    expect(await reconcileAutomaticApprovalAttempt(input)).toMatchObject({
      classification: 'BLOCKED', attemptOutcome: 'BLOCKED', settlementStatus: 'DRAFT',
    });
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).approvedBy).toBeNull();
    expect(await db.settlementRefundAdjustment.count({ where: { vendorId: row.vendorId } })).toBe(0);
    expect(await db.payoutBatch.count({ where: { vendorId: row.vendorId } })).toBe(0);
  });

  it('rolls back a monetary-inconsistent approval while retaining only blocked attempt evidence', async () => {
    const { approveSettlementDraftInternally } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    await db.settlementApproval.update({ where: { id: approvalId },
      data: { grossSalesMinor: row.grossSalesMinor + 1 } });
    await expect(approveSettlementDraftInternally({ settlementApprovalId: approvalId,
      expectedVendorId: row.vendorId, attemptId: `${approvalId}-invalid-money` }))
      .rejects.toThrow('Settlement approval monetary totals are inconsistent');
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } }))
      .toMatchObject({ status: 'DRAFT', approvedBy: null, successfulAutoApprovalAttemptId: null });
    expect(await db.settlementAutoApprovalAttempt.findFirstOrThrow({ where: { settlementApprovalId: approvalId } }))
      .toMatchObject({ outcome: 'BLOCKED' });
    expect(await db.settlementAutoApprovalAttemptEvent.count({ where: {
      attempt: { settlementApprovalId: approvalId }, outcome: 'APPROVED',
    } })).toBe(0);
  });

  it('keeps a completed attempt historically true after an authorized settlement cancellation', async () => {
    const { approveSettlementDraftInternally, reconcileAutomaticApprovalAttempt } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const { cancelSettlementApproval } = await import(
      '../backend/src/modules/finance/settlement-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const input = { settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
      attemptId: `${approvalId}-historical` };
    await approveSettlementDraftInternally(input);
    await cancelSettlementApproval(approvalId, 'test-admin');
    expect(await reconcileAutomaticApprovalAttempt(input)).toMatchObject({
      classification: 'VERIFIED_COMPLETED', reasonCode: 'APPROVED_THEN_CANCELLED',
      settlementStatus: 'CANCELLED', attemptOutcome: 'APPROVED',
    });
    await expect(approveSettlementDraftInternally(input)).rejects.toThrow('already exists');
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(1);
  });

  it('prevents concurrent callers sharing one attempt ID from duplicating approval evidence', async () => {
    const { approveSettlementDraftInternally, reconcileAutomaticApprovalAttempt } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const input = { settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
      attemptId: `${approvalId}-shared` };
    const results = await Promise.allSettled([
      approveSettlementDraftInternally(input), approveSettlementDraftInternally(input),
    ]);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect(await reconcileAutomaticApprovalAttempt(input)).toMatchObject({ classification: 'VERIFIED_COMPLETED' });
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(1);
    expect(await db.settlementAutoApprovalAttemptEvent.count({ where: { attemptId: input.attemptId,
      outcome: 'APPROVED' } })).toBe(1);
  });

  it('rejects a wrong expected vendor before any approval write', async () => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    await expect(approveSettlementDraftInternally({
      settlementApprovalId: approvalId, expectedVendorId: `${before.vendorId}-other`,
    })).rejects.toThrow('System settlement approval vendor identity does not match.');
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } }))
      .toEqual(before);
  });

  it('keeps the Admin actor and canonical blockers on the same approval executor', async () => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const { approveSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'VENDOR_BLOCKED' } });
    await expect(approveSettlementDraftInternally({
      settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
    })).rejects.toMatchObject({ name: 'SettlementApprovalRevalidationError' });
    await expect(approveSettlementApproval(approvalId, 'real-test-admin'))
      .rejects.toMatchObject({ name: 'SettlementApprovalRevalidationError' });
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'ACTIVE' } });
    await approveSettlementApproval(approvalId, 'real-test-admin');
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } }))
      .toMatchObject({ status: 'APPROVED', approvedBy: 'real-test-admin' });
  });

  it('allows only one system approval under concurrent attempts', async () => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const input = { settlementApprovalId: approvalId, expectedVendorId: row.vendorId };
    const results = await Promise.allSettled([
      approveSettlementDraftInternally(input), approveSettlementDraftInternally(input),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } }))
      .toMatchObject({ status: 'APPROVED', approvedBy: 'system:settlement_auto_approval' });
    expect(await db.settlementApproval.count({ where: { vendorId: row.vendorId } })).toBe(1);
    expect(await db.settlementRefundAdjustment.count({ where: { vendorId: row.vendorId } })).toBe(0);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId,
      outcome: 'APPROVED' } })).toBe(1);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(2);
  });

  it('allows only one winner when Admin and system approval race', async () => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const { approveSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const results = await Promise.allSettled([
      approveSettlementApproval(approvalId, 'racing-admin'),
      approveSettlementDraftInternally({ settlementApprovalId: approvalId, expectedVendorId: row.vendorId }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const persisted = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(persisted.status).toBe('APPROVED');
    expect(persisted.approvedBy).toBe(results[0].status === 'fulfilled' ? 'racing-admin' :
      'system:settlement_auto_approval');
    expect(await db.settlementApproval.count({ where: { vendorId: row.vendorId } })).toBe(1);
    const attempts = await db.settlementAutoApprovalAttempt.findMany({ where: { settlementApprovalId: approvalId } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe(persisted.approvedBy === 'system:settlement_auto_approval' ?
      'APPROVED' : 'BLOCKED');
  });

  it('does not reopen a cancelled DRAFT through the system adapter', async () => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const { cancelSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    await cancelSettlementApproval(approvalId, 'cancelling-admin');
    await expect(approveSettlementDraftInternally({
      settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
    })).rejects.toThrow('Only draft settlement approvals can be approved.');
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } }))
      .toMatchObject({ status: 'CANCELLED', cancelledBy: 'cancelling-admin', approvedBy: null });
    expect(await db.settlementAutoApprovalAttempt.findFirstOrThrow({ where: { settlementApprovalId: approvalId } }))
      .toMatchObject({ outcome: 'BLOCKED', reasonCode: 'SETTLEMENT_CANCELLED' });
  });

  it('keeps approval and cancellation mutually exclusive under concurrent requests', async () => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const { cancelSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const results = await Promise.allSettled([
      approveSettlementDraftInternally({ settlementApprovalId: approvalId, expectedVendorId: row.vendorId }),
      cancelSettlementApproval(approvalId, 'racing-canceller'),
    ]);
    const persisted = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    if (results[0].status === 'fulfilled' && results[1].status === 'fulfilled') {
      // Existing policy permits cancellation of APPROVED settlements with no payout or invoice.
      expect(persisted).toMatchObject({ status: 'CANCELLED', cancelledFromStatus: 'APPROVED',
        approvedBy: 'system:settlement_auto_approval' });
    } else if (results[0].status === 'fulfilled') {
      expect(persisted).toMatchObject({ status: 'APPROVED', approvedBy: 'system:settlement_auto_approval' });
    } else {
      expect(results[1].status).toBe('fulfilled');
      expect(persisted).toMatchObject({ status: 'CANCELLED', approvedBy: null });
    }
    expect(await db.settlementApproval.count({ where: { vendorId: row.vendorId } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId: row.vendorId } })).toBe(0);
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
