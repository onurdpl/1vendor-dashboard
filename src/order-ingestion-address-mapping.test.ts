import { describe, expect, it } from 'vitest';
import {
  mapShopifyBillingAddress,
  mapShopifyShippingAddress,
  normalizeShopifyShipmentPhone,
} from '../backend/src/modules/shopify/order-ingestion.service.js';

describe('Shopify order shipping address mapping', () => {
  it('maps Shopify shipping address fields into shipment-ready order fields', () => {
    const mapped = mapShopifyShippingAddress({
      id: 1028,
      name: '#1028',
      shipping_address: {
        phone: ' +90 555 111 22 33 ',
        country_code: 'TR',
        zip: '34000',
        city: 'Istanbul',
        district: 'Kadikoy',
        address1: 'Test Mahallesi 1. Sokak No: 1',
        address2: 'Daire 2',
      },
      line_items: [],
    });

    expect(mapped).toEqual({
      customerPhone: '+905551112233',
      shippingCountry: 'TR',
      shippingPostcode: '34000',
      shippingCity: 'Istanbul',
      shippingDistrict: 'Kadikoy',
      shippingAddress: 'Test Mahallesi 1. Sokak No: 1, Daire 2',
    });
  });

  it('uses available province/city-area data for district without inventing missing fields', () => {
    expect(
      mapShopifyShippingAddress({
        id: 1028,
        shipping_address: {
          city: 'Istanbul',
          city_area: 'Kadikoy',
          address1: 'Test Mahallesi',
        },
        line_items: [],
      }),
    ).toMatchObject({
      shippingDistrict: 'Kadikoy',
      shippingCountry: null,
      shippingPostcode: null,
    });

    expect(
      mapShopifyShippingAddress({
        id: 1029,
        shipping_address: {
          city: 'Istanbul',
          province: 'Besiktas',
        },
        line_items: [],
      }),
    ).toMatchObject({
      shippingDistrict: 'Besiktas',
    });
  });

  it('maps exact Shopify district aliases before address2 fallback', () => {
    const mapped = mapShopifyShippingAddress({
      id: 1081,
      name: '#1081',
      shipping_address: {
        country_code: 'TR',
        city: 'İstanbul',
        districtName: 'Kartal',
        address1: 'İncirağacı Sokak no 6b',
        address2: 'Daire 4',
      },
      line_items: [],
    });

    expect(mapped).toMatchObject({
      shippingDistrict: 'Kartal',
      shippingAddress: 'İncirağacı Sokak no 6b, Daire 4',
    });
  });

  it('keeps Turkey address2 fallback only when exact district fields are absent', () => {
    expect(
      mapShopifyShippingAddress({
        id: 1082,
        name: '#1082',
        shipping_address: {
          country: 'Türkiye',
          city: 'İstanbul',
          address1: 'İncirağacı Sokak',
          address2: '6B Kartal',
        },
        line_items: [],
      }),
    ).toMatchObject({
      shippingDistrict: '6B Kartal',
      shippingAddress: 'İncirağacı Sokak, 6B Kartal',
    });
  });

  it('maps billing district from the same exact district aliases', () => {
    const mapped = mapShopifyBillingAddress({
      id: 1083,
      name: '#1083',
      billing_address: {
        city: 'İstanbul',
        cityArea: 'Kartal',
        address1: 'Billing Sokak',
        address2: 'Kat 2',
      },
      line_items: [],
    });

    expect(mapped).toMatchObject({
      billingDistrict: 'Kartal',
      billingAddress1: 'Billing Sokak',
      billingAddress2: 'Kat 2',
    });
  });

  it('normalizes phone whitespace without stripping country code', () => {
    expect(normalizeShopifyShipmentPhone(' +90 555 111 22 33 ')).toBe('+905551112233');
    expect(normalizeShopifyShipmentPhone('')).toBeNull();
  });
});
