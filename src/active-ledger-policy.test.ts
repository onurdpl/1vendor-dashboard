import { describe, expect, it } from 'vitest';

import {
  activeFinanceLedgerWhere,
  assertLedgerActiveForMoneyMovement,
  isLedgerVoided,
} from '../backend/src/modules/finance/active-ledger-policy.service.js';

describe('active finance ledger policy', () => {
  it('defines active ledgers as rows with voidedAt null', () => {
    expect(activeFinanceLedgerWhere).toEqual({ voidedAt: null });
  });

  it('detects voided ledger rows', () => {
    expect(isLedgerVoided({ voidedAt: null })).toBe(false);
    expect(isLedgerVoided({})).toBe(false);
    expect(isLedgerVoided(null)).toBe(false);
    expect(isLedgerVoided({ voidedAt: new Date('2026-06-21T10:00:00.000Z') })).toBe(true);
  });

  it('blocks voided ledgers from money movement', () => {
    expect(() => assertLedgerActiveForMoneyMovement({ voidedAt: null })).not.toThrow();
    expect(() =>
      assertLedgerActiveForMoneyMovement(
        { voidedAt: new Date('2026-06-21T10:00:00.000Z') },
        'custom blocked message',
      ),
    ).toThrow('custom blocked message');
  });
});
