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
