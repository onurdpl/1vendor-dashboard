import { describe, expect, it } from 'vitest';
import { getMockFinanceDashboard, listMockFinanceTransactions } from './mockFinance';

function parseMoney(value: string) {
  return Number(value.replace(/[^0-9.-]/g, ''));
}

describe('mock finance derived from vendor allocations', () => {
  it('derives vendor A finance from vendor A allocations only', () => {
    const finance = getMockFinanceDashboard('demo-vendor-a');

    expect(finance.summary.grossSales).toBe('$5,310.00');
    expect(finance.summary.refunds).toBe('$1,900.00');
    expect(finance.summary.netRevenue).toBe('$3,410.00');
    expect(finance.summary.platformFee).toBe('$341.00');
    expect(finance.summary.payoutEstimate).toBe('$3,069.00');
    expect(finance.summary.availableBalance).toBe(finance.summary.payoutEstimate);
    expect(finance.summary.totalRevenue).toBe(finance.summary.grossSales);
    expect(finance.summary.refundsThisMonth).toBe(finance.summary.refunds);
    expect(listMockFinanceTransactions('demo-vendor-a').length).toBeGreaterThan(0);
  });

  it('derives vendor B finance from vendor B allocations only', () => {
    const finance = getMockFinanceDashboard('demo-vendor-b');

    expect(finance.summary.grossSales).toBe('$13,300.00');
    expect(finance.summary.refunds).toBe('$2,700.00');
    expect(finance.summary.netRevenue).toBe('$10,600.00');
    expect(finance.summary.platformFee).toBe('$1,060.00');
    expect(finance.summary.payoutEstimate).toBe('$9,540.00');
    expect(finance.summary.availableBalance).toBe(finance.summary.payoutEstimate);
    expect(finance.summary.totalRevenue).toBe(finance.summary.grossSales);
    expect(finance.summary.refundsThisMonth).toBe(finance.summary.refunds);
    expect(listMockFinanceTransactions('demo-vendor-b').length).toBeGreaterThan(0);
  });

  it('keeps refunds reducing net revenue and platform fee at ten percent', () => {
    const finance = getMockFinanceDashboard('demo-vendor-a');
    const grossSales = parseMoney(finance.summary.grossSales);
    const refunds = parseMoney(finance.summary.refunds);
    const netRevenue = parseMoney(finance.summary.netRevenue);
    const platformFee = parseMoney(finance.summary.platformFee);
    const payoutEstimate = parseMoney(finance.summary.payoutEstimate);

    expect(netRevenue).toBe(grossSales - refunds);
    expect(platformFee).toBeCloseTo(netRevenue * 0.1, 2);
    expect(payoutEstimate).toBe(netRevenue - platformFee);
  });
});
