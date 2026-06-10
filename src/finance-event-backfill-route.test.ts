import { beforeEach, describe, expect, it, vi } from 'vitest';

const getFinanceEventBackfillPlanMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/finance/finance-event-backfill-planner.service.js', () => ({
  getFinanceEventBackfillPlan: getFinanceEventBackfillPlanMock,
}));

vi.mock('../backend/src/modules/finance/finance.service.js', () => ({
  cancelPayoutBatch: vi.fn(),
  getPayoutBatch: vi.fn(),
  getVendorFinanceDashboard: vi.fn(),
  getVendorFinanceSummary: vi.fn(),
  getVendorFinancialProfile: vi.fn(),
  getVendorReturnFinanceRecords: vi.fn(),
  listPayoutBatches: vi.fn(),
  markPayoutBatchReview: vi.fn(),
  preparePayoutBatch: vi.fn(),
  upsertShipmentShippingCost: vi.fn(),
  upsertVendorFinancialProfile: vi.fn(),
}));

vi.mock('../backend/src/modules/auth/auth.service.js', () => ({
  createAuthService: vi.fn(() => ({})),
}));

vi.mock('../backend/src/modules/auth/auth.middleware.js', () => ({
  createAuthMiddleware: vi.fn(() => ({
    authenticateRequest: vi.fn(),
  })),
}));

const { registerFinanceRoutes } = await import('../backend/src/modules/finance/finance.routes.js');

describe('finance event backfill route', () => {
  beforeEach(() => {
    getFinanceEventBackfillPlanMock.mockReset();
  });

  it('returns the read-only backfill plan to admins with writesPerformed false', async () => {
    const gets = new Map<string, (request: { authUser?: { role?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        gets.set(path, handler);
      }),
      put: vi.fn(),
      post: vi.fn(),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };
    const plan = {
      ok: true,
      writesPerformed: false,
      summary: {
        financeLedgerRows: 1,
        financeEvents: 0,
        safeSaleBackfillRows: 1,
        safeRefundBackfillRows: 0,
        unsafeRefundRows: 0,
        relinkCandidateEvents: 0,
        alreadyCompleteRows: 0,
      },
      samples: {
        safeSaleBackfill: [],
        safeRefundBackfill: [],
        unsafeRefundMissingSale: [],
        existingEventNeedsRelink: [],
      },
      warnings: [],
    };
    getFinanceEventBackfillPlanMock.mockResolvedValueOnce(plan);

    registerFinanceRoutes(app as never, {} as never);

    const blocked = await gets.get('/admin/finance/events/backfill-plan')?.({ authUser: { role: 'vendor' } }, reply);
    const allowed = await gets.get('/admin/finance/events/backfill-plan')?.({ authUser: { role: 'admin' } }, reply);

    expect(blocked).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    expect(allowed).toEqual(plan);
    expect(allowed?.writesPerformed).toBe(false);
    expect(getFinanceEventBackfillPlanMock).toHaveBeenCalledTimes(1);
  });
});
