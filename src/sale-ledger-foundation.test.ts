import { describe, expect, it } from 'vitest';
import { __saleLedgerTesting } from '../backend/src/modules/finance/sale-ledger.service';
import { upsertSaleLedgerForAllocation } from '../backend/src/modules/finance/sale-ledger.service';

describe('sale ledger foundation', () => {
  it('builds deterministic vendor/order/allocation sale ledger ids for idempotent upserts', () => {
    expect(__saleLedgerTesting.buildSaleLedgerEntryId('yalispor', '12345', 'alloc-a')).toBe('fin-yalispor-sale-12345-alloc-a');
    expect(__saleLedgerTesting.buildSaleLedgerEntryId('sporjinal', '12345', 'alloc-b')).toBe('fin-sporjinal-sale-12345-alloc-b');
  });

  it('snapshots the active vendor finance profile only when creating a sale ledger row', async () => {
    const financeEventCreateManyCalls: unknown[] = [];
    const tx = {
      vendorAllocation: {
        findUnique: async () => ({
          id: 'alloc-1',
          assignedVendorId: 'sporjinal',
          createdAt: new Date('2026-05-13T10:00:00.000Z'),
          updatedAt: new Date('2026-05-13T10:30:00.000Z'),
          fulfillmentStatus: 'Fulfilled',
          shippingStatus: 'Delivered',
          order: {
            id: 'shopify-order-db-1023',
            sourceShopifyOrderId: '7616676626769',
            sourceShopifyOrderNumber: '#1023',
            currency: 'TRY',
          },
          lineItems: [
            {
              lineAmount: 3399,
            },
          ],
          fulfillment: {
            fulfilledAt: new Date('2026-05-13T10:20:00.000Z'),
            shipmentUpdatedAt: new Date('2026-05-13T10:20:00.000Z'),
          },
        }),
      },
      vendorFinancialProfile: {
        findFirst: async () => ({
          id: 'profile-sporjinal',
          commissionPercent: 15,
          commissionVatPercent: 18,
          deductShippingEnabled: true,
          shippingMode: 'EXTERNAL_PROVIDER',
          fixedShippingFee: 88,
          settlementDelayDays: 21,
        }),
      },
      shipmentShippingCost: {
        findFirst: async () => ({
          id: 'shipcost-sporjinal-alloc-1-manual',
          shippingCost: 72,
          shippingVatAmount: 12,
          sourceType: 'MANUAL',
          providerName: 'Manual provider',
        }),
      },
      financeLedgerEntry: {
        findUnique: async () => null,
        upsert: async (args: unknown) => args,
      },
      financeEvent: {
        createMany: async (args: unknown) => {
          financeEventCreateManyCalls.push(args);
          return { count: 4 };
        },
      },
    };

    const result = await upsertSaleLedgerForAllocation(tx as never, 'alloc-1') as {
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    };

    expect(result.create).toMatchObject({
      id: 'fin-sporjinal-sale-7616676626769-alloc-1',
      commissionPercentSnapshot: 15,
      commissionVatPercentSnapshot: 18,
      deductShippingEnabledSnapshot: true,
      shippingModeSnapshot: 'EXTERNAL_PROVIDER',
      fixedShippingFeeSnapshot: 88,
      shippingCostSnapshot: 72,
      shippingVatAmountSnapshot: 12,
      shippingCostSourceSnapshot: 'MANUAL',
      shippingCostProviderSnapshot: 'Manual provider',
      shippingCostIdSnapshot: 'shipcost-sporjinal-alloc-1-manual',
      financialProfileIdSnapshot: 'profile-sporjinal',
      settlementDelayDaysSnapshot: 21,
      settlementStatus: 'PAYABLE',
      accruedAt: new Date('2026-05-13T10:00:00.000Z'),
      payableAt: new Date('2026-06-03T10:20:00.000Z'),
      settlementEligibleAt: new Date('2026-06-03T10:20:00.000Z'),
    });
    expect(result.update).not.toHaveProperty('commissionPercentSnapshot');
    expect(result.update).not.toHaveProperty('commissionVatPercentSnapshot');
    expect(result.update).not.toHaveProperty('settlementDelayDaysSnapshot');
    expect(result.update).not.toHaveProperty('shippingCostSnapshot');
    expect(financeEventCreateManyCalls).toHaveLength(1);
    expect(financeEventCreateManyCalls[0]).toMatchObject({
      skipDuplicates: true,
      data: [
        expect.objectContaining({
          eventType: 'SALE_RECORDED',
          amountMinor: 339900,
          idempotencyKey: 'fin-sporjinal-sale-7616676626769-alloc-1:SALE_RECORDED',
        }),
        expect.objectContaining({
          eventType: 'COMMISSION_RESERVED',
          amountMinor: 50985,
          idempotencyKey: 'fin-sporjinal-sale-7616676626769-alloc-1:COMMISSION_RESERVED',
        }),
        expect.objectContaining({
          eventType: 'COMMISSION_VAT_RESERVED',
          amountMinor: 9177,
          idempotencyKey: 'fin-sporjinal-sale-7616676626769-alloc-1:COMMISSION_VAT_RESERVED',
        }),
        expect.objectContaining({
          eventType: 'VENDOR_PAYABLE_RESERVED',
          amountMinor: 279738,
          idempotencyKey: 'fin-sporjinal-sale-7616676626769-alloc-1:VENDOR_PAYABLE_RESERVED',
        }),
      ],
    });
  });

  it('does not create sale finance events when the sale ledger row already exists', async () => {
    let createManyCalled = false;
    const tx = {
      vendorAllocation: {
        findUnique: async () => ({
          id: 'alloc-1',
          assignedVendorId: 'sporjinal',
          createdAt: new Date('2026-05-13T10:00:00.000Z'),
          updatedAt: new Date('2026-05-13T10:30:00.000Z'),
          fulfillmentStatus: 'Fulfilled',
          shippingStatus: 'Delivered',
          order: {
            id: 'shopify-order-db-1023',
            sourceShopifyOrderId: '7616676626769',
            sourceShopifyOrderNumber: '#1023',
            currency: 'TRY',
          },
          lineItems: [
            {
              lineAmount: 3399,
            },
          ],
          fulfillment: {
            fulfilledAt: new Date('2026-05-13T10:20:00.000Z'),
            shipmentUpdatedAt: new Date('2026-05-13T10:20:00.000Z'),
          },
        }),
      },
      vendorFinancialProfile: {
        findFirst: async () => null,
      },
      shipmentShippingCost: {
        findFirst: async () => null,
      },
      financeLedgerEntry: {
        findUnique: async () => ({ id: 'fin-sporjinal-sale-7616676626769-alloc-1' }),
        upsert: async (args: unknown) => args,
      },
      financeEvent: {
        createMany: async () => {
          createManyCalled = true;
          return { count: 0 };
        },
      },
    };

    await upsertSaleLedgerForAllocation(tx as never, 'alloc-1');

    expect(createManyCalled).toBe(false);
  });

  it('creates distinct sale ledgers for two allocations from the same vendor and Shopify order', async () => {
    const ledgerIdsLookedUp: string[] = [];
    const upsertCreates: Array<Record<string, unknown>> = [];
    const allocations = new Map([
      ['alloc-1', {
        id: 'alloc-1',
        assignedVendorId: 'sporjinal',
        createdAt: new Date('2026-05-13T10:00:00.000Z'),
        updatedAt: new Date('2026-05-13T10:30:00.000Z'),
        fulfillmentStatus: 'Fulfilled',
        shippingStatus: 'Delivered',
        order: {
          id: 'shopify-order-db-1023',
          sourceShopifyOrderId: '7616676626769',
          sourceShopifyOrderNumber: '#1023',
          currency: 'TRY',
        },
        lineItems: [{ lineAmount: 100 }],
        fulfillment: {
          fulfilledAt: new Date('2026-05-13T10:20:00.000Z'),
          shipmentUpdatedAt: new Date('2026-05-13T10:20:00.000Z'),
        },
      }],
      ['alloc-2', {
        id: 'alloc-2',
        assignedVendorId: 'sporjinal',
        createdAt: new Date('2026-05-13T10:05:00.000Z'),
        updatedAt: new Date('2026-05-13T10:35:00.000Z'),
        fulfillmentStatus: 'Fulfilled',
        shippingStatus: 'Delivered',
        order: {
          id: 'shopify-order-db-1023',
          sourceShopifyOrderId: '7616676626769',
          sourceShopifyOrderNumber: '#1023',
          currency: 'TRY',
        },
        lineItems: [{ lineAmount: 200 }],
        fulfillment: {
          fulfilledAt: new Date('2026-05-13T10:25:00.000Z'),
          shipmentUpdatedAt: new Date('2026-05-13T10:25:00.000Z'),
        },
      }],
    ]);
    const tx = {
      vendorAllocation: {
        findUnique: async (args: { where: { id: string } }) => allocations.get(args.where.id),
      },
      vendorFinancialProfile: {
        findFirst: async () => null,
      },
      shipmentShippingCost: {
        findFirst: async () => null,
      },
      financeLedgerEntry: {
        findUnique: async (args: { where: { id: string } }) => {
          ledgerIdsLookedUp.push(args.where.id);
          return null;
        },
        upsert: async (args: { create: Record<string, unknown> }) => {
          upsertCreates.push(args.create);
          return args;
        },
      },
      financeEvent: {
        createMany: async () => ({ count: 4 }),
      },
    };

    await upsertSaleLedgerForAllocation(tx as never, 'alloc-1');
    await upsertSaleLedgerForAllocation(tx as never, 'alloc-2');

    expect(ledgerIdsLookedUp).toEqual([
      'fin-sporjinal-sale-7616676626769-alloc-1',
      'fin-sporjinal-sale-7616676626769-alloc-2',
    ]);
    expect(upsertCreates.map((create) => create.id)).toEqual([
      'fin-sporjinal-sale-7616676626769-alloc-1',
      'fin-sporjinal-sale-7616676626769-alloc-2',
    ]);
    expect(upsertCreates.map((create) => create.vendorAllocationId)).toEqual(['alloc-1', 'alloc-2']);
    expect(upsertCreates.map((create) => create.amount)).toEqual(['100.00', '200.00']);
  });

  it('blocks order replay from repairing a voided sale ledger row', async () => {
    let upsertCalled = false;
    const tx = {
      vendorAllocation: {
        findUnique: async () => ({
          id: 'alloc-1',
          assignedVendorId: 'sporjinal',
          createdAt: new Date('2026-05-13T10:00:00.000Z'),
          updatedAt: new Date('2026-05-13T10:30:00.000Z'),
          fulfillmentStatus: 'Fulfilled',
          shippingStatus: 'Delivered',
          order: {
            id: 'shopify-order-db-1023',
            sourceShopifyOrderId: '7616676626769',
            sourceShopifyOrderNumber: '#1023',
            currency: 'TRY',
          },
          lineItems: [
            {
              lineAmount: 3399,
            },
          ],
          fulfillment: null,
        }),
      },
      vendorFinancialProfile: {
        findFirst: async () => null,
      },
      shipmentShippingCost: {
        findFirst: async () => null,
      },
      financeLedgerEntry: {
        findUnique: async () => ({
          id: 'fin-sporjinal-sale-7616676626769-alloc-1',
          voidedAt: new Date('2026-06-21T10:00:00.000Z'),
          voidReason: 'superseded_by_reassignment',
          supersededByLedgerId: 'fin-yalispor-sale-7616676626769-alloc-1',
        }),
        upsert: async () => {
          upsertCalled = true;
          return null;
        },
      },
      financeEvent: {
        createMany: async () => ({ count: 0 }),
      },
    };

    await expect(upsertSaleLedgerForAllocation(tx as never, 'alloc-1')).rejects.toThrow(
      'Sale ledger fin-sporjinal-sale-7616676626769-alloc-1 has been voided or superseded and cannot be repaired by order replay.',
    );
    expect(upsertCalled).toBe(false);
  });
});
