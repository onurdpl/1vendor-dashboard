import type { FastifyReply, FastifyRequest } from 'fastify';

const DEFAULT_LIMIT_PER_MINUTE = 120;
const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

function readLimitPerMinute() {
  const configured = Number.parseInt(process.env.VENDOR_INTEGRATION_RATE_LIMIT_PER_MINUTE ?? '', 10);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_LIMIT_PER_MINUTE;
  }

  return configured;
}

function readIp(request: FastifyRequest) {
  return (
    request.ip ||
    String(request.headers['x-forwarded-for'] ?? '')
      .split(',')[0]
      .trim() ||
    'unknown'
  );
}

function consumeRateLimit(key: string, now = Date.now()) {
  const limit = readLimitPerMinute();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + WINDOW_MS,
    });
    return { allowed: true, limit };
  }

  if (existing.count >= limit) {
    return { allowed: false, limit };
  }

  existing.count += 1;
  return { allowed: true, limit };
}

function sendRateLimitExceeded(reply: FastifyReply) {
  return reply.code(429).send({ message: 'Rate limit exceeded.' });
}

export function resetVendorIntegrationRateLimitForTests() {
  buckets.clear();
}

export async function rateLimitVendorIntegrationClient(request: FastifyRequest, reply: FastifyReply) {
  const clientId = request.vendorIntegration?.clientId;
  if (!clientId) {
    return;
  }

  const result = consumeRateLimit(`client:${clientId}`);
  if (!result.allowed) {
    return sendRateLimitExceeded(reply);
  }
}

export function rateLimitInvalidVendorIntegrationAttempt(request: FastifyRequest, reply: FastifyReply) {
  const result = consumeRateLimit(`ip:${readIp(request)}`);
  if (!result.allowed) {
    return sendRateLimitExceeded(reply);
  }
}
