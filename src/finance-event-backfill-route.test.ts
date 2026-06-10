import { beforeEach, describe, expect, it, vi } from 'vitest';

const getFinanceEventBackfillPlanMock = vi.hoisted(() => vi.fn());
const getFinanceEventRelinkPlanMock = vi.hoisted(() => vi.fn());
const relinkExistingFinanceEventsMock = vi.hoisted(() => vi.fn());
const getSettlementApprovalAuditMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/finance/finance-event-backfill-planner.service.js', () => ({
  getFinanceEventBackfillPlan: getFinanceEventBackfillPlanMock,
}));

vi.mock('../backend/src/modules/finance/finance-event-relink.service.js', () => ({
  getFinanceEventRelinkPlan: getFinanceEventRelinkPlanMock,
  relinkExistingFinanceEvents: relinkExistingFinanceEventsMock,
}));

vi.mock('../backend/src/modules/finance/settlement-approval.service.js', () => ({
  approveSettlementApproval: vi.fn(),
  cancelSettlementApproval: vi.fn(),
  createDraftApproval: vi.fn(),
  getSettlementApproval: vi.fn(),
  getSettlementApprovalAudit: getSettlementApprovalAuditMock,
  previewApproval: vi.fn(),
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
    getFinanceEventRelinkPlanMock.mockReset();
    relinkExistingFinanceEventsMock.mockReset();
    getSettlementApprovalAuditMock.mockReset();
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

  it('returns the read-only relink plan to admins with writesPerformed false', async () => {
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
        relinkCandidateEvents: 1,
        affectedLedgerRows: 1,
      },
      samples: [
        {
          financeEventId: 'event-1',
          financeLedgerEntryId: 'ledger-1',
          idempotencyKey: 'ledger-1:SALE_RECORDED',
          vendorId: 'sporjinal',
          eventType: 'SALE_RECORDED',
          reason: 'Existing FinanceEvent idempotency key, vendorId, and eventType match this ledger row; only financeLedgerEntryId is null.',
        },
      ],
    };
    getFinanceEventRelinkPlanMock.mockResolvedValueOnce(plan);

    registerFinanceRoutes(app as never, {} as never);

    const allowed = await gets.get('/admin/finance/events/relink-plan')?.({ authUser: { role: 'admin' } }, reply);

    expect(allowed).toEqual(plan);
    expect(allowed?.writesPerformed).toBe(false);
    expect(getFinanceEventRelinkPlanMock).toHaveBeenCalledTimes(1);
    expect(relinkExistingFinanceEventsMock).not.toHaveBeenCalled();
  });

  it('requires confirmRelink true before executing relink', async () => {
    const posts = new Map<string, (request: { authUser?: { role?: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerFinanceRoutes(app as never, {} as never);

    const blocked = await posts.get('/admin/finance/events/relink-existing')?.(
      { authUser: { role: 'admin' }, body: { confirmRelink: false } },
      reply,
    );

    expect(blocked).toEqual({
      status: 400,
      body: {
        message: 'confirmRelink must be true to relink existing FinanceEvent rows.',
        writesPerformed: false,
      },
    });
    expect(relinkExistingFinanceEventsMock).not.toHaveBeenCalled();
  });

  it('executes relink for admins when confirmRelink is true', async () => {
    const posts = new Map<string, (request: { authUser?: { role?: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };
    const result = {
      ok: true,
      writesPerformed: true,
      summary: {
        relinkCandidateEvents: 1,
        affectedLedgerRows: 1,
        relinkedEvents: 1,
        skippedEvents: 0,
      },
      samples: [],
    };
    relinkExistingFinanceEventsMock.mockResolvedValueOnce(result);

    registerFinanceRoutes(app as never, {} as never);

    const allowed = await posts.get('/admin/finance/events/relink-existing')?.(
      { authUser: { role: 'admin' }, body: { confirmRelink: true } },
      reply,
    );

    expect(allowed).toEqual(result);
    expect(relinkExistingFinanceEventsMock).toHaveBeenCalledTimes(1);
  });

  it('returns settlement approval audit explanations to admins', async () => {
    const gets = new Map<string, (request: { authUser?: { role?: string }; params?: { id: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; params?: { id: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
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
    const audit = {
      approvalId: 'approval-1',
      status: 'draft',
      totals: {
        grossSalesMinor: 100000,
        refundTotalMinor: 0,
        commissionMinor: 10000,
        commissionVatMinor: 2000,
        netPayableMinor: 88000,
        currency: 'TRY',
      },
      lines: [
        {
          financeLedgerEntryId: 'sale-1',
          storedSettlementStatus: 'ACCRUING',
          derivedSettlementStatus: 'partially_refunded',
          payoutStatus: 'PENDING',
          eligibilityDecision: 'included',
          eligibilityReason: 'Derived partially refunded because refund records exist.',
        },
      ],
    };
    getSettlementApprovalAuditMock.mockResolvedValueOnce(audit);

    registerFinanceRoutes(app as never, {} as never);

    const allowed = await gets.get('/admin/finance/settlement-approvals/:id/audit')?.(
      { authUser: { role: 'admin' }, params: { id: 'approval-1' } },
      reply,
    );

    expect(allowed).toEqual(audit);
    expect(getSettlementApprovalAuditMock).toHaveBeenCalledWith('approval-1');
  });
});
