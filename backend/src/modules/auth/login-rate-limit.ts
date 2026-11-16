type LoginRateLimitConfig = {
  maxAttempts: number;
  windowSeconds: number;
};

type LoginRateLimitIdentity = { ip?: string; email?: unknown };
type LoginAttemptOutcome = 'failure' | 'success' | 'exception';

type FailureWindow = {
  count: number;
  resetAtMs: number | null;
};

type LoginBucket = {
  window: FailureWindow;
  inFlight: number;
};

const loginRateLimitBuckets = new Map<string, LoginBucket>();
const CLEANUP_INTERVAL_MS = 1_000;
let cleanupTimer: ReturnType<typeof setInterval> | undefined;

export function normalizeLoginRateLimitEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeIp(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'unknown';
}

function buildBucketKey(ip: unknown, email: unknown) {
  return `${normalizeIp(ip)}:${normalizeLoginRateLimitEmail(email)}`;
}

function emptyWindow(): FailureWindow {
  return { count: 0, resetAtMs: null };
}

function expireWindow(bucket: LoginBucket, nowMs: number) {
  const { resetAtMs } = bucket.window;
  if (resetAtMs !== null && resetAtMs <= nowMs) {
    bucket.window = emptyWindow();
  }
}

function stopCleanupIfIdle() {
  if (loginRateLimitBuckets.size === 0 && cleanupTimer !== undefined) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
}

function removeIdleBucket(key: string, bucket: LoginBucket) {
  if (bucket.inFlight === 0 && bucket.window.count === 0) {
    loginRateLimitBuckets.delete(key);
  }
}

function startCleanup() {
  if (cleanupTimer !== undefined) return;
  cleanupTimer = setInterval(() => {
    const nowMs = Date.now();
    for (const [key, bucket] of loginRateLimitBuckets) {
      expireWindow(bucket, nowMs);
      removeIdleBucket(key, bucket);
    }
    stopCleanupIfIdle();
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

export function reserveLoginRateLimitAttempt(identity: LoginRateLimitIdentity, config: LoginRateLimitConfig) {
  const key = buildBucketKey(identity.ip, identity.email);
  const nowMs = Date.now();
  const windowMs = Math.max(1, config.windowSeconds) * 1_000;
  let bucket = loginRateLimitBuckets.get(key);
  if (!bucket) {
    bucket = { window: emptyWindow(), inFlight: 0 };
    loginRateLimitBuckets.set(key, bucket);
    startCleanup();
  }
  expireWindow(bucket, nowMs);
  const window = bucket.window;
  const maxAttempts = Math.max(1, config.maxAttempts);
  if (window.count + bucket.inFlight >= maxAttempts) {
    // A full in-flight budget without a failure window has no reset time.
    // In that case, let the caller check again in one second.
    const resetAtMs = window.resetAtMs ?? nowMs + 1_000;
    return {
      limited: true as const,
      resetAtMs,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - nowMs) / 1_000)),
    };
  }

  const reservedBucket = bucket;
  reservedBucket.inFlight++;
  let finished = false;
  return {
    limited: false as const,
    finish(outcome: LoginAttemptOutcome) {
      if (finished) return;
      finished = true;
      if (loginRateLimitBuckets.get(key) !== reservedBucket) return;

      const completedAtMs = Date.now();
      reservedBucket.inFlight--;
      expireWindow(reservedBucket, completedAtMs);

      // Old requests still occupy admission capacity until completion, but
      // their results cannot change a window that expired or was reset.
      if (reservedBucket.window === window) {
        if (outcome === 'failure') {
          window.resetAtMs ??= completedAtMs + windowMs;
          window.count++;
        } else if (outcome === 'success' && window.count !== 0) {
          reservedBucket.window = emptyWindow();
        }
      }
      removeIdleBucket(key, reservedBucket);
      stopCleanupIfIdle();
    },
  };
}

export function resetLoginRateLimit(identity: LoginRateLimitIdentity) {
  const key = buildBucketKey(identity.ip, identity.email);
  const bucket = loginRateLimitBuckets.get(key);
  if (bucket) {
    bucket.window = emptyWindow();
    removeIdleBucket(key, bucket);
    stopCleanupIfIdle();
  }
}

export function resetLoginRateLimitForTests() {
  loginRateLimitBuckets.clear();
  stopCleanupIfIdle();
}
