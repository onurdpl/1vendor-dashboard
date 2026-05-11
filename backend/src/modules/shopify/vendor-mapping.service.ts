import type {
  ShopifyLineItemVendorMappingInput,
  ShopifyVendorMetafieldValue,
  ShopifyVendorResolution,
} from './vendor-mapping.types.js';

const VENDOR_NAME_TO_ID = new Map<string, string>([
  ['yali spor', 'yalispor'],
  ['yalispor', 'yalispor'],
  ['sporjinal', 'sporjinal'],
  ['sporvol', 'sporvol'],
]);

function normalizeVendorValue(value: string) {
  return value
    .trim()
    .replace(/[ıİ]/g, 'i')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function resolveVendorFromMetafield(value: ShopifyVendorMetafieldValue): string | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const normalized = normalizeVendorValue(value);
  if (!normalized) {
    return null;
  }

  return VENDOR_NAME_TO_ID.get(normalized) ?? null;
}

export function resolveVendorFromShopifyLineItem(
  lineItem: ShopifyLineItemVendorMappingInput,
): ShopifyVendorResolution {
  const originalMetafieldValue =
    typeof lineItem.vendorMetafieldValue === 'string' ? lineItem.vendorMetafieldValue : null;

  if (!originalMetafieldValue?.trim()) {
    return {
      vendorId: null,
      status: 'unresolved',
      confidence: 'none',
      normalizedVendorName: null,
      originalMetafieldValue,
      error: 'Missing vendor metafield value.',
    };
  }

  const normalizedVendorName = normalizeVendorValue(originalMetafieldValue);
  const vendorId = resolveVendorFromMetafield(originalMetafieldValue);

  if (!vendorId) {
    return {
      vendorId: null,
      status: 'unresolved',
      confidence: 'none',
      normalizedVendorName,
      originalMetafieldValue,
      error: 'Vendor metafield could not be resolved.',
    };
  }

  return {
    vendorId,
    status: 'resolved',
    confidence: 'high',
    normalizedVendorName,
    originalMetafieldValue,
    error: null,
  };
}
