import { describe, expect, it } from 'vitest';
import type { FinanceRecordDto } from '../backend/src/modules/finance/finance.types.js';
import { mapFinanceRecords as mapBackend } from '../backend/src/modules/finance/finance-search-record.js';
import { mapFinanceRecords as mapFrontend } from './services/real/finance';
import { getFinancePresentation } from './lib/financePresentation';

const base: FinanceRecordDto = {
  id: 'ledger-001', type: 'sale', amount: '1500.00', status: 'PENDING', payoutStatus: 'PENDING',
  description: null, relatedOrderId: 'gid://shopify/Order/1001', relatedOrderNumber: '#1001',
  relatedReturnId: null, relatedRefundId: null, createdAt: '2026-11-01T00:00:00.000Z',
  payoutCalculation: null,
  settlement: { status: 'pending', payoutReady: false, eligibleAt: '2026-11-22T00:00:00.000Z',
    accruedAt: null, payableAt: null, settledAt: null, holdReason: null, note: 'Pending', review: null },
  payoutBatch: null, settlementRefundAdjustments: [], splitFinanceSummary: null,
};

describe('Finance server search presentation parity', () => {
  it('maps canonical DTOs identically across transaction categories and amount signs', () => {
    const records: FinanceRecordDto[] = [
      base,
      { ...base, id: 'refund', type: 'refund', amount: '25.00', status: 'RECORDED',
        relatedRefundId: 'gid://shopify/Refund/801', description: 'Refund posted' },
      { ...base, id: 'adjustment', type: 'adjustment', amount: '-14.50', status: 'FAILED' },
      { ...base, id: 'payout', type: 'payout', amount: '0.00', status: 'PAID',
        payoutBatch: { id: 'batch-1', status: 'paid', netAmount: '0.00', r1OffsetAmount: '0.00',
          r1ApprovedPayable: null, createdAt: base.createdAt, paidAt: base.createdAt, paymentReference: null } },
    ];
    expect(mapBackend(records)).toEqual(mapFrontend(records));
    for (const record of mapBackend(records)) {
      for (const audience of ['admin', 'vendor'] as const) {
        expect(getFinancePresentation(record, audience, { vendorId: 'vendor-a', vendorName: 'Vendor A' }).searchableText)
          .toEqual(getFinancePresentation(mapFrontend(records).find((item) => item.id === record.id)!, audience,
            { vendorId: 'vendor-a', vendorName: 'Vendor A' }).searchableText);
      }
    }
    expect(mapBackend(records)[0].amount).toBe('TRY\u00a01,500.00');
  });
});
