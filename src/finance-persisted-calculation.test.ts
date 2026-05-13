import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  financeLedgerEntry: {
    findMany: vi.fn(),
  },
  vendorFinancialProfile: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { getVendorFinanceDashboard, upsertVendorFinancialProfile } = await import(
  '../backend/src/modules/finance/finance.service.js'
);

describe('persisted vendor finance calculations', () => {
  let activeProfile: {
    vendorId: string;
    commissionPercent: number;
    commissionVatPercent: number;
    deductShippingEnabled: boolean;
    shippingMode: string;
    fixedShippingFee: number | null;
    active: boolean;
  } | null;

  beforeEach(() => {
    activeProfile = null;
    prismaMock.financeLedgerEntry.findMany.mockReset();
    prismaMock.vendorFinancialProfile.findFirst.mockReset();
    prismaMock.vendorFinancialProfile.upsert.mockReset();

    prismaMock.vendorFinancialProfile.findFirst.mockImplementation(async () => activeProfile);
    prismaMock.vendorFinancialProfile.upsert.mockImplementation(async ({ create, update }) => {
      const next = activeProfile ? update : create;
      activeProfile = {
        vendorId: next.vendorId ?? 'sporjinal',
        commissionPercent: Number(next.commissionPercent),
        commissionVatPercent: Number(next.commissionVatPercent),
        deductShippingEnabled: Boolean(next.deductShippingEnabled),
        shippingMode: String(next.shippingMode),
        fixedShippingFee: next.fixedShippingFee === null ? null : Number(next.fixedShippingFee),
        active: Boolean(next.active),
      };
      return activeProfile;
    });
    prismaMock.financeLedgerEntry.findMany.mockImplementation(async (args: { select?: unknown }) => {
      const allocation = {
        id: 'alloc-sporjinal-7616676626769',
        allocationStatus: 'ACTIVE',
        fulfillmentStatus: 'Fulfilled',
        shippingStatus: 'Delivered',
        fulfillment: {
          fulfilledAt: new Date('2026-05-13T10:00:00.000Z'),
        },
      };

      if (args.select) {
        return [
          {
            entryType: 'sale',
            amount: 3399,
            payoutStatus: 'PENDING',
            vendorAllocation: allocation,
          },
        ];
      }

      return [
        {
          id: 'fin-sporjinal-sale-7616676626769',
          entryType: 'sale',
          amount: 3399,
          payoutStatus: 'PENDING',
          description: 'Shopify order sale recorded',
          createdAt: new Date('2026-05-13T10:30:00.000Z'),
          vendorAllocation: {
            ...allocation,
            sourceShopifyOrderId: '7616676626769',
            sourceShopifyOrderNumber: '#1023',
            returnRecords: [],
            refundRecords: [],
          },
        },
      ];
    });
  });

  it('recalculates finance rows from the active persisted profile after admin update', async () => {
    const before = await getVendorFinanceDashboard('sporjinal');
    expect(before.profile).toMatchObject({
      commissionPercent: '10.00',
      commissionVatPercent: '0.00',
      source: 'default',
    });
    expect(before.summary.platformFee).toBe('339.90');
    expect(before.summary.commissionVat).toBe('0.00');
    expect(before.summary.payoutEstimate).toBe('3059.10');
    expect(before.records[0]?.payoutCalculation).toMatchObject({
      grossAmount: '3399.00',
      commission: '339.90',
      commissionVat: '0.00',
      shippingDeduction: '0.00',
      estimatedPayout: '3059.10',
    });

    await upsertVendorFinancialProfile('sporjinal', {
      commissionPercent: 15,
      commissionVatPercent: 18,
      deductShippingEnabled: true,
      shippingMode: 'external_provider',
      fixedShippingFee: 88,
    });

    const after = await getVendorFinanceDashboard('sporjinal');
    expect(after.profile).toMatchObject({
      commissionPercent: '15.00',
      commissionVatPercent: '18.00',
      deductShippingEnabled: true,
      shippingMode: 'external_provider',
      fixedShippingFee: '88.00',
      source: 'configured',
    });
    expect(after.summary.platformFee).toBe('509.85');
    expect(after.summary.commissionVat).toBe('91.77');
    expect(after.summary.shippingDeductions).toBe('0.00');
    expect(after.summary.payoutEstimate).toBe('2797.38');
    expect(after.records[0]?.payoutCalculation).toMatchObject({
      grossAmount: '3399.00',
      commission: '509.85',
      commissionVat: '91.77',
      shippingDeduction: '0.00',
      estimatedPayout: '2797.38',
      shippingApplied: false,
      shippingMode: 'external_provider',
    });
  });
});
