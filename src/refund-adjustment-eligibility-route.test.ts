import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewRefundAdjustmentEligibilityMock = vi.hoisted(() => vi.fn());
const backfillPendingRefundAdjustmentsMock = vi.hoisted(() => vi.fn());
const previewPendingRefundAdjustmentApplicationMock = vi.hoisted(() => vi.fn());
const getSettlementRefundAdjustmentDetailMock = vi.hoisted(() => vi.fn());
const listAdminRefundReviewsMock = vi.hoisted(() => vi.fn());
const getAdminRefundReviewDetailMock = vi.hoisted(() => vi.fn());
const acknowledgeAdminRefundReviewMock = vi.hoisted(() => vi.fn());
const resolveAdminRefundReviewMock = vi.hoisted(() => vi.fn());
const reopenAdminRefundReviewMock = vi.hoisted(() => vi.fn());
const syncLegacyRefundFinanceReviewsMock = vi.hoisted(() => vi.fn());
const getAdminLegacyRefundReviewDetailMock = vi.hoisted(() => vi.fn());
const acknowledgeAdminLegacyRefundReviewMock = vi.hoisted(() => vi.fn());
const resolveAdminLegacyRefundReviewMock = vi.hoisted(() => vi.fn());
const reopenAdminLegacyRefundReviewMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/finance/admin-refund-review-projection.service.js', () => ({
  listAdminRefundReviews: listAdminRefundReviewsMock,
}));

vi.mock('../backend/src/modules/finance/admin-refund-review-lifecycle.service.js', () => ({
  getAdminRefundReviewDetail: getAdminRefundReviewDetailMock,
  acknowledgeAdminRefundReview: acknowledgeAdminRefundReviewMock,
  resolveAdminRefundReview: resolveAdminRefundReviewMock,
  reopenAdminRefundReview: reopenAdminRefundReviewMock,
  AdminRefundReviewLifecycleError: class AdminRefundReviewLifecycleError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 409) { super(message); this.statusCode = statusCode; }
  },
}));

vi.mock('../backend/src/modules/finance/admin-legacy-refund-review.service.js', () => ({
  syncLegacyRefundFinanceReviews: syncLegacyRefundFinanceReviewsMock,
  getAdminLegacyRefundReviewDetail: getAdminLegacyRefundReviewDetailMock,
  acknowledgeAdminLegacyRefundReview: acknowledgeAdminLegacyRefundReviewMock,
  resolveAdminLegacyRefundReview: resolveAdminLegacyRefundReviewMock,
  reopenAdminLegacyRefundReview: reopenAdminLegacyRefundReviewMock,
  AdminLegacyRefundReviewError: class AdminLegacyRefundReviewError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 409) { super(message); this.statusCode = statusCode; }
  },
}));

vi.mock('../backend/src/modules/finance/settlement-refund-adjustment-eligibility-diagnostics.service.js', () => ({
  backfillPendingRefundAdjustments: backfillPendingRefundAdjustmentsMock,
  previewPendingRefundAdjustmentApplication: previewPendingRefundAdjustmentApplicationMock,
  previewRefundAdjustmentEligibility: previewRefundAdjustmentEligibilityMock,
}));

vi.mock('../backend/src/modules/finance/settlement-refund-adjustment.service.js', () => ({
  getSettlementRefundAdjustmentDetail: getSettlementRefundAdjustmentDetailMock,
  listSettlementRefundAdjustments: vi.fn(),
}));

vi.mock('../backend/src/modules/finance/finance-event-backfill-planner.service.js', () => ({
  getFinanceEventBackfillPlan: vi.fn(),
}));

vi.mock('../backend/src/modules/finance/finance-event-relink.service.js', () => ({
  getFinanceEventRelinkPlan: vi.fn(),
  relinkExistingFinanceEvents: vi.fn(),
}));

vi.mock('../backend/src/modules/finance/settlement-approval.service.js', () => ({
  approveSettlementApproval: vi.fn(),
  cancelSettlementApproval: vi.fn(),
  createDraftApproval: vi.fn(),
  getSettlementApproval: vi.fn(),
  getSettlementApprovalAudit: vi.fn(),
  previewApproval: vi.fn(),
  SettlementApprovalRevalidationError: class SettlementApprovalRevalidationError extends Error {},
}));

vi.mock('../backend/src/modules/finance/settlement-commission-invoice-preview.service.js', () => ({
  previewSettlementLogoCommissionInvoice: vi.fn(),
}));

vi.mock('../backend/src/modules/finance/settlement-commission-invoice-record.service.js', () => ({
  createPendingRecordFromImmutableRequestSnapshot: vi.fn(),
  findBySettlementApproval: vi.fn(),
  getSettlementCommissionInvoiceDiagnostics: vi.fn(),
}));

vi.mock('../backend/src/modules/finance/settlement-logo-commission-invoice-create.service.js', () => ({
  executeSettlementLogoCommissionInvoiceCreate: vi.fn(),
}));

vi.mock('../backend/src/modules/finance/settlement-logo-outgoing-invoice-sync-preview.service.js', () => ({
  persistSettlementLogoSalesInvoiceSync: vi.fn(),
  previewSettlementLogoOutgoingInvoiceSync: vi.fn(),
}));

vi.mock('../backend/src/modules/finance/finance.service.js', () => ({
  cancelPayoutBatch: vi.fn(),
  getPayoutBatch: vi.fn(),
  getVendorFinanceDashboard: vi.fn(),
  getVendorFinanceSummary: vi.fn(),
  getVendorFinancialProfile: vi.fn(),
  getVendorReturnFinanceRecords: vi.fn(),
  listPayoutBatches: vi.fn(),
  markPayoutBatchPaid: vi.fn(),
  markPayoutBatchReview: vi.fn(),
  PayoutBatchTransitionRevalidationError: class PayoutBatchTransitionRevalidationError extends Error {},
  preparePayoutBatch: vi.fn(),
  upsertShipmentShippingCost: vi.fn(),
  upsertVendorFinancialProfile: vi.fn(),
}));

vi.mock('../backend/src/modules/finance/vendor-balance.service.js', () => ({
  getVendorDebtHistory: vi.fn(),
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

function buildReply() {
  return {
    code: vi.fn((status: number) => ({
      send: vi.fn((body: unknown) => ({ status, body })),
    })),
  };
}

describe('refund adjustment eligibility preview route', () => {
  beforeEach(() => {
    listAdminRefundReviewsMock.mockReset();
    previewRefundAdjustmentEligibilityMock.mockReset();
    backfillPendingRefundAdjustmentsMock.mockReset();
    previewPendingRefundAdjustmentApplicationMock.mockReset();
    getSettlementRefundAdjustmentDetailMock.mockReset();
    syncLegacyRefundFinanceReviewsMock.mockReset();
    getAdminLegacyRefundReviewDetailMock.mockReset();
    acknowledgeAdminLegacyRefundReviewMock.mockReset();
    resolveAdminLegacyRefundReviewMock.mockReset();
    reopenAdminLegacyRefundReviewMock.mockReset();
  });

  it('keeps the new read-only review projection admin-only with bounded independent pages', async () => {
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown) => gets.set(path, handler)),
      put: vi.fn(), post: vi.fn(), delete: vi.fn(),
    };
    registerFinanceRoutes(app as never, {} as never);
    const handler = gets.get('/admin/finance/refund-reviews');
    expect(handler).toBeDefined();
    for (const role of ['vendor', 'finance', 'support']) {
      expect(await handler?.({ authUser: { role }, query: {} }, buildReply())).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    }
    expect(listAdminRefundReviewsMock).not.toHaveBeenCalled();
    const response = { ok: true, writesPerformed: false, terminalReviews: { items: [] }, legacyCandidates: { items: [] } };
    listAdminRefundReviewsMock.mockResolvedValue(response);
    expect(await handler?.({ authUser: { role: 'admin' }, query: { vendorId: 'vendor', terminalLimit: '999', terminalOffset: '3', legacyLimit: '4', legacyOffset: '8' } }, buildReply())).toBe(response);
    expect(listAdminRefundReviewsMock).toHaveBeenCalledWith({
      vendorId: 'vendor', terminalStatus: null, terminalResolutionOutcome: null,
      legacyStatus: null, legacyResolutionOutcome: null, legacyAttribution: null, legacyArtifactType: null,
      terminal: { limit: 250, offset: 3 }, legacy: { limit: 4, offset: 8 },
    });
  });

  it('keeps legacy discovery, detail, and lifecycle commands explicitly admin-only', async () => {
    const gets = new Map<string, (request: any, reply: ReturnType<typeof buildReply>) => unknown>();
    const posts = new Map<string, (request: any, reply: ReturnType<typeof buildReply>) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: any, reply: ReturnType<typeof buildReply>) => unknown) => gets.set(path, handler)),
      post: vi.fn((path: string, _options: unknown, handler: (request: any, reply: ReturnType<typeof buildReply>) => unknown) => posts.set(path, handler)),
      put: vi.fn(), delete: vi.fn(),
    };
    registerFinanceRoutes(app as never, {} as never);

    for (const role of ['vendor', 'finance', 'support']) {
      expect(await posts.get('/admin/finance/legacy-refund-reviews/sync')?.(
        { authUser: { role }, body: {} }, buildReply(),
      )).toEqual({ status: 403, body: { message: 'Admin access required.' } });
      expect(await gets.get('/admin/finance/legacy-refund-reviews/:reviewId')?.(
        { authUser: { role }, params: { reviewId: 'legacy-1' } }, buildReply(),
      )).toEqual({ status: 403, body: { message: 'Admin access required.' } });
      expect(await posts.get('/admin/finance/legacy-refund-reviews/:reviewId/acknowledge')?.(
        { authUser: { role }, params: { reviewId: 'legacy-1' }, body: {} }, buildReply(),
      )).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    }
    expect(syncLegacyRefundFinanceReviewsMock).not.toHaveBeenCalled();

    const syncResult = { ok: true, candidates: 2, createdReviews: 1, updatedReviews: 0, createdSources: 2, updatedSources: 0 };
    syncLegacyRefundFinanceReviewsMock.mockResolvedValue(syncResult);
    expect(await posts.get('/admin/finance/legacy-refund-reviews/sync')?.(
      { authUser: { role: 'admin', id: 'admin-1' }, body: { vendorId: 'vendor' } }, buildReply(),
    )).toEqual(syncResult);
    expect(syncLegacyRefundFinanceReviewsMock).toHaveBeenCalledWith({ vendorId: 'vendor' });
  });

  it('keeps terminal review detail and lifecycle commands explicitly admin-only', async () => {
    const gets = new Map<string, (request: any, reply: ReturnType<typeof buildReply>) => unknown>();
    const posts = new Map<string, (request: any, reply: ReturnType<typeof buildReply>) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: any, reply: ReturnType<typeof buildReply>) => unknown) => gets.set(path, handler)),
      post: vi.fn((path: string, _options: unknown, handler: (request: any, reply: ReturnType<typeof buildReply>) => unknown) => posts.set(path, handler)),
      put: vi.fn(), delete: vi.fn(),
    };
    registerFinanceRoutes(app as never, {} as never);

    for (const role of ['vendor', 'finance', 'support']) {
      expect(await gets.get('/admin/finance/refund-reviews/:reviewId')?.(
        { authUser: { role }, params: { reviewId: 'review-1' } }, buildReply(),
      )).toEqual({ status: 403, body: { message: 'Admin access required.' } });
      expect(await posts.get('/admin/finance/refund-reviews/:reviewId/acknowledge')?.(
        { authUser: { role }, params: { reviewId: 'review-1' }, body: {} }, buildReply(),
      )).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    }

    const review = { id: 'review-1', status: 'ACKNOWLEDGED' };
    acknowledgeAdminRefundReviewMock.mockResolvedValue(review);
    expect(await posts.get('/admin/finance/refund-reviews/:reviewId/acknowledge')?.({
      authUser: { role: 'admin', id: 'admin-1' },
      params: { reviewId: 'review-1' },
      body: {
        expectedStatus: 'ACTIVE', expectedUpdatedAt: '2026-09-20T10:00:00.000Z',
        expectedOccurrenceCount: 2, note: 'Investigating',
      },
    }, buildReply())).toEqual({ ok: true, review });
    expect(acknowledgeAdminRefundReviewMock).toHaveBeenCalledWith({
      reviewId: 'review-1', actorUserId: 'admin-1', note: 'Investigating',
      freshness: {
        expectedStatus: 'ACTIVE', expectedUpdatedAt: '2026-09-20T10:00:00.000Z', expectedOccurrenceCount: 2,
      },
    });
  });

  it('requires admin auth', async () => {
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown) => {
        gets.set(path, handler);
      }),
      put: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    };
    registerFinanceRoutes(app as never, {} as never);

    const result = await gets.get('/admin/finance/refund-adjustments/eligibility-preview')?.(
      { authUser: { role: 'vendor' }, query: {} },
      buildReply(),
    );

    expect(result).toEqual({
      status: 403,
      body: { message: 'Admin access required.' },
    });
    expect(previewRefundAdjustmentEligibilityMock).not.toHaveBeenCalled();
  });

  it('returns read-only eligibility preview for admins', async () => {
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown) => {
        gets.set(path, handler);
      }),
      put: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    };
    const preview = {
      ok: true,
      writesPerformed: false,
      summary: {
        totalRefundLedgers: 1,
        createPendingAdjustment: 1,
        alreadyHasAdjustment: 0,
        vendorDebtRequired: 0,
        missingApprovedSettlementLine: 0,
        missingRelatedSaleLedger: 0,
        notAfterApprovedOrInvoicedSettlement: 0,
        unknown: 0,
      },
      records: [],
    };
    previewRefundAdjustmentEligibilityMock.mockResolvedValueOnce(preview);
    registerFinanceRoutes(app as never, {} as never);

    const result = await gets.get('/admin/finance/refund-adjustments/eligibility-preview')?.(
      {
        authUser: { role: 'admin' },
        query: {
          vendorId: 'yalispor',
          orderNumber: '#1086',
          recommendedAction: 'CREATE_PENDING_ADJUSTMENT',
          limit: '25',
        },
      },
      buildReply(),
    );

    expect(result).toBe(preview);
    expect(previewRefundAdjustmentEligibilityMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      orderNumber: '#1086',
      recommendedAction: 'CREATE_PENDING_ADJUSTMENT',
      limit: 25,
    });
  });

  it('blocks backfill without confirmation before writes', async () => {
    const posts = new Map<string, (request: { authUser?: { role?: string }; body?: unknown; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; body?: unknown; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown) => {
        posts.set(path, handler);
      }),
      delete: vi.fn(),
    };
    registerFinanceRoutes(app as never, {} as never);

    const result = await posts.get('/admin/finance/refund-adjustments/backfill')?.(
      { authUser: { role: 'admin' }, body: { confirmRefundAdjustmentBackfill: false }, query: {} },
      buildReply(),
    );

    expect(result).toEqual({
      status: 400,
      body: {
        ok: false,
        writesPerformed: false,
        message: 'Refund adjustment backfill confirmation is required.',
      },
    });
    expect(backfillPendingRefundAdjustmentsMock).not.toHaveBeenCalled();
  });

  it('requires admin auth for backfill', async () => {
    const posts = new Map<string, (request: { authUser?: { role?: string }; body?: unknown; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; body?: unknown; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown) => {
        posts.set(path, handler);
      }),
      delete: vi.fn(),
    };
    registerFinanceRoutes(app as never, {} as never);

    const result = await posts.get('/admin/finance/refund-adjustments/backfill')?.(
      { authUser: { role: 'vendor' }, body: { confirmRefundAdjustmentBackfill: true }, query: {} },
      buildReply(),
    );

    expect(result).toEqual({
      status: 403,
      body: { message: 'Admin access required.' },
    });
    expect(backfillPendingRefundAdjustmentsMock).not.toHaveBeenCalled();
  });

  it('runs confirmed backfill for admins with filters', async () => {
    const posts = new Map<string, (request: { authUser?: { id?: string; email?: string; role?: string }; body?: unknown; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { id?: string; email?: string; role?: string }; body?: unknown; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown) => {
        posts.set(path, handler);
      }),
      delete: vi.fn(),
    };
    const backfill = {
      ok: true,
      writesPerformed: true,
      summary: {
        eligible: 1,
        created: 1,
        alreadyExisting: 0,
        skipped: 0,
        failed: 0,
      },
      createdRecords: [],
      skippedRecords: [],
    };
    backfillPendingRefundAdjustmentsMock.mockResolvedValueOnce(backfill);
    registerFinanceRoutes(app as never, {} as never);

    const result = await posts.get('/admin/finance/refund-adjustments/backfill')?.(
      {
        authUser: { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
        body: {
          confirmRefundAdjustmentBackfill: true,
          vendorId: 'yalispor',
          orderNumber: '#1086',
        },
        query: { limit: '8' },
      },
      buildReply(),
    );

    expect(result).toBe(backfill);
    expect(backfillPendingRefundAdjustmentsMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      orderNumber: '#1086',
      limit: 8,
      createdBy: 'admin-1',
    });
  });

  it('returns read-only pending adjustment application preview for admins', async () => {
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown) => {
        gets.set(path, handler);
      }),
      put: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    };
    const preview = {
      ok: true,
      writesPerformed: false,
      vendorId: 'yalispor',
      pendingAdjustmentCount: 1,
      pendingAdjustmentTotalMinor: 88000,
      currentCandidateNetPayableMinor: null,
      netAfterPendingRefundAdjustmentsMinor: null,
      currencyCode: 'TRY',
      records: [],
      notes: ['Preview only — not applied until Phase 3.5C.'],
    };
    previewPendingRefundAdjustmentApplicationMock.mockResolvedValueOnce(preview);
    registerFinanceRoutes(app as never, {} as never);

    const result = await gets.get('/admin/finance/refund-adjustments/application-preview')?.(
      { authUser: { role: 'admin' }, query: { vendorId: 'yalispor', currencyCode: 'TRY', limit: '20' } },
      buildReply(),
    );

    expect(result).toBe(preview);
    expect(previewPendingRefundAdjustmentApplicationMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      currencyCode: 'TRY',
      limit: 20,
    });
  });

  it('requires vendorId for pending adjustment application preview before reading', async () => {
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: ReturnType<typeof buildReply>) => unknown) => {
        gets.set(path, handler);
      }),
      put: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    };
    registerFinanceRoutes(app as never, {} as never);

    const result = await gets.get('/admin/finance/refund-adjustments/application-preview')?.(
      { authUser: { role: 'admin' }, query: {} },
      buildReply(),
    );

    expect(result).toEqual({
      status: 400,
      body: {
        ok: false,
        writesPerformed: false,
        message: 'vendorId is required.',
      },
    });
    expect(previewPendingRefundAdjustmentApplicationMock).not.toHaveBeenCalled();
  });

  it('returns refund adjustment detail with applications and audit events for admins', async () => {
    const gets = new Map<string, (request: { authUser?: { role?: string }; params?: unknown }, reply: ReturnType<typeof buildReply>) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; params?: unknown }, reply: ReturnType<typeof buildReply>) => unknown) => {
        gets.set(path, handler);
      }),
      put: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    };
    const detail = {
      ok: true,
      writesPerformed: false,
      adjustment: {
        id: 'adjustment-1',
        status: 'partially_applied',
        applications: [{ id: 'application-1', amountMinor: 600000 }],
        events: [{ id: 'event-1', eventType: 'partially_applied' }],
      },
      applications: [{ id: 'application-1', amountMinor: 600000 }],
      auditEvents: [{ id: 'event-1', eventType: 'partially_applied' }],
    };
    getSettlementRefundAdjustmentDetailMock.mockResolvedValueOnce(detail);
    registerFinanceRoutes(app as never, {} as never);

    const result = await gets.get('/admin/finance/refund-adjustments/:id')?.(
      { authUser: { role: 'admin' }, params: { id: 'adjustment-1' } },
      buildReply(),
    );

    expect(result).toBe(detail);
    expect(getSettlementRefundAdjustmentDetailMock).toHaveBeenCalledWith('adjustment-1');
  });

  it('requires admin auth for refund adjustment detail', async () => {
    const gets = new Map<string, (request: { authUser?: { role?: string }; params?: unknown }, reply: ReturnType<typeof buildReply>) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; params?: unknown }, reply: ReturnType<typeof buildReply>) => unknown) => {
        gets.set(path, handler);
      }),
      put: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    };
    registerFinanceRoutes(app as never, {} as never);

    const result = await gets.get('/admin/finance/refund-adjustments/:id')?.(
      { authUser: { role: 'vendor' }, params: { id: 'adjustment-1' } },
      buildReply(),
    );

    expect(result).toEqual({
      status: 403,
      body: { message: 'Admin access required.' },
    });
    expect(getSettlementRefundAdjustmentDetailMock).not.toHaveBeenCalled();
  });
});
