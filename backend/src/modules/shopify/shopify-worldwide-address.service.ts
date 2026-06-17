import { splitAddress2 } from '@shopify/worldwide';

export type ShopifyWorldwideAddress2SplitSource = 'shopify_worldwide' | 'not_applicable' | 'unavailable';

export type ShopifyWorldwideAddress2SplitResult = {
  line2: string | null;
  district: string | null;
  splitSource: ShopifyWorldwideAddress2SplitSource;
};

function normalizeAddressValue(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() || null : null;
}

function normalizeCountryCode(value: string | null | undefined) {
  const normalized = normalizeAddressValue(value)?.toLocaleUpperCase('tr-TR') ?? null;
  if (!normalized) {
    return null;
  }

  if (normalized === 'TR' || normalized === 'TURKEY' || normalized === 'TÜRKIYE' || normalized === 'TÜRKİYE' || normalized === 'TURKIYE') {
    return 'TR';
  }

  return normalized;
}

export function splitShopifyWorldwideAddress2(input: {
  address2?: string | null;
  countryCode?: string | null;
}): ShopifyWorldwideAddress2SplitResult {
  const address2 = normalizeAddressValue(input.address2);
  const countryCode = normalizeCountryCode(input.countryCode);

  if (!address2) {
    return {
      line2: null,
      district: null,
      splitSource: 'not_applicable',
    };
  }

  if (countryCode !== 'TR') {
    return {
      line2: address2,
      district: null,
      splitSource: 'not_applicable',
    };
  }

  try {
    const split = splitAddress2(countryCode, address2);
    const line2 = normalizeAddressValue(split?.line2) ?? address2;
    const district = normalizeAddressValue(split?.neighborhood);

    return {
      line2,
      district,
      splitSource: district ? 'shopify_worldwide' : 'not_applicable',
    };
  } catch {
    return {
      line2: address2,
      district: null,
      splitSource: 'unavailable',
    };
  }
}
