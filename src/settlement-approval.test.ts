import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  financeLedgerEntry: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  settlementApproval: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  settlementApprovalLine: {
    count: vi.fn(),
    update: vi.fn(),
  },
  financialCorrectionCredit: {
    findMany: vi.fn(),
  },
  financialCorrectionDeduction: {
    findMany: vi.fn(),
  },
  financialCorrectionCreditSettlementLine: {
    updateMany: vi.fn(),
  },
  financialCorrectionDeductionSettlementLine: {
    updateMany: vi.fn(),
  },
  financialCorrectionApprovedDeductionCoverage: {
    findFirst: vi.fn(),
  },
  settlementRefundAdjustment: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  settlementRefundAdjustmentApplication: {
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  settlementRefundAdjustmentEvent: {
    create: vi.fn(),
  },
  vendorBillingProfile: {
    findUnique: vi.fn(),
  },
  payoutBatch: {
    create: vi.fn(),
  },
  payoutOffsetClaim: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  vendorBalanceEvent: {
    findMany: vi.fn(),
  },
  financeIntegrityAlert: {
    findMany: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  assessSettlementApprovalReadiness,
  approveSettlementApproval,
  cancelSettlementApproval,
  createDraftApproval,
  getSettlementApprovalAudit,
  listSettlementApprovalsForVendor,
  previewApproval,
  SettlementApprovalRevalidationError,
  __settlementApprovalTesting,
} = await import('../backend/src/modules/finance/settlement-approval.service.js');

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function buildLedgerRow(input: {
  id: string;
  entryType: 'sale' | 'refund';
  amount: number;
  fulfilled?: boolean;
  deliveredAt?: Date | null;
  activeApproval?: boolean;
  activeApprovalId?: string;
  activePayoutBatch?: boolean;
  settlementStatus?: string;
  payoutStatus?: string;
  refundRecords?: Array<{ id: string; sourceShopifyRefundId: string; amount: number }>;
  returnRecords?: Array<{
    id: string;
    status: string;
    returnLifecycleStatus: string | null;
    sourceShopifyRefundId?: string | null;
  }>;
  commissionPercentSnapshot?: number | null;
  commissionVatPercentSnapshot?: number | null;
  shippingModeSnapshot?: string | null;
  financialProfileIdSnapshot?: string | null;
  settlementDelayDaysSnapshot?: number | null;
  relatedSalePaid?: boolean;
  relatedSaleActiveApproval?: boolean;
  relatedSaleActivePayoutBatch?: boolean;
  sourceShopifyOrderId?: string;
  sourceShopifyOrderNumber?: string;
	  cancelledAt?: Date | null;
	  voidedAt?: Date | null;
	  cancelRefundReviewStatus?: string | null;
	  allocationStatus?: string | null;
	  customerCancellationRequestStatus?: 'PENDING' | 'PARTIALLY_RESOLVED' | 'APPROVED_FOR_REFUND' | 'APPROVED' | 'DECLINED' | 'TOO_LATE' | 'CONFLICTED';
	  customerCancellationItemStatus?: 'PENDING' | 'APPROVED_FOR_REFUND' | 'APPROVED' | 'DECLINED' | 'TOO_LATE' | 'CONFLICTED';
	}) {
  const fulfilled = input.fulfilled ?? true;
  const createdAt = new Date('2026-06-01T10:00:00.000Z');
  const deliveredAt =
    input.deliveredAt === undefined
      ? fulfilled
        ? new Date('2026-05-10T10:00:00.000Z')
        : null
      : input.deliveredAt;
  const settlementDelayDaysSnapshot = input.settlementDelayDaysSnapshot ?? 21;
  const eligibleAt = fulfilled && deliveredAt ? addDays(deliveredAt, settlementDelayDaysSnapshot) : null;
  const allocationId = `alloc-${input.id}`;
  const refundRecords = input.refundRecords ?? (input.entryType === 'refund'
    ? [{ id: `refund-record-${input.id}`, sourceShopifyRefundId: `refund-${input.id}`, amount: input.amount }]
    : []);
  const relatedSaleId = `sale-for-${input.id}`;
  return {
    id: input.id,
    vendorId: 'vendor-a',
    entryType: input.entryType,
    amount: input.amount,
    payoutStatus: input.payoutStatus ?? 'PENDING',
    description: `${input.entryType} row`,
    commissionPercentSnapshot:
      input.commissionPercentSnapshot ?? (input.entryType === 'sale' ? 10 : null),
    commissionVatPercentSnapshot:
      input.commissionVatPercentSnapshot ?? (input.entryType === 'sale' ? 20 : null),
    deductShippingEnabledSnapshot: false,
    shippingModeSnapshot: input.shippingModeSnapshot ?? 'DISABLED',
    fixedShippingFeeSnapshot: null,
    shippingCostSnapshot: null,
    shippingVatAmountSnapshot: null,
    shippingCostSourceSnapshot: null,
    shippingCostProviderSnapshot: null,
    financialProfileIdSnapshot: input.financialProfileIdSnapshot ?? 'profile-current',
    settlementDelayDaysSnapshot,
    settlementStatus:
      input.settlementStatus ??
      (input.entryType === 'refund' ? 'PARTIALLY_REFUNDED' : fulfilled ? 'PAYABLE' : 'ACCRUING'),
    settlementEligibleAt: eligibleAt,
    accruedAt: createdAt,
    payableAt: eligibleAt,
    settledAt: null,
    settlementHoldReason: null,
    voidedAt: input.voidedAt ?? null,
    voidReason: input.voidedAt ? 'economic transfer superseded source ledger' : null,
    supersededByLedgerId: input.voidedAt ? `replacement-${input.id}` : null,
    createdAt,
    refundEvidenceSnapshot: input.entryType === 'refund' && refundRecords[0] ? {
      refundFinanceLedgerEntryId: input.id,
      refundRecordId: refundRecords[0].id,
      sourceShopifyRefundId: refundRecords[0].sourceShopifyRefundId,
      vendorAllocationId: allocationId,
      historicalEconomicVendorId: 'vendor-a',
      historicalSaleFinanceLedgerEntryId: relatedSaleId,
    } : null,
	    vendorAllocation: {
	      id: allocationId,
	      outboundMethodSnapshot: 'KARGONOMI',
	      outboundIntegrationProviderSnapshot: null,
	      deliveredObservation: deliveredAt ? {
	        vendorAllocationId: allocationId,
	        outboundMethod: 'KARGONOMI',
	        outboundIntegrationProvider: null,
	        firstObservedDeliveredAt: deliveredAt,
	      } : null,
	      allocationStatus: input.allocationStatus ?? 'ACTIVE',
	      cancelRefundReviewStatus: input.cancelRefundReviewStatus ?? null,
      customerCancellationRequestItems: input.customerCancellationRequestStatus
        ? [{
            status: input.customerCancellationItemStatus ?? 'PENDING',
            request: { status: input.customerCancellationRequestStatus },
          }]
        : [],
      fulfillmentStatus: fulfilled ? 'Fulfilled' : 'Pending',
      shippingStatus: fulfilled ? 'Delivered' : 'Awaiting Shipment',
      sourceShopifyOrderId: input.sourceShopifyOrderId ?? `order-${input.id}`,
      sourceShopifyOrderNumber: input.sourceShopifyOrderNumber ?? '#1001',
      order: {
        cancelledAt: input.cancelledAt ?? null,
      },
      fulfillment: {
        fulfilledAt: fulfilled ? createdAt : null,
        shipmentUpdatedAt: deliveredAt,
      },
      refundRecords,
      returnRecords: (input.returnRecords ?? []).map((record) => ({
        ...record,
        sourceShopifyRefundId: record.sourceShopifyRefundId ?? null,
      })),
      financeEntries: input.entryType === 'refund'
        ? [
            {
              id: relatedSaleId,
              vendorId: 'vendor-a',
              entryType: 'sale',
              payoutStatus: input.relatedSalePaid ? 'PAID' : 'PENDING',
              settlementStatus: input.relatedSalePaid ? 'SETTLED' : 'PAYABLE',
              commissionPercentSnapshot: input.commissionPercentSnapshot ?? 10,
              commissionVatPercentSnapshot: input.commissionVatPercentSnapshot ?? 20,
              payoutBatchLines: input.relatedSaleActivePayoutBatch
                ? [{ payoutBatch: { status: 'DRAFT' } }]
                : [],
              settlementApprovalLines: input.relatedSaleActiveApproval
                ? [{ settlementApproval: { id: `approval-sale-for-${input.id}`, status: 'APPROVED' } }]
                : [],
            },
          ]
        : [],
    },
    settlementApprovalLines: input.activeApproval
      ? [
          {
            id: `approval-line-${input.id}`,
            settlementApproval: {
              id: input.activeApprovalId ?? `approval-${input.id}`,
              status: 'APPROVED',
            },
          },
        ]
      : [],
    payoutBatchLines: input.activePayoutBatch
      ? [
          {
            id: `payout-batch-line-${input.id}`,
            payoutBatch: {
              id: `payout-batch-${input.id}`,
              status: 'DRAFT',
            },
          },
        ]
      : [],
  };
}

function buildApproval(input: {
  id: string;
  status: 'DRAFT' | 'APPROVED' | 'CANCELLED';
  commissionInvoices?: Array<{ id: string; status: 'PENDING' | 'CREATED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN' }>;
}) {
  return {
    id: input.id,
    createdAt: new Date('2026-06-01T11:00:00.000Z'),
    updatedAt: new Date('2026-06-01T11:00:00.000Z'),
    vendorId: 'vendor-a',
    periodStart: null,
    periodEnd: null,
    status: input.status,
    currency: 'TRY',
    grossSalesMinor: 100000,
    refundTotalMinor: 10000,
    commissionMinor: 10000,
    commissionVatMinor: 2000,
    netPayableMinor: 78000,
    correctionCreditMinor: 0,
    correctionDeductionMinor: 0,
    approvedBy: input.status === 'APPROVED' ? 'admin-1' : null,
    approvedAt: input.status === 'APPROVED' ? new Date('2026-06-01T12:00:00.000Z') : null,
    cancelledBy: input.status === 'CANCELLED' ? 'admin-2' : null,
    cancelledAt: input.status === 'CANCELLED' ? new Date('2026-06-01T13:00:00.000Z') : null,
    notes: null,
    sourceSnapshotJson: { vendorId: 'vendor-a' },
    commissionInvoices: input.commissionInvoices ?? [],
    lines: [
      {
        id: 'line-1',
        settlementApprovalId: input.id,
        financeLedgerEntryId: 'sale-1',
        lineType: 'SALE',
        amountMinor: 100000,
        commissionMinor: 10000,
        commissionVatMinor: 2000,
        payableImpactMinor: 88000,
        sourceSnapshotJson: { financeLedgerEntryId: 'sale-1' },
      },
    ],
    correctionCreditLines: [],
    correctionDeductionLines: [],
  };
}

function buildBillingProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'billing-1',
    vendorId: 'vendor-a',
    legalCompanyName: 'Yali Spor A.S.',
    taxNumber: '1234567890',
    taxOffice: 'Kadikoy',
    billingAddress: 'Billing address',
    billingCity: 'Istanbul',
    billingDistrict: 'Kadikoy',
    iban: null,
    authorizedPerson: 'Authorized Person',
    billingEmail: 'billing@yali.test',
    billingPhone: '+905551112233',
    legalEntityType: 'limited_company',
    logoIsbasiCustomerCode: 'LOGO-CODE-1',
    logoIsbasiCustomerId: 'LOGO-ID-1',
    logoIsbasiEinvoiceEligible: true,
    logoIsbasiLastCheckedAt: new Date('2026-06-01T09:00:00.000Z'),
    createdAt: new Date('2026-06-01T09:00:00.000Z'),
    updatedAt: new Date('2026-06-01T09:00:00.000Z'),
    ...overrides,
  };
}

describe('settlement approval foundation', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockReset();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.$queryRaw.mockReset();
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.financeLedgerEntry.findMany.mockReset();
    prismaMock.financeLedgerEntry.findUnique.mockReset();
    prismaMock.settlementApproval.create.mockReset();
    prismaMock.settlementApproval.findMany.mockReset();
    prismaMock.settlementApproval.findUnique.mockReset();
    prismaMock.settlementApproval.update.mockReset();
    prismaMock.settlementApprovalLine.count.mockReset();
    prismaMock.settlementApprovalLine.update.mockReset();
    prismaMock.financialCorrectionCredit.findMany.mockReset();
    prismaMock.financialCorrectionCredit.findMany.mockResolvedValue([]);
    prismaMock.financialCorrectionDeduction.findMany.mockReset();
    prismaMock.financialCorrectionDeduction.findMany.mockResolvedValue([]);
    prismaMock.financialCorrectionCreditSettlementLine.updateMany.mockReset();
    prismaMock.financialCorrectionCreditSettlementLine.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.financialCorrectionDeductionSettlementLine.updateMany.mockReset();
    prismaMock.financialCorrectionDeductionSettlementLine.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.financialCorrectionApprovedDeductionCoverage.findFirst.mockReset();
    prismaMock.financialCorrectionApprovedDeductionCoverage.findFirst.mockResolvedValue(null);
    prismaMock.settlementRefundAdjustment.findMany.mockReset();
    prismaMock.settlementRefundAdjustment.findMany.mockResolvedValue([]);
    prismaMock.settlementRefundAdjustment.findUnique.mockReset();
    prismaMock.settlementRefundAdjustment.update.mockReset();
    prismaMock.settlementRefundAdjustment.updateMany.mockReset();
    prismaMock.settlementRefundAdjustment.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.settlementRefundAdjustmentApplication.create.mockReset();
    prismaMock.settlementRefundAdjustmentApplication.create.mockResolvedValue({
      id: 'application-1',
      settlementRefundAdjustmentId: 'adjustment-1',
      settlementApprovalId: 'settlement-approval-1',
      settlementApprovalLineId: 'line-1',
      amountMinor: 40000,
      currencyCode: 'TRY',
      status: 'ACTIVE',
      createdAt: new Date('2026-06-01T11:00:00.000Z'),
      updatedAt: new Date('2026-06-01T11:00:00.000Z'),
    });
    prismaMock.settlementRefundAdjustmentApplication.findMany.mockReset();
    prismaMock.settlementRefundAdjustmentApplication.findMany.mockResolvedValue([]);
    prismaMock.settlementRefundAdjustmentApplication.update.mockReset();
    prismaMock.settlementRefundAdjustmentEvent.create.mockReset();
    prismaMock.vendorBillingProfile.findUnique.mockReset();
    prismaMock.payoutBatch.create.mockReset();
    prismaMock.payoutOffsetClaim.count.mockReset();
    prismaMock.payoutOffsetClaim.count.mockResolvedValue(0);
    prismaMock.payoutOffsetClaim.findMany.mockReset();
    prismaMock.payoutOffsetClaim.findMany.mockResolvedValue([]);
    prismaMock.vendorBalanceEvent.findMany.mockReset();
    prismaMock.vendorBalanceEvent.findMany.mockResolvedValue([]);
    prismaMock.financeIntegrityAlert.findMany.mockReset();
    prismaMock.financeIntegrityAlert.findMany.mockResolvedValue([]);
  });

  it('previews eligible settlement approval rows without writes', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1000 }),
      buildLedgerRow({ id: 'refund-1', entryType: 'refund', amount: 100 }),
      buildLedgerRow({ id: 'sale-accruing', entryType: 'sale', amount: 500, fulfilled: false }),
    ]);

    const preview = await previewApproval('vendor-a');

    expect(preview.writesPerformed).toBe(false);
    expect(preview).toMatchObject({
      candidateScope: 'vendor_wide',
      candidateSelectionSummary: {
        requestedOrders: [],
        matchedOrders: [],
        unmatchedOrders: [],
        requestedAllocations: [],
        matchedAllocations: [],
        unmatchedAllocations: [],
        candidateRowCount: 3,
      },
    });
    expect(preview.summary).toMatchObject({
      eligibleRowCount: 2,
      grossSalesMinor: 100000,
      refundTotalMinor: 10000,
      commissionMinor: 9000,
      commissionVatMinor: 1800,
      netPayableMinor: 79200,
      detectedCommissionRates: [10],
      detectedCommissionVatRates: [20],
      detectedShippingModes: ['DISABLED'],
      detectedFinancialProfileSnapshotIds: ['profile-current'],
      mixedCommissionRate: false,
      mixedCommissionVatRate: false,
      mixedShippingMode: false,
      candidateQualityWarnings: ['Vendor-wide preview can include historical or test rows.'],
    });
    expect(preview.lines).toEqual([
      expect.objectContaining({
        financeLedgerEntryId: 'sale-1',
        lineType: 'SALE',
        payableImpactMinor: 88000,
        storedSettlementStatus: 'PAYABLE',
        derivedSettlementStatus: 'payable',
        payoutStatus: 'PENDING',
        eligibilityDecision: 'included',
        eligibilityReason: 'Derived payable because delivery evidence satisfies settlement delay.',
        refundDetected: false,
        refundCount: 0,
        fulfillmentEvidencePresent: true,
        shippingEvidencePresent: true,
      }),
      expect.objectContaining({
        financeLedgerEntryId: 'refund-1',
        lineType: 'REFUND',
        commissionMinor: -1000,
        commissionVatMinor: -200,
        payableImpactMinor: -8800,
        storedSettlementStatus: 'PARTIALLY_REFUNDED',
        derivedSettlementStatus: 'partially_refunded',
        eligibilityReason: 'Refund offset applied before settlement.',
        refundDetected: true,
      }),
    ]);
    expect(prismaMock.settlementApproval.create).not.toHaveBeenCalled();
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
  });

  it('resolves a REFUND through its exact accepted snapshot, not the first sibling', () => {
    const row = buildLedgerRow({ id: 'refund-b', entryType: 'refund', amount: 15,
      refundRecords: [
        { id: 'record-a', sourceShopifyRefundId: 'shopify-a', amount: 10 },
        { id: 'record-b', sourceShopifyRefundId: 'shopify-b', amount: 15 },
      ],
    });
    row.refundEvidenceSnapshot!.refundRecordId = 'record-b';
    row.refundEvidenceSnapshot!.sourceShopifyRefundId = 'shopify-b';
    expect(__settlementApprovalTesting.getExactRefundEvidence(row)).toMatchObject({
      record: { id: 'record-b', sourceShopifyRefundId: 'shopify-b' },
      sale: { id: 'sale-for-refund-b', vendorId: 'vendor-a' },
    });
    expect(__settlementApprovalTesting.buildSettlementEligibilityExplanation(row).eligibilityDecision).toBe('included');
  });

  it('does not borrow a sibling refund for missing or contradictory accepted evidence', () => {
    const row = buildLedgerRow({ id: 'refund-missing', entryType: 'refund', amount: 15,
      refundRecords: [
        { id: 'record-a', sourceShopifyRefundId: 'shopify-a', amount: 10 },
        { id: 'record-b', sourceShopifyRefundId: 'shopify-b', amount: 15 },
      ],
    });
    row.refundEvidenceSnapshot = null;
    expect(__settlementApprovalTesting.getExactRefundEvidence(row)).toBeNull();
    expect(__settlementApprovalTesting.buildSettlementEligibilityExplanation(row)).toMatchObject({
      eligibilityDecision: 'excluded',
      eligibilityReason: 'Refund row is not linked to a valid Shopify refund.',
    });
    row.refundEvidenceSnapshot = {
      refundFinanceLedgerEntryId: row.id, refundRecordId: 'record-b', sourceShopifyRefundId: 'shopify-a',
      vendorAllocationId: row.vendorAllocation.id, historicalEconomicVendorId: row.vendorId,
      historicalSaleFinanceLedgerEntryId: 'sale-for-refund-missing',
    };
    expect(__settlementApprovalTesting.getExactRefundEvidence(row)).toBeNull();
    expect(__settlementApprovalTesting.buildSettlementEligibilityExplanation(row).eligibilityDecision).toBe('excluded');
  });

  it('explains observed delivery as the SALE authority after operational status changes', async () => {
    const row = buildLedgerRow({ id: 'sale-observed-returned', entryType: 'sale', amount: 1000 });
    row.vendorAllocation.shippingStatus = 'Returned';
    row.vendorAllocation.fulfillmentStatus = 'Pending';
    row.vendorAllocation.fulfillment.fulfilledAt = null;
    row.vendorAllocation.fulfillment.shipmentUpdatedAt = new Date('2030-01-01T00:00:00.000Z');
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([row]);

    const preview = await previewApproval('vendor-a');
    expect(preview.lines).toEqual([
      expect.objectContaining({
        financeLedgerEntryId: row.id,
        eligibilityDecision: 'included',
        eligibilityReason: 'Derived payable because delivery evidence satisfies settlement delay.',
        fulfillmentEvidencePresent: false,
        shippingEvidencePresent: false,
      }),
    ]);
  });

  it('filters settlement preview candidates to active finance ledger rows', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-active', entryType: 'sale', amount: 1000 }),
    ]);

    await previewApproval('vendor-a');

    expect(prismaMock.financeLedgerEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          vendorId: 'vendor-a',
          voidedAt: null,
          entryType: {
            in: ['sale', 'refund'],
          },
        }),
      }),
    );
  });

  it('excludes conflict-cancelled rows from settlement candidates', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({
        id: 'sale-cancelled-conflict',
        entryType: 'sale',
        amount: 1000,
        cancelledAt: new Date('2026-07-11T20:23:00.000Z'),
        voidedAt: null,
      }),
    ]);

    const preview = await previewApproval('vendor-a');

    expect(preview.summary.eligibleRowCount).toBe(0);
    expect(preview.lines).toEqual([]);
    expect(__settlementApprovalTesting.buildSettlementEligibilityExplanation(
      buildLedgerRow({
        id: 'sale-cancelled-explanation',
        entryType: 'sale',
        amount: 1000,
        cancelledAt: new Date('2026-07-11T20:23:00.000Z'),
      }),
    )).toMatchObject({
      derivedSettlementStatus: 'held',
      eligibilityDecision: 'excluded',
      eligibilityReason: 'Excluded because Full Shopify order cancellation blocks this operation.',
    });
  });

  it('keeps payable sales eligible when no approved open return exists', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-no-return', entryType: 'sale', amount: 100 }),
      buildLedgerRow({
        id: 'sale-requested-return',
        entryType: 'sale',
        amount: 100,
        returnRecords: [{
          id: 'return-requested',
          status: 'requested',
          returnLifecycleStatus: 'requested',
        }],
      }),
      buildLedgerRow({
        id: 'sale-declined-return',
        entryType: 'sale',
        amount: 100,
        returnRecords: [{
          id: 'return-declined',
          status: 'declined',
          returnLifecycleStatus: 'declined',
        }],
      }),
      buildLedgerRow({
        id: 'sale-cancelled-return',
        entryType: 'sale',
        amount: 100,
        returnRecords: [{
          id: 'return-cancelled',
          status: 'cancelled',
          returnLifecycleStatus: 'cancelled',
        }],
      }),
      buildLedgerRow({
        id: 'sale-closed-return',
        entryType: 'sale',
        amount: 100,
        returnRecords: [{
          id: 'return-closed',
          status: 'closed',
          returnLifecycleStatus: 'closed',
        }],
      }),
    ]);

    const preview = await previewApproval('vendor-a');

    expect(preview.summary.eligibleRowCount).toBe(5);
    expect(preview.lines.map((line) => line.financeLedgerEntryId)).toEqual([
      'sale-no-return',
      'sale-requested-return',
      'sale-declined-return',
      'sale-cancelled-return',
      'sale-closed-return',
    ]);
  });

  it('excludes refund rows from settlement offset when the related sale is already paid', () => {
    const explanation = __settlementApprovalTesting.buildSettlementEligibilityExplanation(
      buildLedgerRow({
        id: 'refund-after-paid-sale',
        entryType: 'refund',
        amount: 100,
        payoutStatus: 'HOLD',
        relatedSalePaid: true,
      }),
    );

    expect(explanation).toMatchObject({
      derivedSettlementStatus: 'held',
      eligibilityDecision: 'excluded',
      eligibilityReason: 'Refund after settlement requires vendor debt handling.',
    });
  });

  it('excludes cancel/refund review rows from settlement preview', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({
        id: 'sale-cancel-refund-review',
        entryType: 'sale',
        amount: 1000,
        cancelRefundReviewStatus: 'PENDING_REVIEW',
        sourceShopifyOrderNumber: '#2006',
      }),
    ]);

    const preview = await previewApproval('vendor-a', null, null, {
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#2006'],
    });

    expect(preview.summary).toMatchObject({
      eligibleRowCount: 0,
      grossSalesMinor: 0,
    });
    expect(preview.lines).toEqual([]);
    expect(preview.selectedOrderDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestedIdentifier: '#2006',
          financeLedgerEntryId: 'sale-cancel-refund-review',
          candidateIncluded: false,
          derivedSettlementStatus: 'held',
          excludedReason: 'Allocation is under cancel/refund review and cannot move through settlement or payout.',
        }),
      ]),
    );
  });

  it('holds only the allocation with a pending customer cancellation request', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({
        id: 'sale-cancellation-pending',
        entryType: 'sale',
        amount: 1000,
        customerCancellationRequestStatus: 'PENDING',
      }),
      buildLedgerRow({ id: 'sale-unaffected-allocation', entryType: 'sale', amount: 500 }),
    ]);

    const preview = await previewApproval('vendor-a');

    expect(preview.lines).toEqual([
      expect.objectContaining({ financeLedgerEntryId: 'sale-unaffected-allocation' }),
    ]);
    expect(__settlementApprovalTesting.buildSettlementEligibilityExplanation(
      buildLedgerRow({
        id: 'sale-cancellation-pending',
        entryType: 'sale',
        amount: 1000,
        customerCancellationRequestStatus: 'PARTIALLY_RESOLVED',
      }),
    )).toMatchObject({
      derivedSettlementStatus: 'held',
      eligibilityDecision: 'excluded',
      eligibilityReason: expect.stringContaining('CUSTOMER_CANCELLATION_PENDING'),
    });
  });

  it.each(['APPROVED', 'DECLINED', 'TOO_LATE', 'CONFLICTED'] as const)(
    'releases the finance hold when the cancellation request is %s',
    (requestStatus) => {
      expect(__settlementApprovalTesting.buildSettlementEligibilityExplanation(
        buildLedgerRow({
          id: `sale-cancellation-${requestStatus}`,
          entryType: 'sale',
          amount: 1000,
          customerCancellationRequestStatus: requestStatus,
          customerCancellationItemStatus: requestStatus,
        }),
      )).toMatchObject({ derivedSettlementStatus: 'payable', eligibilityDecision: 'included' });
    },
  );

  it('does not hold a resolved historical item on a partially resolved request', () => {
    expect(__settlementApprovalTesting.buildSettlementEligibilityExplanation(
      buildLedgerRow({
        id: 'sale-historical-resolved-item',
        entryType: 'sale',
        amount: 1000,
        customerCancellationRequestStatus: 'PARTIALLY_RESOLVED',
        customerCancellationItemStatus: 'DECLINED',
      }),
    )).toMatchObject({ derivedSettlementStatus: 'payable', eligibilityDecision: 'included' });
  });

  it('does not rewrite a historically paid row when cancellation review is pending', () => {
    expect(__settlementApprovalTesting.resolveSettlementStatus(
      buildLedgerRow({
        id: 'sale-already-paid',
        entryType: 'sale',
        amount: 1000,
        payoutStatus: 'PAID',
        customerCancellationRequestStatus: 'PENDING',
      }),
    )).toBe('settled');
  });

  it('retains the finance hold after admin approval while refund execution is pending', () => {
    expect(__settlementApprovalTesting.buildSettlementEligibilityExplanation(
      buildLedgerRow({
        id: 'sale-approved-for-refund',
        entryType: 'sale',
        amount: 1000,
        customerCancellationRequestStatus: 'APPROVED_FOR_REFUND',
        customerCancellationItemStatus: 'APPROVED_FOR_REFUND',
      }),
    )).toMatchObject({
      derivedSettlementStatus: 'held',
      eligibilityDecision: 'excluded',
      eligibilityReason: expect.stringContaining('CUSTOMER_CANCELLATION_PENDING'),
    });
  });

  it('excludes vendor-blocked rows from settlement preview', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({
        id: 'sale-vendor-blocked',
        entryType: 'sale',
        amount: 1000,
        allocationStatus: 'VENDOR_BLOCKED',
        sourceShopifyOrderNumber: '#2007',
      }),
    ]);

    const preview = await previewApproval('vendor-a', null, null, {
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#2007'],
    });

    expect(preview.summary).toMatchObject({
      eligibleRowCount: 0,
      grossSalesMinor: 0,
    });
    expect(preview.lines).toEqual([]);
    expect(preview.selectedOrderDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestedIdentifier: '#2007',
          financeLedgerEntryId: 'sale-vendor-blocked',
          candidateIncluded: false,
          derivedSettlementStatus: 'held',
          excludedReason: 'Vendor allocation is blocked and awaiting admin resolution.',
        }),
      ]),
    );
  });

  it('explains vendor-blocked holds as settlement-ineligible', () => {
    const explanation = __settlementApprovalTesting.buildSettlementEligibilityExplanation(
      buildLedgerRow({
        id: 'sale-vendor-blocked',
        entryType: 'sale',
        amount: 1000,
        allocationStatus: 'VENDOR_BLOCKED',
      }),
    );

    expect(explanation).toMatchObject({
      derivedSettlementStatus: 'held',
      eligibilityDecision: 'excluded',
      eligibilityReason: 'Vendor allocation is blocked and awaiting admin resolution.',
    });
  });

  it('does not apply vendor-blocked hold after refund resolution', () => {
    const explanation = __settlementApprovalTesting.buildSettlementEligibilityExplanation(
      buildLedgerRow({
        id: 'sale-vendor-blocked-refunded',
        entryType: 'sale',
        amount: 1000,
        allocationStatus: 'VENDOR_BLOCKED',
        cancelRefundReviewStatus: 'RESOLVED',
        refundRecords: [{ id: 'refund-resolved', sourceShopifyRefundId: 'refund-resolved', amount: 100 }],
      }),
    );

    expect(explanation).toMatchObject({
      derivedSettlementStatus: 'partially_refunded',
    });
    expect(explanation.eligibilityReason).not.toBe('Vendor allocation is blocked and awaiting admin resolution.');
  });

  it('explains cancel/refund review holds as settlement-ineligible', () => {
    const explanation = __settlementApprovalTesting.buildSettlementEligibilityExplanation(
      buildLedgerRow({
        id: 'sale-cancel-refund-review',
        entryType: 'sale',
        amount: 1000,
        cancelRefundReviewStatus: 'SHOPIFY_ACTION_PENDING',
      }),
    );

    expect(explanation).toMatchObject({
      derivedSettlementStatus: 'held',
      eligibilityDecision: 'excluded',
      eligibilityReason: 'Allocation is under cancel/refund review and cannot move through settlement or payout.',
    });
  });

  it('surfaces adjustment-required reason when refund rows relate to an approved settlement', () => {
    const explanation = __settlementApprovalTesting.buildSettlementEligibilityExplanation(
      buildLedgerRow({
        id: 'refund-after-approved-settlement',
        entryType: 'refund',
        amount: 100,
        payoutStatus: 'HOLD',
        relatedSaleActiveApproval: true,
      }),
    );

    expect(explanation).toMatchObject({
      derivedSettlementStatus: 'held',
      eligibilityDecision: 'excluded',
      eligibilityReason: 'Refund after settlement approval requires adjustment before payout',
    });
  });

  it('applies sale-time settlement delay snapshots to settlement preview eligibility', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({
        id: 'sale-default-delay',
        entryType: 'sale',
        amount: 100,
        deliveredAt: new Date('2026-05-20T00:00:00.000Z'),
        sourceShopifyOrderNumber: '#2001',
      }),
      buildLedgerRow({
        id: 'sale-14-day-delay',
        entryType: 'sale',
        amount: 100,
        deliveredAt: new Date('2026-06-01T00:00:00.000Z'),
        settlementDelayDaysSnapshot: 14,
        sourceShopifyOrderNumber: '#2002',
      }),
      buildLedgerRow({
        id: 'sale-28-day-delay',
        entryType: 'sale',
        amount: 100,
        deliveredAt: new Date('2026-05-01T00:00:00.000Z'),
        settlementDelayDaysSnapshot: 28,
        sourceShopifyOrderNumber: '#2003',
      }),
      buildLedgerRow({
        id: 'sale-delay-pending',
        entryType: 'sale',
        amount: 100,
        deliveredAt: new Date('2999-01-01T00:00:00.000Z'),
        sourceShopifyOrderNumber: '#2004',
      }),
    ]);

    const preview = await previewApproval('vendor-a', null, null, {
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#2001', '#2002', '#2003', '#2004'],
    });

    expect(preview.summary.eligibleRowCount).toBe(3);
    expect(preview.lines.map((line) => line.financeLedgerEntryId)).toEqual([
      'sale-default-delay',
      'sale-14-day-delay',
      'sale-28-day-delay',
    ]);
    expect(preview.selectedOrderDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestedIdentifier: '#2004',
          matched: true,
          financeLedgerEntryId: 'sale-delay-pending',
          candidateIncluded: false,
          excludedReason: 'Settlement delay period has not elapsed',
          derivedSettlementStatus: 'accruing',
        }),
      ]),
    );
  });

  it('excludes a refund-aware sale before its frozen delay and admits it at and after the cutoff', async () => {
    const sale = buildLedgerRow({
      id: 'sale-refund-delay-boundary',
      entryType: 'sale',
      amount: 100,
      deliveredAt: new Date('2026-06-01T00:00:00.000Z'),
      settlementDelayDaysSnapshot: 21,
      sourceShopifyOrderNumber: '#2010',
      refundRecords: [{ id: 'refund-boundary', sourceShopifyRefundId: 'refund-boundary', amount: 20 }],
    });
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([sale]);

    const beforeCutoff = await previewApproval('vendor-a', null, null, {
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#2010'],
      asOfDate: new Date('2026-06-21T23:59:59.999Z'),
    });
    expect(beforeCutoff.lines).toEqual([]);
    expect(beforeCutoff.selectedOrderDiagnostics).toEqual([
      expect.objectContaining({
        candidateIncluded: false,
        derivedSettlementStatus: 'accruing',
        excludedReason: 'Settlement delay period has not elapsed',
      }),
    ]);

    const atCutoff = await previewApproval('vendor-a', null, null, {
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#2010'],
      asOfDate: new Date('2026-06-22T00:00:00.000Z'),
    });
    expect(atCutoff.lines).toEqual([
      expect.objectContaining({
        financeLedgerEntryId: 'sale-refund-delay-boundary',
        lineType: 'SALE',
        amountMinor: 10000,
        commissionMinor: 1000,
        commissionVatMinor: 200,
        payableImpactMinor: 8800,
        derivedSettlementStatus: 'partially_refunded',
      }),
    ]);
    expect(atCutoff.summary).toMatchObject({
      grossSalesMinor: 10000,
      commissionMinor: 1000,
      commissionVatMinor: 200,
      netPayableMinor: 8800,
    });

    const afterCutoff = await previewApproval('vendor-a', null, null, {
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#2010'],
      asOfDate: new Date('2026-06-22T00:00:00.001Z'),
    });
    expect(afterCutoff.lines).toEqual([
      expect.objectContaining({
        financeLedgerEntryId: 'sale-refund-delay-boundary',
        derivedSettlementStatus: 'partially_refunded',
        payableImpactMinor: 8800,
      }),
    ]);
  });

  it('uses each refund-aware sale frozen delay snapshot', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({
        id: 'sale-refund-frozen-14', entryType: 'sale', amount: 100,
        deliveredAt: new Date('2026-06-01T00:00:00.000Z'), settlementDelayDaysSnapshot: 14,
        sourceShopifyOrderNumber: '#2011',
        refundRecords: [{ id: 'refund-frozen-14', sourceShopifyRefundId: 'refund-frozen-14', amount: 10 }],
      }),
      buildLedgerRow({
        id: 'sale-refund-frozen-28', entryType: 'sale', amount: 100,
        deliveredAt: new Date('2026-06-01T00:00:00.000Z'), settlementDelayDaysSnapshot: 28,
        sourceShopifyOrderNumber: '#2012',
        refundRecords: [{ id: 'refund-frozen-28', sourceShopifyRefundId: 'refund-frozen-28', amount: 10 }],
      }),
    ]);

    const preview = await previewApproval('vendor-a', null, null, {
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#2011', '#2012'],
      asOfDate: new Date('2026-06-22T00:00:00.000Z'),
    });

    expect(preview.lines.map((line) => line.financeLedgerEntryId)).toEqual(['sale-refund-frozen-14']);
    expect(preview.selectedOrderDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestedIdentifier: '#2011', candidateIncluded: true }),
      expect.objectContaining({
        requestedIdentifier: '#2012', candidateIncluded: false,
        excludedReason: 'Settlement delay period has not elapsed',
      }),
    ]));
  });

  it('blocks sale settlement eligibility when delivery date is missing', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({
        id: 'sale-missing-delivery',
        entryType: 'sale',
        amount: 100,
        deliveredAt: null,
        sourceShopifyOrderNumber: '#2005',
      }),
    ]);

    const preview = await previewApproval('vendor-a', null, null, {
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#2005'],
    });

    expect(preview.summary.eligibleRowCount).toBe(0);
    expect(preview.lines).toEqual([]);
    expect(preview.selectedOrderDiagnostics).toEqual([
      expect.objectContaining({
        requestedIdentifier: '#2005',
        matched: true,
        financeLedgerEntryId: 'sale-missing-delivery',
        candidateIncluded: false,
        excludedReason: 'Missing delivery date for settlement eligibility',
        derivedSettlementStatus: 'accruing',
      }),
    ]);
  });

  it('excludes Shopify-approved open returns from settlement preview diagnostics', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({
        id: 'sale-approved-return',
        entryType: 'sale',
        amount: 100,
        sourceShopifyOrderId: 'shopify-order-1075',
        sourceShopifyOrderNumber: '#1075',
        returnRecords: [{
          id: 'return-approved',
          status: 'requested',
          returnLifecycleStatus: 'approved',
        }],
      }),
    ]);

    const preview = await previewApproval('vendor-a', null, null, {
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#1075'],
    });

    expect(preview.summary.eligibleRowCount).toBe(0);
    expect(preview.lines).toEqual([]);
    expect(preview.selectedOrderDiagnostics).toEqual([
      expect.objectContaining({
        requestedIdentifier: '#1075',
        matched: true,
        financeLedgerEntryId: 'sale-approved-return',
        candidateIncluded: false,
        excludedReason: 'Open approved return pending refund outcome',
        derivedSettlementStatus: 'held',
      }),
    ]);
  });

  it('keeps processed refund impact and refund ledger rows eligible with approved return history', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({
        id: 'sale-refund-processed',
        entryType: 'sale',
        amount: 100,
        refundRecords: [{ id: 'refund-processed', sourceShopifyRefundId: 'refund-1', amount: 100 }],
        returnRecords: [{
          id: 'return-approved-processed',
          status: 'processed',
          returnLifecycleStatus: 'approved',
          sourceShopifyRefundId: 'refund-1',
        }],
      }),
      buildLedgerRow({
        id: 'refund-row',
        entryType: 'refund',
        amount: 100,
        returnRecords: [{
          id: 'return-approved-refund-row',
          status: 'approved',
          returnLifecycleStatus: 'approved',
        }],
      }),
    ]);

    const preview = await previewApproval('vendor-a');

    expect(preview.summary.eligibleRowCount).toBe(2);
    expect(preview.lines.map((line) => line.financeLedgerEntryId)).toEqual([
      'sale-refund-processed',
      'refund-row',
    ]);
    expect(preview.lines[0]).toMatchObject({
      derivedSettlementStatus: 'partially_refunded',
      eligibilityReason: 'Derived partially refunded because refund records exist.',
    });
  });

  it('reports mixed candidate quality from settlement preview rows', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({
        id: 'sale-18',
        entryType: 'sale',
        amount: 1000,
        commissionVatPercentSnapshot: 18,
        shippingModeSnapshot: 'DISABLED',
        financialProfileIdSnapshot: 'profile-old',
      }),
      buildLedgerRow({
        id: 'sale-20',
        entryType: 'sale',
        amount: 500,
        commissionVatPercentSnapshot: 20,
        shippingModeSnapshot: 'FIXED',
        financialProfileIdSnapshot: 'profile-current',
      }),
    ]);

    const preview = await previewApproval('vendor-a', new Date('2026-06-01T00:00:00.000Z'), null);

    expect(preview.summary).toMatchObject({
      detectedCommissionRates: [10],
      detectedCommissionVatRates: [18, 20],
      detectedShippingModes: ['DISABLED', 'FIXED'],
      detectedFinancialProfileSnapshotIds: ['profile-current', 'profile-old'],
      mixedCommissionRate: false,
      mixedCommissionVatRate: true,
      mixedShippingMode: true,
      candidateQualityWarnings: [
        'Candidate rows include mixed commission VAT rates. Logo readiness will block mixed VAT settlements.',
        'Candidate rows include mixed shipping modes.',
      ],
    });
  });

  it('previews only rows matching selected order identifiers and reports unmatched orders', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({
        id: 'sale-1074',
        entryType: 'sale',
        amount: 1000,
        sourceShopifyOrderId: 'shopify-order-1074',
        sourceShopifyOrderNumber: '#1074',
      }),
      buildLedgerRow({
        id: 'sale-1073',
        entryType: 'sale',
        amount: 500,
        sourceShopifyOrderId: 'shopify-order-1073',
        sourceShopifyOrderNumber: '#1073',
      }),
    ]);

    const preview = await previewApproval('vendor-a', null, null, {
      selectedOrderIds: ['#1074', '#9999'],
      selectedShopifyOrderIds: ['shopify-order-1074'],
    });

    expect(preview.candidateScope).toBe('selected_orders');
    expect(preview.candidateSelectionSummary).toEqual({
      requestedOrders: ['#1074', '#9999', 'shopify-order-1074'],
      matchedOrders: ['#1074', 'shopify-order-1074'],
      unmatchedOrders: ['#9999'],
      requestedAllocations: [],
      matchedAllocations: [],
      unmatchedAllocations: [],
      candidateRowCount: 1,
    });
    expect(preview.summary.eligibleRowCount).toBe(1);
    expect(preview.selectedOrderDiagnostics).toEqual([
      expect.objectContaining({
        requestedIdentifier: '#1074',
        matched: true,
        matchedOrderNumber: '#1074',
        matchedShopifyOrderId: 'shopify-order-1074',
        financeLedgerEntryId: 'sale-1074',
        candidateIncluded: true,
        excludedReason: null,
        lockedApprovalId: null,
        currentSettlementStatus: 'PAYABLE',
        derivedSettlementStatus: 'payable',
      }),
      expect.objectContaining({
        requestedIdentifier: '#9999',
        matched: false,
        financeLedgerEntryId: null,
        candidateIncluded: false,
        excludedReason: 'No finance ledger row matched this selected order.',
      }),
      expect.objectContaining({
        requestedIdentifier: 'shopify-order-1074',
        matched: true,
        matchedOrderNumber: '#1074',
        matchedShopifyOrderId: 'shopify-order-1074',
        financeLedgerEntryId: 'sale-1074',
        candidateIncluded: true,
      }),
    ]);
    expect(preview.lines).toEqual([
      expect.objectContaining({
        financeLedgerEntryId: 'sale-1074',
      }),
    ]);
    expect(preview.summary.candidateQualityWarnings).not.toContain('Vendor-wide preview can include historical or test rows.');
  });

  it('reports an integrity-filtered selected order as excluded without changing preview money', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-alert', entryType: 'sale', amount: 1000, sourceShopifyOrderNumber: '#1074' }),
      buildLedgerRow({ id: 'sale-safe', entryType: 'sale', amount: 500, sourceShopifyOrderNumber: '#1073' }),
    ]);
    prismaMock.financeIntegrityAlert.findMany.mockImplementation(async ({ where }) =>
      where.OR[0].vendorAllocationId === 'alloc-sale-alert'
        ? [{ category: 'multiple_active_sale_ledgers' }]
        : [],
    );

    const preview = await previewApproval('vendor-a', null, null, {
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#1074', '#1073'],
    });

    expect(preview.lines.map((line) => line.financeLedgerEntryId)).toEqual(['sale-safe']);
    expect(preview.summary).toMatchObject({
      eligibleRowCount: 1,
      grossSalesMinor: 50000,
      refundTotalMinor: 0,
      commissionMinor: 5000,
      commissionVatMinor: 1000,
      netPayableMinor: 44000,
    });
    expect(preview.selectedOrderDiagnostics).toEqual([
      expect.objectContaining({
        requestedIdentifier: '#1074',
        financeLedgerEntryId: 'sale-alert',
        matched: true,
        candidateIncluded: false,
        excludedReason: 'Money movement blocked by blocking finance integrity alert: multiple_active_sale_ledgers.',
      }),
      expect.objectContaining({
        requestedIdentifier: '#1073',
        financeLedgerEntryId: 'sale-safe',
        candidateIncluded: true,
        excludedReason: null,
      }),
    ]);
  });

  it('reports the final included ledger row when one allocation of a selected order has an alert', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-alert', entryType: 'sale', amount: 1000, sourceShopifyOrderNumber: '#1074' }),
      buildLedgerRow({ id: 'sale-safe', entryType: 'sale', amount: 500, sourceShopifyOrderNumber: '#1074' }),
    ]);
    prismaMock.financeIntegrityAlert.findMany.mockImplementation(async ({ where }) =>
      where.OR[0].vendorAllocationId === 'alloc-sale-alert'
        ? [{ category: 'multiple_active_sale_ledgers' }]
        : [],
    );

    const preview = await previewApproval('vendor-a', null, null, {
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#1074'],
    });

    expect(preview.lines.map((line) => line.financeLedgerEntryId)).toEqual(['sale-safe']);
    expect(preview.selectedOrderDiagnostics).toEqual([
      expect.objectContaining({
        requestedIdentifier: '#1074',
        financeLedgerEntryId: 'sale-safe',
        candidateIncluded: true,
        excludedReason: null,
      }),
    ]);
    expect(preview.summary).toMatchObject({
      eligibleRowCount: 1,
      grossSalesMinor: 50000,
      commissionMinor: 5000,
      commissionVatMinor: 1000,
      netPayableMinor: 44000,
    });
  });

  it('previews only rows matching selected allocation ids and reports unmatched allocations', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-selected', entryType: 'sale', amount: 1000 }),
      buildLedgerRow({ id: 'sale-other', entryType: 'sale', amount: 500 }),
    ]);

    const preview = await previewApproval('vendor-a', null, null, {
      selectedAllocationIds: ['alloc-sale-selected', 'alloc-missing'],
    });

    expect(preview.candidateScope).toBe('selected_allocations');
    expect(preview.candidateSelectionSummary).toEqual({
      requestedOrders: [],
      matchedOrders: [],
      unmatchedOrders: [],
      requestedAllocations: ['alloc-sale-selected', 'alloc-missing'],
      matchedAllocations: ['alloc-sale-selected'],
      unmatchedAllocations: ['alloc-missing'],
      candidateRowCount: 1,
    });
    expect(preview.lines).toEqual([
      expect.objectContaining({
        financeLedgerEntryId: 'sale-selected',
      }),
    ]);
  });

  it('does not fall back to vendor-wide rows when selected order mode has no identifiers', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1000 }),
    ]);

    const preview = await previewApproval('vendor-a', null, null, {
      candidateScope: 'selected_orders',
      selectedOrderIds: [],
      selectedShopifyOrderIds: [],
    });

    expect(preview.candidateScope).toBe('selected_orders');
    expect(preview.candidateSelectionSummary.candidateRowCount).toBe(0);
    expect(preview.summary.eligibleRowCount).toBe(0);
    expect(preview.lines).toEqual([]);
  });

  it('explains unmatched selected orders without changing candidate math', async () => {
    prismaMock.financeLedgerEntry.findMany
      .mockResolvedValueOnce([
        buildLedgerRow({
          id: 'sale-1073',
          entryType: 'sale',
          amount: 500,
          sourceShopifyOrderId: 'shopify-order-1073',
          sourceShopifyOrderNumber: '#1073',
        }),
      ])
      .mockResolvedValueOnce([]);

    const preview = await previewApproval('vendor-a', null, null, {
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#1074'],
    });

    expect(preview.candidateSelectionSummary).toMatchObject({
      requestedOrders: ['#1074'],
      matchedOrders: [],
      unmatchedOrders: ['#1074'],
      candidateRowCount: 0,
    });
    expect(preview.summary.eligibleRowCount).toBe(0);
    expect(preview.selectedOrderDiagnostics).toEqual([
      {
        requestedIdentifier: '#1074',
        matched: false,
        matchedOrderNumber: null,
        matchedShopifyOrderId: null,
        financeLedgerEntryId: null,
        candidateIncluded: false,
        excludedReason: 'No finance ledger row matched this selected order.',
        lockedApprovalId: null,
        lockedApprovalStatus: null,
        currentSettlementStatus: null,
        derivedSettlementStatus: null,
      },
    ]);
  });

  it('explains selected orders that match but are not eligible', async () => {
    prismaMock.financeLedgerEntry.findMany
      .mockResolvedValueOnce([
        buildLedgerRow({
          id: 'sale-1074',
          entryType: 'sale',
          amount: 1000,
          fulfilled: false,
          sourceShopifyOrderId: 'shopify-order-1074',
          sourceShopifyOrderNumber: '#1074',
        }),
      ])
      .mockResolvedValueOnce([]);

    const preview = await previewApproval('vendor-a', null, null, {
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#1074'],
    });

    expect(preview.candidateSelectionSummary.candidateRowCount).toBe(1);
    expect(preview.summary.eligibleRowCount).toBe(0);
    expect(preview.selectedOrderDiagnostics).toEqual([
      expect.objectContaining({
        requestedIdentifier: '#1074',
        matched: true,
        matchedOrderNumber: '#1074',
        matchedShopifyOrderId: 'shopify-order-1074',
        financeLedgerEntryId: 'sale-1074',
        candidateIncluded: false,
        excludedReason: 'Missing delivery date for settlement eligibility',
        lockedApprovalId: null,
        currentSettlementStatus: 'ACCRUING',
        derivedSettlementStatus: 'accruing',
      }),
    ]);
  });

  it('explains selected orders locked by an active settlement approval', async () => {
    prismaMock.financeLedgerEntry.findMany
      .mockResolvedValueOnce([
        buildLedgerRow({
          id: 'sale-1074',
          entryType: 'sale',
          amount: 1000,
          activeApproval: true,
          sourceShopifyOrderId: 'shopify-order-1074',
          sourceShopifyOrderNumber: '#1074',
        }),
      ])
      .mockResolvedValueOnce([]);

    const preview = await previewApproval('vendor-a', null, null, {
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#1074'],
    });

    expect(preview.candidateSelectionSummary.candidateRowCount).toBe(1);
    expect(preview.summary.eligibleRowCount).toBe(0);
    expect(preview.summary.excludedActiveApprovalRowCount).toBe(1);
    expect(preview.selectedOrderDiagnostics).toEqual([
      expect.objectContaining({
        requestedIdentifier: '#1074',
        matched: true,
        financeLedgerEntryId: 'sale-1074',
        candidateIncluded: false,
        excludedReason: 'Excluded because row already belongs to active settlement approval.',
        lockedApprovalId: 'approval-sale-1074',
        lockedApprovalStatus: 'APPROVED',
        currentSettlementStatus: 'PAYABLE',
        derivedSettlementStatus: 'payable',
      }),
    ]);
  });

  it('returns bounded cursor pages with unchanged summaries and a Vendor/limit-bound tuple cursor', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ ...buildApproval({ id: `history-${i}`, status: 'DRAFT' }),
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      _count: { lines: 2, correctionCreditLines: 1, correctionDeductionLines: 1 } }));
    prismaMock.settlementApproval.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
    const first = await listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor' });
    expect(first).toMatchObject({ vendorId: 'vendor-a', writesPerformed: false, hasMore: true,
      approvals: expect.arrayContaining([expect.objectContaining({ id: 'history-0', lineCount: 4 })]) });
    expect(first.approvals).toHaveLength(20);
    expect(prismaMock.settlementApproval.findMany).toHaveBeenNthCalledWith(1, {
      where: { vendorId: 'vendor-a' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21,
      include: { _count: { select: { lines: true, correctionCreditLines: true, correctionDeductionLines: true } } },
    });
    if (!('nextCursor' in first)) throw new Error('Expected a cursor-mode response');
    expect(JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString())).toEqual({
      v: 1, vendorId: 'vendor-a', createdAt: '2026-10-01T00:00:00.000Z', id: 'history-19', limit: 20,
    });
    const last = await listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor', cursor: first.nextCursor });
    expect(last).toEqual({ ok: true, writesPerformed: false, vendorId: 'vendor-a', approvals: [], hasMore: false, nextCursor: null });
    expect(prismaMock.settlementApproval.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {
      vendorId: 'vendor-a', OR: [
        { createdAt: { lt: rows[0].createdAt } }, { createdAt: rows[0].createdAt, id: { lt: 'history-19' } },
      ],
    } }));
    expect(prismaMock.settlementApproval.create).not.toHaveBeenCalled();
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, 101, NaN, Infinity, '', '0', '1.1', '101', ['20'], null])(
    'rejects invalid cursor-mode limit %j before querying', async (limit) => {
      await expect(listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor', limit })).rejects.toThrow('limit');
      expect(prismaMock.settlementApproval.findMany).not.toHaveBeenCalled();
    });

  it.each(['searchTimeZone', 'period', 'unexpected'])(
    'rejects unsupported cursor-mode parameter %s rather than pretending to filter history', async (key) => {
      await expect(listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor', [key]: 'value' })).rejects.toThrow('Unsupported');
      expect(prismaMock.settlementApproval.findMany).not.toHaveBeenCalled();
    });

  it.each(['', 'offset', null, ['cursor']])('rejects unsupported pagination mode %j', async (pagination) => {
    await expect(listSettlementApprovalsForVendor('vendor-a', { pagination })).rejects.toThrow('pagination');
    expect(prismaMock.settlementApproval.findMany).not.toHaveBeenCalled();
  });

  it.each(['', ' ', '\t'])('rejects an empty Vendor %j without an unscoped query', async (id) => {
    await expect(listSettlementApprovalsForVendor(id, { pagination: 'cursor' })).rejects.toThrow('vendorId');
    expect(prismaMock.settlementApproval.findMany).not.toHaveBeenCalled();
  });

  it.each([
    { v: 2 }, { vendorId: 'vendor-b' }, { limit: 10 }, { id: '' }, { id: ' padded ' },
    { createdAt: '2026-02-30T00:00:00.000Z' }, { createdAt: '2026-10-01' },
    { createdAt: '2026-10-01T00:00:00.000+00:00' }, { extra: true },
  ])('rejects invalid cursor boundary, version or query binding %j', async (override) => {
    const cursor = Buffer.from(JSON.stringify({ v: 1, vendorId: 'vendor-a', limit: 20,
      id: 'anchor', createdAt: '2026-10-01T00:00:00.000Z', ...override })).toString('base64url');
    await expect(listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor', cursor })).rejects.toThrow('cursor');
    expect(prismaMock.settlementApproval.findMany).not.toHaveBeenCalled();
  });

  it.each(['', 'bad!', 'e30=', 'e30', 'W10', 'bnVsbA', 42, ['e30'], 'a'.repeat(16_385)])(
    'rejects malformed cursor case %# before querying', async (cursor) => {
      await expect(listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor', cursor })).rejects.toThrow('cursor');
      expect(prismaMock.settlementApproval.findMany).not.toHaveBeenCalled();
    });

  it('accepts the bounded maximum page size and returns no cursor on the final page', async () => {
    prismaMock.settlementApproval.findMany.mockResolvedValue([]);
    expect(await listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor', limit: '100' }))
      .toMatchObject({ approvals: [], hasMore: false, nextCursor: null });
    expect(prismaMock.settlementApproval.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 101 }));
  });

  it.each(['draft', 'APPROVED', 'Cancelled'])('normalizes status %s into the database enum before pagination', async (status) => {
    prismaMock.settlementApproval.findMany.mockResolvedValue([]);
    await listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor', status });
    expect(prismaMock.settlementApproval.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: 'vendor-a', AND: [{ status: status.toUpperCase() }] }, take: 21,
    }));
  });

  it.each([true, 'true'])('uses inclusive positive and negative SQL high-value boundaries for %j', async (highValueOnly) => {
    prismaMock.settlementApproval.findMany.mockResolvedValue([]);
    await listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor', highValueOnly });
    expect(prismaMock.settlementApproval.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: 'vendor-a', AND: [{ OR: [
        { netPayableMinor: { gte: 100000 } }, { netPayableMinor: { lte: -100000 } },
      ] }] },
    }));
  });

  it.each([
    { status: 'PAID' }, { status: '' }, { status: ' draft ' }, { status: null }, { status: ['draft'] },
    { highValueOnly: 'yes' }, { highValueOnly: 'TRUE' }, { highValueOnly: 1 }, { highValueOnly: null },
    { highValueOnly: ['true'] }, { periodKey: '' }, { periodKey: null }, { periodKey: 202610 },
    { periodKey: ['2026-10'] }, { periodKey: 'x'.repeat(513) },
  ])('rejects malformed filter forms before any database query: %j', async (filters) => {
    await expect(listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor', ...filters })).rejects.toThrow();
    expect(prismaMock.settlementApproval.findMany).not.toHaveBeenCalled();
  });

  it.each(['2026-02-30', 'all', ' cycle key ', ' '])('keeps raw cycle key %j literal without timezone or trimming', async (periodKey) => {
    prismaMock.settlementApproval.findMany.mockResolvedValue([]);
    await listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor', periodKey });
    expect(prismaMock.settlementApproval.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: 'vendor-a', AND: [{ OR: [{ scheduledCycleKey: periodKey }] }] },
    }));
  });

  it('binds v2 cursors to normalized filters and rejects every filter/Vendor/limit mismatch', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ ...buildApproval({ id: `filtered-${i}`, status: 'DRAFT' }),
      _count: { lines: 0 } }));
    prismaMock.settlementApproval.findMany.mockResolvedValue(rows);
    const query = { pagination: 'cursor', limit: 2, status: 'draft', periodKey: '2026-10', highValueOnly: 'true' };
    const first = await listSettlementApprovalsForVendor('vendor-a', query);
    if (!('nextCursor' in first)) throw new Error('Expected cursor mode');
    const decoded = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString());
    expect(decoded).toMatchObject({ v: 2, filters: { status: 'DRAFT', periodKey: '2026-10', highValueOnly: true } });
    await expect(listSettlementApprovalsForVendor('vendor-a', { ...query, status: 'DRAFT', highValueOnly: true,
      cursor: first.nextCursor })).resolves.toMatchObject({ vendorId: 'vendor-a' });
    for (const override of [{ status: 'approved' }, { status: 'all' }, { periodKey: '2026-09' },
      { periodKey: undefined }, { highValueOnly: false }, { limit: 3 }]) {
      prismaMock.settlementApproval.findMany.mockClear();
      await expect(listSettlementApprovalsForVendor('vendor-a', { ...query, ...override, cursor: first.nextCursor }))
        .rejects.toThrow('cursor');
      expect(prismaMock.settlementApproval.findMany).not.toHaveBeenCalled();
    }
    await expect(listSettlementApprovalsForVendor('vendor-b', { ...query, cursor: first.nextCursor })).rejects.toThrow('cursor');
    for (const filters of [null, [], { ...decoded.filters, extra: true }, { ...decoded.filters, status: 'draft' },
      { ...decoded.filters, highValueOnly: 'true' }]) {
      await expect(listSettlementApprovalsForVendor('vendor-a', { ...query,
        cursor: Buffer.from(JSON.stringify({ ...decoded, filters })).toString('base64url') })).rejects.toThrow('cursor');
    }
  });

  it('preserves v1 unfiltered cursors with all/false normalization and rejects reuse with active filters', async () => {
    prismaMock.settlementApproval.findMany.mockResolvedValue([]);
    const cursor = Buffer.from(JSON.stringify({ v: 1, vendorId: 'vendor-a', limit: 20,
      id: 'old-b1-anchor', createdAt: '2026-10-01T00:00:00.000Z' })).toString('base64url');
    for (const highValueOnly of [false, 'false', undefined]) {
      await expect(listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor', status: 'all', highValueOnly, cursor }))
        .resolves.toMatchObject({ approvals: [] });
    }
    for (const filters of [{ status: 'draft' }, { periodKey: '2026-10' }, { highValueOnly: true }])
      await expect(listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor', cursor, ...filters })).rejects.toThrow('cursor');
  });

  it.each(['', 'ALL', 'PAID', 'unknown', ' ready_for_approval ', null, ['approved'], 1])(
    'rejects invalid workflow %j before querying', async (workflow) => {
      await expect(listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor', workflow })).rejects.toThrow('workflow');
      expect(prismaMock.settlementApproval.findMany).not.toHaveBeenCalled();
    });

  it.each([
    ['ready_for_approval', { status: 'DRAFT', OR: [{ netPayableMinor: { gt: 0 } }, {
      lines: { none: {} }, correctionCreditLines: { none: {} }, correctionDeductionLines: { none: {} },
    }] }],
    ['needs_review', { status: 'DRAFT', netPayableMinor: { lte: 0 }, OR: [
      { lines: { some: {} } }, { correctionCreditLines: { some: {} } }, { correctionDeductionLines: { some: {} } },
    ] }],
    ['vendor_hold', { OR: [{ status: 'CANCELLED' }, { netPayableMinor: { lte: 0 }, OR: [
      { lines: { some: {} } }, { correctionCreditLines: { some: {} } }, { correctionDeductionLines: { some: {} } },
    ] }] }],
    ['approved', { status: 'APPROVED' }],
    ['refund_review', { id: { in: [] } }],
    ['paid', { id: { in: [] } }],
  ])('pushes exact summary workflow %s into the bounded Vendor query', async (workflow, predicate) => {
    prismaMock.settlementApproval.findMany.mockResolvedValue([]);
    await listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor', workflow });
    expect(prismaMock.settlementApproval.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: 'vendor-a', AND: [predicate] }, take: 21,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('binds workflow v3 cursors without changing existing v1/v2 payloads or all normalization', async () => {
    prismaMock.settlementApproval.findMany.mockResolvedValue(Array.from({ length: 3 }, (_, i) => ({
      ...buildApproval({ id: `workflow-${i}`, status: 'DRAFT' }), _count: { lines: 0 },
    })));
    const base = { pagination: 'cursor', limit: 2 };
    for (const filters of [{}, { status: 'draft', periodKey: '2026-10', highValueOnly: true }]) {
      const unscoped = await listSettlementApprovalsForVendor('vendor-a', filters.status ? { ...base, ...filters } : base);
      if (!('nextCursor' in unscoped)) throw new Error('Cursor response expected');
      const oldCursor = JSON.parse(Buffer.from(unscoped.nextCursor!, 'base64url').toString());
      expect(oldCursor.v).toBe(filters.status ? 2 : 1);
      await expect(listSettlementApprovalsForVendor('vendor-a', { ...base, ...filters, workflow: 'all', cursor: unscoped.nextCursor }))
        .resolves.toBeDefined();
      await expect(listSettlementApprovalsForVendor('vendor-a', { ...base, ...filters, workflow: 'ready_for_approval', cursor: unscoped.nextCursor }))
        .rejects.toThrow('cursor');
      const query = { ...base, ...filters, workflow: 'ready_for_approval' };
      const first = await listSettlementApprovalsForVendor('vendor-a', query);
      if (!('nextCursor' in first)) throw new Error('Cursor response expected');
      const decoded = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString());
      expect(decoded).toMatchObject({ v: 3, workflow: 'ready_for_approval', filters: {
        status: filters.status ? 'DRAFT' : null, periodKey: filters.periodKey ?? null, highValueOnly: filters.highValueOnly ?? false,
      } });
      await expect(listSettlementApprovalsForVendor('vendor-a', { ...query, cursor: first.nextCursor })).resolves.toBeDefined();
      for (const override of [{ workflow: 'needs_review' }, { workflow: 'all' }, { workflow: undefined },
        { status: 'approved' }, { periodKey: 'different' }, { highValueOnly: !filters.highValueOnly }, { limit: 3 }]) {
        prismaMock.settlementApproval.findMany.mockClear();
        await expect(listSettlementApprovalsForVendor('vendor-a', { ...query, ...override, cursor: first.nextCursor })).rejects.toThrow('cursor');
        expect(prismaMock.settlementApproval.findMany).not.toHaveBeenCalled();
      }
      await expect(listSettlementApprovalsForVendor('vendor-b', { ...query, cursor: first.nextCursor })).rejects.toThrow('cursor');
      for (const tamper of [{ v: 2 }, { workflow: null }, { workflow: 'approved' }, { filters: null },
        { filters: { ...decoded.filters, workflow: 'ready_for_approval' } }]) {
        await expect(listSettlementApprovalsForVendor('vendor-a', { ...query,
          cursor: Buffer.from(JSON.stringify({ ...decoded, ...tamper })).toString('base64url') })).rejects.toThrow('cursor');
      }
    }
  });

  it.each([null, 1, ['x'], {}, 'x'.repeat(513)])('rejects invalid searchId %j', async (searchId) => {
    await expect(listSettlementApprovalsForVendor('vendor-a', { pagination: 'cursor', searchId })).rejects.toThrow('searchId');
    expect(prismaMock.settlementApproval.findMany).not.toHaveBeenCalled();
  });
  it('escapes literal pattern characters and binds normalized search cursors to all query conditions', async () => {
    prismaMock.settlementApproval.findMany.mockResolvedValue(Array.from({ length: 3 }, (_, i) => ({
      ...buildApproval({ id: `search-${i}`, status: 'DRAFT' }), _count: { lines: 0 },
    })));
    const query = { pagination: 'cursor', limit: 2, searchId: '  A%_  ', workflow: 'ready_for_approval', status: 'draft' };
    const first = await listSettlementApprovalsForVendor('vendor-a', query);
    expect(prismaMock.settlementApproval.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      vendorId: 'vendor-a', AND: expect.arrayContaining([{ id: { contains: 'a\\%\\_', mode: 'insensitive' } }]),
    }) }));
    if (!('nextCursor' in first)) throw new Error('Cursor expected');
    expect(JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString())).toMatchObject({ v: 4, searchId: 'a%_' });
    await expect(listSettlementApprovalsForVendor('vendor-a', { ...query, searchId: 'a%_', cursor: first.nextCursor })).resolves.toBeDefined();
    for (const override of [{ searchId: 'different' }, { searchId: '' }, { status: 'approved' }, { workflow: 'all' },
      { periodKey: '2025-01' }, { highValueOnly: true }, { limit: 3 }])
      await expect(listSettlementApprovalsForVendor('vendor-a', { ...query, ...override, cursor: first.nextCursor })).rejects.toThrow('cursor');
    await expect(listSettlementApprovalsForVendor('vendor-b', { ...query, cursor: first.nextCursor })).rejects.toThrow('cursor');
  });
  it('lists recent settlement approvals for a vendor newest first without writes', async () => {
    prismaMock.settlementApproval.findMany.mockResolvedValue([
      {
        ...buildApproval({ id: 'approval-new', status: 'APPROVED' }),
        _count: { lines: 2 },
      },
      {
        ...buildApproval({ id: 'approval-draft', status: 'DRAFT' }),
        _count: { lines: 1 },
      },
    ]);

    const result = await listSettlementApprovalsForVendor('vendor-a');

    expect(prismaMock.settlementApproval.findMany).toHaveBeenCalledWith({
      where: { vendorId: 'vendor-a' },
      orderBy: {
        createdAt: 'desc',
      },
      take: 20,
      include: {
        _count: {
          select: {
            lines: true,
            correctionCreditLines: true,
            correctionDeductionLines: true,
          },
        },
      },
    });
    expect(result).toMatchObject({
      ok: true,
      writesPerformed: false,
      vendorId: 'vendor-a',
      approvals: [
        {
          id: 'approval-new',
          status: 'approved',
          lineCount: 2,
          grossSalesMinor: 100000,
          netPayableMinor: 78000,
        },
        {
          id: 'approval-draft',
          status: 'draft',
          lineCount: 1,
        },
      ],
    });
    expect(prismaMock.settlementApproval.create).not.toHaveBeenCalled();
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
  });

  it('creates a draft approval with total and line snapshots', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1000 }),
      buildLedgerRow({ id: 'refund-1', entryType: 'refund', amount: 100 }),
    ]);
    prismaMock.settlementApprovalLine.count.mockResolvedValue(0);
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());
    prismaMock.settlementApproval.create.mockImplementation(async ({ data }) => ({
      id: 'settlement-approval-1',
      createdAt: new Date('2026-06-01T11:00:00.000Z'),
      updatedAt: new Date('2026-06-01T11:00:00.000Z'),
      vendorId: data.vendorId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      status: data.status,
      currency: data.currency,
      grossSalesMinor: data.grossSalesMinor,
      refundTotalMinor: data.refundTotalMinor,
      commissionMinor: data.commissionMinor,
      commissionVatMinor: data.commissionVatMinor,
      netPayableMinor: data.netPayableMinor,
      approvedBy: null,
      approvedAt: null,
      cancelledBy: null,
      cancelledAt: null,
      notes: data.notes,
      sourceSnapshotJson: data.sourceSnapshotJson,
      lines: data.lines.create.map((line: Record<string, unknown>, index: number) => ({
        id: `line-${index}`,
        settlementApprovalId: 'settlement-approval-1',
        ...line,
      })),
    }));

    const approval = await createDraftApproval({ vendorId: 'vendor-a', notes: 'June review' });

    expect(prismaMock.settlementApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vendorId: 'vendor-a',
          status: 'DRAFT',
          grossSalesMinor: 100000,
          refundTotalMinor: 10000,
          commissionMinor: 9000,
          commissionVatMinor: 1800,
          netPayableMinor: 79200,
          correctionCreditMinor: 0,
          correctionDeductionMinor: 0,
          sourceSnapshotJson: expect.objectContaining({
            candidateScope: 'vendor_wide',
            settlementBillingSnapshot: expect.objectContaining({
              version: 1,
              source: 'vendor_billing_profile',
              vendorId: 'vendor-a',
              vendorBillingProfileId: 'billing-1',
              legalCompanyName: 'Yali Spor A.S.',
              taxNumber: '1234567890',
              taxOffice: 'Kadikoy',
              billingAddress: 'Billing address',
              billingCity: 'Istanbul',
              billingDistrict: 'Kadikoy',
              authorizedPerson: 'Authorized Person',
              billingEmail: 'billing@yali.test',
              billingPhone: '+905551112233',
              legalEntityType: 'limited_company',
              logoIsbasiCustomerCode: 'LOGO-CODE-1',
              logoIsbasiCustomerId: 'LOGO-ID-1',
              logoIsbasiEinvoiceEligible: true,
              logoIsbasiLastCheckedAt: '2026-06-01T09:00:00.000Z',
            }),
          }),
          lines: {
            create: [
              expect.objectContaining({
                financeLedgerEntryId: 'sale-1',
                lineType: 'SALE',
                payableImpactMinor: 88000,
                sourceSnapshotJson: expect.objectContaining({
                  storedSettlementStatus: 'PAYABLE',
                  derivedSettlementStatus: 'payable',
                  payoutStatus: 'PENDING',
                  settlementDelayDaysSnapshot: 21,
                  eligibilityDecision: 'included',
                  eligibilityReason: 'Derived payable because delivery evidence satisfies settlement delay.',
                  refundDetected: false,
                  refundCount: 0,
                  fulfillmentEvidencePresent: true,
                  shippingEvidencePresent: true,
                }),
              }),
              expect.objectContaining({
                financeLedgerEntryId: 'refund-1',
                lineType: 'REFUND',
                commissionMinor: -1000,
                commissionVatMinor: -200,
                payableImpactMinor: -8800,
                sourceSnapshotJson: expect.objectContaining({
                  storedSettlementStatus: 'PARTIALLY_REFUNDED',
                  derivedSettlementStatus: 'partially_refunded',
                  eligibilityReason: 'Refund offset applied before settlement.',
                  refundOffsetAppliedBeforeSettlement: true,
                  vendorPayableReversalMinor: 8800,
                }),
              }),
            ],
          },
        }),
        include: {
          lines: true,
          correctionCreditLines: true,
          correctionDeductionLines: true,
        },
      }),
    );
    expect(approval).toMatchObject({
      id: 'settlement-approval-1',
      writesPerformed: true,
      status: 'draft',
      grossSalesMinor: 100000,
      commissionMinor: 9000,
      commissionVatMinor: 1800,
      netPayableMinor: 79200,
    });
    expect(prismaMock.vendorBillingProfile.findUnique).toHaveBeenCalledWith({
      where: {
        vendorId: 'vendor-a',
      },
    });
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
  });

  it('applies pending refund adjustments into a draft approval and reduces payable', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1000 }),
    ]);
    prismaMock.settlementRefundAdjustment.findMany.mockResolvedValue([
      {
        id: 'adjustment-1',
        originalOrderId: 'order-1086',
        refundRecordId: 'refund-record-1086',
        refundFinanceLedgerEntryId: 'refund-ledger-1086',
        originalSettlementApprovalId: 'approval-original',
        originalSettlementCommissionInvoiceId: 'commission-invoice-original',
        amountMinor: 40000,
        currencyCode: 'TRY',
        reason: 'Refund after invoiced settlement requires future settlement adjustment.',
      },
    ]);
    prismaMock.settlementApprovalLine.count.mockResolvedValue(0);
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());
    prismaMock.settlementApproval.create.mockImplementation(async ({ data }) => ({
      id: 'settlement-approval-1',
      createdAt: new Date('2026-06-01T11:00:00.000Z'),
      updatedAt: new Date('2026-06-01T11:00:00.000Z'),
      vendorId: data.vendorId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      status: data.status,
      currency: data.currency,
      grossSalesMinor: data.grossSalesMinor,
      refundTotalMinor: data.refundTotalMinor,
      commissionMinor: data.commissionMinor,
      commissionVatMinor: data.commissionVatMinor,
      netPayableMinor: data.netPayableMinor,
      approvedBy: null,
      approvedAt: null,
      cancelledBy: null,
      cancelledAt: null,
      notes: data.notes,
      sourceSnapshotJson: data.sourceSnapshotJson,
      lines: data.lines.create.map((line: Record<string, unknown>, index: number) => ({
        id: `line-${index}`,
        settlementApprovalId: 'settlement-approval-1',
        ...line,
      })),
    }));

    const approval = await createDraftApproval({ vendorId: 'vendor-a' });

    expect(prismaMock.settlementApproval.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        grossSalesMinor: 100000,
        refundTotalMinor: 0,
        commissionMinor: 10000,
        commissionVatMinor: 2000,
        netPayableMinor: 48000,
        sourceSnapshotJson: expect.objectContaining({
          pendingRefundAdjustmentCount: 1,
          pendingRefundAdjustmentTotalMinor: 40000,
          netAfterPendingRefundAdjustmentsMinor: 48000,
        }),
        lines: {
          create: [
            expect.objectContaining({
              financeLedgerEntryId: 'sale-1',
              lineType: 'SALE',
              payableImpactMinor: 88000,
            }),
            expect.objectContaining({
              financeLedgerEntryId: 'refund-ledger-1086',
              settlementRefundAdjustmentId: null,
              settlementRefundAdjustmentApplicationId: null,
              lineType: 'REFUND_ADJUSTMENT',
              amountMinor: 40000,
              commissionMinor: 0,
              commissionVatMinor: 0,
              payableImpactMinor: -40000,
              sourceSnapshotJson: expect.objectContaining({
                settlementRefundAdjustmentId: 'adjustment-1',
                adjustmentStatus: 'APPLIED',
                reason: 'Refund after invoiced settlement requires future settlement adjustment.',
              }),
            }),
          ],
        },
      }),
    }));
    expect(prismaMock.settlementRefundAdjustmentApplication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        settlementRefundAdjustmentId: 'adjustment-1',
        settlementApprovalId: 'settlement-approval-1',
        settlementApprovalLineId: 'line-1',
        amountMinor: 40000,
        currencyCode: 'TRY',
        status: 'ACTIVE',
      }),
    });
    expect(prismaMock.settlementApprovalLine.update).toHaveBeenCalledWith({
      where: { id: 'line-1' },
      data: { settlementRefundAdjustmentApplicationId: 'application-1' },
    });
    expect(prismaMock.settlementRefundAdjustment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'adjustment-1',
        vendorId: 'vendor-a',
        status: {
          in: ['PENDING', 'PARTIALLY_APPLIED'],
        },
        remainingAmountMinor: {
          gte: 40000,
        },
      },
      data: {
        status: 'APPLIED',
        appliedAmountMinor: { increment: 40000 },
        remainingAmountMinor: { decrement: 40000 },
        appliedSettlementApprovalId: 'settlement-approval-1',
        appliedSettlementApprovalLineId: 'line-1',
      },
    });
    expect(prismaMock.settlementRefundAdjustmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        settlementRefundAdjustmentId: 'adjustment-1',
        eventType: 'APPLIED',
        metadataJson: expect.objectContaining({
          settlementApprovalId: 'settlement-approval-1',
          settlementApprovalLineId: 'line-1',
          settlementRefundAdjustmentApplicationId: 'application-1',
          appliedAmountMinor: 40000,
          remainingAmountMinorAfter: 0,
        }),
      }),
    });
    expect(approval.netPayableMinor).toBe(48000);
    expect(approval.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        lineType: 'REFUND_ADJUSTMENT',
        payableImpactMinor: -40000,
      }),
    ]));
  });

  it('blocks adjustment-only settlement drafts', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([]);
    prismaMock.settlementRefundAdjustment.findMany.mockResolvedValue([
      {
        id: 'adjustment-1',
        originalOrderId: 'order-1086',
        refundRecordId: 'refund-record-1086',
        refundFinanceLedgerEntryId: 'refund-ledger-1086',
        originalSettlementApprovalId: null,
        originalSettlementCommissionInvoiceId: null,
        amountMinor: 40000,
        currencyCode: 'TRY',
        reason: 'Refund after approved settlement requires future settlement adjustment.',
      },
    ]);

    await expect(createDraftApproval({ vendorId: 'vendor-a' })).rejects.toThrow(
      'Adjustment-only settlement drafts are not supported yet.',
    );
    expect(prismaMock.settlementApproval.create).not.toHaveBeenCalled();
    expect(prismaMock.settlementRefundAdjustment.updateMany).not.toHaveBeenCalled();
  });

  it('partially applies pending refund adjustments when they exceed current settlement payable', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-small', entryType: 'sale', amount: 100 }),
    ]);
    prismaMock.settlementRefundAdjustment.findMany.mockResolvedValue([
      {
        id: 'adjustment-1',
        originalOrderId: 'order-1086',
        refundRecordId: 'refund-record-1086',
        refundFinanceLedgerEntryId: 'refund-ledger-1086',
        originalSettlementApprovalId: null,
        originalSettlementCommissionInvoiceId: null,
        amountMinor: 10000,
        originalAmountMinor: 10000,
        appliedAmountMinor: 0,
        remainingAmountMinor: 10000,
        currencyCode: 'TRY',
        reason: 'Refund after approved settlement requires future settlement adjustment.',
      },
    ]);
    prismaMock.settlementApprovalLine.count.mockResolvedValue(0);
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());
    prismaMock.settlementRefundAdjustmentApplication.create.mockResolvedValueOnce({
      id: 'application-partial',
      settlementRefundAdjustmentId: 'adjustment-1',
      settlementApprovalId: 'settlement-approval-1',
      settlementApprovalLineId: 'line-1',
      amountMinor: 8800,
      currencyCode: 'TRY',
      status: 'ACTIVE',
      createdAt: new Date('2026-06-01T11:00:00.000Z'),
      updatedAt: new Date('2026-06-01T11:00:00.000Z'),
    });
    prismaMock.settlementApproval.create.mockImplementation(async ({ data }) => ({
      id: 'settlement-approval-1',
      createdAt: new Date('2026-06-01T11:00:00.000Z'),
      updatedAt: new Date('2026-06-01T11:00:00.000Z'),
      vendorId: data.vendorId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      status: data.status,
      currency: data.currency,
      grossSalesMinor: data.grossSalesMinor,
      refundTotalMinor: data.refundTotalMinor,
      commissionMinor: data.commissionMinor,
      commissionVatMinor: data.commissionVatMinor,
      netPayableMinor: data.netPayableMinor,
      approvedBy: null,
      approvedAt: null,
      cancelledBy: null,
      cancelledAt: null,
      notes: data.notes,
      sourceSnapshotJson: data.sourceSnapshotJson,
      lines: data.lines.create.map((line: Record<string, unknown>, index: number) => ({
        id: `line-${index}`,
        settlementApprovalId: 'settlement-approval-1',
        ...line,
      })),
    }));

    const approval = await createDraftApproval({ vendorId: 'vendor-a' });

    expect(approval.netPayableMinor).toBe(0);
    expect(prismaMock.settlementRefundAdjustmentApplication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        settlementRefundAdjustmentId: 'adjustment-1',
        amountMinor: 8800,
      }),
    });
    expect(prismaMock.settlementRefundAdjustment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'PARTIALLY_APPLIED',
        appliedAmountMinor: { increment: 8800 },
        remainingAmountMinor: { decrement: 8800 },
        appliedSettlementApprovalId: null,
        appliedSettlementApprovalLineId: null,
      }),
    }));
    expect(prismaMock.settlementRefundAdjustmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        settlementRefundAdjustmentId: 'adjustment-1',
        eventType: 'PARTIALLY_APPLIED',
        metadataJson: expect.objectContaining({
          appliedAmountMinor: 8800,
          remainingAmountMinorAfter: 1200,
        }),
      }),
    });
  });

  it('fails draft creation if an adjustment cannot be marked applied safely', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1000 }),
    ]);
    prismaMock.settlementRefundAdjustment.findMany.mockResolvedValue([
      {
        id: 'adjustment-1',
        originalOrderId: 'order-1086',
        refundRecordId: 'refund-record-1086',
        refundFinanceLedgerEntryId: 'refund-ledger-1086',
        originalSettlementApprovalId: 'approval-original',
        originalSettlementCommissionInvoiceId: 'commission-invoice-original',
        amountMinor: 40000,
        currencyCode: 'TRY',
        reason: 'Refund after invoiced settlement requires future settlement adjustment.',
      },
    ]);
    prismaMock.settlementApprovalLine.count.mockResolvedValue(0);
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());
    prismaMock.settlementApproval.create.mockImplementation(async ({ data }) => ({
      id: 'settlement-approval-1',
      createdAt: new Date('2026-06-01T11:00:00.000Z'),
      updatedAt: new Date('2026-06-01T11:00:00.000Z'),
      vendorId: data.vendorId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      status: data.status,
      currency: data.currency,
      grossSalesMinor: data.grossSalesMinor,
      refundTotalMinor: data.refundTotalMinor,
      commissionMinor: data.commissionMinor,
      commissionVatMinor: data.commissionVatMinor,
      netPayableMinor: data.netPayableMinor,
      approvedBy: null,
      approvedAt: null,
      cancelledBy: null,
      cancelledAt: null,
      notes: data.notes,
      sourceSnapshotJson: data.sourceSnapshotJson,
      lines: data.lines.create.map((line: Record<string, unknown>, index: number) => ({
        id: `line-${index}`,
        settlementApprovalId: 'settlement-approval-1',
        ...line,
      })),
    }));
    prismaMock.settlementRefundAdjustment.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(createDraftApproval({ vendorId: 'vendor-a' })).rejects.toThrow(
      'Pending refund adjustment could not be applied safely.',
    );
  });

  it('excludes Shopify-approved open returns from settlement approval drafts', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({
        id: 'sale-approved-return',
        entryType: 'sale',
        amount: 1000,
        returnRecords: [{
          id: 'return-approved',
          status: 'approved',
          returnLifecycleStatus: 'approved',
        }],
      }),
      buildLedgerRow({ id: 'sale-clear', entryType: 'sale', amount: 500 }),
    ]);
    prismaMock.settlementApprovalLine.count.mockResolvedValue(0);
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());
    prismaMock.settlementApproval.create.mockImplementation(async ({ data }) => ({
      id: 'settlement-approval-open-return',
      createdAt: new Date('2026-06-01T11:00:00.000Z'),
      updatedAt: new Date('2026-06-01T11:00:00.000Z'),
      vendorId: data.vendorId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      status: data.status,
      currency: data.currency,
      grossSalesMinor: data.grossSalesMinor,
      refundTotalMinor: data.refundTotalMinor,
      commissionMinor: data.commissionMinor,
      commissionVatMinor: data.commissionVatMinor,
      netPayableMinor: data.netPayableMinor,
      approvedBy: null,
      approvedAt: null,
      cancelledBy: null,
      cancelledAt: null,
      notes: data.notes,
      sourceSnapshotJson: data.sourceSnapshotJson,
      lines: data.lines.create.map((line: Record<string, unknown>, index: number) => ({
        id: `line-open-return-${index}`,
        settlementApprovalId: 'settlement-approval-open-return',
        ...line,
      })),
    }));

    const approval = await createDraftApproval({ vendorId: 'vendor-a' });

    expect(prismaMock.settlementApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          grossSalesMinor: 50000,
          lines: {
            create: [
              expect.objectContaining({
                financeLedgerEntryId: 'sale-clear',
              }),
            ],
          },
        }),
      }),
    );
    expect(approval.lines).toHaveLength(1);
    expect(approval.lines[0]).toMatchObject({
      financeLedgerEntryId: 'sale-clear',
    });
  });

  it('excludes sale rows from settlement approval drafts before the settlement delay passes', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({
        id: 'sale-delay-pending',
        entryType: 'sale',
        amount: 1000,
        deliveredAt: new Date('2999-01-01T00:00:00.000Z'),
      }),
      buildLedgerRow({ id: 'sale-clear', entryType: 'sale', amount: 500 }),
    ]);
    prismaMock.settlementApprovalLine.count.mockResolvedValue(0);
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());
    prismaMock.settlementApproval.create.mockImplementation(async ({ data }) => ({
      id: 'settlement-approval-delay',
      createdAt: new Date('2026-06-01T11:00:00.000Z'),
      updatedAt: new Date('2026-06-01T11:00:00.000Z'),
      vendorId: data.vendorId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      status: data.status,
      currency: data.currency,
      grossSalesMinor: data.grossSalesMinor,
      refundTotalMinor: data.refundTotalMinor,
      commissionMinor: data.commissionMinor,
      commissionVatMinor: data.commissionVatMinor,
      netPayableMinor: data.netPayableMinor,
      approvedBy: null,
      approvedAt: null,
      cancelledBy: null,
      cancelledAt: null,
      notes: data.notes,
      sourceSnapshotJson: data.sourceSnapshotJson,
      lines: data.lines.create.map((line: Record<string, unknown>, index: number) => ({
        id: `line-delay-${index}`,
        settlementApprovalId: 'settlement-approval-delay',
        ...line,
      })),
    }));

    const approval = await createDraftApproval({ vendorId: 'vendor-a' });

    expect(prismaMock.settlementApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          grossSalesMinor: 50000,
          lines: {
            create: [
              expect.objectContaining({
                financeLedgerEntryId: 'sale-clear',
              }),
            ],
          },
        }),
      }),
    );
    expect(approval.lines).toHaveLength(1);
    expect(approval.lines[0]).toMatchObject({
      financeLedgerEntryId: 'sale-clear',
    });
  });

  it('does not create a draft from only an immature refund-aware sale', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({
        id: 'sale-refund-delay-pending', entryType: 'sale', amount: 1000,
        deliveredAt: new Date('2026-06-01T00:00:00.000Z'), settlementDelayDaysSnapshot: 21,
        refundRecords: [{ id: 'refund-delay-pending', sourceShopifyRefundId: 'refund-delay-pending', amount: 100 }],
      }),
    ]);

    await expect(createDraftApproval({
      vendorId: 'vendor-a', asOfDate: new Date('2026-06-21T23:59:59.999Z'),
    })).rejects.toThrow('No eligible settlement rows are available for approval.');
    expect(prismaMock.settlementApproval.create).not.toHaveBeenCalled();
  });

  it.each(['PENDING', 'PARTIALLY_APPLIED'] as const)(
    'does not let an immature refund-aware sale fund a %s refund adjustment',
    async (status) => {
      prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
        buildLedgerRow({
          id: `sale-refund-adjustment-${status}`, entryType: 'sale', amount: 1000,
          deliveredAt: new Date('2026-06-01T00:00:00.000Z'), settlementDelayDaysSnapshot: 21,
          refundRecords: [{ id: `refund-${status}`, sourceShopifyRefundId: `refund-${status}`, amount: 100 }],
        }),
      ]);
      prismaMock.settlementRefundAdjustment.findMany.mockResolvedValue([{
        id: `adjustment-${status}`, originalOrderId: `order-${status}`,
        refundRecordId: `refund-record-${status}`, refundFinanceLedgerEntryId: `refund-ledger-${status}`,
        originalSettlementApprovalId: null, originalSettlementCommissionInvoiceId: null,
        status, amountMinor: 40000, originalAmountMinor: 40000,
        appliedAmountMinor: status === 'PARTIALLY_APPLIED' ? 10000 : 0,
        remainingAmountMinor: status === 'PARTIALLY_APPLIED' ? 30000 : 40000,
        currencyCode: 'TRY', reason: 'Existing refund adjustment.',
      }]);

      await expect(createDraftApproval({
        vendorId: 'vendor-a', asOfDate: new Date('2026-06-21T23:59:59.999Z'),
      })).rejects.toThrow('Adjustment-only settlement drafts are not supported yet.');
      expect(prismaMock.settlementApproval.create).not.toHaveBeenCalled();
      expect(prismaMock.settlementRefundAdjustmentApplication.create).not.toHaveBeenCalled();
      expect(prismaMock.settlementRefundAdjustment.updateMany).not.toHaveBeenCalled();
    },
  );

  it('creates a draft from the same selected order candidate set used by preview', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({
        id: 'sale-1074',
        entryType: 'sale',
        amount: 1000,
        sourceShopifyOrderId: 'shopify-order-1074',
        sourceShopifyOrderNumber: '#1074',
      }),
      buildLedgerRow({
        id: 'sale-1073',
        entryType: 'sale',
        amount: 500,
        sourceShopifyOrderId: 'shopify-order-1073',
        sourceShopifyOrderNumber: '#1073',
      }),
    ]);
    prismaMock.settlementApprovalLine.count.mockResolvedValue(0);
    prismaMock.settlementApproval.create.mockImplementation(async ({ data }) => ({
      id: 'settlement-approval-selected',
      createdAt: new Date('2026-06-01T11:00:00.000Z'),
      updatedAt: new Date('2026-06-01T11:00:00.000Z'),
      vendorId: data.vendorId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      status: data.status,
      currency: data.currency,
      grossSalesMinor: data.grossSalesMinor,
      refundTotalMinor: data.refundTotalMinor,
      commissionMinor: data.commissionMinor,
      commissionVatMinor: data.commissionVatMinor,
      netPayableMinor: data.netPayableMinor,
      approvedBy: null,
      approvedAt: null,
      cancelledBy: null,
      cancelledAt: null,
      notes: data.notes,
      sourceSnapshotJson: data.sourceSnapshotJson,
      lines: data.lines.create.map((line: Record<string, unknown>, index: number) => ({
        id: `line-${index}`,
        settlementApprovalId: 'settlement-approval-selected',
        ...line,
      })),
    }));

    const approval = await createDraftApproval({
      vendorId: 'vendor-a',
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#1074'],
    });

    expect(prismaMock.settlementApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceSnapshotJson: expect.objectContaining({
            candidateScope: 'selected_orders',
            candidateSelectionSummary: expect.objectContaining({
              requestedOrders: ['#1074'],
              matchedOrders: ['#1074'],
              unmatchedOrders: [],
              candidateRowCount: 1,
            }),
          }),
          lines: {
            create: [
              expect.objectContaining({
                financeLedgerEntryId: 'sale-1074',
              }),
            ],
          },
        }),
      }),
    );
    expect(approval.lines).toHaveLength(1);
    expect(approval.lines[0]).toMatchObject({
      financeLedgerEntryId: 'sale-1074',
    });
  });

  it('keeps an integrity-filtered selected order out of draft membership', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-alert', entryType: 'sale', amount: 1000, sourceShopifyOrderNumber: '#1074' }),
      buildLedgerRow({ id: 'sale-safe', entryType: 'sale', amount: 500, sourceShopifyOrderNumber: '#1073' }),
    ]);
    prismaMock.financeIntegrityAlert.findMany.mockImplementation(async ({ where }) =>
      where.OR[0].vendorAllocationId === 'alloc-sale-alert'
        ? [{ category: 'multiple_active_sale_ledgers' }]
        : [],
    );
    prismaMock.settlementApprovalLine.count.mockResolvedValue(0);
    prismaMock.vendorBillingProfile.findUnique.mockResolvedValue(buildBillingProfile());
    prismaMock.settlementApproval.create.mockImplementation(async ({ data }) => ({
      ...buildApproval({ id: 'settlement-approval-selected', status: 'DRAFT' }),
      ...data,
      id: 'settlement-approval-selected',
      correctionCreditLines: [],
      correctionDeductionLines: [],
      lines: data.lines.create.map((line: Record<string, unknown>, index: number) => ({
        id: `line-${index}`,
        settlementApprovalId: 'settlement-approval-selected',
        ...line,
      })),
    }));

    const approval = await createDraftApproval({
      vendorId: 'vendor-a',
      candidateScope: 'selected_orders',
      selectedOrderIds: ['#1074', '#1073'],
    });

    expect(prismaMock.settlementApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          grossSalesMinor: 50000,
          commissionMinor: 5000,
          commissionVatMinor: 1000,
          netPayableMinor: 44000,
          lines: { create: [expect.objectContaining({ financeLedgerEntryId: 'sale-safe' })] },
        }),
      }),
    );
    expect(approval.lines.map((line) => line.financeLedgerEntryId)).toEqual(['sale-safe']);
  });

  it('approves only draft approvals without invoice or payout execution', async () => {
    // This approval contains one SALE line and no REFUND line; its header must match that source.
    prismaMock.settlementApproval.findUnique.mockResolvedValue({
      ...buildApproval({ id: 'approval-1', status: 'DRAFT' }),
      refundTotalMinor: 0,
      netPayableMinor: 88000,
    });
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1000, activeApproval: true, activeApprovalId: 'approval-1' }),
    );
    prismaMock.settlementApproval.update.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'APPROVED' }));

    const approval = await approveSettlementApproval('approval-1', 'admin-1');

    expect(prismaMock.settlementApproval.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'approval-1' },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 'admin-1',
        }),
      }),
    );
    expect(approval.status).toBe('approved');
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
  });

  it('assesses a clean draft with the same current source checks without approving it', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1000, activeApproval: true, activeApprovalId: 'approval-1' }),
    );

    const assessment = await assessSettlementApprovalReadiness('approval-1');

    expect(assessment).toMatchObject({
      writesPerformed: false,
      settlementApprovalId: 'approval-1', vendorId: 'vendor-a', currency: 'TRY', status: 'DRAFT',
      classification: 'VERIFIED_BY_EXISTING_CHECKS',
      sourceValidation: { evaluated: true, ok: true, reasons: [] },
      blockers: [], missingEvidence: [], adminReviewRequired: true,
    });
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
  });

  it('blocks a stale refund-aware draft and preserves its source identity', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1000, activeApproval: true,
        activeApprovalId: 'approval-1', refundRecords: [{ id: 'refund-new', sourceShopifyRefundId: 'refund-new', amount: 100 }] }),
    );

    const assessment = await assessSettlementApprovalReadiness('approval-1');

    expect(assessment).toMatchObject({
      classification: 'BLOCKED',
      sourceValidation: { evaluated: true, ok: false, reasons: [
        expect.objectContaining({ code: 'refund_arrived_after_draft', financeLedgerEntryId: 'sale-1' }),
      ] },
      adminReviewRequired: true,
    });
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('does not label replacement authority as verified by line checks', async () => {
    const replacement = buildApproval({ id: 'approval-1', status: 'DRAFT' });
    prismaMock.settlementApproval.findUnique.mockResolvedValue({
      ...replacement, replacesSettlementApprovalId: 'cancelled-original',
    });
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1000, activeApproval: true, activeApprovalId: 'approval-1' }),
    );

    const assessment = await assessSettlementApprovalReadiness('approval-1');

    expect(assessment).toMatchObject({
      classification: 'UNKNOWN', sourceValidation: { evaluated: true, ok: true }, adminReviewRequired: true,
    });
    expect(assessment?.blockers).toEqual([expect.stringContaining('Controlled replacement')]);
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('does not label Financial Correction authority as verified by ordinary line checks', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue({
      ...buildApproval({ id: 'approval-1', status: 'DRAFT' }), correctionCreditMinor: 1000,
      correctionCreditLines: [{ id: 'credit-line-1' }],
    });
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1000, activeApproval: true, activeApprovalId: 'approval-1' }),
    );

    const result = await assessSettlementApprovalReadiness('approval-1');

    expect(result?.classification).toBe('UNKNOWN');
    expect(result?.blockers).toEqual([expect.stringContaining('Financial Correction')]);
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('reports missing ledger authority without borrowing another source', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(null);

    const result = await assessSettlementApprovalReadiness('approval-1');

    expect(result).toMatchObject({
      classification: 'BLOCKED', sourceValidation: { ok: false, reasons: [
        expect.objectContaining({ code: 'ledger_missing', financeLedgerEntryId: 'sale-1' }),
      ] }, missingEvidence: ['Ledger row no longer exists'],
    });
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('blocks a new return hold before any settlement mutation', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1000, activeApproval: true,
        activeApprovalId: 'approval-1', returnRecords: [{ id: 'return-new', status: 'approved', returnLifecycleStatus: 'approved' }] }),
    );

    const result = await assessSettlementApprovalReadiness('approval-1');

    expect(result?.classification).toBe('BLOCKED');
    expect(result?.sourceValidation.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'approved_return_hold_active' }),
    ]));
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('blocks a pending customer cancellation and cross-vendor ledger source', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue({
      ...buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1000, activeApproval: true,
        activeApprovalId: 'approval-1', customerCancellationRequestStatus: 'PENDING' }),
      vendorId: 'vendor-b',
    });

    const result = await assessSettlementApprovalReadiness('approval-1');

    expect(result?.classification).toBe('BLOCKED');
    expect(result?.sourceValidation.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'customer_cancellation_pending' }),
      expect.objectContaining({ code: 'vendor_mismatch' }),
    ]));
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('blocks a changed monetary source while retaining the frozen DRAFT amount', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1100, activeApproval: true, activeApprovalId: 'approval-1' }),
    );

    const result = await assessSettlementApprovalReadiness('approval-1');

    expect(result?.classification).toBe('BLOCKED');
    expect(result?.sourceValidation.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'settlement_amount_changed', details: expect.objectContaining({
        frozen: expect.objectContaining({ amountMinor: 100000 }),
      }) }),
    ]));
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('keeps draft status when the ledger row has been voided', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({
        id: 'sale-1',
        entryType: 'sale',
        amount: 1000,
        activeApproval: true,
        activeApprovalId: 'approval-1',
        voidedAt: new Date('2026-06-21T10:00:00.000Z'),
      }),
    );

    await expect(approveSettlementApproval('approval-1', 'admin-1')).rejects.toMatchObject({
      name: 'SettlementApprovalRevalidationError',
      reasons: [
        expect.objectContaining({
          financeLedgerEntryId: 'sale-1',
          code: 'ledger_voided',
          reason: 'Ledger has been voided or superseded and cannot be approved.',
        }),
      ],
    });
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('keeps approval fail-closed for a stale refund-aware sale before its settlement delay', async () => {
    const approval = buildApproval({ id: 'approval-1', status: 'DRAFT' });
    approval.lines[0].sourceSnapshotJson = { financeLedgerEntryId: 'sale-1', refundCount: 1 };
    prismaMock.settlementApproval.findUnique.mockResolvedValue(approval);
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({
        id: 'sale-1', entryType: 'sale', amount: 1000,
        deliveredAt: new Date('2999-01-01T00:00:00.000Z'),
        activeApproval: true, activeApprovalId: 'approval-1',
        refundRecords: [{ id: 'refund-existing', sourceShopifyRefundId: 'refund-existing', amount: 100 }],
      }),
    );

    await expect(approveSettlementApproval('approval-1', 'admin-1')).rejects.toMatchObject({
      name: 'SettlementApprovalRevalidationError',
      reasons: [expect.objectContaining({
        financeLedgerEntryId: 'sale-1', code: 'settlement_delay_not_satisfied',
      })],
    });
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('keeps draft status when an open finance integrity alert exists for the allocation', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1000, activeApproval: true, activeApprovalId: 'approval-1' }),
    );
    prismaMock.financeIntegrityAlert.findMany.mockResolvedValueOnce([
      {
        id: 'alert-1',
        dedupeKey: 'finance-integrity:multiple_active_sale_ledgers:allocation:alloc-sale-1',
        severity: 'critical',
        category: 'multiple_active_sale_ledgers',
        reason: 'Multiple active sale ledgers exist for allocation.',
        vendorAllocationId: 'alloc-sale-1',
        allocationEconomicTransferId: null,
      },
    ]);

    await expect(approveSettlementApproval('approval-1', 'admin-1')).rejects.toMatchObject({
      name: 'SettlementApprovalRevalidationError',
      reasons: [
        expect.objectContaining({
          financeLedgerEntryId: 'sale-1',
          code: 'finance_integrity_alert_open',
          reason: 'Money movement blocked by blocking finance integrity alert: multiple_active_sale_ledgers.',
          details: expect.objectContaining({
            alertCategory: 'multiple_active_sale_ledgers',
            alertSeverity: 'critical',
            dedupeKey: 'finance-integrity:multiple_active_sale_ledgers:allocation:alloc-sale-1',
          }),
        }),
      ],
    });
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('keeps draft status and returns structured reasons when a refund arrives after draft creation', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({
        id: 'sale-1',
        entryType: 'sale',
        amount: 1000,
        activeApproval: true,
        activeApprovalId: 'approval-1',
        refundRecords: [{ id: 'refund-new', sourceShopifyRefundId: 'refund-new', amount: 100 }],
      }),
    );

    await expect(approveSettlementApproval('approval-1', 'admin-1')).rejects.toMatchObject({
      name: 'SettlementApprovalRevalidationError',
      reasons: [
        expect.objectContaining({
          financeLedgerEntryId: 'sale-1',
          code: 'refund_arrived_after_draft',
          reason: 'Refund arrived after draft creation',
        }),
      ],
    });
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('keeps draft status when an approved return hold appears after draft creation', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({
        id: 'sale-1',
        entryType: 'sale',
        amount: 1000,
        activeApproval: true,
        activeApprovalId: 'approval-1',
        returnRecords: [{
          id: 'return-new',
          status: 'approved',
          returnLifecycleStatus: 'approved',
        }],
      }),
    );

    await expect(approveSettlementApproval('approval-1', 'admin-1')).rejects.toMatchObject({
      reasons: [
        expect.objectContaining({
          code: 'approved_return_hold_active',
          reason: 'Approved return hold is now active',
        }),
      ],
    });
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('keeps draft status when customer cancellation becomes pending after draft creation', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({
        id: 'sale-1',
        entryType: 'sale',
        amount: 1000,
        activeApproval: true,
        activeApprovalId: 'approval-1',
        customerCancellationRequestStatus: 'PENDING',
      }),
    );

    await expect(approveSettlementApproval('approval-1', 'admin-1')).rejects.toMatchObject({
      reasons: [expect.objectContaining({
        financeLedgerEntryId: 'sale-1',
        code: 'customer_cancellation_pending',
        reason: expect.stringContaining('CUSTOMER_CANCELLATION_PENDING'),
      })],
    });
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('keeps draft status when a ledger row is already in an active payout batch', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({
        id: 'sale-1',
        entryType: 'sale',
        amount: 1000,
        activeApproval: true,
        activeApprovalId: 'approval-1',
        activePayoutBatch: true,
      }),
    );

    await expect(approveSettlementApproval('approval-1', 'admin-1')).rejects.toMatchObject({
      reasons: [
        expect.objectContaining({
          code: 'active_payout_batch',
          reason: 'Ledger row is already included in an active payout batch',
        }),
      ],
    });
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('keeps draft status when a ledger row is already paid', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({
        id: 'sale-1',
        entryType: 'sale',
        amount: 1000,
        activeApproval: true,
        activeApprovalId: 'approval-1',
        payoutStatus: 'PAID',
      }),
    );

    await expect(approveSettlementApproval('approval-1', 'admin-1')).rejects.toMatchObject({
      reasons: [
        expect.objectContaining({
          code: 'ledger_paid',
          reason: 'Ledger row already paid',
        }),
      ],
    });
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('keeps draft status when settlement amounts changed since draft creation', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({
        id: 'sale-1',
        entryType: 'sale',
        amount: 1200,
        activeApproval: true,
        activeApprovalId: 'approval-1',
      }),
    );

    await expect(approveSettlementApproval('approval-1', 'admin-1')).rejects.toMatchObject({
      reasons: [
        expect.objectContaining({
          code: 'settlement_amount_changed',
          reason: 'Settlement amount changed since draft creation',
        }),
      ],
    });
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('keeps draft status when a refund approval line becomes stale', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue({
      ...buildApproval({ id: 'approval-1', status: 'DRAFT' }),
      lines: [
        {
          id: 'line-refund-1',
          settlementApprovalId: 'approval-1',
          financeLedgerEntryId: 'refund-1',
          lineType: 'REFUND',
          amountMinor: 10000,
          commissionMinor: 0,
          commissionVatMinor: 0,
          payableImpactMinor: -10000,
          sourceSnapshotJson: { financeLedgerEntryId: 'refund-1', refundCount: 1 },
        },
      ],
    });
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({
        id: 'refund-1',
        entryType: 'refund',
        amount: 100,
        activeApproval: true,
        activeApprovalId: 'approval-1',
        payoutStatus: 'HOLD',
      }),
    );

    await expect(approveSettlementApproval('approval-1', 'admin-1')).rejects.toMatchObject({
      reasons: [
        expect.objectContaining({
          code: 'settlement_amount_changed',
          reason: 'Settlement amount changed since draft creation',
        }),
      ],
    });
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('keeps draft status when a ledger row is locked by another active settlement approval', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(
      buildLedgerRow({
        id: 'sale-1',
        entryType: 'sale',
        amount: 1000,
        activeApproval: true,
        activeApprovalId: 'approval-other',
      }),
    );

    const approvalAttempt = approveSettlementApproval('approval-1', 'admin-1');
    await expect(approvalAttempt).rejects.toBeInstanceOf(SettlementApprovalRevalidationError);
    await expect(approvalAttempt).rejects.toMatchObject({
      reasons: [
        expect.objectContaining({
          code: 'active_settlement_approval_conflict',
          reason: 'Ledger row is locked by another active settlement approval',
        }),
      ],
    });
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('rejects approval when approval is not draft', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'APPROVED' }));

    await expect(approveSettlementApproval('approval-1', 'admin-1')).rejects.toThrow(
      'Only draft settlement approvals can be approved.',
    );
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('cancels active approvals so rows are released from future previews', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'APPROVED' }));
    prismaMock.settlementApproval.update.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'CANCELLED' }));

    const cancelled = await cancelSettlementApproval('approval-1', 'admin-2');

    expect(cancelled.status).toBe('cancelled');
    expect(prismaMock.settlementApproval.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelledBy: 'admin-2',
          cancelledFromStatus: 'APPROVED',
        }),
      }),
    );
    expect(prismaMock.settlementRefundAdjustmentApplication.findMany).toHaveBeenCalledWith({
      where: {
        settlementApprovalId: 'approval-1',
        status: 'ACTIVE',
      },
      include: {
        settlementRefundAdjustment: true,
      },
    });
    expect(prismaMock.settlementRefundAdjustment.findMany).toHaveBeenCalledWith({
      where: {
        appliedSettlementApprovalId: 'approval-1',
        status: 'APPLIED',
      },
      select: {
        id: true,
        originalAmountMinor: true,
        amountMinor: true,
      },
    });
  });

  it('uses the post-lock approval state, not the vendor locator, for cancellation audit', async () => {
    prismaMock.settlementApproval.findUnique
      .mockResolvedValueOnce({ vendorId: 'vendor-a', status: 'DRAFT' })
      .mockResolvedValueOnce(buildApproval({ id: 'approval-1', status: 'APPROVED' }));
    prismaMock.settlementApproval.update.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'CANCELLED' }));

    await cancelSettlementApproval('approval-1', 'admin-2');

    expect(prismaMock.settlementApproval.findUnique).toHaveBeenNthCalledWith(1, {
      where: { id: 'approval-1' }, select: { vendorId: true },
    });
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(4);
    expect(prismaMock.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(prismaMock.$queryRaw.mock.invocationCallOrder[1]);
    expect(prismaMock.$queryRaw.mock.invocationCallOrder[1])
      .toBeLessThan(prismaMock.settlementApproval.findUnique.mock.invocationCallOrder[1]);
    expect(prismaMock.settlementApproval.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cancelledFromStatus: 'APPROVED' }),
    }));
  });

  it('rejects cancellation of an approved settlement linked to a paid payout before any mutation', async () => {
    const approved = buildApproval({ id: 'approval-1', status: 'APPROVED' });
    const paidAt = new Date('2026-06-02T08:30:00.000Z');
    const paidPayout = {
      id: 'payout-paid-1',
      status: 'PAID',
      paidAt,
    };
    prismaMock.settlementApproval.findUnique.mockResolvedValue(approved);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: approved.vendorId }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: approved.id }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([paidPayout]);
    prismaMock.settlementRefundAdjustmentApplication.findMany.mockResolvedValueOnce([
      {
        id: 'application-1',
        settlementRefundAdjustmentId: 'adjustment-1',
        settlementApprovalId: 'approval-1',
        settlementApprovalLineId: 'line-1',
        amountMinor: 600000,
        currencyCode: 'TRY',
        status: 'ACTIVE',
        settlementRefundAdjustment: {
          id: 'adjustment-1',
          status: 'APPLIED',
          appliedAmountMinor: 600000,
          remainingAmountMinor: 0,
          appliedSettlementApprovalId: 'approval-1',
          appliedSettlementApprovalLineId: 'line-1',
        },
      },
    ]);
    prismaMock.settlementRefundAdjustment.findMany.mockResolvedValueOnce([
      {
        id: 'legacy-adjustment-1',
        originalAmountMinor: 600000,
        amountMinor: 600000,
      },
    ]);

    await expect(cancelSettlementApproval('approval-1', 'admin-2')).rejects.toThrow(
      'Settlement approval cannot be cancelled because it is linked to a paid payout batch.',
    );

    expect(approved).toMatchObject({
      status: 'APPROVED',
      cancelledBy: null,
      cancelledAt: null,
      lines: [expect.objectContaining({ id: 'line-1' })],
    });
    expect(paidPayout).toEqual({ id: 'payout-paid-1', status: 'PAID', paidAt });
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
    expect(prismaMock.settlementApprovalLine.update).not.toHaveBeenCalled();
    expect(prismaMock.settlementRefundAdjustmentApplication.findMany).not.toHaveBeenCalled();
    expect(prismaMock.settlementRefundAdjustmentApplication.update).not.toHaveBeenCalled();
    expect(prismaMock.settlementRefundAdjustment.findMany).not.toHaveBeenCalled();
    expect(prismaMock.settlementRefundAdjustment.update).not.toHaveBeenCalled();
    expect(prismaMock.settlementRefundAdjustmentEvent.create).not.toHaveBeenCalled();
  });

  it('rejects the entire settlement when only one of several linked payout batches is paid', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue({
      ...buildApproval({ id: 'approval-1', status: 'APPROVED' }),
      lines: [
        { ...buildApproval({ id: 'approval-1', status: 'APPROVED' }).lines[0], id: 'line-1' },
        { ...buildApproval({ id: 'approval-1', status: 'APPROVED' }).lines[0], id: 'line-2', financeLedgerEntryId: 'sale-2' },
      ],
    });
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 'vendor-1' }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 'approval-1' }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { id: 'payout-review-1', status: 'REVIEW', paidAt: null },
      { id: 'payout-paid-1', status: 'PAID', paidAt: new Date('2026-06-02T08:30:00.000Z') },
    ]);

    await expect(cancelSettlementApproval('approval-1', 'admin-2')).rejects.toThrow(
      'Settlement approval cannot be cancelled because it is linked to a paid payout batch.',
    );
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('fails closed when a linked non-paid payout batch has paidAt evidence', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'APPROVED' }));
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 'vendor-1' }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 'approval-1' }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { id: 'payout-review-with-paid-evidence', status: 'REVIEW', paidAt: new Date('2026-06-02T08:30:00.000Z') },
    ]);

    await expect(cancelSettlementApproval('approval-1', 'admin-2')).rejects.toThrow(
      'Settlement approval cannot be cancelled because it is linked to a paid payout batch.',
    );
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('locks linked payout authority before cancelling a settlement with no paid linkage', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'APPROVED' }));
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 'vendor-1' }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 'approval-1' }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { id: 'payout-review-1', status: 'REVIEW', paidAt: null },
    ]);
    prismaMock.settlementApproval.update.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'CANCELLED' }));

    await expect(cancelSettlementApproval('approval-1', 'admin-2')).resolves.toMatchObject({
      status: 'cancelled',
    });
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(4);
    expect(prismaMock.$queryRaw.mock.invocationCallOrder[2])
      .toBeLessThan(prismaMock.settlementApproval.update.mock.invocationCallOrder[0]);
  });

  it('cancels active refund adjustment applications and restores only the applied amount', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'APPROVED' }));
    prismaMock.settlementApproval.update.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'CANCELLED' }));
    prismaMock.settlementRefundAdjustmentApplication.findMany.mockResolvedValueOnce([
      {
        id: 'application-1',
        settlementRefundAdjustmentId: 'adjustment-1',
        settlementApprovalId: 'approval-1',
        settlementApprovalLineId: 'line-1',
        amountMinor: 600000,
        currencyCode: 'TRY',
        status: 'ACTIVE',
        settlementRefundAdjustment: {
          id: 'adjustment-1',
          appliedAmountMinor: 600000,
          remainingAmountMinor: 372654,
          appliedSettlementApprovalId: null,
          appliedSettlementApprovalLineId: null,
        },
      },
    ]);

    await cancelSettlementApproval('approval-1', 'admin-2');

    expect(prismaMock.settlementRefundAdjustmentApplication.update).toHaveBeenCalledWith({
      where: { id: 'application-1' },
      data: { status: 'CANCELLED' },
    });
    expect(prismaMock.settlementRefundAdjustment.update).toHaveBeenCalledWith({
      where: { id: 'adjustment-1' },
      data: expect.objectContaining({
        appliedAmountMinor: { decrement: 600000 },
        remainingAmountMinor: { increment: 600000 },
        status: 'PENDING',
      }),
    });
    expect(prismaMock.settlementRefundAdjustmentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        settlementRefundAdjustmentId: 'adjustment-1',
        eventType: 'APPLICATION_CANCELLED',
        metadataJson: expect.objectContaining({
          settlementApprovalId: 'approval-1',
          settlementApprovalLineId: 'line-1',
          settlementRefundAdjustmentApplicationId: 'application-1',
          cancelledAmountMinor: 600000,
          remainingAmountMinorAfter: 972654,
        }),
      }),
    });
  });

  it.each([
    ['DRAFT', 'PENDING'],
    ['APPROVED', 'PENDING'],
    ['APPROVED', 'CREATED'],
    ['APPROVED', 'FAILED'],
    ['APPROVED', 'UNKNOWN'],
  ] as const)(
    'blocks cancellation for %s settlement approvals with active %s commission invoice records',
    async (approvalStatus, invoiceStatus) => {
      prismaMock.settlementApproval.findUnique.mockResolvedValue(
        buildApproval({
          id: 'approval-1',
          status: approvalStatus,
          commissionInvoices: [{ id: 'commission-invoice-1', status: invoiceStatus }],
        }),
      );

      await expect(cancelSettlementApproval('approval-1', 'admin-2')).rejects.toThrow(
        'Settlement approval cannot be cancelled because an active commission invoice record exists.',
      );
      expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
    },
  );

  it('allows cancellation when only cancelled commission invoice records exist', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'APPROVED' }));
    prismaMock.settlementApproval.update.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'CANCELLED' }));

    const cancelled = await cancelSettlementApproval('approval-1', 'admin-2');

    expect(prismaMock.settlementApproval.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          commissionInvoices: {
            where: {
              status: {
                not: 'CANCELLED',
              },
            },
            select: {
              id: true,
            },
          },
        }),
      }),
    );
    expect(cancelled.status).toBe('cancelled');
    expect(prismaMock.settlementApproval.update).toHaveBeenCalled();
    expect(prismaMock.settlementRefundAdjustment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        appliedSettlementApprovalId: 'approval-1',
        status: 'APPLIED',
      },
    }));
  });

  it('excludes rows already linked to active approvals from new preview', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-active', entryType: 'sale', amount: 1000, activeApproval: true }),
      buildLedgerRow({ id: 'sale-free', entryType: 'sale', amount: 500 }),
    ]);

    const preview = await previewApproval('vendor-a');

    expect(preview.summary).toMatchObject({
      eligibleRowCount: 1,
      excludedActiveApprovalRowCount: 1,
      grossSalesMinor: 50000,
    });
    expect(preview.lines).toEqual([
      expect.objectContaining({
        financeLedgerEntryId: 'sale-free',
      }),
    ]);
  });

  it('does not let refund-aware sale status bypass missing delivery evidence', async () => {
    const row = buildLedgerRow({
      id: 'sale-with-refund',
      entryType: 'sale',
      amount: 120,
      fulfilled: false,
      settlementStatus: 'ACCRUING',
      refundRecords: [{ id: 'refund-1', sourceShopifyRefundId: 'rf-1', amount: 120 }],
    });

    const line = __settlementApprovalTesting.buildLine(row);

    expect(line.sourceSnapshotJson).toEqual(
      expect.objectContaining({
        storedSettlementStatus: 'ACCRUING',
        derivedSettlementStatus: 'accruing',
        payoutStatus: 'PENDING',
        eligibilityDecision: 'excluded',
        eligibilityReason: 'Missing delivery date for settlement eligibility',
        refundDetected: true,
        refundCount: 1,
        fulfillmentEvidencePresent: false,
        shippingEvidencePresent: false,
      }),
    );
  });

  it('explains excluded active approval and hold rows without changing eligibility math', async () => {
    const activeApprovalExplanation = __settlementApprovalTesting.buildSettlementEligibilityExplanation(
      buildLedgerRow({ id: 'sale-active', entryType: 'sale', amount: 1000, activeApproval: true }),
    );
    const holdExplanation = __settlementApprovalTesting.buildSettlementEligibilityExplanation(
      buildLedgerRow({ id: 'sale-hold', entryType: 'sale', amount: 1000, payoutStatus: 'HOLD' }),
    );
    const approvedReturnExplanation = __settlementApprovalTesting.buildSettlementEligibilityExplanation(
      buildLedgerRow({
        id: 'sale-approved-return',
        entryType: 'sale',
        amount: 1000,
        returnRecords: [{
          id: 'return-approved',
          status: 'approved',
          returnLifecycleStatus: null,
        }],
      }),
    );

    expect(activeApprovalExplanation).toMatchObject({
      eligibilityDecision: 'excluded',
      eligibilityReason: 'Excluded because row already belongs to active settlement approval.',
    });
    expect(holdExplanation).toMatchObject({
      derivedSettlementStatus: 'held',
      eligibilityDecision: 'excluded',
      eligibilityReason: 'Excluded because payout status is HOLD.',
    });
    expect(approvedReturnExplanation).toMatchObject({
      derivedSettlementStatus: 'held',
      eligibilityDecision: 'excluded',
      eligibilityReason: 'Open approved return pending refund outcome',
    });
  });

  it('returns audit lines from stored source snapshot explanations', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue({
      ...buildApproval({ id: 'approval-1', status: 'DRAFT' }),
      lines: [
        {
          id: 'line-1',
          settlementApprovalId: 'approval-1',
          financeLedgerEntryId: 'sale-1',
          lineType: 'SALE',
          amountMinor: 100000,
          commissionMinor: 10000,
          commissionVatMinor: 2000,
          payableImpactMinor: 88000,
          sourceSnapshotJson: {
            storedSettlementStatus: 'ACCRUING',
            derivedSettlementStatus: 'partially_refunded',
            payoutStatus: 'PENDING',
            eligibilityDecision: 'included',
            eligibilityReason: 'Derived partially refunded because refund records exist.',
            refundDetected: true,
            refundCount: 1,
            fulfillmentEvidencePresent: false,
            shippingEvidencePresent: false,
          },
        },
      ],
    });

    const audit = await getSettlementApprovalAudit('approval-1');

    expect(audit).toEqual({
      approvalId: 'approval-1',
      status: 'draft',
      totals: {
        grossSalesMinor: 100000,
        refundTotalMinor: 10000,
        commissionMinor: 10000,
        commissionVatMinor: 2000,
        netPayableMinor: 78000,
        correctionCreditMinor: 0,
        correctionDeductionMinor: 0,
        currency: 'TRY',
      },
      lines: [
        {
          financeLedgerEntryId: 'sale-1',
          storedSettlementStatus: 'ACCRUING',
          derivedSettlementStatus: 'partially_refunded',
          payoutStatus: 'PENDING',
          eligibilityDecision: 'included',
          eligibilityReason: 'Derived partially refunded because refund records exist.',
        },
      ],
    });
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
  });
});
