import { describe, expect, it } from 'vitest';
import { buildFinanceLedgerPreview } from '../backend/src/modules/finance/finance-ledger-preview.service';

const baseInput = {
  allocationId: 'alloc-sporjinal-1045',
  vendorId: 'sporjinal',
  orderId: 'gid://shopify/Order/1045',
  orderNumber: '#1045',
  currency: 'TRY',
  createdAt: '2026-05-20T10:00:00.000Z',
  lineItems: [
    {
      id: 'line-1045-1',
      lineAmount: 1000,
    },
  ],
  commissionBps: 1000,
};

describe('finance ledger preview', () => {
  it('simulates a normal paid order without mutating live finance state', () => {
    const { preview, balance, entries } = buildFinanceLedgerPreview({
      ...baseInput,
      shippingCost: {
        id: 'shipcost-1045',
        amount: 84,
        currency: 'TRY',
        providerName: 'Try OTO',
        source: 'confirmed',
        updatedAt: '2026-05-20T11:00:00.000Z',
      },
    });

    expect(preview.status).toBe('ready');
    expect(preview.entries.map((entry) => entry.eventType)).toEqual([
      'ORDER_CREATED',
      'PAYMENT_CAPTURED',
      'MARKETPLACE_COMMISSION_RESERVED',
      'VENDOR_PAYABLE_RESERVED',
      'SHIPPING_COST_RESERVED',
    ]);
    expect(preview.balance).toMatchObject({
      grossSales: '1000.00',
      marketplaceCommission: '100.00',
      vendorPayable: '900.00',
      shippingCostReserved: '84.00',
      netVendorPosition: '816.00',
    });
    expect(balance.netVendorPositionMinor).toBe(81_600);
    expect(Object.isFrozen(entries)).toBe(true);
  });

  it('simulates partial return refund reversal before payout', () => {
    const { preview } = buildFinanceLedgerPreview({
      ...baseInput,
      returnRecords: [
        {
          id: 'return-1045',
          status: 'approved',
          createdAt: '2026-05-20T12:00:00.000Z',
          sourceLineItemId: 'line-1045-1',
        },
      ],
      refundRecords: [
        {
          id: 'refund-record-1045',
          sourceShopifyRefundId: 'refund-1045',
          amount: 400,
          status: 'completed',
          createdAt: '2026-05-20T12:30:00.000Z',
          lineItems: [
            {
              sourceLineItemId: 'line-1045-1',
              subtotal: 400,
            },
          ],
        },
      ],
      shippingCost: null,
    });

    expect(preview.entries.map((entry) => entry.eventType)).toContain('RETURN_CREATED');
    expect(preview.entries.map((entry) => entry.eventType)).toContain('COMMISSION_REVERSED');
    expect(preview.entries.map((entry) => entry.eventType)).toContain('VENDOR_PAYABLE_REVERSED');
    expect(preview.balance.marketplaceCommission).toBe('60.00');
    expect(preview.balance.vendorPayable).toBe('540.00');
    expect(preview.balance.netVendorPosition).toBe('540.00');
  });

  it('marks commission and payable unknown when no profile rate is available', () => {
    const { preview } = buildFinanceLedgerPreview({
      ...baseInput,
      commissionBps: null,
    });

    expect(preview.status).toBe('partial');
    expect(preview.unknowns).toContain('commission_rate');
    expect(preview.unknowns).toContain('vendor_payable');
    expect(preview.entries.map((entry) => entry.eventType)).toEqual(['ORDER_CREATED', 'PAYMENT_CAPTURED']);
    expect(preview.balance.marketplaceCommission).toBe('0.00');
    expect(preview.balance.vendorPayable).toBe('0.00');
  });

  it('marks shipping cost unknown when no confirmed shipment cost exists', () => {
    const { preview } = buildFinanceLedgerPreview({
      ...baseInput,
      shippingCost: null,
    });

    expect(preview.status).toBe('partial');
    expect(preview.unknowns).toContain('shipping_cost');
    expect(preview.entries.map((entry) => entry.eventType)).not.toContain('SHIPPING_COST_RESERVED');
  });

  it('simulates vendor debt when payout was already paid', () => {
    const { preview } = buildFinanceLedgerPreview({
      ...baseInput,
      refundRecords: [
        {
          id: 'refund-record-1045-paid',
          sourceShopifyRefundId: 'refund-1045-paid',
          amount: 400,
          status: 'completed',
          createdAt: '2026-05-20T12:30:00.000Z',
        },
      ],
      payoutAlreadyPaid: true,
      shippingCost: null,
    });

    expect(preview.entries.map((entry) => entry.eventType)).toContain('VENDOR_DEBT_CREATED');
    expect(preview.balance.vendorPayable).toBe('900.00');
    expect(preview.balance.vendorDebt).toBe('360.00');
    expect(preview.balance.netVendorPosition).toBe('540.00');
  });
});
