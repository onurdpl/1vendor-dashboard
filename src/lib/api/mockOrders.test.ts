import { describe, expect, it } from 'vitest';
import { getMockOrder, listMockOrders } from './mockOrders';

describe('mock orders vendor allocations', () => {
  it('shows the shared Shopify order as a vendor A allocation', () => {
    const orders = listMockOrders('demo-vendor-a');
    const sharedOrder = getMockOrder('ORD-A-1001', 'demo-vendor-a');

    expect(orders.map((order) => order.id)).toContain('ORD-A-1001');
    expect(sharedOrder).not.toBeNull();
    expect(sharedOrder?.sourceShopifyOrderId).toBe('gid://shopify/Order/1001');
    expect(sharedOrder?.sourceShopifyOrderNumber).toBe(1001);
    expect(sharedOrder?.vendorId).toBe('demo-vendor-a');
    expect(sharedOrder?.lineItems).toHaveLength(2);
    expect(sharedOrder?.lineItems.every((item) => item.vendorId === 'demo-vendor-a')).toBe(true);
    expect(sharedOrder?.lineItems.map((item) => item.sku)).toEqual(['SKU123', 'STANDARD']);
    expect(sharedOrder?.fulfillmentStatus).toBe('Processing');
    expect(sharedOrder?.shippingStatus).toBe('Awaiting Shipment');
    expect(sharedOrder?.lineItems.every((item) => item.fulfillmentStatus === 'Processing')).toBe(true);
    expect(sharedOrder?.lineItems.every((item) => item.shippingStatus === 'Awaiting Shipment')).toBe(true);
  });

  it('shows the same Shopify order as a vendor B allocation', () => {
    const orders = listMockOrders('demo-vendor-b');
    const sharedOrder = getMockOrder('ORD-B-1001', 'demo-vendor-b');

    expect(orders.map((order) => order.id)).toContain('ORD-B-1001');
    expect(sharedOrder).not.toBeNull();
    expect(sharedOrder?.sourceShopifyOrderId).toBe('gid://shopify/Order/1001');
    expect(sharedOrder?.sourceShopifyOrderNumber).toBe(1001);
    expect(sharedOrder?.vendorId).toBe('demo-vendor-b');
    expect(sharedOrder?.lineItems).toHaveLength(1);
    expect(sharedOrder?.lineItems.every((item) => item.vendorId === 'demo-vendor-b')).toBe(true);
    expect(sharedOrder?.lineItems[0].variantTitle).toBe('Large');
    expect(sharedOrder?.fulfillmentStatus).toBe('Fulfilled');
    expect(sharedOrder?.shippingStatus).toBe('In Transit');
    expect(sharedOrder?.trackingNumber).toBe('TRK-B-1001');
    expect(sharedOrder?.carrier).toBe('UPS');
    expect(sharedOrder?.lineItems.every((item) => item.fulfillmentStatus === 'Fulfilled')).toBe(true);
    expect(sharedOrder?.lineItems.every((item) => item.shippingStatus === 'In Transit')).toBe(true);
  });

  it('blocks cross-vendor order detail access', () => {
    expect(getMockOrder('ORD-B-1001', 'demo-vendor-a')).toBeNull();
    expect(getMockOrder('ORD-A-1001', 'demo-vendor-b')).toBeNull();
  });
});
