import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewRefundAdjustmentEligibilityMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/finance/settlement-refund-adjustment-eligibility-diagnostics.service.js', () => ({
  previewRefundAdjustmentEligibility: previewRefundAdjustmentEligibilityMock,
}));

vi.mock('../backend/src/modules/finance/settlement-refund-adjustment.service.js', () => ({
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
    previewRefundAdjustmentEligibilityMock.mockReset();
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
});
