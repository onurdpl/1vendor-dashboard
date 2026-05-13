import { describe, expect, it } from 'vitest';
import { __saleLedgerTesting } from '../backend/src/modules/finance/sale-ledger.service';
import { upsertSaleLedgerForAllocation } from '../backend/src/modules/finance/sale-ledger.service';

describe('sale ledger foundation', () => {
  it('builds deterministic vendor/order sale ledger ids for idempotent upserts', () => {
    expect(__saleLedgerTesting.buildSaleLedgerEntryId('yalispor', '12345')).toBe('fin-yalispor-sale-12345');
    expect(__saleLedgerTesting.buildSaleLedgerEntryId('sporjinal', '12345')).toBe('fin-sporjinal-sale-12345');
  });

  it('snapshots the active vendor finance profile only when creating a sale ledger row', async () => {
    const tx = {
      vendorAllocation: {
        findUnique: async () => ({
          id: 'alloc-1',
          assignedVendorId: 'sporjinal',
          order: {
            sourceShopifyOrderId: '7616676626769',
            sourceShopifyOrderNumber: '#1023',
          },
          lineItems: [
            {
              lineAmount: 3399,
            },
          ],
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
        }),
      },
      financeLedgerEntry: {
        upsert: async (args: unknown) => args,
      },
    };

    const result = await upsertSaleLedgerForAllocation(tx as never, 'alloc-1') as {
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    };

    expect(result.create).toMatchObject({
      id: 'fin-sporjinal-sale-7616676626769',
      commissionPercentSnapshot: 15,
      commissionVatPercentSnapshot: 18,
      deductShippingEnabledSnapshot: true,
      shippingModeSnapshot: 'EXTERNAL_PROVIDER',
      fixedShippingFeeSnapshot: 88,
      financialProfileIdSnapshot: 'profile-sporjinal',
    });
    expect(result.update).not.toHaveProperty('commissionPercentSnapshot');
    expect(result.update).not.toHaveProperty('commissionVatPercentSnapshot');
  });
});
