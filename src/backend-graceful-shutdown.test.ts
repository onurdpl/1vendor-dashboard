import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { registerGracefulShutdownHandlers } from '../backend/src/runtime/graceful-shutdown.js';

describe('backend graceful shutdown coordination', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)('%s initiates and awaits app.close', async (signal) => {
    const signals = new EventEmitter();
    let resolveClose!: () => void;
    const close = vi.fn(() => new Promise<void>((resolve) => { resolveClose = resolve; }));
    const coordinator = registerGracefulShutdownHandlers({
      app: { close, log: { info: vi.fn(), error: vi.fn() } } as never,
      signalTarget: signals as never,
    });

    signals.emit(signal);
    expect(close).toHaveBeenCalledTimes(1);
    expect(coordinator.getShutdownPromise()).toBeInstanceOf(Promise);
    resolveClose();
    await coordinator.getShutdownPromise();
    coordinator.dispose();
  });

  it('keeps repeated shutdown signals idempotent', async () => {
    const signals = new EventEmitter();
    const close = vi.fn().mockResolvedValue(undefined);
    const coordinator = registerGracefulShutdownHandlers({
      app: { close, log: { info: vi.fn(), error: vi.fn() } } as never,
      signalTarget: signals as never,
    });

    signals.emit('SIGTERM');
    signals.emit('SIGINT');
    signals.emit('SIGTERM');
    await coordinator.getShutdownPromise();
    expect(close).toHaveBeenCalledTimes(1);
    coordinator.dispose();
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    expect(signals.listenerCount('SIGINT')).toBe(0);
  });
});
