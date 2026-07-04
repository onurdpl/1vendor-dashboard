import { beforeEach, describe, expect, it, vi } from 'vitest';

const getFinanceEventBackfillPlanMock = vi.hoisted(() => vi.fn());
const getFinanceEventRelinkPlanMock = vi.hoisted(() => vi.fn());
const relinkExistingFinanceEventsMock = vi.hoisted(() => vi.fn());
const approveSettlementApprovalMock = vi.hoisted(() => vi.fn());
const getSettlementApprovalAuditMock = vi.hoisted(() => vi.fn());
const previewSettlementLogoCommissionInvoiceMock = vi.hoisted(() => vi.fn());
const findSettlementCommissionInvoiceRecordsMock = vi.hoisted(() => vi.fn());
const getSettlementCommissionInvoiceDiagnosticsMock = vi.hoisted(() => vi.fn());
const createPendingRecordFromImmutableRequestSnapshotMock = vi.hoisted(() => vi.fn());
const executeSettlementLogoCommissionInvoiceCreateMock = vi.hoisted(() => vi.fn());
const previewSettlementLogoOutgoingInvoiceSyncMock = vi.hoisted(() => vi.fn());
const persistSettlementLogoSalesInvoiceSyncMock = vi.hoisted(() => vi.fn());
const SettlementApprovalRevalidationErrorMock = vi.hoisted(() => class SettlementApprovalRevalidationError extends Error {
  reasons: Array<Record<string, unknown>>;

  constructor(reasons: Array<Record<string, unknown>>) {
    super('Settlement approval cannot be approved because one or more lines are no longer valid.');
    this.name = 'SettlementApprovalRevalidationError';
    this.reasons = reasons;
  }
});

vi.mock('../backend/src/modules/finance/finance-event-backfill-planner.service.js', () => ({
  getFinanceEventBackfillPlan: getFinanceEventBackfillPlanMock,
}));

vi.mock('../backend/src/modules/finance/finance-event-relink.service.js', () => ({
  getFinanceEventRelinkPlan: getFinanceEventRelinkPlanMock,
  relinkExistingFinanceEvents: relinkExistingFinanceEventsMock,
}));

vi.mock('../backend/src/modules/finance/settlement-approval.service.js', () => ({
  approveSettlementApproval: approveSettlementApprovalMock,
  cancelSettlementApproval: vi.fn(),
  createDraftApproval: vi.fn(),
  getSettlementApproval: vi.fn(),
  getSettlementApprovalAudit: getSettlementApprovalAuditMock,
  previewApproval: vi.fn(),
  SettlementApprovalRevalidationError: SettlementApprovalRevalidationErrorMock,
}));

vi.mock('../backend/src/modules/finance/settlement-commission-invoice-preview.service.js', () => ({
  previewSettlementLogoCommissionInvoice: previewSettlementLogoCommissionInvoiceMock,
}));

vi.mock('../backend/src/modules/finance/settlement-commission-invoice-record.service.js', () => ({
  createPendingRecordFromImmutableRequestSnapshot: createPendingRecordFromImmutableRequestSnapshotMock,
  findBySettlementApproval: findSettlementCommissionInvoiceRecordsMock,
  getSettlementCommissionInvoiceDiagnostics: getSettlementCommissionInvoiceDiagnosticsMock,
}));

vi.mock('../backend/src/modules/finance/settlement-logo-commission-invoice-create.service.js', () => ({
  executeSettlementLogoCommissionInvoiceCreate: executeSettlementLogoCommissionInvoiceCreateMock,
}));

vi.mock('../backend/src/modules/finance/settlement-logo-outgoing-invoice-sync-preview.service.js', () => ({
  persistSettlementLogoSalesInvoiceSync: persistSettlementLogoSalesInvoiceSyncMock,
  previewSettlementLogoOutgoingInvoiceSync: previewSettlementLogoOutgoingInvoiceSyncMock,
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
  PayoutBatchTransitionRevalidationError: class PayoutBatchTransitionRevalidationError extends Error {
    blockers: unknown[];

    constructor(blockers: unknown[]) {
      super('Payout batch requires revision because financial facts changed after batch creation.');
      this.blockers = blockers;
    }
  },
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
    approveSettlementApprovalMock.mockReset();
    getSettlementApprovalAuditMock.mockReset();
    previewSettlementLogoCommissionInvoiceMock.mockReset();
    findSettlementCommissionInvoiceRecordsMock.mockReset();
    getSettlementCommissionInvoiceDiagnosticsMock.mockReset();
    createPendingRecordFromImmutableRequestSnapshotMock.mockReset();
    executeSettlementLogoCommissionInvoiceCreateMock.mockReset();
    previewSettlementLogoOutgoingInvoiceSyncMock.mockReset();
    persistSettlementLogoSalesInvoiceSyncMock.mockReset();
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

  it('returns settlement Logo commission invoice preview without writes', async () => {
    const posts = new Map<string, (request: { authUser?: { role?: string }; params?: { id: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; params?: { id: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };
    const preview = {
      ok: true,
      writesPerformed: false,
      settlementApprovalId: 'approval-1',
      readiness: {
        canCreateLogoInvoiceLater: true,
        blockers: [],
        warnings: [],
        billingSnapshotPresent: true,
        billingSnapshotSource: 'settlement_approval',
      },
      amounts: {
        commissionAmount: 100,
        commissionVatAmount: 20,
        expectedGrossInvoiceAmount: 120,
        currency: 'TRY',
        taxRate: 20,
        vatIncluded: false,
      },
      vendorBillingReadiness: {
        complete: true,
        missingFields: [],
        logoCustomerCodePresent: true,
        logoCustomerIdPresent: true,
        logoEinvoiceEligible: true,
        billingSnapshotPresent: true,
        billingSnapshotSource: 'settlement_approval',
      },
      vatRateSource: 'settlement_line_snapshots',
      detectedVatRates: [20],
      configuredVendorCommissionVatPercent: null,
      executionSnapshotGuard: {
        ok: true,
        blockers: [],
        warnings: [],
        snapshotCompleteness: {
          settlementApprovalFound: true,
          settlementApprovalStatus: 'APPROVED',
          lineCount: 1,
          executionLineCount: 1,
        },
        detectedCommissionRates: [10],
        detectedCommissionVatRates: [20],
        detectedShippingModes: ['disabled'],
        requiredSnapshotsPresent: true,
      },
      immutableRequestSnapshot: {
        status: 'READY',
        payloadBuilderVersion: 'settlement-logo-request-v1',
        blockers: [],
        warnings: [],
        requestSnapshotPresent: true,
      },
      logoPayloadPreview: {
        salesInvoiceDetails: [
          {
            productDetail: {
              itemCode: 'SPORGYM-COMMISSION',
              itemType: 2,
            },
          },
        ],
      },
    };
    previewSettlementLogoCommissionInvoiceMock.mockResolvedValueOnce(preview);

    registerFinanceRoutes(app as never, {} as never);

    const allowed = await posts.get('/admin/finance/settlement-approvals/:id/logo-commission-invoice-preview')?.(
      { authUser: { role: 'admin' }, params: { id: 'approval-1' } },
      reply,
    );

    expect(allowed).toEqual(preview);
    expect(allowed?.writesPerformed).toBe(false);
    expect(previewSettlementLogoCommissionInvoiceMock).toHaveBeenCalledWith('approval-1');
  });

  it('persists immutable Logo request snapshots as pending local records for admins', async () => {
    const posts = new Map<string, (request: { authUser?: { id?: string; role?: string }; params?: { id: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { id?: string; role?: string }; params?: { id: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
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
      settlementApprovalId: 'approval-1',
      provider: 'logo_isbasi',
      status: 'pending',
      blockers: [],
      warnings: [],
      record: {
        id: 'record-1',
        settlementApprovalId: 'approval-1',
        provider: 'logo_isbasi',
        status: 'pending',
        requestSnapshot: {
          requestSnapshotPresent: true,
          payloadBuilderVersion: 'settlement-logo-request-v1',
          requestBuiltAt: '2026-06-12T10:00:00.000Z',
          snapshotSource: 'immutable_settlement_truth',
        },
      },
      requestSnapshot: {
        requestSnapshotPresent: true,
        payloadBuilderVersion: 'settlement-logo-request-v1',
        requestBuiltAt: '2026-06-12T10:00:00.000Z',
        snapshotSource: 'immutable_settlement_truth',
      },
    };
    createPendingRecordFromImmutableRequestSnapshotMock.mockResolvedValueOnce(result);

    registerFinanceRoutes(app as never, {} as never);

    const blocked = await posts.get('/admin/finance/settlement-approvals/:id/logo-commission-invoice-request-snapshot')?.(
      { authUser: { id: 'vendor-user', role: 'vendor' }, params: { id: 'approval-1' } },
      reply,
    );
    const allowed = await posts.get('/admin/finance/settlement-approvals/:id/logo-commission-invoice-request-snapshot')?.(
      { authUser: { id: 'admin-user', role: 'admin' }, params: { id: 'approval-1' } },
      reply,
    );

    expect(blocked).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    expect(allowed).toEqual(result);
    expect(allowed?.writesPerformed).toBe(true);
    expect(createPendingRecordFromImmutableRequestSnapshotMock).toHaveBeenCalledWith(
      'approval-1',
      'LOGO_ISBASI',
      { createdBy: 'admin-user' },
    );
  });

  it('returns structured revalidation reasons when settlement approval is stale', async () => {
    const posts = new Map<string, (request: { authUser?: { id?: string; role?: string }; params?: { id: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { id?: string; role?: string }; params?: { id: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };
    const reasons = [
      {
        settlementApprovalLineId: 'line-1',
        financeLedgerEntryId: 'sale-1',
        code: 'refund_arrived_after_draft',
        reason: 'Refund arrived after draft creation',
      },
    ];
    approveSettlementApprovalMock.mockRejectedValueOnce(new SettlementApprovalRevalidationErrorMock(reasons));

    registerFinanceRoutes(app as never, {} as never);

    const response = await posts.get('/admin/finance/settlement-approvals/:id/approve')?.(
      { authUser: { id: 'admin-user', role: 'admin' }, params: { id: 'approval-1' } },
      reply,
    );

    expect(response).toEqual({
      status: 400,
      body: {
        ok: false,
        writesPerformed: false,
        message: 'Settlement approval cannot be approved because one or more lines are no longer valid.',
        revalidationReasons: reasons,
        blockers: ['Refund arrived after draft creation'],
      },
    });
    expect(approveSettlementApprovalMock).toHaveBeenCalledWith('approval-1', 'admin-user');
  });

  it('returns settlement commission invoice records without writes', async () => {
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
    const records = [
      {
        id: 'record-1',
        settlementApprovalId: 'approval-1',
        provider: 'logo_isbasi',
        status: 'pending',
      },
    ];
    findSettlementCommissionInvoiceRecordsMock.mockResolvedValueOnce(records);

    registerFinanceRoutes(app as never, {} as never);

    const allowed = await gets.get('/admin/finance/settlement-approvals/:id/commission-invoice-records')?.(
      { authUser: { role: 'admin' }, params: { id: 'approval-1' } },
      reply,
    );

    expect(allowed).toEqual({
      ok: true,
      writesPerformed: false,
      settlementApprovalId: 'approval-1',
      records,
    });
    expect(findSettlementCommissionInvoiceRecordsMock).toHaveBeenCalledWith('approval-1');
  });

  it('returns settlement commission invoice diagnostics without raw snapshot payloads', async () => {
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
    const diagnostics = {
      ok: true,
      writesPerformed: false,
      record: {
        id: 'record-1',
        status: 'failed',
        retryCount: 2,
        providerIdentifiers: {
          providerInvoiceId: 'logo-invoice-1',
          providerUuid: 'logo-uuid-1',
          providerEttn: 'logo-ettn-1',
          invoiceNo: 'ABC202600001',
        },
        snapshots: {
          request: { present: true, type: 'object', topLevelKeys: ['amount'], approximateSizeBytes: 14 },
          response: { present: true, type: 'object', topLevelKeys: ['providerError'], approximateSizeBytes: 28 },
          document: { present: false, type: 'null', topLevelKeys: [], approximateSizeBytes: 0 },
        },
      },
    };
    getSettlementCommissionInvoiceDiagnosticsMock.mockResolvedValueOnce(diagnostics);

    registerFinanceRoutes(app as never, {} as never);

    const allowed = await gets.get('/admin/finance/commission-invoices/:id')?.(
      { authUser: { role: 'admin' }, params: { id: 'record-1' } },
      reply,
    );

    expect(allowed).toEqual(diagnostics);
    expect(allowed?.writesPerformed).toBe(false);
    expect(JSON.stringify(allowed)).not.toContain('rawBody');
    expect(getSettlementCommissionInvoiceDiagnosticsMock).toHaveBeenCalledWith('record-1', { env: {} });
  });

  it('blocks controlled Logo commission invoice create without backend confirmation', async () => {
    const posts = new Map<string, (request: { authUser?: { role?: string }; params?: { id: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; params?: { id: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerFinanceRoutes(app as never, {} as never);

    const blocked = await posts.get('/admin/finance/commission-invoices/:id/logo-isbasi/create')?.(
      { authUser: { role: 'admin' }, params: { id: 'record-1' }, body: {} },
      reply,
    );

    expect(blocked).toEqual({
      status: 400,
      body: expect.objectContaining({
        ok: false,
        writesPerformed: false,
        externalApiCallAttempted: false,
        settlementCommissionInvoiceId: 'record-1',
        blockers: ['Logo create confirmation is required.'],
      }),
    });
    expect(executeSettlementLogoCommissionInvoiceCreateMock).not.toHaveBeenCalled();
  });

  it('executes controlled Logo commission invoice create for admins with backend confirmation', async () => {
    const posts = new Map<string, (request: { authUser?: { role?: string }; params?: { id: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; params?: { id: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
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
      externalApiCallAttempted: true,
      settlementCommissionInvoiceId: 'record-1',
      status: 'created',
      blockers: [],
      warnings: [],
      environmentGuard: {
        allowed: true,
        environment: 'test',
        expectedTenantConfigured: true,
        actualTenantPresent: true,
        tenantValidationStatus: 'passed',
        tenantValidation: {
          expectedTenantConfigured: true,
          expectedTenantIdPresent: true,
          expectedTenantId: 'tenant-1',
          actualTenantPresent: true,
          actualTenantIdPresent: true,
          actualTenantId: 'tenant-1',
          tenantValidationStatus: 'passed',
          status: 'passed',
        },
        blockers: [],
        warnings: [],
      },
      record: { id: 'record-1', status: 'created', invoiceNo: 'ABC202600001' },
	      providerResult: {
	        httpStatus: 200,
	        invoiceId: 'logo-invoice-1',
	        uuid: 'logo-uuid-1',
	        ettn: 'logo-ettn-1',
	        invoiceNo: 'ABC202600001',
	      },
	      reconciliation: {
	        attempted: true,
	        status: 'matched',
	        matched: true,
	        invoiceNo: 'REE2026000000068',
	        invoiceDate: '2026-06-18T17:45:00',
	        invoiceTotalMinor: 136764,
	        invoiceCurrency: 'TL',
	        warnings: [],
	      },
	    };
    executeSettlementLogoCommissionInvoiceCreateMock.mockResolvedValueOnce(result);

    registerFinanceRoutes(app as never, {} as never);

    const allowed = await posts.get('/admin/finance/commission-invoices/:id/logo-isbasi/create')?.(
      { authUser: { role: 'admin' }, params: { id: 'record-1' }, body: { confirmLogoCreate: true } },
      reply,
    );

    expect(allowed).toEqual(result);
    expect(executeSettlementLogoCommissionInvoiceCreateMock).toHaveBeenCalledWith('record-1', { env: {} });
  });

  it('returns read-only Logo sales invoice sync preview to admins', async () => {
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
    const result = {
      ok: true,
      writesPerformed: false,
      blockers: [],
      warnings: [],
      record: { id: 'record-1', status: 'CREATED', providerUuid: 'uuid-1', invoiceNo: null },
      search: { matched: true, ambiguity: false },
      matchedInvoice: { uuId: 'uuid-1' },
      providerFieldsObserved: ['uuId'],
      mappedFields: { providerUuid: 'uuid-1', invoiceNumberAvailable: false },
    };
    previewSettlementLogoOutgoingInvoiceSyncMock.mockResolvedValueOnce(result);

    registerFinanceRoutes(app as never, {} as never);

    const response = await gets.get('/admin/finance/commission-invoices/:id/logo-isbasi/outgoing-invoice-sync-preview')?.(
      { authUser: { role: 'admin' }, params: { id: 'record-1' } },
      reply,
    );

    expect(response).toEqual(result);
    expect(previewSettlementLogoOutgoingInvoiceSyncMock).toHaveBeenCalledWith('record-1', { env: {} });
  });

  it('requires admin access for Logo sales invoice sync preview', async () => {
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

    registerFinanceRoutes(app as never, {} as never);

    const response = await gets.get('/admin/finance/commission-invoices/:id/logo-isbasi/outgoing-invoice-sync-preview')?.(
      { authUser: { role: 'vendor' }, params: { id: 'record-1' } },
      reply,
    );

    expect(response).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    expect(previewSettlementLogoOutgoingInvoiceSyncMock).not.toHaveBeenCalled();
  });

  it('blocks Logo sales invoice sync persistence without backend confirmation', async () => {
    const posts = new Map<string, (request: { authUser?: { role?: string }; params?: { id: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; params?: { id: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerFinanceRoutes(app as never, {} as never);

    const blocked = await posts.get('/admin/finance/commission-invoices/:id/logo-isbasi/sales-invoice-sync')?.(
      { authUser: { role: 'admin' }, params: { id: 'record-1' }, body: {} },
      reply,
    );

    expect(blocked).toEqual({
      status: 400,
      body: expect.objectContaining({
        ok: false,
        writesPerformed: false,
        settlementCommissionInvoiceId: 'record-1',
        blockers: ['Logo sales invoice sync confirmation is required.'],
      }),
    });
    expect(persistSettlementLogoSalesInvoiceSyncMock).not.toHaveBeenCalled();
  });

  it('persists Logo sales invoice sync for admins with backend confirmation', async () => {
    const posts = new Map<string, (request: { authUser?: { id?: string; email?: string; role?: string }; params?: { id: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { id?: string; email?: string; role?: string }; params?: { id: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
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
      settlementCommissionInvoiceId: 'record-1',
      status: 'synced',
      blockers: [],
      warnings: [],
      record: { id: 'record-1', status: 'created', invoiceNo: 'REE2026000000068' },
      preview: null,
    };
    persistSettlementLogoSalesInvoiceSyncMock.mockResolvedValueOnce(result);

    registerFinanceRoutes(app as never, {} as never);

    const allowed = await posts.get('/admin/finance/commission-invoices/:id/logo-isbasi/sales-invoice-sync')?.(
      {
        authUser: { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
        params: { id: 'record-1' },
        body: { confirmLogoSalesInvoiceSync: true },
      },
      reply,
    );

    expect(allowed).toEqual(result);
    expect(persistSettlementLogoSalesInvoiceSyncMock).toHaveBeenCalledWith('record-1', {
      env: {},
      syncedBy: 'admin@example.com',
    });
  });

  it('returns conflict status when Logo sales invoice sync persistence is blocked', async () => {
    const posts = new Map<string, (request: { authUser?: { role?: string }; params?: { id: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; params?: { id: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };
    const result = {
      ok: false,
      writesPerformed: false,
      settlementCommissionInvoiceId: 'record-1',
      status: 'blocked',
      blockers: ['Logo sales invoice sync cannot be persisted because no matching Logo sales invoice was found.'],
      warnings: [],
      record: null,
      preview: null,
    };
    persistSettlementLogoSalesInvoiceSyncMock.mockResolvedValueOnce(result);

    registerFinanceRoutes(app as never, {} as never);

    const blocked = await posts.get('/admin/finance/commission-invoices/:id/logo-isbasi/sales-invoice-sync')?.(
      { authUser: { role: 'admin' }, params: { id: 'record-1' }, body: { confirmLogoSalesInvoiceSync: true } },
      reply,
    );

    expect(blocked).toEqual({ status: 409, body: result });
  });

  it('requires admin access for Logo sales invoice sync persistence', async () => {
    const posts = new Map<string, (request: { authUser?: { role?: string }; params?: { id: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; params?: { id: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerFinanceRoutes(app as never, {} as never);

    const response = await posts.get('/admin/finance/commission-invoices/:id/logo-isbasi/sales-invoice-sync')?.(
      { authUser: { role: 'vendor' }, params: { id: 'record-1' }, body: { confirmLogoSalesInvoiceSync: true } },
      reply,
    );

    expect(response).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    expect(persistSettlementLogoSalesInvoiceSyncMock).not.toHaveBeenCalled();
  });
});
