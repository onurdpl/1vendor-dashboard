import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const SENSITIVE_PAYMENT_KEY_PATTERN =
  /authorization|cookie|csrf|password|secret|token|session|api[_-]?key|merchantuser|merchantpassword|card|cvv|cvc|pan|holder|email|phone|address/i;
const TOKEN_LIKE_PAYMENT_VALUE_PATTERN =
  /((?:access|refresh|session)[_-]?token|token|password|secret|merchantpassword|merchantuser)\s*[:=]\s*[^&\s,}]+/gi;
const CARD_LIKE_PAYMENT_VALUE_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const SAFE_VALUE_MAX_LENGTH = 160;

type RequestInputMetadata = {
  keyCount: number;
  sensitiveKeyCount: number;
  keys: string[];
  safeValues: Record<string, string | string[]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toMetadata(value: unknown): RequestInputMetadata {
  if (!isRecord(value)) {
    return {
      keyCount: 0,
      sensitiveKeyCount: 0,
      keys: [],
      safeValues: {},
    };
  }

  const keys = Object.keys(value);

  return {
    keyCount: keys.length,
    sensitiveKeyCount: keys.filter((key) => SENSITIVE_PAYMENT_KEY_PATTERN.test(key)).length,
    keys,
    safeValues: Object.fromEntries(keys.map((key) => [key, sanitizePaymentReturnValue(key, value[key])])),
  };
}

function sanitizePaymentReturnString(key: string, value: string) {
  if (SENSITIVE_PAYMENT_KEY_PATTERN.test(key)) {
    return '[redacted]';
  }

  const sanitized = value
    .replace(TOKEN_LIKE_PAYMENT_VALUE_PATTERN, '$1=[redacted]')
    .replace(CARD_LIKE_PAYMENT_VALUE_PATTERN, '[redacted]')
    .slice(0, SAFE_VALUE_MAX_LENGTH);
  return sanitized || '';
}

function sanitizePaymentReturnValue(key: string, value: unknown): string | string[] {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePaymentReturnString(key, String(item ?? '')));
  }

  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'object') {
    return '[object omitted]';
  }

  return sanitizePaymentReturnString(key, String(value));
}

function readFirstSafeValue(...metadata: RequestInputMetadata[]) {
  const names = ['responseCode', 'RESPONSECODE', 'status', 'STATUS', 'paymentStatus', 'PAYMENTSTATUS', 'responseMsg', 'RESPONSEMSG'];
  for (const name of names) {
    for (const source of metadata) {
      const value = source.safeValues[name];
      if (typeof value === 'string' && value.trim() && value !== '[redacted]') {
        return value.trim();
      }
      if (Array.isArray(value)) {
        const match = value.find((entry) => entry.trim() && entry !== '[redacted]');
        if (match) {
          return match.trim();
        }
      }
    }
  }
  return null;
}

function readFirstSafeReference(...metadata: RequestInputMetadata[]) {
  const names = [
    'merchantPaymentId',
    'MERCHANTPAYMENTID',
    'paymentId',
    'PAYMENTID',
    'orderId',
    'ORDERID',
    'pgTranId',
    'PGTRANID',
    'pgOrderId',
    'PGORDERID',
  ];
  for (const name of names) {
    for (const source of metadata) {
      const value = source.safeValues[name];
      if (typeof value === 'string' && value.trim() && value !== '[redacted]') {
        return value.trim();
      }
      if (Array.isArray(value)) {
        const match = value.find((entry) => entry.trim() && entry !== '[redacted]');
        if (match) {
          return match.trim();
        }
      }
    }
  }
  return null;
}

async function handleParatikaPaymentReturn(request: FastifyRequest, reply: FastifyReply) {
  const query = toMetadata(request.query);
  const body = toMetadata(request.body);
  const receivedStatus = readFirstSafeValue(query, body);
  const receivedReference = readFirstSafeReference(query, body);

  request.log.info(
    {
      provider: 'PARATIKA',
      route: '/payments/paratika/return',
      method: request.method,
      queryKeyCount: query.keyCount,
      bodyKeyCount: body.keyCount,
      queryKeys: query.keys,
      bodyKeys: body.keys,
      querySafeValues: query.safeValues,
      bodySafeValues: body.safeValues,
      receivedStatus,
      receivedReference,
      sensitiveKeyCount: query.sensitiveKeyCount + body.sensitiveKeyCount,
      requestId: request.requestId ?? null,
      paymentStateMutated: false,
      shopifyMutationAttempted: false,
      paratikaApiCallAttempted: false,
    },
    'Paratika payment return placeholder received.',
  );

  return reply.code(202).send({
    ok: true,
    provider: 'PARATIKA',
    message: 'Payment return received. Verification pending.',
    verificationStatus: 'pending',
    receivedStatus,
    receivedReference,
    diagnostics: {
      query: query,
      body: body,
    },
    writesPerformed: false,
    paymentStateMutated: false,
    shopifyMutationAttempted: false,
    paratikaApiCallAttempted: false,
    ignoredParameterCount: query.keyCount + body.keyCount,
  });
}

export function registerPaymentReturnRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body.toString())));
  });

  app.get('/payments/paratika/return', handleParatikaPaymentReturn);
  app.post('/payments/paratika/return', handleParatikaPaymentReturn);
}
