export function formatShopifyOrderNumber(value: string | number | null | undefined, fallback = 'Unknown order') {
  if (value === null || value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.startsWith('#') ? normalized : `#${normalized}`;
}

export function formatShopifyOrderLabel(value: string | number | null | undefined, fallback = 'Unknown order') {
  const orderNumber = formatShopifyOrderNumber(value, fallback);
  return orderNumber === fallback ? fallback : `Order ${orderNumber}`;
}
