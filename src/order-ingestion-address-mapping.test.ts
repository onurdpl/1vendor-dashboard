import { describe, expect, it } from 'vitest';
import {
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

  it('normalizes phone whitespace without stripping country code', () => {
    expect(normalizeShopifyShipmentPhone(' +90 555 111 22 33 ')).toBe('+905551112233');
    expect(normalizeShopifyShipmentPhone('')).toBeNull();
  });
});
