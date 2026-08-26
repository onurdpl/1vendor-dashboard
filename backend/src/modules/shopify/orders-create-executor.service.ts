import type { FastifyInstance } from 'fastify';
import type { WebhookEvent } from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import {
  mirrorOrdersCreateExecutorJob,
  runBestEffortOperationalJobMutation,
  type OrdersCreateExecutorJobState,
} from '../operational-jobs/operational-jobs.service.js';
import type { OrderIngestionFailureResult, ShopifyOrdersCreateWebhookPayload } from './order-ingestion.types.js';
import {
  claimDueFailedOrdersCreateEvent,
  claimDueReceivedOrdersCreateEvent,
  claimExpiredProcessingOrdersCreateEvent,
  createOrdersCreateFencedExecutionContext,
  discoverOrdersCreateExecutionCandidates,
  fenceExpiredExhaustedOrdersCreateEvent,
  finalizeRetryableOrdersCreateFailureWithState,
  finalizeTerminalOrdersCreateFailure,
  heartbeatOrdersCreateOwnership,
  isOrdersCreateLostFenceError,
  OrdersCreateLostFenceError,
  type OrdersCreateExecutionCandidate,
  type OrdersCreateFencedClaimResult,
} from './orders-create-ownership.service.js';
import {
  createOrdersCreateProcessingService,
  prepareOrdersCreatePayload,
} from './orders-create-processing.service.js';

type ExecutorLogger = Pick<FastifyInstance['log'], 'info' | 'warn' | 'error'>;

type OrdersCreateProcessingService = ReturnType<typeof createOrdersCreateProcessingService>;

type ExecutorDependencies = {
  discoverCandidates?: typeof discoverOrdersCreateExecutionCandidates;
  claimReceived?: typeof claimDueReceivedOrdersCreateEvent;
  claimFailed?: typeof claimDueFailedOrdersCreateEvent;
  claimExpired?: typeof claimExpiredProcessingOrdersCreateEvent;
  fenceExhausted?: typeof fenceExpiredExhaustedOrdersCreateEvent;
  heartbeat?: typeof heartbeatOrdersCreateOwnership;
  finalizeRetryable?: typeof finalizeRetryableOrdersCreateFailureWithState;
  finalizeTerminal?: typeof finalizeTerminalOrdersCreateFailure;
  mirrorJob?: typeof mirrorOrdersCreateExecutorJob;
  processingService?: OrdersCreateProcessingService;
};

export type OrdersCreateExecutorCycleSummary = {
  candidateCount: number;
  claimWins: number;
  claimLosses: number;
  processed: number;
  retryScheduled: number;
  deadLetter: number;
  errors: number;
  cycleDurationMs: number;
};

type AttemptOutcome =
  | 'processed'
  | 'retry_scheduled'
  | 'dead_letter'
  | 'terminal_failure'
  | 'lost_fence'
  | 'shutdown_aborted';

type ActiveAttempt = {
  eventId: string;
  controller: AbortController;
  stopHeartbeat: () => Promise<void>;
  promise: Promise<AttemptOutcome>;
};

function emptySummary(): OrdersCreateExecutorCycleSummary {
  return {
    candidateCount: 0,
    claimWins: 0,
    claimLosses: 0,
    processed: 0,
    retryScheduled: 0,
    deadLetter: 0,
    errors: 0,
    cycleDurationMs: 0,
  };
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown executor failure.');
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The orders/create executor attempt was aborted.', 'AbortError');
}

function terminalJobState(failure: OrderIngestionFailureResult): OrdersCreateExecutorJobState {
  return failure.failureCategory === 'permanent' ? 'permanently_failed' : 'failed';
}

export function getOrdersCreateExecutorRequestTimeoutMs(leaseMs: number) {
  return Math.max(1, Math.floor(leaseMs / 2));
}

export function createOrdersCreateExecutor(input: {
  env: AppEnv;
  logger: ExecutorLogger;
  dependencies?: ExecutorDependencies;
}) {
  const dependencies = input.dependencies ?? {};
  const discoverCandidates = dependencies.discoverCandidates ?? discoverOrdersCreateExecutionCandidates;
  const claimReceived = dependencies.claimReceived ?? claimDueReceivedOrdersCreateEvent;
  const claimFailed = dependencies.claimFailed ?? claimDueFailedOrdersCreateEvent;
  const claimExpired = dependencies.claimExpired ?? claimExpiredProcessingOrdersCreateEvent;
  const fenceExhausted = dependencies.fenceExhausted ?? fenceExpiredExhaustedOrdersCreateEvent;
  const heartbeat = dependencies.heartbeat ?? heartbeatOrdersCreateOwnership;
  const finalizeRetryable = dependencies.finalizeRetryable ?? finalizeRetryableOrdersCreateFailureWithState;
  const finalizeTerminal = dependencies.finalizeTerminal ?? finalizeTerminalOrdersCreateFailure;
  const mirrorJob = dependencies.mirrorJob ?? mirrorOrdersCreateExecutorJob;
  const processingService = dependencies.processingService ?? createOrdersCreateProcessingService({
    env: input.env,
    logger: input.logger,
  });
  const intervalMs = input.env.SHOPIFY_ORDERS_CREATE_EXECUTOR_INTERVAL_MS ?? 2_000;
  const batchSize = input.env.SHOPIFY_ORDERS_CREATE_EXECUTOR_BATCH_SIZE ?? 5;
  const leaseMs = input.env.SHOPIFY_ORDERS_CREATE_LEASE_MS ?? 60_000;
  const heartbeatMs = input.env.SHOPIFY_ORDERS_CREATE_HEARTBEAT_MS ?? 10_000;
  const requestTimeoutMs = getOrdersCreateExecutorRequestTimeoutMs(leaseMs);
  let interval: ReturnType<typeof globalThis.setInterval> | null = null;
  let running = false;
  let stopping = false;
  let closePromise: Promise<void> | null = null;
  let activeAttempt: ActiveAttempt | null = null;

  async function mirror(inputMirror: Parameters<typeof mirrorOrdersCreateExecutorJob>[0]) {
    await runBestEffortOperationalJobMutation(
      () => mirrorJob(inputMirror),
      (error) => input.logger.warn(
        {
          event: 'SHOPIFY_ORDERS_CREATE_EXECUTOR_JOB_MIRROR_FAILED',
          webhookEventId: inputMirror.webhookEventId,
          state: inputMirror.state,
          errorMessage: safeErrorMessage(error),
        },
        'Shopify orders/create executor job metadata mirror failed.',
      ),
    );
  }

  function claim(candidate: OrdersCreateExecutionCandidate): Promise<OrdersCreateFencedClaimResult> {
    if (candidate.kind === 'RECEIVED') {
      return claimReceived(candidate.event.id, leaseMs);
    }
    if (candidate.kind === 'FAILED') {
      return claimFailed(candidate.event.id, leaseMs);
    }
    return claimExpired(candidate.event.id, leaseMs);
  }

  function createHeartbeatRuntime(
    context: ReturnType<typeof createOrdersCreateFencedExecutionContext>,
    controller: AbortController,
  ) {
    let stopped = false;
    let inFlight: Promise<void> | null = null;
    let lostFence: Error | null = null;

    const pulse = () => {
      if (stopped || inFlight) return;
      inFlight = heartbeat(context, leaseMs)
        .then(() => undefined)
        .catch((error: unknown) => {
          if (stopped) return;
          lostFence = isOrdersCreateLostFenceError(error)
            ? error
            : new OrdersCreateLostFenceError('Shopify orders/create heartbeat failed; ownership is no longer safe.');
          input.logger.warn(
            {
              event: 'SHOPIFY_ORDERS_CREATE_EXECUTOR_HEARTBEAT_FAILED',
              webhookEventId: context.webhookEventId,
              generation: context.processingGeneration,
              errorMessage: safeErrorMessage(error),
            },
            'Shopify orders/create executor heartbeat failed.',
          );
          controller.abort(lostFence);
        })
        .finally(() => {
          inFlight = null;
        });
    };

    const timer = globalThis.setInterval(pulse, heartbeatMs);
    timer.unref?.();

    return {
      get lostFence() {
        return lostFence;
      },
      async stop() {
        stopped = true;
        globalThis.clearInterval(timer);
        await inFlight;
      },
    };
  }

  async function executeClaimedAttempt(
    event: WebhookEvent,
    ownership: Extract<OrdersCreateFencedClaimResult, { acquired: true }>['ownership'],
  ): Promise<AttemptOutcome> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const baseContext = createOrdersCreateFencedExecutionContext(ownership, controller.signal);
    const context = {
      ...baseContext,
      shopifyAdminRequestTimeoutMs: requestTimeoutMs,
    };
    const heartbeatRuntime = createHeartbeatRuntime(context, controller);
    let finalizationStarted = false;
    let attemptResult: AttemptOutcome | 'error' = 'error';
    const recordOutcome = (outcome: AttemptOutcome) => {
      attemptResult = outcome;
      return outcome;
    };

    const attemptPromise = (async (): Promise<AttemptOutcome> => {
      try {
        const prepared = prepareOrdersCreatePayload({
          event,
          incomingPayload: { id: ownership.sourceShopifyOrderId! } as ShopifyOrdersCreateWebhookPayload,
          retainedSnapshotMode: true,
        });
        if (!prepared.ok) {
          await heartbeatRuntime.stop();
          finalizationStarted = true;
          await finalizeTerminal(context, new Error(prepared.message));
          await mirror({
            webhookEventId: event.id,
            sourceShopifyOrderId: ownership.sourceShopifyOrderId!,
            state: 'failed',
            attemptCount: ownership.executionAttemptCount,
            maxAttempts: ownership.executionMaxAttempts,
            error: prepared.message,
          });
          return recordOutcome('terminal_failure');
        }

        const result = await processingService.process({
          event,
          payload: prepared.payload,
          mode: 'missing_order_only',
          executionContext: context,
        });
        await heartbeatRuntime.stop();

        if (heartbeatRuntime.lostFence) {
          throw heartbeatRuntime.lostFence;
        }
        if (controller.signal.aborted) {
          throw abortReason(controller.signal);
        }

        if (result.ok) {
          await mirror({
            webhookEventId: event.id,
            sourceShopifyOrderId: ownership.sourceShopifyOrderId!,
            state: 'completed',
            attemptCount: ownership.executionAttemptCount,
            maxAttempts: ownership.executionMaxAttempts,
          });
          return recordOutcome('processed');
        }

        if (result.failureDisposition === 'RETRYABLE') {
          finalizationStarted = true;
          const finalized = await finalizeRetryable(context, new Error(result.error));
          const retryScheduled = finalized.executionAvailableAt !== null;
          await mirror({
            webhookEventId: event.id,
            sourceShopifyOrderId: ownership.sourceShopifyOrderId!,
            state: retryScheduled ? 'retry_scheduled' : 'dead_letter_ready',
            attemptCount: finalized.executionAttemptCount,
            maxAttempts: finalized.executionMaxAttempts,
            nextRetryAt: finalized.executionAvailableAt,
            error: result.error,
          });
          return recordOutcome(retryScheduled ? 'retry_scheduled' : 'dead_letter');
        }

        finalizationStarted = true;
        await finalizeTerminal(context, new Error(result.error));
        await mirror({
          webhookEventId: event.id,
          sourceShopifyOrderId: ownership.sourceShopifyOrderId!,
          state: terminalJobState(result),
          attemptCount: ownership.executionAttemptCount,
          maxAttempts: ownership.executionMaxAttempts,
          error: result.error,
        });
        return recordOutcome('terminal_failure');
      } catch (error) {
        await heartbeatRuntime.stop();
        if (heartbeatRuntime.lostFence || isOrdersCreateLostFenceError(error)) {
          input.logger.warn(
            {
              event: 'SHOPIFY_ORDERS_CREATE_EXECUTOR_LOST_FENCE',
              webhookEventId: event.id,
              generation: ownership.processingGeneration,
              attemptCount: ownership.executionAttemptCount,
            },
            'Shopify orders/create executor stopped stale ownership.',
          );
          return recordOutcome('lost_fence');
        }
        if (controller.signal.aborted) {
          return recordOutcome('shutdown_aborted');
        }
        if (finalizationStarted) {
          throw error;
        }

        await finalizeTerminal(context, error);
        await mirror({
          webhookEventId: event.id,
          sourceShopifyOrderId: ownership.sourceShopifyOrderId!,
          state: 'failed',
          attemptCount: ownership.executionAttemptCount,
          maxAttempts: ownership.executionMaxAttempts,
          error,
        });
        return recordOutcome('terminal_failure');
      } finally {
        await heartbeatRuntime.stop();
        input.logger.info(
          {
            event: 'SHOPIFY_ORDERS_CREATE_EXECUTOR_ATTEMPT',
            webhookEventId: event.id,
            generation: ownership.processingGeneration,
            attemptCount: ownership.executionAttemptCount,
            result: attemptResult,
            processingDurationMs: Date.now() - startedAt,
          },
          'Shopify orders/create executor attempt finished.',
        );
      }
    })();

    const currentAttempt: ActiveAttempt = {
      eventId: event.id,
      controller,
      stopHeartbeat: heartbeatRuntime.stop,
      promise: attemptPromise,
    };
    activeAttempt = currentAttempt;
    try {
      return await attemptPromise;
    } finally {
      if (activeAttempt === currentAttempt) activeAttempt = null;
    }
  }

  async function processCandidate(candidate: OrdersCreateExecutionCandidate) {
    if (candidate.kind === 'EXHAUSTED_PROCESSING') {
      const fenced = await fenceExhausted(candidate.event.id);
      if (!fenced?.sourceShopifyOrderId) return { claimed: false as const };
      input.logger.warn(
        {
          event: 'SHOPIFY_ORDERS_CREATE_EXECUTOR_EXHAUSTED_STALE_FENCED',
          webhookEventId: fenced.id,
          generation: fenced.processingGeneration,
          attemptCount: fenced.executionAttemptCount,
        },
        'Shopify orders/create exhausted stale ownership was terminalized.',
      );
      await mirror({
        webhookEventId: fenced.id,
        sourceShopifyOrderId: fenced.sourceShopifyOrderId,
        state: 'dead_letter_ready',
        attemptCount: fenced.executionAttemptCount,
        maxAttempts: fenced.executionMaxAttempts,
        error: 'Shopify orders/create automatic execution attempts exhausted.',
      });
      return { claimed: true as const, outcome: 'dead_letter' as const };
    }

    const result = await claim(candidate);
    if (!result.acquired) return { claimed: false as const };
    const state = result.ownership.executionAttemptCount > 1 ? 'retrying' : 'processing';
    await mirror({
      webhookEventId: result.ownership.id,
      sourceShopifyOrderId: result.ownership.sourceShopifyOrderId!,
      state,
      attemptCount: result.ownership.executionAttemptCount,
      maxAttempts: result.ownership.executionMaxAttempts,
    });
    if (candidate.kind === 'EXPIRED_PROCESSING') {
      input.logger.warn(
        {
          event: 'SHOPIFY_ORDERS_CREATE_EXECUTOR_STALE_TAKEOVER',
          webhookEventId: result.ownership.id,
          generation: result.ownership.processingGeneration,
          attemptCount: result.ownership.executionAttemptCount,
        },
        'Shopify orders/create executor acquired an expired lease.',
      );
    }
    return {
      claimed: true as const,
      outcome: await executeClaimedAttempt(candidate.event, result.ownership),
    };
  }

  async function runCycle(): Promise<OrdersCreateExecutorCycleSummary> {
    if (running || stopping) return emptySummary();
    running = true;
    const startedAt = Date.now();
    const summary = emptySummary();
    try {
      const candidates = await discoverCandidates(batchSize);
      summary.candidateCount = candidates.length;
      for (const candidate of candidates) {
        if (stopping) break;
        try {
          const result = await processCandidate(candidate);
          if (!result.claimed) {
            summary.claimLosses += 1;
            continue;
          }
          summary.claimWins += 1;
          if (result.outcome === 'processed') summary.processed += 1;
          if (result.outcome === 'retry_scheduled') summary.retryScheduled += 1;
          if (result.outcome === 'dead_letter') summary.deadLetter += 1;
          if (result.outcome === 'terminal_failure') summary.errors += 1;
        } catch (error) {
          summary.errors += 1;
          input.logger.error(
            {
              event: 'SHOPIFY_ORDERS_CREATE_EXECUTOR_CANDIDATE_FAILED',
              webhookEventId: candidate.event.id,
              errorMessage: safeErrorMessage(error),
            },
            'Shopify orders/create executor candidate failed.',
          );
        }
      }
    } catch (error) {
      summary.errors += 1;
      input.logger.error(
        {
          event: 'SHOPIFY_ORDERS_CREATE_EXECUTOR_DISCOVERY_FAILED',
          errorMessage: safeErrorMessage(error),
        },
        'Shopify orders/create executor discovery failed.',
      );
    } finally {
      running = false;
      summary.cycleDurationMs = Date.now() - startedAt;
      input.logger.info(
        { event: 'SHOPIFY_ORDERS_CREATE_EXECUTOR_CYCLE', ...summary },
        'Shopify orders/create executor cycle completed.',
      );
    }
    return summary;
  }

  function start() {
    if (interval || stopping) return;
    interval = globalThis.setInterval(() => {
      void runCycle();
    }, intervalMs);
    interval.unref?.();
    void runCycle();
  }

  async function close() {
    if (closePromise) return closePromise;
    stopping = true;
    if (interval) {
      globalThis.clearInterval(interval);
      interval = null;
    }
    closePromise = (async () => {
      const attempt = activeAttempt;
      if (!attempt) return;
      let drainTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
      const drained = await Promise.race([
        attempt.promise.then(() => true),
        new Promise<boolean>((resolve) => {
          drainTimer = globalThis.setTimeout(() => resolve(false), leaseMs);
          drainTimer.unref?.();
        }),
      ]);
      if (drainTimer) globalThis.clearTimeout(drainTimer);
      if (drained) return;
      attempt.controller.abort(new DOMException('Executor shutdown drain deadline expired.', 'AbortError'));
      await attempt.stopHeartbeat();
      input.logger.warn(
        {
          event: 'SHOPIFY_ORDERS_CREATE_EXECUTOR_DRAIN_EXPIRED',
          webhookEventId: attempt.eventId,
          drainTimeoutMs: leaseMs,
        },
        'Shopify orders/create executor drain deadline expired.',
      );
    })();
    return closePromise;
  }

  return {
    start,
    runCycle,
    close,
    isRunning: () => running,
    isStopping: () => stopping,
    hasActiveAttempt: () => activeAttempt !== null,
  };
}

export function registerOrdersCreateExecutor(app: FastifyInstance, env: AppEnv) {
  if (!env.SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED || !env.DATABASE_URL) return null;
  const executor = createOrdersCreateExecutor({ env, logger: app.log });
  app.addHook('onReady', async () => {
    executor.start();
  });
  app.addHook('onClose', async () => {
    await executor.close();
  });
  return executor;
}
