import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { setCurrentUser, setCurrentVendorId, setToken } from '../lib/auth';
import { AdminSettlementApprovalsPage } from './AdminSettlementApprovalsPage';
import {
  approveSettlementApproval,
  cancelSettlementApproval,
  createSettlementApprovalDraft,
  getDatabaseHealth,
  getSettlementApproval,
  getSettlementApprovalAudit,
  getSettlementCommissionInvoiceDiagnostics,
  getSettlementCommissionInvoiceRecords,
  previewSettlementApproval,
  previewSettlementLogoCommissionInvoice,
  type SettlementApproval,
  type SettlementApprovalAudit,
  type SettlementApprovalPreview,
  type SettlementCommissionInvoiceDiagnostics,
  type SettlementCommissionInvoiceRecordsResponse,
  type SettlementLogoCommissionInvoicePreview,
} from '../features/finance/settlementApprovalsApi';

vi.mock('../features/finance/settlementApprovalsApi', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/settlementApprovalsApi')>(
    '../features/finance/settlementApprovalsApi',
  );
  return {
    ...actual,
    getDatabaseHealth: vi.fn(),
    previewSettlementApproval: vi.fn(),
    createSettlementApprovalDraft: vi.fn(),
    getSettlementApproval: vi.fn(),
    approveSettlementApproval: vi.fn(),
    cancelSettlementApproval: vi.fn(),
    getSettlementApprovalAudit: vi.fn(),
    previewSettlementLogoCommissionInvoice: vi.fn(),
    getSettlementCommissionInvoiceRecords: vi.fn(),
    getSettlementCommissionInvoiceDiagnostics: vi.fn(),
  };
});

const getDatabaseHealthMock = vi.mocked(getDatabaseHealth);
const previewSettlementApprovalMock = vi.mocked(previewSettlementApproval);
const createSettlementApprovalDraftMock = vi.mocked(createSettlementApprovalDraft);
const getSettlementApprovalMock = vi.mocked(getSettlementApproval);
const approveSettlementApprovalMock = vi.mocked(approveSettlementApproval);
const cancelSettlementApprovalMock = vi.mocked(cancelSettlementApproval);
const getSettlementApprovalAuditMock = vi.mocked(getSettlementApprovalAudit);
const previewSettlementLogoCommissionInvoiceMock = vi.mocked(previewSettlementLogoCommissionInvoice);
const getSettlementCommissionInvoiceRecordsMock = vi.mocked(getSettlementCommissionInvoiceRecords);
const getSettlementCommissionInvoiceDiagnosticsMock = vi.mocked(getSettlementCommissionInvoiceDiagnostics);

const previewResponse: SettlementApprovalPreview = {
  ok: true,
  writesPerformed: false,
  vendorId: 'yalispor',
  periodStart: null,
  periodEnd: null,
  summary: {
    grossSalesMinor: 120000,
    refundTotalMinor: 10000,
    commissionMinor: 12000,
    commissionVatMinor: 2400,
    netPayableMinor: 95600,
    currency: 'TRY',
    eligibleRowCount: 2,
    excludedActiveApprovalRowCount: 0,
    detectedCommissionRates: [10],
    detectedCommissionVatRates: [20],
    detectedShippingModes: ['DISABLED'],
    detectedFinancialProfileSnapshotIds: ['profile-current'],
    mixedCommissionRate: false,
    mixedCommissionVatRate: false,
    mixedShippingMode: false,
    candidateQualityWarnings: ['Vendor-wide preview can include historical or test rows.'],
  },
  lines: [
    {
      financeLedgerEntryId: 'fle-sale-1',
      lineType: 'SALE',
      amountMinor: 120000,
      commissionMinor: 12000,
      commissionVatMinor: 2400,
      payableImpactMinor: 105600,
      sourceSnapshotJson: {},
      eligibilityDecision: 'included',
      eligibilityReason: 'Derived payable because fulfillment evidence exists.',
    },
  ],
};

const lockedRowsPreviewResponse: SettlementApprovalPreview = {
  ...previewResponse,
  summary: {
    ...previewResponse.summary,
    grossSalesMinor: 0,
    refundTotalMinor: 0,
    commissionMinor: 0,
    commissionVatMinor: 0,
    netPayableMinor: 0,
    eligibleRowCount: 0,
    excludedActiveApprovalRowCount: 12,
  },
  lines: [],
};

const mixedVatPreviewResponse: SettlementApprovalPreview = {
  ...previewResponse,
  summary: {
    ...previewResponse.summary,
    detectedCommissionVatRates: [18, 20],
    mixedCommissionVatRate: true,
    candidateQualityWarnings: [
      'Candidate rows include mixed commission VAT rates. Logo readiness will block mixed VAT settlements.',
    ],
  },
};

const draftApproval: SettlementApproval = {
  ok: true,
  writesPerformed: true,
  id: 'approval-1',
  vendorId: 'yalispor',
  status: 'draft',
  periodStart: null,
  periodEnd: null,
  currency: 'TRY',
  grossSalesMinor: 120000,
  refundTotalMinor: 10000,
  commissionMinor: 12000,
  commissionVatMinor: 2400,
  netPayableMinor: 95600,
  approvedBy: null,
  approvedAt: null,
  cancelledBy: null,
  cancelledAt: null,
  notes: 'Admin settlement approval draft',
  sourceSnapshotJson: { eligibleRowCount: 2 },
  lines: previewResponse.lines,
};

const approvedApproval: SettlementApproval = {
  ...draftApproval,
  status: 'approved',
  approvedBy: 'admin-user',
  approvedAt: '2026-06-10T10:00:00.000Z',
};

const cancelledApproval: SettlementApproval = {
  ...approvedApproval,
  status: 'cancelled',
  cancelledBy: 'admin-user',
  cancelledAt: '2026-06-10T10:05:00.000Z',
};

const auditResponse: SettlementApprovalAudit = {
  approvalId: 'approval-1',
  status: 'draft',
  totals: {
    grossSalesMinor: 120000,
    refundTotalMinor: 10000,
    commissionMinor: 12000,
    commissionVatMinor: 2400,
    netPayableMinor: 95600,
    currency: 'TRY',
  },
  lines: [
    {
      financeLedgerEntryId: 'fle-sale-1',
      storedSettlementStatus: 'ACCRUING',
      derivedSettlementStatus: 'PAYABLE',
      payoutStatus: 'pending',
      eligibilityDecision: 'included',
      eligibilityReason: 'Derived payable because fulfillment evidence exists.',
    },
  ],
};

const logoPreviewResponse: SettlementLogoCommissionInvoicePreview = {
  ok: false,
  writesPerformed: false,
  settlementApprovalId: 'approval-1',
  readiness: {
    canCreateLogoInvoiceLater: false,
    blockers: ['Vendor must have logoIsbasiCustomerCode before Logo invoice creation.'],
    warnings: ['Read-only preview only. No Logo invoice is created.'],
  },
  amounts: {
    commissionAmount: 120,
    commissionVatAmount: 24,
    expectedGrossInvoiceAmount: 144,
    currency: 'TRY',
    taxRate: 20,
    vatIncluded: false,
  },
  vendorBillingReadiness: {
    complete: false,
    missingFields: ['taxNumber'],
    logoCustomerCodePresent: false,
    logoCustomerIdPresent: false,
    logoEinvoiceEligible: null,
  },
  vatRateSource: 'settlement_line_snapshots',
  detectedVatRates: [20],
  configuredVendorCommissionVatPercent: 20,
  executionSnapshotGuard: {
    ok: true,
    blockers: [],
    warnings: [],
    snapshotCompleteness: {
      settlementApprovalFound: true,
      settlementApprovalStatus: 'APPROVED',
      lineCount: 1,
      executionLineCount: 1,
      commissionPercentSnapshot: {
        present: true,
        missingLineIds: [],
        resolvedFromLedgerLineIds: [],
      },
      commissionVatPercentSnapshot: {
        present: true,
        missingLineIds: [],
        resolvedFromLedgerLineIds: [],
      },
    },
    detectedCommissionRates: [10],
    detectedCommissionVatRates: [20],
    detectedShippingModes: ['disabled'],
    requiredSnapshotsPresent: true,
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

const invoiceRecordsResponse: SettlementCommissionInvoiceRecordsResponse = {
  ok: true,
  writesPerformed: false,
  settlementApprovalId: 'approval-1',
  records: [
    {
      id: 'invoice-record-1',
      createdAt: '2026-06-10T10:01:00.000Z',
      updatedAt: '2026-06-10T10:01:00.000Z',
      settlementApprovalId: 'approval-1',
      vendorId: 'yalispor',
      provider: 'logo_isbasi',
      status: 'pending',
      providerInvoiceId: null,
      providerUuid: null,
      providerEttn: null,
      invoiceNo: null,
      failureCode: null,
      failureMessage: null,
      failedAt: null,
      retryCount: 0,
      lastRetriedAt: null,
      cancelledAt: null,
    },
  ],
};

const diagnosticsResponse: SettlementCommissionInvoiceDiagnostics = {
  ok: true,
  writesPerformed: false,
  record: {
    id: 'invoice-record-1',
    settlementApprovalId: 'approval-1',
    vendorId: 'yalispor',
    provider: 'logo_isbasi',
    status: 'pending',
    retryCount: 0,
    providerIdentifiers: {
      providerInvoiceId: null,
      providerUuid: null,
      providerEttn: null,
      invoiceNo: null,
    },
    timestamps: {
      createdAt: '2026-06-10T10:01:00.000Z',
      updatedAt: '2026-06-10T10:01:00.000Z',
      failedAt: null,
      lastRetriedAt: null,
      cancelledAt: null,
      documentFetchedAt: null,
    },
    snapshots: {
      request: {
        present: true,
        type: 'object',
        topLevelKeys: ['payload'],
        approximateSizeBytes: 20,
      },
      response: {
        present: false,
        type: 'null',
        topLevelKeys: [],
        approximateSizeBytes: 0,
      },
      document: {
        present: false,
        type: 'null',
        topLevelKeys: [],
        approximateSizeBytes: 0,
      },
    },
    failure: {
      failureCode: null,
      failureMessage: null,
    },
  },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/finance/settlement-approvals']}>
      <AdminSettlementApprovalsPage />
    </MemoryRouter>,
  );
}

describe('Finance Settlement approval admin UI', () => {
  beforeEach(() => {
    cleanup();
    vi.resetAllMocks();
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['yalispor'],
      vendorDetails: [{ vendorId: 'yalispor', vendorName: 'Yalispor' }],
      canSwitchVendors: true,
      defaultVendorId: 'yalispor',
    });
    setCurrentVendorId('yalispor');
    getDatabaseHealthMock.mockResolvedValue({
      ok: true,
      environment: 'test',
      financeAuditMetadata: {
        environment: 'test',
        databaseHost: 'localhost',
        databaseName: 'vendor_dashboard_dev',
        schemaReady: true,
        databaseSourceLabel: 'local',
        warnings: [],
      },
      databaseSource: {
        duplicateDatabaseUrlDefinitionsDetected: false,
        warnings: [],
      },
    });
    previewSettlementApprovalMock.mockResolvedValue(previewResponse);
    createSettlementApprovalDraftMock.mockResolvedValue(draftApproval);
    getSettlementApprovalMock.mockResolvedValue(draftApproval);
    approveSettlementApprovalMock.mockResolvedValue(approvedApproval);
    cancelSettlementApprovalMock.mockResolvedValue(cancelledApproval);
    getSettlementApprovalAuditMock.mockResolvedValue(auditResponse);
    previewSettlementLogoCommissionInvoiceMock.mockResolvedValue(logoPreviewResponse);
    getSettlementCommissionInvoiceRecordsMock.mockResolvedValue(invoiceRecordsResponse);
    getSettlementCommissionInvoiceDiagnosticsMock.mockResolvedValue(diagnosticsResponse);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the admin settlement approval page and database source banner', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Settlement Approvals' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Guided settlement workflow' })).toBeInTheDocument();
    expect(screen.getByText('Next: Preview settlement candidates.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Preview Settlement \(read-only\)/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/vendor_dashboard_dev/i)).toBeInTheDocument());
  });

  it('loads settlement preview totals and sample lines', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Preview Settlement \(read-only\)/i }));

    await waitFor(() => expect(previewSettlementApprovalMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      periodStart: null,
      periodEnd: null,
    }));
    expect(screen.getByText('fle-sale-1')).toBeInTheDocument();
    expect(screen.getByText('Eligible lines')).toBeInTheDocument();
    expect(screen.getByText('TRY')).toBeInTheDocument();
    expect(screen.getAllByText('Vendor-wide preview can include historical or test rows.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('profile-current').length).toBeGreaterThan(0);
    expect(screen.getByText('Next: Review candidate quality warnings.')).toBeInTheDocument();
    expect(screen.getAllByText('Settlement Preview').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
  });

  it('sends period filters to preview and draft creation', async () => {
    renderPage();

    await userEvent.type(screen.getByLabelText(/Period start/i), '2026-06-01');
    await userEvent.type(screen.getByLabelText(/Period end/i), '2026-06-30');
    await userEvent.click(screen.getByRole('button', { name: /Preview Settlement \(read-only\)/i }));

    await waitFor(() => expect(previewSettlementApprovalMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
    }));
    expect(screen.getAllByText('Start 2026-06-01 · End 2026-06-30').length).toBeGreaterThan(0);

    await userEvent.click(await screen.findByRole('button', { name: /Create Draft from preview \(writes local DB\)/i }));
    await waitFor(() => expect(createSettlementApprovalDraftMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      notes: 'Admin settlement approval draft',
    }));
  });

  it('calls draft, approve, cancel, and fetch routes through the approval controls', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Preview Settlement \(read-only\)/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Create Draft from preview \(writes local DB\)/i }));

    await waitFor(() => expect(createSettlementApprovalDraftMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      periodStart: null,
      periodEnd: null,
      notes: 'Admin settlement approval draft',
    }));

    await userEvent.click(screen.getByRole('button', { name: /Approve DRAFT \(writes local DB\)/i }));
    await waitFor(() => expect(approveSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));

    const approvalInput = screen.getByLabelText(/Approval id/i);
    await userEvent.clear(approvalInput);
    await userEvent.type(approvalInput, 'approval-1');
    await userEvent.click(screen.getByRole('button', { name: /Fetch approval detail \(read-only\)/i }));
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));

    await userEvent.click(screen.getByRole('button', { name: /Cancel DRAFT\/APPROVED \(writes local DB\)/i }));
    await waitFor(() => expect(cancelSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));
  });

  it('renders audit eligibility reason and Logo readiness blockers and warnings', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Preview Settlement \(read-only\)/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Create Draft from preview \(writes local DB\)/i }));
    await userEvent.click(screen.getByRole('button', { name: /Approve DRAFT \(writes local DB\)/i }));
    await waitFor(() => expect(approveSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));
    await userEvent.click(screen.getByRole('button', { name: /Load audit snapshot \(read-only\)/i }));
    await waitFor(() => expect(screen.getByText('Derived payable because fulfillment evidence exists.')).toBeInTheDocument());
    expect(screen.getByText('Next: Run Logo Readiness.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Run Logo readiness preview \(read-only\)/i }));
    await waitFor(() => expect(screen.getByText('Vendor must have logoIsbasiCustomerCode before Logo invoice creation.')).toBeInTheDocument());
    expect(screen.getByText('Read-only preview only. No Logo invoice is created.')).toBeInTheDocument();
    expect(screen.getByText('Execution snapshot guard')).toBeInTheDocument();
    expect(screen.getAllByText('Pass').length).toBeGreaterThan(0);
    expect(screen.getByText('disabled')).toBeInTheDocument();
    expect(screen.getByText('SPORGYM-COMMISSION')).toBeInTheDocument();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  });

  it('renders active commission invoice warning and diagnostics metadata', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Preview Settlement \(read-only\)/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Create Draft from preview \(writes local DB\)/i }));
    await userEvent.click(screen.getByRole('button', { name: /Approve DRAFT \(writes local DB\)/i }));
    await userEvent.click(screen.getByRole('button', { name: /Load audit snapshot \(read-only\)/i }));
    await waitFor(() => expect(getSettlementApprovalAuditMock).toHaveBeenCalledWith('approval-1'));
    await userEvent.click(screen.getByRole('button', { name: /Run Logo readiness preview \(read-only\)/i }));
    await waitFor(() => expect(previewSettlementLogoCommissionInvoiceMock).toHaveBeenCalledWith('approval-1'));
    await userEvent.click(screen.getByRole('button', { name: /Load commission invoice records \(read-only\)/i }));

    await waitFor(() => expect(screen.getByText('Active commission invoice record exists.')).toBeInTheDocument());
    expect(screen.getByText('invoice-record-1')).toBeInTheDocument();

    const invoicePanel = screen.getByText('invoice-record-1').closest('.op-meta-group') ?? document.body;
    await userEvent.click(within(invoicePanel as HTMLElement).getByRole('button', { name: /Read diagnostics \(read-only\)/i }));
    await waitFor(() => expect(getSettlementCommissionInvoiceDiagnosticsMock).toHaveBeenCalledWith('invoice-record-1'));
    expect(screen.getByText('Diagnostics invoice-record-1')).toBeInTheDocument();
    expect(screen.getByText(/Present · object/i)).toBeInTheDocument();
  });

  it('keeps approval workflow context after a zero-eligible preview with active locked rows', async () => {
    previewSettlementApprovalMock
      .mockResolvedValueOnce(previewResponse)
      .mockResolvedValueOnce(lockedRowsPreviewResponse);

    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Preview Settlement \(read-only\)/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Create Draft from preview \(writes local DB\)/i }));
    await waitFor(() => expect(screen.getAllByText('approval-1').length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole('button', { name: /Approve DRAFT \(writes local DB\)/i }));
    await waitFor(() => expect(approveSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));

    await userEvent.click(screen.getByRole('button', { name: /Load audit snapshot \(read-only\)/i }));
    await waitFor(() => expect(screen.getByText('Derived payable because fulfillment evidence exists.')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Run Logo readiness preview \(read-only\)/i }));
    await waitFor(() => expect(screen.getByText('Vendor must have logoIsbasiCustomerCode before Logo invoice creation.')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Load commission invoice records \(read-only\)/i }));
    await waitFor(() => expect(screen.getByText('invoice-record-1')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Preview Settlement \(read-only\)/i }));

    await waitFor(() => expect(previewSettlementApprovalMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText('No eligible rows remain because rows are already locked in an active settlement approval.')).toBeInTheDocument();
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
    expect(screen.getAllByText('approval-1').length).toBeGreaterThan(0);
    expect(screen.getByText('Derived payable because fulfillment evidence exists.')).toBeInTheDocument();
    expect(screen.getByText('Vendor must have logoIsbasiCustomerCode before Logo invoice creation.')).toBeInTheDocument();
    expect(screen.getByText('invoice-record-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fetch approval detail \(read-only\)/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Load audit snapshot \(read-only\)/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Run Logo readiness preview \(read-only\)/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Load commission invoice records \(read-only\)/i })).toBeEnabled();
  });

  it('requires acknowledgement before creating a mixed VAT draft', async () => {
    previewSettlementApprovalMock.mockResolvedValue(mixedVatPreviewResponse);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Preview Settlement \(read-only\)/i }));

    await waitFor(() => expect(
      screen.getAllByText('Candidate rows include mixed commission VAT rates. Logo readiness will block mixed VAT settlements.').length,
    ).toBeGreaterThan(0));
    expect(screen.getByText('Mixed VAT acknowledgement required before draft creation.')).toBeInTheDocument();
    expect(screen.getByText('Candidate Quality Review')).toBeInTheDocument();
    expect(screen.getAllByText('Warning').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Create Draft from preview \(writes local DB\)/i })).toBeDisabled();

    await userEvent.click(screen.getByLabelText(/I acknowledge this preview contains mixed commission VAT rates/i));
    expect(screen.getByRole('button', { name: /Create Draft from preview \(writes local DB\)/i })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: /Create Draft from preview \(writes local DB\)/i }));
    await waitFor(() => expect(createSettlementApprovalDraftMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      periodStart: null,
      periodEnd: null,
      notes: 'Admin settlement approval draft',
    }));
  });

  it('does not reference any Logo create route in the settlement approval UI files', () => {
    const pageSource = readFileSync('src/pages/AdminSettlementApprovalsPage.tsx', 'utf8');
    const apiSource = readFileSync('src/features/finance/settlementApprovalsApi.ts', 'utf8');

    expect(`${pageSource}\n${apiSource}`).not.toMatch(/test-create-invoice|create-invoice|\/logo[^'\"]*create/i);
  });
});
