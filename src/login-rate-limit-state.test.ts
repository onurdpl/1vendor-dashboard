import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reserveLoginRateLimitAttempt, resetLoginRateLimitForTests } from '../backend/src/modules/auth/login-rate-limit.js';

const config = { maxAttempts: 2, windowSeconds: 3 };
const first = { ip: '127.0.0.1', email: 'first@example.test' };
const second = { ...first, email: 'second@example.test' };

function admit(identity = first, options = config) {
  const result = reserveLoginRateLimitAttempt(identity, options);
  if (result.limited) throw new Error('Expected the attempt to be admitted');
  return result;
}

describe('login rate-limit state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    resetLoginRateLimitForTests();
    vi.useRealTimers();
  });

  it('cleans unused expired buckets automatically and stops its single timer when idle', () => {
    admit().finish('failure');
    admit(second).finish('failure');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2_999);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(6_000);
    expect(vi.getTimerCount()).toBe(0);
    const reused = admit();
    reused.finish('failure');
    expect(reserveLoginRateLimitAttempt(first, { ...config, maxAttempts: 1 }))
      .toMatchObject({ limited: true, resetAtMs: 12_000, retryAfterSeconds: 3 });
  });

  it('preserves active counters while sweeping earlier expired buckets', () => {
    const options = { ...config, maxAttempts: 1 };
    admit(first, options).finish('failure');
    vi.advanceTimersByTime(1_000);
    admit(second, options).finish('failure');
    vi.advanceTimersByTime(2_000);
    expect(reserveLoginRateLimitAttempt(second, options))
      .toMatchObject({ limited: true, resetAtMs: 4_000, retryAfterSeconds: 1 });
    admit(first, options).finish('exception');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains in-flight occupancy across rollover and ignores stale failure or success', () => {
    admit().finish('failure');
    const oldFailure = admit();
    vi.advanceTimersByTime(3_000);
    const oldSuccess = admit();
    expect(reserveLoginRateLimitAttempt(first, config)).toMatchObject({ limited: true, retryAfterSeconds: 1 });
    oldFailure.finish('failure');
    const fresh = admit();
    fresh.finish('failure');
    oldSuccess.finish('exception');
    // Open a second window with one completed failure and one pending login.
    const delayedSuccess = admit();
    vi.advanceTimersByTime(3_000);
    admit().finish('failure');
    delayedSuccess.finish('success');
    const final = admit();
    final.finish('failure');
    expect(reserveLoginRateLimitAttempt(first, config)).toMatchObject({ limited: true, retryAfterSeconds: 3 });
    vi.advanceTimersByTime(3_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('finishes each reservation once and keeps other reservations after success', () => {
    const failure = admit();
    const other = admit();
    failure.finish('failure');
    failure.finish('failure');
    expect(reserveLoginRateLimitAttempt(first, config)).toMatchObject({ limited: true, retryAfterSeconds: 3 });
    other.finish('success');
    const pending = admit();
    const successful = admit();
    successful.finish('success');
    successful.finish('success');
    const remaining = admit();
    expect(reserveLoginRateLimitAttempt(first, config)).toMatchObject({ limited: true, retryAfterSeconds: 1 });
    remaining.finish('exception');
    pending.finish('failure');
    const last = admit();
    last.finish('success');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('test reset clears the cleanup timer and detaches earlier completions', () => {
    const old = admit();
    expect(vi.getTimerCount()).toBe(1);
    resetLoginRateLimitForTests();
    expect(vi.getTimerCount()).toBe(0);
    const fresh = admit(first, { ...config, maxAttempts: 1 });
    old.finish('failure');
    expect(reserveLoginRateLimitAttempt(first, { ...config, maxAttempts: 1 }))
      .toMatchObject({ limited: true, retryAfterSeconds: 1 });
    fresh.finish('exception');
    expect(vi.getTimerCount()).toBe(0);
  });
});
