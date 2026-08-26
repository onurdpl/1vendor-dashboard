import type { FastifyInstance } from 'fastify';

type ShutdownSignal = 'SIGTERM' | 'SIGINT';

type SignalTarget = {
  on(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
};

export function registerGracefulShutdownHandlers(input: {
  app: Pick<FastifyInstance, 'close' | 'log'>;
  signalTarget?: SignalTarget;
}) {
  const signalTarget = input.signalTarget ?? process;
  let shutdownPromise: Promise<void> | null = null;

  const shutdown = (signal: ShutdownSignal) => {
    if (!shutdownPromise) {
      input.app.log.info({ event: 'BACKEND_SHUTDOWN_STARTED', signal }, 'Backend graceful shutdown started.');
      shutdownPromise = input.app.close().catch((error: unknown) => {
        input.app.log.error(
          { event: 'BACKEND_SHUTDOWN_FAILED', signal, error },
          'Backend graceful shutdown failed.',
        );
        process.exitCode = 1;
      });
    }
    return shutdownPromise;
  };

  const onSigterm = () => { void shutdown('SIGTERM'); };
  const onSigint = () => { void shutdown('SIGINT'); };
  signalTarget.on('SIGTERM', onSigterm);
  signalTarget.on('SIGINT', onSigint);

  return {
    shutdown,
    dispose() {
      signalTarget.off('SIGTERM', onSigterm);
      signalTarget.off('SIGINT', onSigint);
    },
    getShutdownPromise: () => shutdownPromise,
  };
}
