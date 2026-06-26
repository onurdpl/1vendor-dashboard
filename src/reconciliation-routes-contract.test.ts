import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerReconciliationRoutes } from '../backend/src/modules/reconciliation/reconciliation.routes.js';

const reconcileAllocationMock = vi.hoisted(() => vi.fn());
const reconcileShopifyOrderMock = vi.hoisted(() => vi.fn());
const reconcileShopifyOrderRefundsMock = vi.hoisted(() => vi.fn());
const reconcileShopifyOrderReturnsMock = vi.hoisted(() => vi.fn());
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
});
