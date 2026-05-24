import { describe, expect, it } from 'vitest';
import { resolveShopifyLineItemImageUrl } from '../backend/src/modules/shopify/shopify-admin.service.js';

function buildLineItem(overrides: Record<string, unknown> = {}): Parameters<typeof resolveShopifyLineItemImageUrl>[0] {
  return {
    id: 'gid://shopify/LineItem/1',
    sku: 'SKU-1',
    image: null,
    variant: null,
    product: null,
    ...overrides,
  } as Parameters<typeof resolveShopifyLineItemImageUrl>[0];
}

describe('Shopify order line item image resolver', () => {
  it('prefers the line item image over variant and product images', () => {
    const resolved = resolveShopifyLineItemImageUrl(buildLineItem({
      image: { url: 'https://cdn.shopify.com/line.jpg', altText: 'Line item image' },
      variant: { id: 'gid://shopify/ProductVariant/1', image: { url: 'https://cdn.shopify.com/variant.jpg', altText: 'Variant image' } },
      product: { id: 'gid://shopify/Product/1', featuredMedia: { image: { url: 'https://cdn.shopify.com/product.jpg', altText: 'Product image' } } },
    }));

    expect(resolved).toEqual({
      imageUrl: 'https://cdn.shopify.com/line.jpg',
      imageSource: 'line_item',
      altText: 'Line item image',
    });
  });

  it('falls back to variant image before product featured media', () => {
    const resolved = resolveShopifyLineItemImageUrl(buildLineItem({
      variant: { id: 'gid://shopify/ProductVariant/1', image: { url: 'https://cdn.shopify.com/variant.jpg', altText: null } },
      product: { id: 'gid://shopify/Product/1', featuredMedia: { image: { url: 'https://cdn.shopify.com/product.jpg', altText: 'Product image' } } },
    }));

    expect(resolved).toEqual({
      imageUrl: 'https://cdn.shopify.com/variant.jpg',
      imageSource: 'variant',
      altText: null,
    });
  });

  it('uses product featured media when line item and variant images are missing', () => {
    const resolved = resolveShopifyLineItemImageUrl(buildLineItem({
      product: { id: 'gid://shopify/Product/1', featuredMedia: { image: { url: 'https://cdn.shopify.com/product.jpg', altText: 'Product image' } } },
    }));

    expect(resolved).toEqual({
      imageUrl: 'https://cdn.shopify.com/product.jpg',
      imageSource: 'product_featured_media',
      altText: 'Product image',
    });
  });

  it('returns null image data when Shopify has no usable image URL', () => {
    expect(resolveShopifyLineItemImageUrl(buildLineItem())).toEqual({
      imageUrl: null,
      imageSource: null,
      altText: null,
    });
  });
});
