import { describe, it, expect } from 'vitest';
import { matchesSettlementSearch, settlementSummaryPeriodLabel, formatSettlementDateUtc } from '../backend/src/modules/finance/settlement-search-presentation';
import { safeStatusLabel } from './services/real/formatting';
describe('exact Settlement Search presentation', () => {
  const row = { id: 'ID%_\\İ', vendorId: 'vendor', status: 'approved', lineCount: 101,
    createdAt: '2026-12-31T23:59:00Z', scheduledCycleKey: null };
  it.each(['id%_\\i̇', 'vendor', 'workspace', 'app', '01', 'created', '11:59 pm', ''])('matches literal JS field %j', term => {
    expect(matchesSettlementSearch(row, term, 'Workspace')).toBe(true);
  });
  it('preserves Unicode lowercase and cycle label transformation exactly', () => {
    for (const key of ['İ_ΟΣ', ' élAN_test ', ' ', 'A%_\\B']) {
      expect(settlementSummaryPeriodLabel({ ...row, scheduledCycleKey: key })).toBe(safeStatusLabel(key));
    }
    expect(matchesSettlementSearch({ ...row, id: 'ΟΣ' }, 'ος', '')).toBe(true);
    expect(matchesSettlementSearch({ ...row, id: 'ΟΣ' }, 'οσ', '')).toBe(false);
  });
  it('uses exact Intl UTC output across boundaries and optional-date precedence', () => {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    for (const value of ['2026-12-31T23:59:00Z', '2027-01-01T00:00:00Z', '2024-02-29T00:00:00Z']) {
      expect(formatSettlementDateUtc(value)).toBe(formatter.format(new Date(value)));
      expect(settlementSummaryPeriodLabel({ createdAt: value })).toBe(`Created ${formatter.format(new Date(value))}`);
      expect(settlementSummaryPeriodLabel({ createdAt: value, scheduledRunDate: value })).toBe(`Run ${formatter.format(new Date(value))}`);
      expect(settlementSummaryPeriodLabel({ createdAt: value, scheduledRunDate: row.createdAt, scheduledPeriodEnd: value })).toBe(`Through ${formatter.format(new Date(value))}`);
    }
    expect(formatSettlementDateUtc(null)).toBe('Not set');
    expect(formatSettlementDateUtc('invalid')).toBe('Not set');
  });
});
