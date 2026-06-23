import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAllocationForShopifyOrderLineItem } from '../backend/src/modules/orders/allocation-ownership-resolution.service';

const db = {
  shopifyOrderLineItem: {
    findMany: vi.fn(),
  },
  vendorAllocationLineItem: {
    findMany: vi.fn(),
  },
};

describe('allocation ownership resolution', () => {
  beforeEach(() => {
    db.shopifyOrderLineItem.findMany.mockReset();
    db.vendorAllocationLineItem.findMany.mockReset();
  });

  it('resolves the allocation owner for a Shopify order line item', async () => {
    const shopifyOrderLineItem = {
      id: 'shopify-line-db-1',
      shopifyOrderId: 'shopify-order-db-1',
      sourceLineItemId: 'line-1',
      sku: 'SKU-1',
    };
    const allocation = {
      id: 'alloc-source',
      originalVendorId: 'sporjinal',
      assignedVendorId: 'sporjinal',
      sourceShopifyOrderNumber: '#1096',
    };
    const allocationLineItem = {
      id: 'allocation-line-1',
      vendorAllocationId: allocation.id,
      shopifyLineItemId: shopifyOrderLineItem.id,
      vendorAllocation: allocation,
      shopifyOrderLineItem,
    };
    db.shopifyOrderLineItem.findMany.mockResolvedValueOnce([shopifyOrderLineItem]);
    db.vendorAllocationLineItem.findMany.mockResolvedValueOnce([allocationLineItem]);

    const result = await resolveAllocationForShopifyOrderLineItem({
      shopifyOrderId: 'shopify-order-db-1',
      sourceLineItemId: 'line-1',
    }, db as never);

    expect(result).toEqual({
      allocation,
      allocationLineItem,
      shopifyOrderLineItem,
    });
    expect(db.shopifyOrderLineItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shopifyOrderId: 'shopify-order-db-1',
        }),
        take: 2,
      }),
    );
    expect(db.vendorAllocationLineItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          shopifyLineItemId: 'shopify-line-db-1',
        },
        take: 2,
      }),
    );
  });

  it('fails closed when no allocation line owner exists', async () => {
    db.shopifyOrderLineItem.findMany.mockResolvedValueOnce([
      {
        id: 'shopify-line-db-1',
        shopifyOrderId: 'shopify-order-db-1',
        sourceLineItemId: 'line-1',
      },
    ]);
    db.vendorAllocationLineItem.findMany.mockResolvedValueOnce([]);

    await expect(resolveAllocationForShopifyOrderLineItem({
      shopifyOrderId: 'shopify-order-db-1',
      sourceLineItemId: 'line-1',
    }, db as never)).rejects.toMatchObject({
      code: 'allocation_line_owner_not_found',
    });
  });

  it('fails closed when multiple allocation line owners exist', async () => {
    db.shopifyOrderLineItem.findMany.mockResolvedValueOnce([
      {
        id: 'shopify-line-db-1',
        shopifyOrderId: 'shopify-order-db-1',
        sourceLineItemId: 'line-1',
      },
    ]);
    db.vendorAllocationLineItem.findMany.mockResolvedValueOnce([
      { id: 'allocation-line-1' },
      { id: 'allocation-line-2' },
    ]);

    await expect(resolveAllocationForShopifyOrderLineItem({
      shopifyOrderId: 'shopify-order-db-1',
      sourceLineItemId: 'line-1',
    }, db as never)).rejects.toMatchObject({
      code: 'multiple_allocation_line_owners',
    });
  });

  it('fails closed when input maps to multiple Shopify order line items', async () => {
    db.shopifyOrderLineItem.findMany.mockResolvedValueOnce([
      {
        id: 'shopify-line-db-1',
        shopifyOrderId: 'shopify-order-db-1',
        sourceLineItemId: 'line-1',
      },
      {
        id: 'shopify-line-db-2',
        shopifyOrderId: 'shopify-order-db-1',
        sourceLineItemId: 'line-2',
      },
    ]);

    await expect(resolveAllocationForShopifyOrderLineItem({
      shopifyOrderId: 'shopify-order-db-1',
      shopifyOrderLineItemId: 'ambiguous',
    }, db as never)).rejects.toMatchObject({
      code: 'multiple_shopify_order_line_items',
    });
  });
});
