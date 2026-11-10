import { describe, expect, it } from 'vitest';
import { getMockFinanceDashboard, listMockFinanceTransactions } from './mockFinance';
import { runtimeConfig } from '../../config/runtime';
import { runtimeServices } from '../../services/runtime-services';

function parseMoney(value: string) {
  return Number(value.replace(/[^0-9.-]/g, ''));
}

describe('mock finance derived from vendor allocations', () => {
  it('keeps typed reference results Vendor scoped and fails closed for unavailable local identities', async () => {
    const previousMode = runtimeConfig.apiMode;
    runtimeConfig.apiMode = 'mock';
    try {
      const a = getMockFinanceDashboard('demo-vendor-a').transactions;
      const orderId = a.find((record) => record.shopifyOrderId)?.shopifyOrderId;
      const refundId = a.find((record) => record.category === 'Refund' && record.shopifyRefundId)?.shopifyRefundId;
      expect(orderId).toBeTruthy();
      expect(refundId).toBeTruthy();
      const orders = await runtimeServices.finance.transactions('demo-vendor-a', {
        reference: { type: 'sourceShopifyOrderId', id: orderId! }, audience: 'admin',
      });
      expect(orders.records.length).toBeGreaterThan(0);
      expect(orders.records.every((record) => record.shopifyOrderId === orderId)).toBe(true);
      const refunds = await runtimeServices.finance.transactions('demo-vendor-a', {
        reference: { type: 'sourceShopifyRefundId', id: refundId! }, audience: 'admin',
      });
      expect(refunds.records.length).toBeGreaterThan(0);
      expect(refunds.records.every((record) => record.category === 'Refund' && record.shopifyRefundId === refundId)).toBe(true);
      expect((await runtimeServices.finance.transactions('demo-vendor-b', {
        reference: { type: 'sourceShopifyRefundId', id: refundId! }, audience: 'vendor',
      })).records.some((record) => record.id === refunds.records[0].id)).toBe(false);
      expect((await runtimeServices.finance.transactions('demo-vendor-a', {
        reference: { type: 'localOrderId', id: 'unavailable-local-order' }, audience: 'admin',
      })).records).toEqual([]);
      expect((await runtimeServices.finance.transactions('demo-vendor-a', {
        reference: { type: 'refundRecordId', id: 'unavailable-local-refund' }, audience: 'admin',
      })).records).toEqual([]);
    } finally {
      runtimeConfig.apiMode = previousMode;
    }
  });
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
