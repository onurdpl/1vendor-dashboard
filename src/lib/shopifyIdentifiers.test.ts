import { describe, expect, it } from 'vitest';
import {
  normalizeOrderNumber,
  normalizeShopifyIdentifier,
  sameNormalizedIdentifier,
  sameOrderNumber,
  sameShopifyIdentifier,
} from './shopifyIdentifiers';

describe('shopify identifier helpers', () => {
  it('normalizes Shopify order numbers with prefixes', () => {
    expect(normalizeOrderNumber('Order #1030')).toBe('1030');
    expect(sameOrderNumber('#1030', '1030')).toBe(true);
  });

  it('normalizes Shopify GID tails', () => {
    expect(normalizeShopifyIdentifier('gid://shopify/Refund/5002')).toBe('5002');
    expect(sameShopifyIdentifier('gid://shopify/Return/9001', '9001')).toBe(true);
  });

  it('matches normalized identifiers across full GID and numeric forms', () => {
    expect(sameNormalizedIdentifier('gid://shopify/Order/7616544244030', '7616544244030')).toBe(true);
    expect(sameNormalizedIdentifier('Order #1030', '#1030')).toBe(true);
  });
});
