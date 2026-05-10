import { describe, expect, it } from 'vitest';
import {
  allocateShopifyOrderToVendors,
  resolveVendorFromVariantMetafield,
} from './vendorMapping';

describe('shopify vendor mapping', () => {
  it('resolves vendor A metafields', () => {
    expect(resolveVendorFromVariantMetafield('Demo Vendor A')).toBe('demo-vendor-a');
  });

  it('resolves vendor B metafields', () => {
    expect(resolveVendorFromVariantMetafield('Demo Vendor B')).toBe('demo-vendor-b');
  });

  it('resolves trimmed lowercase metafields', () => {
    expect(resolveVendorFromVariantMetafield('  demo vendor a  ')).toBe('demo-vendor-a');
    expect(resolveVendorFromVariantMetafield('  DEMO VENDOR B  ')).toBe('demo-vendor-b');
  });

  it('returns null for unknown vendor metafields', () => {
    expect(resolveVendorFromVariantMetafield('Unknown Vendor')).toBeNull();
  });

  it('allocates one Shopify order into vendor-specific allocations', () => {
    const result = allocateShopifyOrderToVendors({
      id: '1001',
      orderNumber: 1001,
      lineItems: [
        {
          id: 'line-1',
          variantId: 'variant-1',
          sku: 'SKU123',
          title: 'Medium',
          variantTitle: 'Medium',
          quantity: 1,
          price: '$19.00',
          vendorMetafield: 'Demo Vendor A',
        },
        {
          id: 'line-2',
          variantId: 'variant-2',
          sku: 'SKU123',
          title: 'Large',
          variantTitle: 'Large',
          quantity: 2,
          price: '$21.00',
          vendorMetafield: 'Demo Vendor B',
        },
        {
          id: 'line-3',
          variantId: 'variant-3',
          sku: 'STANDARD',
          title: 'Standard Product',
          variantTitle: 'Default Title',
          quantity: 1,
          price: '$9.00',
          vendorMetafield: 'Demo Vendor A',
        },
        {
          id: 'line-4',
          variantId: 'variant-4',
          sku: 'MISC',
          title: 'Unmapped Item',
          variantTitle: 'Default Title',
          quantity: 1,
          price: '$5.00',
          vendorMetafield: 'Unknown Vendor',
        },
      ],
    });

    expect(result.allocations).toHaveLength(2);
    expect(result.unmappedLineItems).toHaveLength(1);

    const vendorA = result.allocations.find((allocation) => allocation.vendorId === 'demo-vendor-a');
    const vendorB = result.allocations.find((allocation) => allocation.vendorId === 'demo-vendor-b');

    expect(vendorA).toBeDefined();
    expect(vendorB).toBeDefined();

    expect(vendorA?.lineItems).toHaveLength(2);
    expect(vendorA?.originalVendorId).toBe('demo-vendor-a');
    expect(vendorA?.assignedVendorId).toBe('demo-vendor-a');
    expect(vendorA?.vendorId).toBe('demo-vendor-a');
    expect(vendorA?.lineItems.every((lineItem) => lineItem.vendorId === 'demo-vendor-a')).toBe(true);
    expect(vendorA?.lineItems.every((lineItem) => lineItem.originalVendorId === 'demo-vendor-a')).toBe(true);
    expect(vendorA?.lineItems.every((lineItem) => lineItem.assignedVendorId === lineItem.originalVendorId)).toBe(true);
    expect(vendorA?.lineItems.map((lineItem) => lineItem.title)).toEqual(['Medium', 'Standard Product']);

    expect(vendorB?.lineItems).toHaveLength(1);
    expect(vendorB?.originalVendorId).toBe('demo-vendor-b');
    expect(vendorB?.assignedVendorId).toBe('demo-vendor-b');
    expect(vendorB?.vendorId).toBe('demo-vendor-b');
    expect(vendorB?.lineItems.every((lineItem) => lineItem.vendorId === 'demo-vendor-b')).toBe(true);
    expect(vendorB?.lineItems.every((lineItem) => lineItem.originalVendorId === 'demo-vendor-b')).toBe(true);
    expect(vendorB?.lineItems.every((lineItem) => lineItem.assignedVendorId === lineItem.originalVendorId)).toBe(true);
    expect(vendorB?.lineItems[0].title).toBe('Large');

    expect(result.unmappedLineItems[0].title).toBe('Unmapped Item');
    expect(result.allocations.every((allocation) => allocation.shopifyOrderId === '1001')).toBe(true);
    expect(result.allocations.every((allocation) => allocation.shopifyOrderNumber === 1001)).toBe(true);
  });
});
