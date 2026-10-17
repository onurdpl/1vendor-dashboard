import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerSettlementAutoApprovalScheduler } from
  '../backend/src/modules/finance/settlement-auto-approval-scheduler.service.js';

function appFixture() {
  let close: ((_instance: FastifyInstance, done: () => void) => void) | undefined;
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    app: { log, addHook: vi.fn((name: string, hook: typeof close) => {
      if (name === 'onClose') close = hook;
    }) } as unknown as FastifyInstance,
    log,
    close: () => close?.({} as FastifyInstance, () => undefined),
  };
}

const emptySweep = { reconciliations: [], reconciliationErrors: [], vendors: [], vendorErrors: [], skippedVendors: [] };
afterEach(() => vi.useRealTimers());

describe('gated five-minute automatic settlement approval scheduler', () => {
  it('does not install a timer or run while disabled', async () => {
    vi.useFakeTimers();
    const { app, close } = appFixture();
    const runSweep = vi.fn().mockResolvedValue(emptySweep);
    expect(registerSettlementAutoApprovalScheduler(app,
      { SETTLEMENT_AUTO_APPROVAL_SCHEDULER_ENABLED: false }, { runSweep })).toBeNull();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(runSweep).not.toHaveBeenCalled();
    close();
  });

  it('runs only after five minutes, repeats at five-minute intervals and stops on shutdown', async () => {
    vi.useFakeTimers();
    const { app, log, close } = appFixture();
    const runSweep = vi.fn().mockResolvedValue(emptySweep);
    const env = { SETTLEMENT_AUTO_APPROVAL_SCHEDULER_ENABLED: true };
    const scheduler = registerSettlementAutoApprovalScheduler(app, env, { runSweep });
    expect(registerSettlementAutoApprovalScheduler(app, env, { runSweep })).toBe(scheduler);
    expect(runSweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(runSweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runSweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(runSweep).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ approved: 0 }), expect.any(String));
    close();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(runSweep).toHaveBeenCalledTimes(2);
    expect(await scheduler!.runTick()).toBeNull();
  });

  it('skips overlapping ticks but can run at the next regular interval', async () => {
    vi.useFakeTimers();
    const { app, log, close } = appFixture();
    let finish!: (value: typeof emptySweep) => void;
    const pending = new Promise<typeof emptySweep>((resolve) => { finish = resolve; });
    const runSweep = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(emptySweep);
    registerSettlementAutoApprovalScheduler(app,
      { SETTLEMENT_AUTO_APPROVAL_SCHEDULER_ENABLED: true }, { runSweep });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(runSweep).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalled();
    finish(emptySweep);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(runSweep).toHaveBeenCalledTimes(2);
    close();
  });

  it('reports a failed tick without leaking its error or claiming success', async () => {
    vi.useFakeTimers();
    const { app, log, close } = appFixture();
    const runSweep = vi.fn().mockRejectedValue(new Error('private financial detail'));
    const recordError = vi.fn().mockResolvedValue(true);
    registerSettlementAutoApprovalScheduler(app,
      { SETTLEMENT_AUTO_APPROVAL_SCHEDULER_ENABLED: true }, { runSweep, recordError });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(log.error).toHaveBeenCalledWith({ errorType: 'Error' }, expect.any(String));
    expect(recordError).toHaveBeenCalledWith(expect.objectContaining({ phase: 'SCHEDULER_SWEEP',
      category: 'UNEXPECTED_SWEEP_FAILURE' }), false);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('private financial detail');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(recordError).toHaveBeenCalledTimes(2);
    close();
  });
});
