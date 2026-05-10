import { describe, expect, it } from 'vitest';
import { getMockReturn, listMockReturns } from './mockReturns';

describe('mock returns vendor allocations', () => {
  it('creates vendor-scoped return allocations from a shared Shopify refund', () => {
    const vendorAReturns = listMockReturns('demo-vendor-a');
    const vendorBReturns = listMockReturns('demo-vendor-b');

    expect(vendorAReturns.map((item) => item.id)).toContain('RET-A-1001');
    expect(vendorBReturns.map((item) => item.id)).toContain('RET-B-1001');
  });

  it('shows only vendor A refunded items for vendor A', () => {
    const vendorAReturn = getMockReturn('RET-A-1001', 'demo-vendor-a');

    expect(vendorAReturn).not.toBeNull();
    expect(vendorAReturn?.vendorId).toBe('demo-vendor-a');
    expect(vendorAReturn?.sourceShopifyOrderId).toBe('gid://shopify/Order/1001');
    expect(vendorAReturn?.sourceShopifyOrderNumber).toBe(1001);
    expect(vendorAReturn?.sourceShopifyRefundId).toBe('gid://shopify/Refund/5001');
    expect(vendorAReturn?.refundedItems.every((item) => item.vendorId === 'demo-vendor-a')).toBe(true);
    expect(vendorAReturn?.refundedItems.map((item) => item.variantTitle)).toEqual(['Medium']);
  });

  it('shows only vendor B refunded items for vendor B', () => {
    const vendorBReturn = getMockReturn('RET-B-1001', 'demo-vendor-b');

    expect(vendorBReturn).not.toBeNull();
    expect(vendorBReturn?.vendorId).toBe('demo-vendor-b');
    expect(vendorBReturn?.sourceShopifyOrderId).toBe('gid://shopify/Order/1001');
    expect(vendorBReturn?.sourceShopifyOrderNumber).toBe(1001);
    expect(vendorBReturn?.sourceShopifyRefundId).toBe('gid://shopify/Refund/5001');
    expect(vendorBReturn?.refundedItems.every((item) => item.vendorId === 'demo-vendor-b')).toBe(true);
    expect(vendorBReturn?.refundedItems.map((item) => item.variantTitle)).toEqual(['Large']);
  });

  it('blocks cross-vendor refund lookup', () => {
    expect(getMockReturn('RET-B-1001', 'demo-vendor-a')).toBeNull();
    expect(getMockReturn('RET-A-1001', 'demo-vendor-b')).toBeNull();
  });
});
