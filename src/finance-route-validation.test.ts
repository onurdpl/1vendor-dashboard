import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerFinanceRoutes } from '../backend/src/modules/finance/finance.routes.js';

const upsertVendorFinancialProfileMock = vi.hoisted(() => vi.fn());
const getVendorFinanceSummaryMock = vi.hoisted(() => vi.fn());
const getVendorFinancialProfileMock = vi.hoisted(() => vi.fn());
const getVendorReturnFinanceRecordsMock = vi.hoisted(() => vi.fn());
const getVendorDebtHistoryMock = vi.hoisted(() => vi.fn());
const getSettlementScheduleDryRunMock = vi.hoisted(() => vi.fn());
const createSettlementScheduleDraftsMock = vi.hoisted(() => vi.fn());
const getSettlementScheduleAutoDraftJobStatusMock = vi.hoisted(() => vi.fn());
const runSettlementScheduleAutoDraftJobMock = vi.hoisted(() => vi.fn());
const runFinanceIntegrityScannerDiagnosticsMock = vi.hoisted(() => vi.fn());
const rescanFinanceIntegrityAlertMock = vi.hoisted(() => vi.fn());
const resolveFinanceIntegrityAlertWithScannerValidationMock = vi.hoisted(() => vi.fn());
const acknowledgeFinanceIntegrityAlertMock = vi.hoisted(() => vi.fn());
const FinanceIntegrityScannerValidationErrorMock = vi.hoisted(() =>
  class FinanceIntegrityScannerValidationError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  },
);
const FinanceIntegrityAlertLifecycleErrorMock = vi.hoisted(() =>
  class FinanceIntegrityAlertLifecycleError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  },
);

vi.mock('../backend/src/modules/finance/finance.service.js', () => ({
  cancelPayoutBatch: vi.fn(),
  getPayoutBatch: vi.fn(),
  getVendorFinanceDashboard: vi.fn(),
  getVendorFinanceSummary: getVendorFinanceSummaryMock,
  getVendorFinancialProfile: getVendorFinancialProfileMock,
  getVendorReturnFinanceRecords: getVendorReturnFinanceRecordsMock,
  listPayoutBatches: vi.fn(),
  markPayoutBatchReview: vi.fn(),
  PayoutBatchTransitionRevalidationError: class PayoutBatchTransitionRevalidationError extends Error {
    blockers: unknown[];

    constructor(blockers: unknown[]) {
      super('Payout batch requires revision because financial facts changed after batch creation.');
      this.blockers = blockers;
    }
  },
  preparePayoutBatch: vi.fn(),
  upsertShipmentShippingCost: vi.fn(),
  upsertVendorFinancialProfile: upsertVendorFinancialProfileMock,
}));

vi.mock('../backend/src/modules/finance/vendor-balance.service.js', () => ({
  getVendorDebtHistory: getVendorDebtHistoryMock,
}));

vi.mock('../backend/src/modules/finance/settlement-schedule.service.js', () => ({
  getSettlementScheduleDryRun: getSettlementScheduleDryRunMock,
  createSettlementScheduleDrafts: createSettlementScheduleDraftsMock,
}));

vi.mock('../backend/src/modules/finance/settlement-schedule-job.service.js', () => ({
  getSettlementScheduleAutoDraftJobStatus: getSettlementScheduleAutoDraftJobStatusMock,
  runSettlementScheduleAutoDraftJob: runSettlementScheduleAutoDraftJobMock,
}));

vi.mock('../backend/src/modules/finance/finance-integrity-scanner.service.js', () => ({
  FinanceIntegrityScannerValidationError: FinanceIntegrityScannerValidationErrorMock,
  rescanFinanceIntegrityAlert: rescanFinanceIntegrityAlertMock,
  resolveFinanceIntegrityAlertWithScannerValidation: resolveFinanceIntegrityAlertWithScannerValidationMock,
  runFinanceIntegrityScannerDiagnostics: runFinanceIntegrityScannerDiagnosticsMock,
}));

vi.mock('../backend/src/modules/finance/finance-integrity-alert.service.js', () => ({
  acknowledgeFinanceIntegrityAlert: acknowledgeFinanceIntegrityAlertMock,
  FinanceIntegrityAlertLifecycleError: FinanceIntegrityAlertLifecycleErrorMock,
}));

vi.mock('../backend/src/modules/auth/auth.service.js', () => ({
  createAuthService: vi.fn(() => ({})),
}));

vi.mock('../backend/src/modules/auth/auth.middleware.js', () => ({
  createAuthMiddleware: vi.fn(() => ({
    authenticateRequest: vi.fn(),
  })),
}));

vi.mock('../backend/src/modules/vendor-access/vendor-access.middleware.js', () => ({
  requireVendorAccess: vi.fn(),
}));

type PutHandler = (
  request: {
    authUser?: { role?: string };
    params?: Record<string, string>;
    body?: unknown;
  },
  reply: ReturnType<typeof createReply>,
) => unknown;

type GetHandler = (
  request: {
    authUser?: { role?: string };
    vendorContext?: { vendorId?: string };
    params?: Record<string, string>;
    query?: unknown;
  },
  reply: ReturnType<typeof createReply>,
) => unknown;

type PostHandler = (
  request: {
    authUser?: { id?: string; role?: string };
    body?: unknown;
    params?: Record<string, string>;
    query?: unknown;
  },
  reply: ReturnType<typeof createReply>,
) => unknown;

function createReply() {
  const reply = {
    statusCode: 200,
    payload: undefined as unknown,
    sent: false,
    code: vi.fn((status: number) => {
      reply.statusCode = status;
      return {
        send: vi.fn((body: unknown) => {
          reply.payload = body;
          reply.sent = true;
          return { status, body };
        }),
      };
    }),
  };

  return reply;
}

function createRegisteredPutRoutes() {
  const puts = new Map<string, PutHandler>();
  const app = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn((path: string, _options: unknown, handler: PutHandler) => {
      puts.set(path, handler);
    }),
  };

  registerFinanceRoutes(app as never, {} as never);
  return puts;
}

function createRegisteredGetRoutes() {
  const gets = new Map<string, GetHandler>();
  const app = {
    get: vi.fn((path: string, _options: unknown, handler: GetHandler) => {
      gets.set(path, handler);
    }),
    post: vi.fn(),
    put: vi.fn(),
  };

  registerFinanceRoutes(app as never, {} as never);
  return gets;
}

function createRegisteredPostRoutes() {
  const posts = new Map<string, PostHandler>();
  const app = {
    get: vi.fn(),
    post: vi.fn((path: string, _options: unknown, handler: PostHandler) => {
      posts.set(path, handler);
    }),
    put: vi.fn(),
  };

  registerFinanceRoutes(app as never, {} as never);
  return posts;
}

async function updateFinancialProfile(body: unknown) {
  const puts = createRegisteredPutRoutes();
  const reply = createReply();
  const result = await puts.get('/admin/vendors/:vendorId/financial-profile')?.(
    {
      authUser: { role: 'admin' },
      params: { vendorId: 'sporjinal' },
      body,
    },
    reply,
  );

  return {
    statusCode: reply.statusCode,
    payload: reply.sent ? reply.payload : result,
  };
}

describe('finance route validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runFinanceIntegrityScannerDiagnosticsMock.mockReset();
    rescanFinanceIntegrityAlertMock.mockReset();
    resolveFinanceIntegrityAlertWithScannerValidationMock.mockReset();
    acknowledgeFinanceIntegrityAlertMock.mockReset();
    upsertVendorFinancialProfileMock.mockResolvedValue({
      vendorId: 'sporjinal',
      commissionPercent: '10.00',
      commissionVatPercent: '0.00',
      deductShippingEnabled: true,
      shippingMode: 'fixed',
      fixedShippingFee: '30.00',
      settlementDelayDays: 21,
      settlementFrequencyType: 'WEEKLY',
      weeklySettlementDay: 'WEDNESDAY',
      autoSettlementDraftEnabled: false,
      autoSettlementApproveEnabled: false,
      autoSettlementInvoiceEnabled: false,
      active: true,
      source: 'configured',
    });
    getVendorFinanceSummaryMock.mockResolvedValue({
      summary: {
        grossSales: '100.00',
        refunds: '25.00',
        netRevenue: '75.00',
        payoutEstimate: '67.50',
      },
    });
    getVendorFinancialProfileMock.mockResolvedValue({
      vendorId: 'sporjinal',
      commissionPercent: '10.00',
      commissionVatPercent: '0.00',
      deductShippingEnabled: true,
      shippingMode: 'fixed',
      fixedShippingFee: '30.00',
      settlementDelayDays: 21,
      settlementFrequencyType: 'WEEKLY',
      weeklySettlementDay: 'WEDNESDAY',
      autoSettlementDraftEnabled: false,
      autoSettlementApproveEnabled: false,
      autoSettlementInvoiceEnabled: false,
      active: true,
      source: 'configured',
    });
    getVendorReturnFinanceRecordsMock.mockResolvedValue({
      records: [
        {
          id: 'ledger-refund-1',
          category: 'refund',
          amount: 125.5,
          status: 'recorded',
          date: '2026-05-13T05:00:00.000Z',
        },
      ],
    });
    getVendorDebtHistoryMock.mockResolvedValue({
      ok: true,
      writesPerformed: false,
      vendorId: 'sporjinal',
      currency: 'TRY',
      summary: {
        outstandingDebtMinor: 264000,
        totalDebtCreatedMinor: 300000,
        totalDebtOffsetMinor: 36000,
        remainingDebtMinor: 264000,
        lastDebtActivityAt: '2026-06-19T10:00:00.000Z',
      },
      events: [],
    });
    getSettlementScheduleDryRunMock.mockResolvedValue({
      ok: true,
      writesPerformed: false,
      runDate: '2026-01-21',
      periodEnd: '2026-01-21T23:59:59.999Z',
      summary: {
        vendorsChecked: 1,
        dueVendors: 1,
        autoDraftEligibleVendors: 1,
        totalEligibleLineCount: 2,
        totalNetPayableMinor: 88000,
      },
      vendors: [],
      notes: [],
    });
    createSettlementScheduleDraftsMock.mockResolvedValue({
      ok: true,
      writesPerformed: true,
      runDate: '2026-01-21',
      periodEnd: '2026-01-21T23:59:59.999Z',
      summary: {
        vendorsChecked: 1,
        dueVendors: 1,
        created: 1,
        skipped: 0,
        failed: 0,
      },
      createdDrafts: [{ vendorId: 'yalispor', settlementApprovalId: 'approval-1', status: 'draft', lineCount: 2 }],
      skipped: [],
      failed: [],
      dryRun: {
        ok: true,
        writesPerformed: false,
        runDate: '2026-01-21',
        periodEnd: '2026-01-21T23:59:59.999Z',
        summary: {
          vendorsChecked: 1,
          dueVendors: 1,
          autoDraftEligibleVendors: 1,
          totalEligibleLineCount: 2,
          totalNetPayableMinor: 88000,
        },
        vendors: [],
        notes: [],
      },
    });
    getSettlementScheduleAutoDraftJobStatusMock.mockResolvedValue({
      ok: true,
      writesPerformed: false,
      enabled: true,
      dryRun: true,
      mode: 'DRY_RUN',
      lastRun: null,
      notes: ['Dry-run mode is enabled.'],
    });
    runSettlementScheduleAutoDraftJobMock.mockResolvedValue({
      ok: true,
      writesPerformed: false,
      runDate: '2026-01-21',
      mode: 'DRY_RUN',
      enabled: true,
      dryRun: true,
      summary: {
        vendorsChecked: 1,
        dueVendors: 1,
        readyVendors: 1,
        createdDrafts: 0,
        skipped: 0,
        blocked: 0,
        existingDrafts: 0,
      },
      vendors: [],
      notes: ['No settlement drafts were created.'],
      jobRun: null,
    });
  });

  it('returns only dashboard finance summary fields', async () => {
    const gets = createRegisteredGetRoutes();
    const reply = createReply();

    const result = await gets.get('/finance/summary')?.(
      {
        vendorContext: { vendorId: 'sporjinal' },
      },
      reply,
    );

    expect(result).toEqual({
      summary: {
        grossSales: '100.00',
        refunds: '25.00',
        netRevenue: '75.00',
        payoutEstimate: '67.50',
      },
    });
    expect(getVendorFinanceSummaryMock).toHaveBeenCalledWith('sporjinal');
    expect(result).not.toHaveProperty('records');
    expect(result).not.toHaveProperty('profile');
    expect(result).not.toHaveProperty('payoutBatchSummary');
    expect(result).not.toHaveProperty('settlements');
    expect(result).not.toHaveProperty('invoiceExecutions');
    expect(result).not.toHaveProperty('vendorBalance');
  });

  it('rejects finance summary requests without resolved vendor context', async () => {
    const gets = createRegisteredGetRoutes();
    const reply = createReply();

    const result = await gets.get('/finance/summary')?.({}, reply);

    expect(result).toEqual({
      status: 400,
      body: { message: 'Vendor context could not be resolved.' },
    });
    expect(getVendorFinanceSummaryMock).not.toHaveBeenCalled();
  });

  it('returns only the vendor-scoped finance profile fields', async () => {
    const gets = createRegisteredGetRoutes();
    const reply = createReply();

    const result = await gets.get('/finance/profile')?.(
      {
        vendorContext: { vendorId: 'sporjinal' },
      },
      reply,
    );

    expect(result).toEqual({
      vendorId: 'sporjinal',
      commissionPercent: '10.00',
      commissionVatPercent: '0.00',
      deductShippingEnabled: true,
      shippingMode: 'fixed',
      fixedShippingFee: '30.00',
      settlementDelayDays: 21,
      settlementFrequencyType: 'WEEKLY',
      weeklySettlementDay: 'WEDNESDAY',
      autoSettlementDraftEnabled: false,
      autoSettlementApproveEnabled: false,
      autoSettlementInvoiceEnabled: false,
      active: true,
      source: 'configured',
    });
    expect(getVendorFinancialProfileMock).toHaveBeenCalledWith('sporjinal');
    expect(result).not.toHaveProperty('summary');
    expect(result).not.toHaveProperty('records');
    expect(result).not.toHaveProperty('payoutBatchSummary');
    expect(result).not.toHaveProperty('transactions');
  });

  it('rejects finance profile requests without resolved vendor context', async () => {
    const gets = createRegisteredGetRoutes();
    const reply = createReply();

    const result = await gets.get('/finance/profile')?.({}, reply);

    expect(result).toEqual({
      status: 400,
      body: { message: 'Vendor context could not be resolved.' },
    });
    expect(getVendorFinancialProfileMock).not.toHaveBeenCalled();
  });

  it('returns only return-scoped finance record fields', async () => {
    const gets = createRegisteredGetRoutes();
    const reply = createReply();

    const result = await gets.get('/finance/return-records')?.(
      {
        vendorContext: { vendorId: 'sporjinal' },
        query: {
          shopifyRefundId: 'gid://shopify/Refund/1',
          shopifyOrderNumber: '1023',
        },
      },
      reply,
    );

    expect(result).toEqual({
      records: [
        {
          id: 'ledger-refund-1',
          category: 'refund',
          amount: 125.5,
          status: 'recorded',
          date: '2026-05-13T05:00:00.000Z',
        },
      ],
    });
    expect(getVendorReturnFinanceRecordsMock).toHaveBeenCalledWith('sporjinal', {
      shopifyRefundId: 'gid://shopify/Refund/1',
      shopifyOrderNumber: '1023',
    });
    expect(result?.records[0]).not.toHaveProperty('settlement');
    expect(result?.records[0]).not.toHaveProperty('payoutCalculation');
    expect(result?.records[0]).not.toHaveProperty('invoiceExecution');
    expect(result).not.toHaveProperty('summary');
    expect(result).not.toHaveProperty('profile');
    expect(result).not.toHaveProperty('payoutBatchSummary');
  });

  it('rejects return finance record requests without resolved vendor context', async () => {
    const gets = createRegisteredGetRoutes();
    const reply = createReply();

    const result = await gets.get('/finance/return-records')?.(
      {
        query: {
          shopifyOrderNumber: '1023',
        },
      },
      reply,
    );

    expect(result).toEqual({
      status: 400,
      body: { message: 'Vendor context could not be resolved.' },
    });
    expect(getVendorReturnFinanceRecordsMock).not.toHaveBeenCalled();
  });

  it('returns vendor debt history for the resolved vendor context', async () => {
    const gets = createRegisteredGetRoutes();
    const reply = createReply();

    const result = await gets.get('/finance/vendor-debt-history')?.(
      {
        vendorContext: { vendorId: 'sporjinal' },
      },
      reply,
    );

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      writesPerformed: false,
      vendorId: 'sporjinal',
      summary: expect.objectContaining({
        outstandingDebtMinor: 264000,
      }),
    }));
    expect(getVendorDebtHistoryMock).toHaveBeenCalledWith('sporjinal', 'TRY');
  });

  it('rejects vendor debt history requests without resolved vendor context', async () => {
    const gets = createRegisteredGetRoutes();
    const reply = createReply();

    const result = await gets.get('/finance/vendor-debt-history')?.({}, reply);

    expect(result).toEqual({
      status: 400,
      body: { message: 'Vendor context could not be resolved.' },
    });
    expect(getVendorDebtHistoryMock).not.toHaveBeenCalled();
  });

  it('requires admin access for finance integrity scanner diagnostics', async () => {
    const posts = createRegisteredPostRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/finance-integrity/scan')?.(
      {
        authUser: { role: 'vendor' },
        body: {
          vendorAllocationId: 'alloc-1',
          dryRun: true,
        },
      },
      reply,
    );

    expect(result).toEqual({
      status: 403,
      body: { message: 'Admin access required.' },
    });
    expect(runFinanceIntegrityScannerDiagnosticsMock).not.toHaveBeenCalled();
  });

  it('rejects unscoped finance integrity scanner diagnostics', async () => {
    runFinanceIntegrityScannerDiagnosticsMock.mockRejectedValueOnce(
      new Error('vendorAllocationId or allocationEconomicTransferId is required for scoped finance integrity scans.'),
    );
    const posts = createRegisteredPostRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/finance-integrity/scan')?.(
      {
        authUser: { role: 'admin' },
        body: {
          dryRun: true,
        },
      },
      reply,
    );

    expect(result).toEqual({
      status: 400,
      body: {
        ok: false,
        dryRun: true,
        writesPerformed: false,
        message: 'vendorAllocationId or allocationEconomicTransferId is required for scoped finance integrity scans.',
      },
    });
    expect(runFinanceIntegrityScannerDiagnosticsMock).toHaveBeenCalledWith({
      vendorAllocationId: null,
      allocationEconomicTransferId: null,
      dryRun: true,
    });
  });

  it('runs scoped finance integrity scanner diagnostics in dry-run mode by default', async () => {
    const response = {
      ok: true,
      dryRun: true,
      writesPerformed: false,
      scope: {
        vendorAllocationId: 'alloc-1',
        allocationEconomicTransferId: null,
      },
      findings: [
        {
          category: 'multiple_active_sale_ledgers',
          severity: 'critical',
          reason: 'Multiple active sale ledgers exist for allocation.',
          dedupeKey: 'finance-integrity:multiple_active_sale_ledgers:allocation:alloc-1',
          vendorAllocationId: 'alloc-1',
          allocationEconomicTransferId: null,
          affectedLedgerIds: ['ledger-a', 'ledger-b'],
          createdAlertId: null,
        },
      ],
    };
    runFinanceIntegrityScannerDiagnosticsMock.mockResolvedValueOnce(response);
    const posts = createRegisteredPostRoutes();

    const result = await posts.get('/admin/finance-integrity/scan')?.(
      {
        authUser: { role: 'admin' },
        body: {
          vendorAllocationId: ' alloc-1 ',
        },
      },
      createReply(),
    );

    expect(result).toBe(response);
    expect(runFinanceIntegrityScannerDiagnosticsMock).toHaveBeenCalledWith({
      vendorAllocationId: 'alloc-1',
      allocationEconomicTransferId: null,
      dryRun: true,
    });
  });

  it('passes non-dry-run scoped finance integrity scanner diagnostics', async () => {
    const response = {
      ok: true,
      dryRun: false,
      writesPerformed: true,
      scope: {
        vendorAllocationId: 'alloc-1',
        allocationEconomicTransferId: 'transfer-1',
      },
      findings: [
        {
          category: 'transfer_failed',
          severity: 'critical',
          reason: 'Economic transfer failed for allocation.',
          dedupeKey: 'finance-integrity:transfer_failed:transfer:transfer-1',
          vendorAllocationId: 'alloc-1',
          allocationEconomicTransferId: 'transfer-1',
          affectedLedgerIds: ['ledger-a'],
          createdAlertId: 'alert-1',
        },
      ],
    };
    runFinanceIntegrityScannerDiagnosticsMock.mockResolvedValueOnce(response);
    const posts = createRegisteredPostRoutes();

    const result = await posts.get('/admin/finance-integrity/scan')?.(
      {
        authUser: { role: 'admin' },
        body: {
          allocationEconomicTransferId: 'transfer-1',
          dryRun: false,
        },
      },
      createReply(),
    );

    expect(result).toBe(response);
    expect(runFinanceIntegrityScannerDiagnosticsMock).toHaveBeenCalledWith({
      vendorAllocationId: null,
      allocationEconomicTransferId: 'transfer-1',
      dryRun: false,
    });
  });

  it('requires admin access for finance integrity alert acknowledgment', async () => {
    const posts = createRegisteredPostRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/finance-integrity/alerts/:alertId/acknowledge')?.(
      {
        authUser: { id: 'vendor-user', role: 'vendor' },
        params: { alertId: 'alert-1' },
        body: {
          note: 'Reviewed by finance ops.',
        },
      },
      reply,
    );

    expect(result).toEqual({
      status: 403,
      body: { message: 'Admin access required.' },
    });
    expect(acknowledgeFinanceIntegrityAlertMock).not.toHaveBeenCalled();
  });

  it('requires a note for finance integrity alert acknowledgment', async () => {
    const posts = createRegisteredPostRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/finance-integrity/alerts/:alertId/acknowledge')?.(
      {
        authUser: { id: 'admin-1', role: 'admin' },
        params: { alertId: 'alert-1' },
        body: {
          note: ' ',
        },
      },
      reply,
    );

    expect(result).toEqual({
      status: 400,
      body: {
        ok: false,
        message: 'Acknowledgment note is required.',
      },
    });
    expect(acknowledgeFinanceIntegrityAlertMock).not.toHaveBeenCalled();
  });

  it('acknowledges an open finance integrity alert for admins', async () => {
    acknowledgeFinanceIntegrityAlertMock.mockResolvedValueOnce({
      id: 'alert-1',
      dedupeKey: 'finance-integrity:multiple_active_sale_ledgers:allocation:alloc-1',
      severity: 'critical',
      category: 'multiple_active_sale_ledgers',
      reason: 'Multiple active sale ledgers exist.',
      status: 'acknowledged',
      vendorAllocationId: 'alloc-1',
      allocationEconomicTransferId: null,
      acknowledgedAt: new Date('2026-06-21T13:00:00.000Z'),
      acknowledgedByUserId: 'admin-1',
      acknowledgmentNote: 'Reviewed by finance ops.',
      resolvedAt: null,
      resolvedByUserId: null,
      resolutionNote: null,
      detectedAt: new Date('2026-06-21T12:00:00.000Z'),
      updatedAt: new Date('2026-06-21T13:00:00.000Z'),
    });
    const posts = createRegisteredPostRoutes();

    const result = await posts.get('/admin/finance-integrity/alerts/:alertId/acknowledge')?.(
      {
        authUser: { id: 'admin-1', role: 'admin' },
        params: { alertId: 'alert-1' },
        body: {
          note: ' Reviewed by finance ops. ',
        },
      },
      createReply(),
    );

    expect(result).toEqual({
      ok: true,
      alert: expect.objectContaining({
        id: 'alert-1',
        status: 'acknowledged',
        acknowledgedAt: '2026-06-21T13:00:00.000Z',
        acknowledgedByUserId: 'admin-1',
        acknowledgmentNote: 'Reviewed by finance ops.',
        resolvedAt: null,
      }),
    });
    expect(acknowledgeFinanceIntegrityAlertMock).toHaveBeenCalledWith({
      alertId: 'alert-1',
      note: 'Reviewed by finance ops.',
      acknowledgedByUserId: 'admin-1',
    });
  });

  it('returns lifecycle validation errors for finance integrity alert acknowledgment', async () => {
    acknowledgeFinanceIntegrityAlertMock.mockRejectedValueOnce(
      new FinanceIntegrityAlertLifecycleErrorMock('Resolved finance integrity alerts cannot be acknowledged.', 409),
    );
    const posts = createRegisteredPostRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/finance-integrity/alerts/:alertId/acknowledge')?.(
      {
        authUser: { id: 'admin-1', role: 'admin' },
        params: { alertId: 'alert-1' },
        body: {
          note: 'Reviewed by finance ops.',
        },
      },
      reply,
    );

    expect(result).toEqual({
      status: 409,
      body: {
        ok: false,
        message: 'Resolved finance integrity alerts cannot be acknowledged.',
      },
    });
  });

  it('requires admin access for finance integrity alert rescan', async () => {
    const posts = createRegisteredPostRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/finance-integrity/alerts/:alertId/rescan')?.(
      {
        authUser: { id: 'vendor-user', role: 'vendor' },
        params: { alertId: 'alert-1' },
        body: {
          dryRun: true,
        },
      },
      reply,
    );

    expect(result).toEqual({
      status: 403,
      body: { message: 'Admin access required.' },
    });
    expect(rescanFinanceIntegrityAlertMock).not.toHaveBeenCalled();
  });

  it('rescans finance integrity alerts in forced dry-run mode', async () => {
    const response = {
      ok: true,
      alertId: 'alert-1',
      dryRun: true,
      writesPerformed: false,
      matchingAlertStillDetected: true,
      scope: {
        vendorAllocationId: 'alloc-1',
        allocationEconomicTransferId: null,
      },
      findings: [
        {
          category: 'multiple_active_sale_ledgers',
          severity: 'critical',
          reason: 'Multiple active sale ledgers exist for allocation.',
          dedupeKey: 'finance-integrity:multiple_active_sale_ledgers:allocation:alloc-1',
          vendorAllocationId: 'alloc-1',
          allocationEconomicTransferId: null,
          affectedLedgerIds: ['ledger-a', 'ledger-b'],
          createdAlertId: null,
        },
      ],
    };
    rescanFinanceIntegrityAlertMock.mockResolvedValueOnce(response);
    const posts = createRegisteredPostRoutes();

    const result = await posts.get('/admin/finance-integrity/alerts/:alertId/rescan')?.(
      {
        authUser: { id: 'admin-1', role: 'admin' },
        params: { alertId: 'alert-1' },
        body: {
          dryRun: false,
        },
      },
      createReply(),
    );

    expect(result).toBe(response);
    expect(rescanFinanceIntegrityAlertMock).toHaveBeenCalledWith({
      alertId: 'alert-1',
      dryRun: true,
    });
  });

  it('returns scanner validation errors for finance integrity alert rescans', async () => {
    rescanFinanceIntegrityAlertMock.mockRejectedValueOnce(
      new FinanceIntegrityScannerValidationErrorMock('Finance integrity alert has no allocation or transfer scope to rescan.', 400),
    );
    const posts = createRegisteredPostRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/finance-integrity/alerts/:alertId/rescan')?.(
      {
        authUser: { id: 'admin-1', role: 'admin' },
        params: { alertId: 'alert-1' },
        body: {},
      },
      reply,
    );

    expect(result).toEqual({
      status: 400,
      body: {
        ok: false,
        alertId: 'alert-1',
        dryRun: true,
        writesPerformed: false,
        message: 'Finance integrity alert has no allocation or transfer scope to rescan.',
      },
    });
  });

  it('requires admin access for finance integrity alert resolve', async () => {
    const posts = createRegisteredPostRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/finance-integrity/alerts/:alertId/resolve')?.(
      {
        authUser: { id: 'vendor-user', role: 'vendor' },
        params: { alertId: 'alert-1' },
        body: {
          note: 'Validated and resolved.',
          confirmResolve: true,
        },
      },
      reply,
    );

    expect(result).toEqual({
      status: 403,
      body: { message: 'Admin access required.' },
    });
    expect(resolveFinanceIntegrityAlertWithScannerValidationMock).not.toHaveBeenCalled();
  });

  it('requires confirmation for finance integrity alert resolve', async () => {
    const posts = createRegisteredPostRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/finance-integrity/alerts/:alertId/resolve')?.(
      {
        authUser: { id: 'admin-1', role: 'admin' },
        params: { alertId: 'alert-1' },
        body: {
          note: 'Validated and resolved.',
        },
      },
      reply,
    );

    expect(result).toEqual({
      status: 400,
      body: {
        ok: false,
        message: 'confirmResolve must be true to resolve finance integrity alerts.',
      },
    });
    expect(resolveFinanceIntegrityAlertWithScannerValidationMock).not.toHaveBeenCalled();
  });

  it('requires a note for finance integrity alert resolve', async () => {
    const posts = createRegisteredPostRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/finance-integrity/alerts/:alertId/resolve')?.(
      {
        authUser: { id: 'admin-1', role: 'admin' },
        params: { alertId: 'alert-1' },
        body: {
          note: ' ',
          confirmResolve: true,
        },
      },
      reply,
    );

    expect(result).toEqual({
      status: 400,
      body: {
        ok: false,
        message: 'Resolution note is required.',
      },
    });
    expect(resolveFinanceIntegrityAlertWithScannerValidationMock).not.toHaveBeenCalled();
  });

  it('resolves finance integrity alerts through scanner validation', async () => {
    resolveFinanceIntegrityAlertWithScannerValidationMock.mockResolvedValueOnce({
      id: 'alert-1',
      dedupeKey: 'finance-integrity:multiple_active_sale_ledgers:allocation:alloc-1',
      severity: 'critical',
      category: 'multiple_active_sale_ledgers',
      reason: 'Multiple active sale ledgers exist for allocation.',
      status: 'resolved',
      vendorAllocationId: 'alloc-1',
      allocationEconomicTransferId: null,
      acknowledgedAt: null,
      acknowledgedByUserId: null,
      acknowledgmentNote: null,
      resolvedAt: new Date('2026-06-21T14:00:00.000Z'),
      resolvedByUserId: 'admin-1',
      resolutionNote: 'Validated and resolved.',
      resolutionValidationJson: {
        scannerValidated: true,
        findingsReturned: [],
      },
      resolutionType: 'scanner_validated',
      detectedAt: new Date('2026-06-21T10:00:00.000Z'),
      updatedAt: new Date('2026-06-21T14:00:00.000Z'),
    });
    const posts = createRegisteredPostRoutes();

    const result = await posts.get('/admin/finance-integrity/alerts/:alertId/resolve')?.(
      {
        authUser: { id: 'admin-1', role: 'admin' },
        params: { alertId: 'alert-1' },
        body: {
          note: 'Validated and resolved.',
          confirmResolve: true,
        },
      },
      createReply(),
    );

    expect(result).toEqual({
      ok: true,
      alert: expect.objectContaining({
        id: 'alert-1',
        status: 'resolved',
        resolvedAt: '2026-06-21T14:00:00.000Z',
        resolvedByUserId: 'admin-1',
        resolutionNote: 'Validated and resolved.',
        resolutionType: 'scanner_validated',
      }),
    });
    expect(resolveFinanceIntegrityAlertWithScannerValidationMock).toHaveBeenCalledWith({
      alertId: 'alert-1',
      note: 'Validated and resolved.',
      resolvedByUserId: 'admin-1',
    });
  });

  it('returns lifecycle validation errors for finance integrity alert resolve', async () => {
    resolveFinanceIntegrityAlertWithScannerValidationMock.mockRejectedValueOnce(
      new FinanceIntegrityAlertLifecycleErrorMock('Cannot resolve alert because the issue is still detected.', 409),
    );
    const posts = createRegisteredPostRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/finance-integrity/alerts/:alertId/resolve')?.(
      {
        authUser: { id: 'admin-1', role: 'admin' },
        params: { alertId: 'alert-1' },
        body: {
          note: 'Validated and resolved.',
          confirmResolve: true,
        },
      },
      reply,
    );

    expect(result).toEqual({
      status: 409,
      body: {
        ok: false,
        message: 'Cannot resolve alert because the issue is still detected.',
      },
    });
  });

  it('runs settlement schedule dry-run through the admin route', async () => {
    const gets = createRegisteredGetRoutes();
    const reply = createReply();

    const result = await gets.get('/admin/finance/settlement-schedules/dry-run')?.(
      {
        authUser: { role: 'admin' },
        query: {
          runDate: '2026-01-21',
          vendorId: 'yalispor',
          limit: '10',
        },
      },
      reply,
    );

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      writesPerformed: false,
      runDate: '2026-01-21',
    }));
    expect(getSettlementScheduleDryRunMock).toHaveBeenCalledWith({
      runDate: '2026-01-21',
      vendorId: 'yalispor',
      limit: 10,
    });
  });

  it('requires admin access for settlement schedule dry-run', async () => {
    const gets = createRegisteredGetRoutes();
    const reply = createReply();

    const result = await gets.get('/admin/finance/settlement-schedules/dry-run')?.(
      {
        authUser: { role: 'vendor' },
        query: {},
      },
      reply,
    );

    expect(result).toEqual({
      status: 403,
      body: { message: 'Admin access required.' },
    });
    expect(getSettlementScheduleDryRunMock).not.toHaveBeenCalled();
  });

  it('requires confirmation for scheduled settlement draft creation', async () => {
    const posts = createRegisteredPostRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/finance/settlement-schedules/create-drafts')?.(
      {
        authUser: { id: 'admin-1', role: 'admin' },
        body: {
          runDate: '2026-01-21',
        },
      },
      reply,
    );

    expect(result).toEqual({
      status: 400,
      body: {
        message: 'confirmAutoSettlementDrafts must be true to create scheduled settlement drafts.',
        writesPerformed: false,
      },
    });
    expect(createSettlementScheduleDraftsMock).not.toHaveBeenCalled();
  });

  it('creates scheduled settlement drafts through the admin route', async () => {
    const posts = createRegisteredPostRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/finance/settlement-schedules/create-drafts')?.(
      {
        authUser: { id: 'admin-1', role: 'admin' },
        body: {
          runDate: '2026-01-21',
          vendorId: 'yalispor',
          limit: 5,
          confirmAutoSettlementDrafts: true,
        },
      },
      reply,
    );

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      writesPerformed: true,
    }));
    expect(createSettlementScheduleDraftsMock).toHaveBeenCalledWith({
      runDate: '2026-01-21',
      vendorId: 'yalispor',
      limit: 5,
      confirmAutoSettlementDrafts: true,
      createdBy: 'admin-1',
    });
  });

  it('returns scheduled auto draft job status through the admin route', async () => {
    const gets = createRegisteredGetRoutes();
    const reply = createReply();

    const result = await gets.get('/admin/finance/settlement-schedules/auto-draft-job-status')?.(
      {
        authUser: { role: 'admin' },
      },
      reply,
    );

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      writesPerformed: false,
      mode: 'DRY_RUN',
    }));
    expect(getSettlementScheduleAutoDraftJobStatusMock).toHaveBeenCalled();
  });

  it('requires admin access for scheduled auto draft job status', async () => {
    const gets = createRegisteredGetRoutes();
    const reply = createReply();

    const result = await gets.get('/admin/finance/settlement-schedules/auto-draft-job-status')?.(
      {
        authUser: { role: 'vendor' },
      },
      reply,
    );

    expect(result).toEqual({
      status: 403,
      body: { message: 'Admin access required.' },
    });
    expect(getSettlementScheduleAutoDraftJobStatusMock).not.toHaveBeenCalled();
  });

  it('runs scheduled auto draft job through the admin route', async () => {
    const posts = createRegisteredPostRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/finance/settlement-schedules/run-auto-draft-job')?.(
      {
        authUser: { id: 'admin-1', role: 'admin' },
        body: {
          runDate: '2026-01-21',
          confirmScheduledSettlementAutoDraftJob: true,
        },
      },
      reply,
    );

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      writesPerformed: false,
    }));
    expect(runSettlementScheduleAutoDraftJobMock).toHaveBeenCalledWith(expect.objectContaining({
      runDate: '2026-01-21',
      confirmScheduledSettlementAutoDraftJob: true,
      triggeredBy: 'admin-1',
    }));
  });

  it('requires admin access for scheduled auto draft job trigger', async () => {
    const posts = createRegisteredPostRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/finance/settlement-schedules/run-auto-draft-job')?.(
      {
        authUser: { role: 'vendor' },
        body: { confirmScheduledSettlementAutoDraftJob: true },
      },
      reply,
    );

    expect(result).toEqual({
      status: 403,
      body: { message: 'Admin access required.' },
    });
    expect(runSettlementScheduleAutoDraftJobMock).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'fixed', 'external_provider'])('accepts supported shippingMode value %s', async (shippingMode) => {
    const response = await updateFinancialProfile({
      commissionPercent: 10,
      shippingMode,
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(
      expect.objectContaining({
        vendorId: 'sporjinal',
        shippingMode: 'fixed',
      }),
    );
    expect(upsertVendorFinancialProfileMock).toHaveBeenCalledWith(
      'sporjinal',
      {
        commissionPercent: 10,
        shippingMode,
      },
      expect.objectContaining({
        actor: expect.objectContaining({
          userId: null,
          email: null,
        }),
      }),
    );
  });

  it('preserves existing behavior when shippingMode is omitted', async () => {
    const response = await updateFinancialProfile({
      commissionPercent: 12,
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(
      expect.objectContaining({
        vendorId: 'sporjinal',
        source: 'configured',
      }),
    );
    expect(upsertVendorFinancialProfileMock).toHaveBeenCalledWith(
      'sporjinal',
      {
        commissionPercent: 12,
      },
      expect.objectContaining({
        actor: expect.objectContaining({
          userId: null,
          email: null,
        }),
      }),
    );
  });

  it.each([
    ['unknown', 'manual'],
    ['empty', ''],
    ['non-string number', 123],
    ['non-string boolean', true],
    ['null', null],
    ['object', { value: 'fixed' }],
    ['array', ['fixed']],
  ])('rejects %s shippingMode values', async (_label, shippingMode) => {
    const response = await updateFinancialProfile({
      commissionPercent: 10,
      shippingMode,
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual({ message: 'shippingMode must be disabled, fixed, or external_provider.' });
    expect(upsertVendorFinancialProfileMock).not.toHaveBeenCalled();
  });

  it('keeps the successful response shape unchanged for valid profile updates', async () => {
    upsertVendorFinancialProfileMock.mockResolvedValueOnce({
      vendorId: 'sporjinal',
      commissionPercent: '12.00',
      commissionVatPercent: '18.00',
      deductShippingEnabled: true,
      shippingMode: 'external_provider',
      fixedShippingFee: null,
      settlementDelayDays: 21,
      settlementFrequencyType: 'WEEKLY',
      weeklySettlementDay: 'WEDNESDAY',
      autoSettlementDraftEnabled: false,
      autoSettlementApproveEnabled: false,
      autoSettlementInvoiceEnabled: false,
      active: true,
      source: 'configured',
    });

    const response = await updateFinancialProfile({
      commissionPercent: 12,
      commissionVatPercent: 18,
      deductShippingEnabled: true,
      shippingMode: 'external_provider',
      fixedShippingFee: null,
      active: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual({
      vendorId: 'sporjinal',
      commissionPercent: '12.00',
      commissionVatPercent: '18.00',
      deductShippingEnabled: true,
      shippingMode: 'external_provider',
      fixedShippingFee: null,
      settlementDelayDays: 21,
      settlementFrequencyType: 'WEEKLY',
      weeklySettlementDay: 'WEDNESDAY',
      autoSettlementDraftEnabled: false,
      autoSettlementApproveEnabled: false,
      autoSettlementInvoiceEnabled: false,
      active: true,
      source: 'configured',
    });
  });
});
