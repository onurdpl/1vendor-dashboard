export type ShipmentLabelOpenResult =
  | { opened: true; source: 'url' | 'object_url' }
  | { opened: false; error: string };

const PDF_DATA_URL_PREFIX = 'data:application/pdf;base64,';
const LABEL_OBJECT_URL_REVOKE_DELAY_MS = 60_000;

function isOpenableShipmentLabelUrl(value: string) {
  return /^(https?:|blob:)/i.test(value) || value.startsWith('/');
}

function normalizePdfBase64Label(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.toLowerCase().startsWith(PDF_DATA_URL_PREFIX)) {
    return trimmed.slice(PDF_DATA_URL_PREFIX.length).replace(/\s+/g, '');
  }

  const compact = trimmed.replace(/\s+/g, '');
  if (!/^[a-z0-9+/]+={0,2}$/i.test(compact)) {
    return null;
  }

  try {
    const binary = globalThis.atob(compact);
    return binary.startsWith('%PDF') ? compact : null;
  } catch {
    return null;
  }
}

export function openShipmentLabel(labelValue: string): ShipmentLabelOpenResult {
  const trimmed = labelValue.trim();
  if (!trimmed) {
    return { opened: false, error: 'Shipment label is unavailable.' };
  }

  if (isOpenableShipmentLabelUrl(trimmed)) {
    globalThis.open?.(trimmed, '_blank', 'noopener,noreferrer');
    return { opened: true, source: 'url' };
  }

  const pdfBase64 = normalizePdfBase64Label(trimmed);
  if (!pdfBase64) {
    return { opened: false, error: 'Shipment label data is not a supported PDF link.' };
  }

  try {
    const binary = globalThis.atob(pdfBase64);
    if (!binary.startsWith('%PDF')) {
      return { opened: false, error: 'Shipment label data is not a supported PDF link.' };
    }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    globalThis.open?.(objectUrl, '_blank', 'noopener,noreferrer');
    globalThis.setTimeout(() => revokeObjectURL(objectUrl), LABEL_OBJECT_URL_REVOKE_DELAY_MS);
    return { opened: true, source: 'object_url' };
  } catch {
    return { opened: false, error: 'Shipment label PDF could not be opened.' };
  }
}
