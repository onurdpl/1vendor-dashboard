import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const SENSITIVE_PAYMENT_KEY_PATTERN =
  /authorization|cookie|csrf|password|secret|token|api[_-]?key|merchantuser|merchantpassword|card|cvv|cvc|pan|holder|email|phone|address/i;

type RequestInputMetadata = {
  keyCount: number;
  sensitiveKeyCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toMetadata(value: unknown): RequestInputMetadata {
  if (!isRecord(value)) {
    return {
      keyCount: 0,
      sensitiveKeyCount: 0,
    };
  }

  const keys = Object.keys(value);

  return {
    keyCount: keys.length,
    sensitiveKeyCount: keys.filter((key) => SENSITIVE_PAYMENT_KEY_PATTERN.test(key)).length,
  };
}

async function handleParatikaPaymentReturn(request: FastifyRequest, reply: FastifyReply) {
  const query = toMetadata(request.query);
  const body = toMetadata(request.body);

  request.log.info(
    {
      provider: 'PARATIKA',
      route: '/payments/paratika/return',
      method: request.method,
      queryKeyCount: query.keyCount,
      bodyKeyCount: body.keyCount,
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
