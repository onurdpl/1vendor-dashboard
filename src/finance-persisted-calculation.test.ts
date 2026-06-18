import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  payoutBatch: {
    findFirst: vi.fn(),
  },
  financeLedgerEntry: {
    findMany: vi.fn(),
  },
  vendorFinancialProfile: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  vendorProfileAuditLog: {
    createMany: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { getVendorFinanceDashboard, getVendorFinanceSummary, upsertVendorFinancialProfile } = await import(
  '../backend/src/modules/finance/finance.service.js'
);

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

type LedgerFixture = {
  id: string;
  entryType: string;
  amount: number;
  payoutStatus: string;
  description: string;
  createdAt: Date;
  commissionPercentSnapshot: number | null;
  commissionVatPercentSnapshot: number | null;
  deductShippingEnabledSnapshot: boolean | null;
  shippingModeSnapshot: string | null;
  fixedShippingFeeSnapshot: number | null;
  shippingCostSnapshot?: number | null;
  shippingVatAmountSnapshot?: number | null;
  shippingCostSourceSnapshot?: string | null;
  shippingCostProviderSnapshot?: string | null;
  settlementDelayDaysSnapshot: number;
  settlementStatus: string;
  settlementEligibleAt: Date | null;
  accruedAt: Date | null;
  payableAt: Date | null;
  settledAt: Date | null;
  settlementHoldReason: string | null;
  vendorAllocation: {
    id: string;
    allocationStatus: string;
    fulfillmentStatus: string;
    shippingStatus: string;
    fulfillment: { fulfilledAt: Date | null; shipmentUpdatedAt: Date | null };
    sourceShopifyOrderId: string;
    sourceShopifyOrderNumber: string;
    returnRecords: Array<{ id: string }>;
    refundRecords: Array<{ id: string; sourceShopifyRefundId: string; amount?: number }>;
  } | null;
};

function buildSaleFixture(input: {
  id: string;
  amount: number;
  orderId: string;
  orderNumber: string;
  commissionPercentSnapshot: number;
  commissionVatPercentSnapshot: number;
  createdAt: string;
  fulfilled?: boolean;
  deliveredAt?: string | null;
  settlementDelayDaysSnapshot?: number;
}): LedgerFixture {
  const createdAt = new Date(input.createdAt);
  const fulfilled = input.fulfilled ?? true;
  const deliveredAt =
    input.deliveredAt === undefined
      ? fulfilled
        ? new Date('2026-05-10T10:00:00.000Z')
        : null
      : input.deliveredAt
        ? new Date(input.deliveredAt)
        : null;
  const settlementDelayDaysSnapshot = input.settlementDelayDaysSnapshot ?? 21;
  const eligibleAt = fulfilled && deliveredAt ? addDays(deliveredAt, settlementDelayDaysSnapshot) : null;
  return {
    id: input.id,
    entryType: 'sale',
    amount: input.amount,
    payoutStatus: 'PENDING',
    description: `Shopify order sale recorded ${input.orderNumber}`,
    createdAt,
    commissionPercentSnapshot: input.commissionPercentSnapshot,
    commissionVatPercentSnapshot: input.commissionVatPercentSnapshot,
    deductShippingEnabledSnapshot: true,
    shippingModeSnapshot: 'EXTERNAL_PROVIDER',
    fixedShippingFeeSnapshot: 88,
    shippingCostSnapshot: null,
    shippingVatAmountSnapshot: null,
    shippingCostSourceSnapshot: null,
    shippingCostProviderSnapshot: null,
    settlementDelayDaysSnapshot,
    settlementStatus: fulfilled ? 'PAYABLE' : 'ACCRUING',
    settlementEligibleAt: eligibleAt,
    accruedAt: createdAt,
    payableAt: eligibleAt,
    settledAt: null,
    settlementHoldReason: null,
    vendorAllocation: {
      id: `alloc-${input.orderId}`,
      allocationStatus: 'ACTIVE',
      fulfillmentStatus: fulfilled ? 'Fulfilled' : 'Pending',
      shippingStatus: fulfilled ? 'Delivered' : 'Awaiting Shipment',
      fulfillment: {
        fulfilledAt: fulfilled ? createdAt : null,
        shipmentUpdatedAt: deliveredAt,
      },
      sourceShopifyOrderId: input.orderId,
      sourceShopifyOrderNumber: input.orderNumber,
      returnRecords: [],
      refundRecords: [],
    },
  };
}

describe('persisted vendor finance calculations', () => {
  let activeProfile: {
    id: string;
    vendorId: string;
    commissionPercent: number;
    commissionVatPercent: number;
    deductShippingEnabled: boolean;
    shippingMode: string;
    fixedShippingFee: number | null;
    settlementDelayDays: number;
    active: boolean;
  } | null;
  let ledgerRows: LedgerFixture[];

  beforeEach(() => {
    activeProfile = null;
    ledgerRows = [
      buildSaleFixture({
        id: 'fin-sporjinal-sale-7616676626769',
        amount: 3399,
        orderId: '7616676626769',
        orderNumber: '#1023',
        commissionPercentSnapshot: 10,
        commissionVatPercentSnapshot: 0,
        createdAt: '2026-05-13T10:30:00.000Z',
      }),
      {
        id: 'fin-sporjinal-refund-1074189959505',
        entryType: 'refund',
        amount: 100,
        payoutStatus: 'RECORDED',
        description: 'Shopify refund recorded',
        createdAt: new Date('2026-05-13T11:00:00.000Z'),
        commissionPercentSnapshot: null,
        commissionVatPercentSnapshot: null,
        deductShippingEnabledSnapshot: null,
        shippingModeSnapshot: null,
        fixedShippingFeeSnapshot: null,
        shippingCostSnapshot: null,
        shippingVatAmountSnapshot: null,
        shippingCostSourceSnapshot: null,
        shippingCostProviderSnapshot: null,
        settlementDelayDaysSnapshot: 21,
        settlementStatus: 'PARTIALLY_REFUNDED',
        settlementEligibleAt: null,
        accruedAt: null,
        payableAt: null,
        settledAt: null,
        settlementHoldReason: null,
        vendorAllocation: {
          id: 'alloc-refund',
          allocationStatus: 'ACTIVE',
          fulfillmentStatus: 'Fulfilled',
          shippingStatus: 'Delivered',
          fulfillment: {
            fulfilledAt: new Date('2026-05-13T10:00:00.000Z'),
            shipmentUpdatedAt: new Date('2026-05-10T10:00:00.000Z'),
          },
          sourceShopifyOrderId: 'refund-order',
          sourceShopifyOrderNumber: '#1018',
          returnRecords: [],
          refundRecords: [],
        },
      },
    ];
    prismaMock.financeLedgerEntry.findMany.mockReset();
    prismaMock.payoutBatch.findFirst.mockReset();
    prismaMock.vendorFinancialProfile.findFirst.mockReset();
    prismaMock.vendorFinancialProfile.upsert.mockReset();
    prismaMock.vendorProfileAuditLog.createMany.mockReset();
    prismaMock.vendorProfileAuditLog.createMany.mockResolvedValue({ count: 0 });

    prismaMock.payoutBatch.findFirst.mockResolvedValue(null);
    prismaMock.vendorFinancialProfile.findFirst.mockImplementation(async () => activeProfile);
    prismaMock.vendorFinancialProfile.upsert.mockImplementation(async ({ create, update }) => {
      const next = activeProfile ? update : create;
      activeProfile = {
        id: activeProfile?.id ?? 'profile-sporjinal',
        vendorId: next.vendorId ?? 'sporjinal',
        commissionPercent: Number(next.commissionPercent),
        commissionVatPercent: Number(next.commissionVatPercent),
        deductShippingEnabled: Boolean(next.deductShippingEnabled),
        shippingMode: String(next.shippingMode),
        fixedShippingFee: next.fixedShippingFee === null ? null : Number(next.fixedShippingFee),
        settlementDelayDays:
          next.settlementDelayDays === undefined ? activeProfile?.settlementDelayDays ?? 21 : Number(next.settlementDelayDays),
        active: Boolean(next.active),
      };
      return activeProfile;
    });
    prismaMock.financeLedgerEntry.findMany.mockImplementation(async (args: { select?: unknown }) => {
      if (args.select) {
        return ledgerRows.map((row) => ({
          id: row.id,
          entryType: row.entryType,
          amount: row.amount,
          payoutStatus: row.payoutStatus,
          description: row.description,
          commissionPercentSnapshot: row.commissionPercentSnapshot,
          commissionVatPercentSnapshot: row.commissionVatPercentSnapshot,
          deductShippingEnabledSnapshot: row.deductShippingEnabledSnapshot,
          shippingModeSnapshot: row.shippingModeSnapshot,
          fixedShippingFeeSnapshot: row.fixedShippingFeeSnapshot,
          shippingCostSnapshot: row.shippingCostSnapshot,
          shippingVatAmountSnapshot: row.shippingVatAmountSnapshot,
          shippingCostSourceSnapshot: row.shippingCostSourceSnapshot,
          shippingCostProviderSnapshot: row.shippingCostProviderSnapshot,
          settlementDelayDaysSnapshot: row.settlementDelayDaysSnapshot,
          settlementStatus: row.settlementStatus,
          settlementEligibleAt: row.settlementEligibleAt,
          accruedAt: row.accruedAt,
          payableAt: row.payableAt,
          settledAt: row.settledAt,
          settlementHoldReason: row.settlementHoldReason,
          createdAt: row.createdAt,
          vendorAllocation: row.vendorAllocation
            ? {
                sourceShopifyOrderId: row.vendorAllocation.sourceShopifyOrderId,
                sourceShopifyOrderNumber: row.vendorAllocation.sourceShopifyOrderNumber,
                id: row.vendorAllocation.id,
                allocationStatus: row.vendorAllocation.allocationStatus,
                fulfillmentStatus: row.vendorAllocation.fulfillmentStatus,
                shippingStatus: row.vendorAllocation.shippingStatus,
                fulfillment: row.vendorAllocation.fulfillment,
                returnRecords: row.vendorAllocation.returnRecords,
                refundRecords: row.vendorAllocation.refundRecords,
              }
            : null,
          payoutBatchLines: row.payoutBatchLines ?? [],
          invoiceExecutions: row.invoiceExecutions ?? [],
        }));
      }

      return ledgerRows;
    });
  });

  it('keeps existing sale rows on their profile snapshot after admin profile updates', async () => {
    await upsertVendorFinancialProfile('sporjinal', {
      commissionPercent: 15,
      commissionVatPercent: 18,
      deductShippingEnabled: true,
      shippingMode: 'external_provider',
      fixedShippingFee: 88,
    });

    expect(prismaMock.vendorProfileAuditLog.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          vendorId: 'sporjinal',
          section: 'finance_policy',
          fieldName: 'commissionPercent',
          snapshotImpact: 'FUTURE_LEDGER_ROWS_ONLY',
        }),
        expect.objectContaining({
          vendorId: 'sporjinal',
          section: 'finance_policy',
          fieldName: 'fixedShippingFee',
          snapshotImpact: 'FUTURE_LEDGER_ROWS_ONLY',
        }),
      ]),
    });

    const dashboard = await getVendorFinanceDashboard('sporjinal');
    const historicalSale = dashboard.records.find((record) => record.id === 'fin-sporjinal-sale-7616676626769');

    expect(dashboard.profile).toMatchObject({
      commissionPercent: '15.00',
      commissionVatPercent: '18.00',
      source: 'configured',
    });
    expect(historicalSale?.payoutCalculation).toMatchObject({
      grossAmount: '3399.00',
      commission: '339.90',
      commissionVat: '0.00',
      shippingDeduction: '0.00',
      estimatedPayout: '3059.10',
      profileSource: 'snapshot',
      commissionPercent: '10.00',
      commissionVatPercent: '0.00',
    });
    expect(historicalSale?.settlement).toMatchObject({
      status: 'payable',
      payoutReady: true,
    });
  });

  it('uses the new active profile only for new sale ledger snapshots and aggregates mixed rates', async () => {
    await upsertVendorFinancialProfile('sporjinal', {
      commissionPercent: 15,
      commissionVatPercent: 18,
      deductShippingEnabled: true,
      shippingMode: 'external_provider',
      fixedShippingFee: 88,
    });
    ledgerRows.unshift(
      buildSaleFixture({
        id: 'fin-sporjinal-sale-new',
        amount: 1000,
        orderId: 'new-order',
        orderNumber: '#1024',
        commissionPercentSnapshot: activeProfile?.commissionPercent ?? 15,
        commissionVatPercentSnapshot: activeProfile?.commissionVatPercent ?? 18,
        createdAt: '2026-05-13T12:00:00.000Z',
      }),
      buildSaleFixture({
        id: 'fin-sporjinal-sale-accruing',
        amount: 500,
        orderId: 'unfulfilled-order',
        orderNumber: '#1025',
        commissionPercentSnapshot: 10,
        commissionVatPercentSnapshot: 0,
        createdAt: '2026-05-13T12:30:00.000Z',
        fulfilled: false,
      }),
    );

    const dashboard = await getVendorFinanceDashboard('sporjinal');
    const historicalSale = dashboard.records.find((record) => record.id === 'fin-sporjinal-sale-7616676626769');
    const newSale = dashboard.records.find((record) => record.id === 'fin-sporjinal-sale-new');
    const accruingSale = dashboard.records.find((record) => record.id === 'fin-sporjinal-sale-accruing');
    const refund = dashboard.records.find((record) => record.id === 'fin-sporjinal-refund-1074189959505');

    expect(historicalSale?.payoutCalculation).toMatchObject({
      commission: '339.90',
      commissionVat: '0.00',
      commissionPercent: '10.00',
      commissionVatPercent: '0.00',
    });
    expect(newSale?.payoutCalculation).toMatchObject({
      grossAmount: '1000.00',
      commission: '150.00',
      commissionVat: '27.00',
      estimatedPayout: '823.00',
      profileSource: 'snapshot',
      commissionPercent: '15.00',
      commissionVatPercent: '18.00',
    });
    expect(accruingSale?.payoutCalculation).toMatchObject({
      grossAmount: '500.00',
      commission: '50.00',
      estimatedPayout: '450.00',
    });
    expect(accruingSale?.settlement).toMatchObject({
      status: 'accruing',
      payoutReady: false,
    });
    expect(refund?.payoutCalculation).toMatchObject({
      grossAmount: '0.00',
      refundImpact: '100.00',
      estimatedPayout: '-100.00',
    });
    expect(refund?.settlement).toMatchObject({
      status: 'partially_refunded',
    });
    expect(dashboard.summary).toMatchObject({
      grossSales: '4899.00',
      refunds: '100.00',
      platformFee: '539.90',
      commissionVat: '27.00',
      payoutEstimate: '4232.10',
      payableBalance: '3782.10',
      accruedBalance: '450.00',
      refundedBalance: '100.00',
      pendingSettlement: '450.00',
    });
  });

  it('builds dashboard finance summary without fetching records, profile, or payout batch', async () => {
    await upsertVendorFinancialProfile('sporjinal', {
      commissionPercent: 15,
      commissionVatPercent: 18,
      deductShippingEnabled: true,
      shippingMode: 'external_provider',
      fixedShippingFee: 88,
    });
    ledgerRows.unshift(
      buildSaleFixture({
        id: 'fin-sporjinal-sale-new',
        amount: 1000,
        orderId: 'new-order',
        orderNumber: '#1024',
        commissionPercentSnapshot: activeProfile?.commissionPercent ?? 15,
        commissionVatPercentSnapshot: activeProfile?.commissionVatPercent ?? 18,
        createdAt: '2026-05-13T12:00:00.000Z',
      }),
      buildSaleFixture({
        id: 'fin-sporjinal-sale-accruing',
        amount: 500,
        orderId: 'unfulfilled-order',
        orderNumber: '#1025',
        commissionPercentSnapshot: 10,
        commissionVatPercentSnapshot: 0,
        createdAt: '2026-05-13T12:30:00.000Z',
        fulfilled: false,
      }),
    );
    prismaMock.financeLedgerEntry.findMany.mockClear();
    prismaMock.vendorFinancialProfile.findFirst.mockClear();
    prismaMock.payoutBatch.findFirst.mockClear();

    const summary = await getVendorFinanceSummary('sporjinal');

    expect(summary).toEqual({
      summary: {
        grossSales: '4899.00',
        refunds: '100.00',
        netRevenue: '4799.00',
        payoutEstimate: '4232.10',
      },
    });
    expect(prismaMock.financeLedgerEntry.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.vendorFinancialProfile.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.payoutBatch.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          description: true,
          payoutBatchLines: expect.anything(),
          invoiceExecutions: expect.anything(),
        }),
      }),
    );
  });
});
