export function formatShippingProviderName(value?: string | null) {
  const raw = value?.trim();
  if (!raw) {
    return '';
  }

  const normalized = raw.toLowerCase();
  if (normalized === 'try_oto') {
    return 'Try OTO';
  }
  if (normalized === 'kargo_entegrator') {
    return 'Kargo Entegratör';
  }
  if (normalized === 'kargonomi') {
    return 'Kargonomi';
  }
  if (normalized === 'hepsijet') {
    return 'Hepsijet';
  }
  if (/^[A-Z0-9\s-]+$/.test(raw)) {
    return raw;
  }

  return raw
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

export function formatTrackingCarrierLabel(carrier?: string | null) {
  const label = formatShippingProviderName(carrier);
  return label || null;
}
