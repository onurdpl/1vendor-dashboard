export type OperationalEventProjectionInput = {
  title?: string | null;
  description?: string | null;
  source?: string | null;
};

export type OperationalEventProjection = {
  title: string;
  description: string;
};

const INTERNAL_ENTITY_ID_PATTERN = /\b(?:alloc|signal|return-request)-[a-z0-9][a-z0-9._:-]*(?:-[a-z0-9._:-]+)*\b/gi;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function extractOrderLabel(value: string) {
  const match = value.match(/\border\s*#{0,2}\s*(\d+)\b/i);
  return match ? `Order #${match[1]}` : null;
}

function extractHourLabel(value: string) {
  const match = value.match(/\b(\d+(?:\.\d+)?)\s*h(?:ours?)?\b/i);
  return match ? `${match[1]} hours` : null;
}

function hasInternalIdentifier(value: string) {
  return /\b(?:alloc|signal|return-request)-[a-z0-9][a-z0-9._:-]*(?:-[a-z0-9._:-]+)*\b/i.test(value);
}

function sanitizeOperationalText(value: string) {
  return normalizeWhitespace(
    value
      .replace(/##+/g, '#')
      .replace(INTERNAL_ENTITY_ID_PATTERN, 'operational record')
      .replace(/\b(?:gid:\/\/shopify\/[A-Za-z]+\/)\d+\b/g, 'Shopify record'),
  );
}

export function formatOperationalSource(value: string | null | undefined) {
  const source = value?.trim();
  if (!source) {
    return 'Operational signal';
  }

  const normalized = source.replace(/^signal[-_:]/i, '').replace(/[._:-]+/g, ' ');
  return normalizeWhitespace(normalized)
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase()) || 'Operational signal';
}

export function projectOperationalEvent(input: OperationalEventProjectionInput): OperationalEventProjection {
  const rawTitle = input.title?.trim() ?? '';
  const rawDescription = input.description?.trim() ?? '';
  const rawSource = input.source?.trim() ?? '';
  const combined = normalizeWhitespace([rawTitle, rawDescription, rawSource].filter(Boolean).join(' '));
  const normalized = combined.toLowerCase();
  const orderLabel = extractOrderLabel(combined);
  const hourLabel = extractHourLabel(combined);

  if (
    normalized.includes('fulfillment') &&
    (normalized.includes('stale') || normalized.includes('delayed') || normalized.includes('awaiting shipment'))
  ) {
    const description = orderLabel && hourLabel
      ? `${orderLabel} has not progressed for ${hourLabel}.`
      : orderLabel
        ? `${orderLabel} needs shipment progress.`
        : hourLabel
          ? `A shipment has not progressed for ${hourLabel}.`
          : 'A shipment has not progressed within the expected window.';

    return {
      title: 'Fulfillment progress delayed',
      description,
    };
  }

  if (normalized.includes('awaiting shipment')) {
    return {
      title: 'Shipment awaiting fulfillment',
      description: orderLabel
        ? `${orderLabel} is waiting for shipment progress.`
        : 'An order is waiting for shipment progress.',
    };
  }

  if (normalized.includes('return-request') || (normalized.includes('return') && normalized.includes('refund'))) {
    return {
      title: 'Return review requested',
      description: normalized.includes('refund')
        ? 'A return request is awaiting refund review.'
        : 'A return request is awaiting operational review.',
    };
  }

  if (normalized.includes('shipping cost') || normalized.includes('shipping_cost')) {
    return {
      title: 'Shipping cost review needed',
      description: 'External-provider shipping cost is missing from the operational record.',
    };
  }

  if (normalized.includes('refund') && normalized.includes('webhook') && normalized.includes('processed')) {
    return {
      title: 'Refund processed',
      description: 'Refund event processing completed successfully.',
    };
  }

  if (normalized.includes('automation') && (normalized.includes('signal') || normalized.includes('rule'))) {
    return {
      title: 'Automation issue group',
      description: 'Automation signals are grouped for operational review.',
    };
  }

  const title = sanitizeOperationalText(rawTitle || formatOperationalSource(rawSource) || 'Operational event');
  const description = sanitizeOperationalText(rawDescription || 'Operational context recorded.');

  return {
    title: title && !hasInternalIdentifier(title) ? title : 'Operational event',
    description: description && !hasInternalIdentifier(description) ? description : 'Operational context recorded.',
  };
}
