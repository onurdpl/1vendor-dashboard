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

export function checkLoginRateLimit(
  input: { ip?: string; email?: unknown; nowMs?: number },
  config: LoginRateLimitConfig,
) {
  const nowMs = input.nowMs ?? Date.now();
  const windowMs = Math.max(1, config.windowSeconds) * 1000;
  const maxAttempts = Math.max(1, config.maxAttempts);
  const key = buildBucketKey(input.ip, input.email);
  const existing = loginRateLimitBuckets.get(key);
  const bucket = !existing || existing.resetAtMs <= nowMs
    ? { count: 0, resetAtMs: nowMs + windowMs }
    : existing;

  bucket.count += 1;
  loginRateLimitBuckets.set(key, bucket);

  return {
    limited: bucket.count > maxAttempts,
    remaining: Math.max(0, maxAttempts - bucket.count),
    resetAtMs: bucket.resetAtMs,
  };
}

export function resetLoginRateLimitForTests() {
  loginRateLimitBuckets.clear();
}
