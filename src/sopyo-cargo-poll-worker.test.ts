import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSopyoCargoPollWorker } from '../backend/src/modules/vendor-integration/sopyo-cargo-poll.service.js';
import { SOPYO_DELIVERY_POLL_INTERVAL_MS } from '../backend/src/modules/vendor-integration/sopyo-delivery-poll.service.js';

afterEach(() => { vi.useRealTimers(); });

describe('Sopyo cargo polling scheduler', () => {
  it('uses the existing 30-minute opt-in cadence, prevents overlapping cycles and stops cleanly', async () => {
    vi.useFakeTimers();
    let finish!: (value: never) => void;
    const first = new Promise<never>((resolve) => { finish = resolve; });
    const poll = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ candidateCount: 0 });
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = createSopyoCargoPollWorker({ logger, poll });
    worker.start();
    worker.start();
    await vi.advanceTimersByTimeAsync(SOPYO_DELIVERY_POLL_INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SOPYO_DELIVERY_POLL_INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(1);
    let closed = false;
    const closing = worker.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    finish({ candidateCount: 0 } as never);
    await closing;
    await vi.advanceTimersByTimeAsync(SOPYO_DELIVERY_POLL_INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('continues a later cycle after a safe poll failure', async () => {
    vi.useFakeTimers();
    const poll = vi.fn().mockRejectedValueOnce(new Error('secret')).mockResolvedValue({ candidateCount: 0 });
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = createSopyoCargoPollWorker({ logger, poll });
    worker.start();
    await vi.advanceTimersByTimeAsync(SOPYO_DELIVERY_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(SOPYO_DELIVERY_POLL_INTERVAL_MS);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith({ category: 'POLL_FAILED' }, 'Sopyo cargo polling failed.');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret');
    await worker.close();
  });
});
