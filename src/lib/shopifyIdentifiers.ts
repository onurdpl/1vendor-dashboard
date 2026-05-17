export function normalizeOrderNumber(value: string | number | null | undefined) {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }

  return text.replace(/^order\s*/i, '').replace(/^#+/, '').trim().toLowerCase();
}

export function normalizeShopifyIdentifier(value: string | number | null | undefined) {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }

  return text.split('/').filter(Boolean).pop()?.trim().toLowerCase() ?? text.toLowerCase();
}

export function sameOrderNumber(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
) {
  const normalizedLeft = normalizeOrderNumber(left);
  const normalizedRight = normalizeOrderNumber(right);

  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function sameShopifyIdentifier(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
) {
  const normalizedLeft = normalizeShopifyIdentifier(left);
  const normalizedRight = normalizeShopifyIdentifier(right);

  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function sameNormalizedIdentifier(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
) {
  const normalizedLeft = normalizeOrderNumber(left);
  const normalizedRight = normalizeOrderNumber(right);

  if (normalizedLeft && normalizedRight && normalizedLeft === normalizedRight) {
    return true;
  }

  return sameShopifyIdentifier(left, right);
}
