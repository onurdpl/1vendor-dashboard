import { describe, expect, it } from 'vitest';
import { classifyPersistedRefundFinanceEvidence } from '../backend/src/modules/shopify/refund-persisted-finance-classifier';

const base = {
  snapshot: null,
  ledgers: [] as Array<{ id: string; vendorAllocationId: string | null }>,
  expectedRefundLedgerId: 'fin-vendor-refund-refund-allocation',
  legacyRefundLedgerId: 'fin-vendor-refund-refund',
  vendorAllocationId: 'allocation',
  refundRecord: { id: 'record' },
  adjustment: null,
  debtEvent: null,
  financeEvents: [] as Array<{ financeLedgerEntry: { vendorAllocationId: string | null } | null; metadataJson: unknown }>,
};

describe('persisted refund finance classifier parity', () => {
  it('gives accepted snapshots precedence over all historical evidence', () => {
    expect(classifyPersistedRefundFinanceEvidence({ ...base, snapshot: { id: 'snapshot' }, ledgers: [{ id: 'ledger', vendorAllocationId: 'allocation' }] })).toEqual({ kind: 'snapshot', snapshot: { id: 'snapshot' } });
  });

  it('treats allocation-scoped refund ledgers as historical even if voided or superseded', () => {
    // The classifier intentionally reads identity, not active/voided state.
    expect(classifyPersistedRefundFinanceEvidence({ ...base, ledgers: [{ id: 'voided-ledger', vendorAllocationId: 'allocation' }] }).kind).toBe('historical_finance');
    expect(classifyPersistedRefundFinanceEvidence({ ...base, ledgers: [{ id: 'superseded-ledger', vendorAllocationId: 'allocation' }] }).kind).toBe('historical_finance');
  });

  it('preserves adjustment, debt and finance-event historical evidence', () => {
    expect(classifyPersistedRefundFinanceEvidence({ ...base, adjustment: { id: 'adjustment' } }).kind).toBe('historical_finance');
    expect(classifyPersistedRefundFinanceEvidence({ ...base, debtEvent: { id: 'debt' } }).kind).toBe('historical_finance');
    expect(classifyPersistedRefundFinanceEvidence({ ...base, financeEvents: [{ financeLedgerEntry: null, metadataJson: { vendorAllocationId: 'allocation' } }] }).kind).toBe('historical_finance');
  });

  it('preserves unscoped, conflicting-identity and unscoped-event ambiguity', () => {
    expect(classifyPersistedRefundFinanceEvidence({ ...base, ledgers: [{ id: 'other', vendorAllocationId: null }] }).kind).toBe('ambiguous_legacy');
    expect(classifyPersistedRefundFinanceEvidence({ ...base, ledgers: [{ id: base.expectedRefundLedgerId, vendorAllocationId: 'other' }] }).kind).toBe('ambiguous_legacy');
    expect(classifyPersistedRefundFinanceEvidence({ ...base, financeEvents: [{ financeLedgerEntry: null, metadataJson: {} }] }).kind).toBe('ambiguous_legacy');
  });

  it('does not treat a RefundRecord alone as finance authority', () => {
    expect(classifyPersistedRefundFinanceEvidence(base).kind).toBe('new');
  });
});
