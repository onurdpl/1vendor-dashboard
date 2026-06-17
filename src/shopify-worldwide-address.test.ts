import { describe, expect, it } from 'vitest';
import { splitShopifyWorldwideAddress2 } from '../backend/src/modules/shopify/shopify-worldwide-address.service.js';

describe('Shopify Worldwide address2 split', () => {
  it('splits Shopify Turkey address2 into line2 and district using the reserved delimiter', () => {
    expect(splitShopifyWorldwideAddress2({ address2: '6B ⁠Kartal', countryCode: 'TR' })).toEqual({
      line2: '6B',
      district: 'Kartal',
      splitSource: 'shopify_worldwide',
    });
  });

  it('keeps clean Turkey address2 as line2 without inventing a district', () => {
    expect(splitShopifyWorldwideAddress2({ address2: 'Kartal', countryCode: 'TR' })).toEqual({
      line2: 'Kartal',
      district: null,
      splitSource: 'not_applicable',
    });
  });

  it('does not apply Turkey address2 splitting to non-TR countries', () => {
    expect(splitShopifyWorldwideAddress2({ address2: '6B ⁠Kartal', countryCode: 'US' })).toEqual({
      line2: '6B ⁠Kartal',
      district: null,
      splitSource: 'not_applicable',
    });
  });

  it('does not guess district when Turkey address2 has no Shopify delimiter', () => {
    expect(splitShopifyWorldwideAddress2({ address2: '6B Kartal', countryCode: 'TR' })).toEqual({
      line2: '6B Kartal',
      district: null,
      splitSource: 'not_applicable',
    });
  });
});
