type LoginRateLimitConfig = {
  maxAttempts: number;
  windowSeconds: number;
};

type LoginRateLimitState = {
  count: number;
  resetAtMs: number;
};

const loginRateLimitBuckets = new Map<string, LoginRateLimitState>();

export function normalizeLoginRateLimitEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeIp(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'unknown';
}

function buildBucketKey(ip: unknown, email: unknown) {
  return `${normalizeIp(ip)}:${normalizeLoginRateLimitEmail(email)}`;
}

function getActiveBucket(key: string, nowMs: number, windowMs: number) {
  const existing = loginRateLimitBuckets.get(key);
  if (!existing || existing.resetAtMs <= nowMs) {
    return { count: 0, resetAtMs: nowMs + windowMs };
  }

  return existing;
}

function buildLimitStatus(bucket: LoginRateLimitState, maxAttempts: number, nowMs: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAtMs - nowMs) / 1000));
  return {
    limited: bucket.count >= maxAttempts,
    remaining: Math.max(0, maxAttempts - bucket.count),
    resetAtMs: bucket.resetAtMs,
    retryAfterSeconds,
  };
}

export function checkLoginRateLimit(
  input: { ip?: string; email?: unknown; nowMs?: number },
  config: LoginRateLimitConfig,
) {
  const nowMs = input.nowMs ?? Date.now();
  const windowMs = Math.max(1, config.windowSeconds) * 1000;
  const maxAttempts = Math.max(1, config.maxAttempts);
  const key = buildBucketKey(input.ip, input.email);
  const bucket = getActiveBucket(key, nowMs, windowMs);

  return buildLimitStatus(bucket, maxAttempts, nowMs);
}

export function recordFailedLoginRateLimitAttempt(
  input: { ip?: string; email?: unknown; nowMs?: number },
  config: LoginRateLimitConfig,
) {
  const nowMs = input.nowMs ?? Date.now();
  const windowMs = Math.max(1, config.windowSeconds) * 1000;
  const maxAttempts = Math.max(1, config.maxAttempts);
  const key = buildBucketKey(input.ip, input.email);
  const bucket = getActiveBucket(key, nowMs, windowMs);
  bucket.count += 1;
  loginRateLimitBuckets.set(key, bucket);

  return buildLimitStatus(bucket, maxAttempts, nowMs);
}

export function resetLoginRateLimit(input?: { ip?: string; email?: unknown }) {
  if (!input) {
    loginRateLimitBuckets.clear();
    return;
  }

  loginRateLimitBuckets.delete(buildBucketKey(input.ip, input.email));
}

export function resetLoginRateLimitForTests() {
  resetLoginRateLimit();
}
