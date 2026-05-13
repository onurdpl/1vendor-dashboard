import { describe, expect, it } from 'vitest';
import { __saleLedgerTesting } from '../backend/src/modules/finance/sale-ledger.service';

describe('sale ledger foundation', () => {
  it('builds deterministic vendor/order sale ledger ids for idempotent upserts', () => {
    expect(__saleLedgerTesting.buildSaleLedgerEntryId('yalispor', '12345')).toBe('fin-yalispor-sale-12345');
    expect(__saleLedgerTesting.buildSaleLedgerEntryId('sporjinal', '12345')).toBe('fin-sporjinal-sale-12345');
  });
});
