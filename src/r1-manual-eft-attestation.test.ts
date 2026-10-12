import { describe, expect, it } from 'vitest';
import { parseAdminDeclaredEftTime } from '../backend/src/modules/finance/manual-eft-attestation.js';

describe('R1 manual bank-EFT timestamp attestation', () => {
  it('normalizes an explicit bank-record UTC offset without substituting request time', () => {
    expect(parseAdminDeclaredEftTime('2026-10-12T14:30:15+03:00').toISOString())
      .toBe('2026-10-12T11:30:15.000Z');
    expect(parseAdminDeclaredEftTime('2026-10-12T11:30:15Z').toISOString())
      .toBe('2026-10-12T11:30:15.000Z');
  });

  it.each([
    '2026-10-12T14:30:15',
    '2026-02-30T14:30:15+03:00',
    '2026-10-12T25:30:15+03:00',
    '2026-10-12T14:30:15+15:00',
    '2026-10-12T14:30:15+14:30',
    '2026-10-12T14:30:15+03:60',
  ])('rejects invalid or timezone-ambiguous bank time %s', (value) => {
    expect(() => parseAdminDeclaredEftTime(value)).toThrow();
  });
});
