import { describe, expect, it } from 'vitest';
import { formatShopifyOrderLabel, formatShopifyOrderNumber } from './formatOrderDisplay';

describe('formatShopifyOrderNumber', () => {
  it('keeps Shopify order names that already include a prefix', () => {
    expect(formatShopifyOrderNumber('#1029')).toBe('#1029');
  });

  it('adds a Shopify order prefix when the value is numeric text', () => {
    expect(formatShopifyOrderNumber('1029')).toBe('#1029');
    expect(formatShopifyOrderNumber(1029)).toBe('#1029');
  });

  it('uses a safe fallback for missing values', () => {
    expect(formatShopifyOrderNumber(null)).toBe('Unknown order');
    expect(formatShopifyOrderNumber(undefined)).toBe('Unknown order');
    expect(formatShopifyOrderNumber('')).toBe('Unknown order');
  });
});

describe('formatShopifyOrderLabel', () => {
  it('builds order labels without duplicating the Shopify prefix', () => {
    expect(formatShopifyOrderLabel('#1029')).toBe('Order #1029');
    expect(formatShopifyOrderLabel('1029')).toBe('Order #1029');
  });
});
