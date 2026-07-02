import { createHmac, timingSafeEqual } from 'node:crypto';

function toBase64Buffer(value: string) {
  try {
    return Buffer.from(value, 'base64');
  } catch {
    return null;
  }
}

export function verifyShopifyWebhookHmac(
  rawBody: string | Buffer,
  hmacHeader: string | null,
  secret: string,
): boolean {
  if (!hmacHeader) {
    return false;
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
  const expectedBuffer = toBase64Buffer(expected);
  const actualBuffer = toBase64Buffer(hmacHeader);

  if (!expectedBuffer || !actualBuffer || expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function normalizeShopifyShopDomain(value: string | null | undefined) {
  const normalized = value
    ?.trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/g, '')
    .toLowerCase();

  return normalized || null;
}

export function verifyShopifyWebhookShopDomain(input: {
  headerShopDomain: string | null | undefined;
  configuredShopDomain: string | null | undefined;
  nodeEnv: string;
}) {
  const headerShopDomain = normalizeShopifyShopDomain(input.headerShopDomain);
  const configuredShopDomain = normalizeShopifyShopDomain(input.configuredShopDomain);

  if (!configuredShopDomain) {
    return input.nodeEnv === 'production'
      ? {
          ok: false as const,
          reason: 'missing_configured_shop_domain' as const,
          headerShopDomain,
          configuredShopDomain,
        }
      : {
          ok: true as const,
          headerShopDomain,
          configuredShopDomain,
        };
  }

  if (!headerShopDomain) {
    return {
      ok: false as const,
      reason: 'missing_header_shop_domain' as const,
      headerShopDomain,
      configuredShopDomain,
    };
  }

  if (headerShopDomain !== configuredShopDomain) {
    return {
      ok: false as const,
      reason: 'shop_domain_mismatch' as const,
      headerShopDomain,
      configuredShopDomain,
    };
  }

  return {
    ok: true as const,
    headerShopDomain,
    configuredShopDomain,
  };
}
