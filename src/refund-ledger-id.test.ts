import { describe, expect, it } from 'vitest';

import {
  buildLegacyRefundLedgerEntryId,
  buildRefundLedgerEntryId,
  matchesRefundLedgerSource,
} from '../backend/src/modules/finance/refund-ledger-id.service.js';
import { __reconciliationTesting } from '../backend/src/modules/reconciliation/reconciliation.service.js';

describe('refund ledger id foundation', () => {
  it('builds allocation-scoped refund ledger ids', () => {
    expect(buildRefundLedgerEntryId({
      vendorId: 'yalispor',
      sourceShopifyRefundId: '1074533826897',
      vendorAllocationId: 'alloc-yalispor-781877444617',
    })).toBe('fin-yalispor-refund-1074533826897-alloc-yalispor-781877444617');
  });

  it('keeps legacy refund ledger id construction explicit for compatibility checks', () => {
    expect(buildLegacyRefundLedgerEntryId({
      vendorId: 'yalispor',
      sourceShopifyRefundId: '1074533826897',
    })).toBe('fin-yalispor-refund-1074533826897');
  });

  it('uses the same allocation-scoped format for reconciliation expectations', () => {
    const input = {
      vendorId: 'sporjinal',
      sourceShopifyRefundId: 'refund-1',
      vendorAllocationId: 'alloc-sporjinal-order-1-child',
    };

    expect(__reconciliationTesting.buildExpectedRefundLedgerIdForReconciliation(input))
      .toBe(buildRefundLedgerEntryId(input));
  });

  it('matches refund source ids across allocation-scoped ledger ids', () => {
    expect(matchesRefundLedgerSource({
      ledgerId: 'fin-sporjinal-refund-refund-1-alloc-child',
      sourceShopifyRefundId: 'refund-1',
    })).toBe(true);
    expect(matchesRefundLedgerSource({
      ledgerId: 'fin-sporjinal-refund-refund-2-alloc-child',
      sourceShopifyRefundId: 'refund-1',
    })).toBe(false);
  });
});
