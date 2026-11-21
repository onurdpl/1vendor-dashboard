import { describe, expect, it } from 'vitest';
import { getCurrentReturnClosure } from './returnClosure';
describe('current authoritative Return closure', () => {
  it('shows only an accepted current closure date', () => {
    expect(getCurrentReturnClosure({ status: 'Closed', shopifyClosureStatus: 'CLOSED', shopifyClosedAt: '2026-11-19T10:00:00Z' })?.at).toBe('2026-11-19T10:00:00Z');
  });
  it('keeps closed historical records unknown without using generic dates', () => {
    expect(getCurrentReturnClosure({ status: 'Closed' })).toEqual({ label: 'Closed', at: null });
    expect(getCurrentReturnClosure({ status: 'Closed', shopifyClosedAt: '2026-11-19T10:00:00Z' })?.at).toBeNull();
  });
  it.each(['OPEN', 'REQUESTED', 'CANCELED'])('suppresses current closure when canonical status is %s', (status) => {
    expect(getCurrentReturnClosure({ status: 'Closed', shopifyClosureStatus: status, shopifyClosedAt: '2026-11-19T10:00:00Z' })).toBeNull();
  });
  it('displays accepted canonical closure without changing the separate operational status', () => {
    const record = { status: 'Approved', shopifyClosureStatus: 'CLOSED', shopifyClosedAt: '2026-11-19T10:00:00Z' };
    expect(getCurrentReturnClosure(record)?.at).toBe(record.shopifyClosedAt);
    expect(record.status).toBe('Approved');
  });
});
