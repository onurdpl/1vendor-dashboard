import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerReconciliationRoutes } from '../backend/src/modules/reconciliation/reconciliation.routes.js';

const reconcileAllocationMock = vi.hoisted(() => vi.fn());
const reconcileShopifyOrderMock = vi.hoisted(() => vi.fn());
const reconcileShopifyOrderRefundsMock = vi.hoisted(() => vi.fn());
const reconcileShopifyOrderReturnsMock = vi.hoisted(() => vi.fn());
const reconcileShopifyOrderCancellationMock = vi.hoisted(() => vi.fn());
const runCanonicalReconciliationMock = vi.hoisted(() => vi.fn());
const getLatestCanonicalReconciliationRunMock = vi.hoisted(() => vi.fn());
const createOperationalJobMock = vi.hoisted(() => vi.fn());
const markOperationalJobProcessingMock = vi.hoisted(() => vi.fn());
const markOperationalJobCompletedMock = vi.hoisted(() => vi.fn());
const markOperationalJobFailedMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/reconciliation/reconciliation.service.js', () => ({
  createReconciliationService: vi.fn(() => ({
    reconcileAllocation: reconcileAllocationMock,
    reconcileShopifyOrder: reconcileShopifyOrderMock,
  })),
}));

vi.mock('../backend/src/modules/reconciliation/canonical-refund-reconciliation.service.js', () => ({
  createCanonicalRefundReconciliationService: vi.fn(() => ({
    reconcileShopifyOrderRefunds: reconcileShopifyOrderRefundsMock,
  })),
}));

vi.mock('../backend/src/modules/reconciliation/canonical-return-reconciliation.service.js', () => ({
  createCanonicalReturnReconciliationService: vi.fn(() => ({
    reconcileShopifyOrderReturns: reconcileShopifyOrderReturnsMock,
  })),
}));

vi.mock('../backend/src/modules/reconciliation/canonical-cancellation-reconciliation.service.js', () => ({
  createCanonicalCancellationReconciliationService: vi.fn(() => ({
    reconcileShopifyOrderCancellation: reconcileShopifyOrderCancellationMock,
  })),
}));

vi.mock('../backend/src/modules/reconciliation/canonical-reconciliation-runner.service.js', () => ({
  runCanonicalReconciliation: runCanonicalReconciliationMock,
  getLatestCanonicalReconciliationRun: getLatestCanonicalReconciliationRunMock,
}));

vi.mock('../backend/src/modules/operational-jobs/operational-jobs.service.js', () => ({
  createOperationalJob: createOperationalJobMock,
  markOperationalJobCompleted: markOperationalJobCompletedMock,
  markOperationalJobFailed: markOperationalJobFailedMock,
  markOperationalJobProcessing: markOperationalJobProcessingMock,
}));

describe('reconciliation route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createOperationalJobMock.mockResolvedValue({ id: 'job-1' });
    markOperationalJobProcessingMock.mockResolvedValue(undefined);
    markOperationalJobCompletedMock.mockResolvedValue(undefined);
    markOperationalJobFailedMock.mockResolvedValue(undefined);
    runCanonicalReconciliationMock.mockResolvedValue({
      id: 'canonical-run-1',
      mode: 'dry-run',
      status: 'COMPLETED',
      startedAt: '2026-06-26T03:00:00.000Z',
      finishedAt: '2026-06-26T03:00:08.000Z',
      durationMs: 8000,
      lookbackDays: 3,
      orderLimit: 500,
      ordersScanned: 10,
      repairOpportunities: 2,
      wouldRepairOrders: 1,
      wouldRepairFulfillment: 0,
      wouldRepairRefunds: 1,
      wouldRepairReturns: 0,
      wouldRepairCancellations: 0,
      wouldCreateSignals: 0,
      wouldRepairLedgers: 1,
      wouldRepairFinanceEvents: 1,
      errors: [],
      perOrderDetails: [],
    });
    getLatestCanonicalReconciliationRunMock.mockResolvedValue({
      id: 'canonical-run-1',
      mode: 'dry-run',
      status: 'COMPLETED',
    });
  });

  it('wires admin canonical Shopify refund reconciliation route', async () => {
    reconcileShopifyOrderRefundsMock.mockResolvedValueOnce({
      shopifyOrderId: 'order-1',
      refundsFetched: 1,
      refundsAlreadyPresent: 0,
      refundsCreated: 1,
      ledgersRepaired: 1,
      eventsRepaired: 4,
      skippedCount: 0,
      failedCount: 0,
      signalsCreatedOrUpdated: 1,
      results: [],
    });
    const posts = new Map<string, (request: {
      authUser?: { role?: string };
      params: { shopifyOrderId: string };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { role?: string };
        params: { shopifyOrderId: string };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
      get: vi.fn(),
      log: {
        error: vi.fn(),
      },
    };

    registerReconciliationRoutes(app as never, {} as never);
    const response = await posts.get('/admin/reconciliation/shopify-order/:shopifyOrderId/refunds')?.({
      authUser: { role: 'admin' },
      params: { shopifyOrderId: 'order-1' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toMatchObject({
      shopifyOrderId: 'order-1',
      refundsFetched: 1,
      refundsCreated: 1,
    });
    expect(createOperationalJobMock).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'reconciliation',
      sourceShopifyOrderId: 'order-1',
    }));
    expect(reconcileShopifyOrderRefundsMock).toHaveBeenCalledWith('order-1');
    expect(markOperationalJobCompletedMock).toHaveBeenCalledWith('job-1');
  });

  it('returns 404 when canonical refund reconciliation has no Shopify refund source', async () => {
    reconcileShopifyOrderRefundsMock.mockResolvedValueOnce(null);
    const posts = new Map<string, (request: {
      authUser?: { role?: string };
      params: { shopifyOrderId: string };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { role?: string };
        params: { shopifyOrderId: string };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
      get: vi.fn(),
      log: {
        error: vi.fn(),
      },
    };

    registerReconciliationRoutes(app as never, {} as never);
    const response = await posts.get('/admin/reconciliation/shopify-order/:shopifyOrderId/refunds')?.({
      authUser: { role: 'admin' },
      params: { shopifyOrderId: 'order-1' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({
      statusCode: 404,
      payload: {
        message: 'Shopify order refunds not found or Shopify Admin is not configured.',
      },
    });
    expect(markOperationalJobFailedMock).toHaveBeenCalledWith(
      'job-1',
      'Shopify order refunds not found or Shopify Admin is not configured.',
    );
  });

  it('wires admin canonical Shopify return reconciliation route', async () => {
    reconcileShopifyOrderReturnsMock.mockResolvedValueOnce({
      shopifyOrderId: 'order-1',
      returnsFetched: 1,
      returnsAlreadyPresent: 0,
      returnsCreated: 1,
      returnRecordsRepaired: 0,
      skippedCount: 0,
      failedCount: 0,
      signalsCreatedOrUpdated: 1,
      results: [],
    });
    const posts = new Map<string, (request: {
      authUser?: { role?: string };
      params: { shopifyOrderId: string };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { role?: string };
        params: { shopifyOrderId: string };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
      get: vi.fn(),
      log: {
        error: vi.fn(),
      },
    };

    registerReconciliationRoutes(app as never, {} as never);
    const response = await posts.get('/admin/reconciliation/shopify-order/:shopifyOrderId/returns')?.({
      authUser: { role: 'admin' },
      params: { shopifyOrderId: 'order-1' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toMatchObject({
      shopifyOrderId: 'order-1',
      returnsFetched: 1,
      returnsCreated: 1,
    });
    expect(createOperationalJobMock).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'reconciliation',
      sourceShopifyOrderId: 'order-1',
    }));
    expect(reconcileShopifyOrderReturnsMock).toHaveBeenCalledWith('order-1');
    expect(markOperationalJobCompletedMock).toHaveBeenCalledWith('job-1');
  });

  it('returns 404 when canonical return reconciliation has no Shopify return source', async () => {
    reconcileShopifyOrderReturnsMock.mockResolvedValueOnce(null);
    const posts = new Map<string, (request: {
      authUser?: { role?: string };
      params: { shopifyOrderId: string };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { role?: string };
        params: { shopifyOrderId: string };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
      get: vi.fn(),
      log: {
        error: vi.fn(),
      },
    };

    registerReconciliationRoutes(app as never, {} as never);
    const response = await posts.get('/admin/reconciliation/shopify-order/:shopifyOrderId/returns')?.({
      authUser: { role: 'admin' },
      params: { shopifyOrderId: 'order-1' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({
      statusCode: 404,
      payload: {
        message: 'Shopify order returns not found or Shopify Admin is not configured.',
      },
    });
    expect(markOperationalJobFailedMock).toHaveBeenCalledWith(
      'job-1',
      'Shopify order returns not found or Shopify Admin is not configured.',
    );
  });

  it('wires admin canonical Shopify order cancellation reconciliation route', async () => {
    reconcileShopifyOrderCancellationMock.mockResolvedValueOnce({
      shopifyOrderId: 'order-1',
      cancellationState: 'full_order_cancelled',
      affectedAllocations: ['alloc-a'],
      affectedLineItems: ['line-1'],
      ledgersHeldOrVoided: ['ledger-1'],
      skippedCount: 0,
      failedCount: 0,
      signalsCreatedOrUpdated: 1,
      results: [],
    });
    const posts = new Map<string, (request: {
      authUser?: { role?: string };
      params: { shopifyOrderId: string };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { role?: string };
        params: { shopifyOrderId: string };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
      get: vi.fn(),
      log: {
        error: vi.fn(),
      },
    };

    registerReconciliationRoutes(app as never, {} as never);
    const response = await posts.get('/admin/reconciliation/shopify-order/:shopifyOrderId/cancellation')?.({
      authUser: { role: 'admin' },
      params: { shopifyOrderId: 'order-1' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toMatchObject({
      shopifyOrderId: 'order-1',
      cancellationState: 'full_order_cancelled',
    });
    expect(createOperationalJobMock).toHaveBeenCalledWith(expect.objectContaining({
      jobType: 'reconciliation',
      sourceShopifyOrderId: 'order-1',
    }));
    expect(reconcileShopifyOrderCancellationMock).toHaveBeenCalledWith('order-1');
    expect(markOperationalJobCompletedMock).toHaveBeenCalledWith('job-1');
  });

  it('returns 404 when canonical cancellation reconciliation has no Shopify order source', async () => {
    reconcileShopifyOrderCancellationMock.mockResolvedValueOnce(null);
    const posts = new Map<string, (request: {
      authUser?: { role?: string };
      params: { shopifyOrderId: string };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { role?: string };
        params: { shopifyOrderId: string };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
      get: vi.fn(),
      log: {
        error: vi.fn(),
      },
    };

    registerReconciliationRoutes(app as never, {} as never);
    const response = await posts.get('/admin/reconciliation/shopify-order/:shopifyOrderId/cancellation')?.({
      authUser: { role: 'admin' },
      params: { shopifyOrderId: 'order-1' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({
      statusCode: 404,
      payload: {
        message: 'Shopify order cancellation state not found or Shopify Admin is not configured.',
      },
    });
    expect(markOperationalJobFailedMock).toHaveBeenCalledWith(
      'job-1',
      'Shopify order cancellation state not found or Shopify Admin is not configured.',
    );
  });

  it('wires admin canonical reconciliation manual dry-run route', async () => {
    const posts = new Map<string, (request: {
      authUser?: { role?: string };
      body?: { lookbackDays?: number; limit?: number; mode?: 'dry-run' | 'repair' };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { role?: string };
        body?: { lookbackDays?: number; limit?: number; mode?: 'dry-run' | 'repair' };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
      get: vi.fn(),
      log: {
        error: vi.fn(),
      },
    };

    registerReconciliationRoutes(app as never, { CANONICAL_RECONCILIATION_MODE: 'dry-run' } as never);
    const response = await posts.get('/admin/reconciliation/canonical/run')?.({
      authUser: { role: 'admin' },
      body: { lookbackDays: 2, limit: 25, mode: 'dry-run' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toMatchObject({
      id: 'canonical-run-1',
      mode: 'dry-run',
      ordersScanned: 10,
    });
    expect(runCanonicalReconciliationMock).toHaveBeenCalledWith(
      expect.objectContaining({ CANONICAL_RECONCILIATION_MODE: 'dry-run' }),
      { lookbackDays: 2, limit: 25, mode: 'dry-run' },
    );
  });

  it('blocks manual canonical repair unless repair mode is enabled by config', async () => {
    const posts = new Map<string, (request: {
      authUser?: { role?: string };
      body?: { lookbackDays?: number; limit?: number; mode?: 'dry-run' | 'repair' };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { role?: string };
        body?: { lookbackDays?: number; limit?: number; mode?: 'dry-run' | 'repair' };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
      get: vi.fn(),
      log: {
        error: vi.fn(),
      },
    };

    registerReconciliationRoutes(app as never, { CANONICAL_RECONCILIATION_MODE: 'dry-run' } as never);
    const response = await posts.get('/admin/reconciliation/canonical/run')?.({
      authUser: { role: 'admin' },
      body: { mode: 'repair' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({
      statusCode: 400,
      payload: {
        message: 'Canonical reconciliation repair mode is disabled. Set CANONICAL_RECONCILIATION_MODE=repair to enable it.',
      },
    });
    expect(runCanonicalReconciliationMock).not.toHaveBeenCalled();
  });

  it('wires admin canonical reconciliation summary route', async () => {
    const gets = new Map<string, (request: {
      authUser?: { role?: string };
    }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn(),
      get: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { role?: string };
      }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => unknown) => {
        gets.set(path, handler);
      }),
      log: {
        error: vi.fn(),
      },
    };

    registerReconciliationRoutes(app as never, { CANONICAL_RECONCILIATION_MODE: 'dry-run' } as never);
    const response = await gets.get('/admin/reconciliation/canonical/summary')?.({
      authUser: { role: 'admin' },
    }, {
      code: (statusCode: number) => ({
        send: (payload: unknown) => ({ statusCode, payload }),
      }),
    });

    expect(response).toEqual({
      lastRun: {
        id: 'canonical-run-1',
        mode: 'dry-run',
        status: 'COMPLETED',
      },
    });
    expect(getLatestCanonicalReconciliationRunMock).toHaveBeenCalledTimes(1);
  });
});
