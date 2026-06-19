import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
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
  },
  vendorBillingProfile: {
    findUnique: vi.fn(),
  },
  payoutBatch: {
    create: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
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
  sourceShopifyOrderId?: string;
  sourceShopifyOrderNumber?: string;
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
    createdAt,
    vendorAllocation: {
      id: `alloc-${input.id}`,
      allocationStatus: 'ACTIVE',
      fulfillmentStatus: fulfilled ? 'Fulfilled' : 'Pending',
      shippingStatus: fulfilled ? 'Delivered' : 'Awaiting Shipment',
      sourceShopifyOrderId: input.sourceShopifyOrderId ?? `order-${input.id}`,
      sourceShopifyOrderNumber: input.sourceShopifyOrderNumber ?? '#1001',
      fulfillment: {
        fulfilledAt: fulfilled ? createdAt : null,
        shipmentUpdatedAt: deliveredAt,
      },
      refundRecords: input.refundRecords ?? [],
      returnRecords: (input.returnRecords ?? []).map((record) => ({
        ...record,
        sourceShopifyRefundId: record.sourceShopifyRefundId ?? null,
      })),
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
    prismaMock.financeLedgerEntry.findMany.mockReset();
    prismaMock.financeLedgerEntry.findUnique.mockReset();
    prismaMock.settlementApproval.create.mockReset();
    prismaMock.settlementApproval.findMany.mockReset();
    prismaMock.settlementApproval.findUnique.mockReset();
    prismaMock.settlementApproval.update.mockReset();
    prismaMock.settlementApprovalLine.count.mockReset();
    prismaMock.vendorBillingProfile.findUnique.mockReset();
    prismaMock.payoutBatch.create.mockReset();
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
      commissionMinor: 10000,
      commissionVatMinor: 2000,
      netPayableMinor: 78000,
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
        payableImpactMinor: -10000,
        storedSettlementStatus: 'PARTIALLY_REFUNDED',
        derivedSettlementStatus: 'partially_refunded',
        eligibilityReason: 'Derived partially refunded because refund records exist.',
        refundDetected: true,
      }),
    ]);
    expect(prismaMock.settlementApproval.create).not.toHaveBeenCalled();
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
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
          commissionMinor: 10000,
          commissionVatMinor: 2000,
          netPayableMinor: 78000,
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
                payableImpactMinor: -10000,
                sourceSnapshotJson: expect.objectContaining({
                  storedSettlementStatus: 'PARTIALLY_REFUNDED',
                  derivedSettlementStatus: 'partially_refunded',
                  eligibilityReason: 'Derived partially refunded because refund records exist.',
                }),
              }),
            ],
          },
        }),
        include: {
          lines: true,
        },
      }),
    );
    expect(approval).toMatchObject({
      id: 'settlement-approval-1',
      writesPerformed: true,
      status: 'draft',
      grossSalesMinor: 100000,
      commissionMinor: 10000,
      commissionVatMinor: 2000,
      netPayableMinor: 78000,
    });
    expect(prismaMock.vendorBillingProfile.findUnique).toHaveBeenCalledWith({
      where: {
        vendorId: 'vendor-a',
      },
    });
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
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

  it('approves only draft approvals without invoice or payout execution', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
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
          code: 'settlement_row_not_eligible',
          reason: 'Excluded because payout status is HOLD.',
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
        }),
      }),
    );
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

  it('captures derived partially refunded explanation when stored status differs', async () => {
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
        derivedSettlementStatus: 'partially_refunded',
        payoutStatus: 'PENDING',
        eligibilityDecision: 'included',
        eligibilityReason: 'Derived partially refunded because refund records exist.',
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
