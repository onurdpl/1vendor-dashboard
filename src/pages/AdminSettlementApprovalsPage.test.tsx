import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { setCurrentUser, setCurrentVendorId, setToken } from '../lib/auth';
import { AdminSettlementApprovalsPage } from './AdminSettlementApprovalsPage';
import {
  getDatabaseHealth,
  getSettlementApproval,
  listSettlementApprovals,
  previewSettlementApproval,
  type SettlementApproval,
  type SettlementApprovalLine,
  type SettlementApprovalListResponse,
} from '../features/finance/settlementApprovalsApi';

vi.mock('../features/finance/settlementApprovalsApi', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/settlementApprovalsApi')>(
    '../features/finance/settlementApprovalsApi',
  );
  return {
    ...actual,
    approveSettlementApproval: vi.fn(),
    cancelSettlementApproval: vi.fn(),
    createSettlementApprovalDraft: vi.fn(),
    executeSettlementLogoCommissionInvoiceCreate: vi.fn(),
    getDatabaseHealth: vi.fn(),
    getSettlementApproval: vi.fn(),
    getSettlementApprovalAudit: vi.fn(),
    getSettlementCommissionInvoiceDiagnostics: vi.fn(),
    getSettlementCommissionInvoiceRecords: vi.fn(),
    listSettlementApprovals: vi.fn(),
    persistLogoSalesInvoiceSync: vi.fn(),
    persistSettlementLogoCommissionInvoiceRequestSnapshot: vi.fn(),
    previewLogoOutgoingInvoiceSync: vi.fn(),
    previewSettlementApproval: vi.fn(),
    previewSettlementLogoCommissionInvoice: vi.fn(),
  };
});

const getDatabaseHealthMock = vi.mocked(getDatabaseHealth);
const getSettlementApprovalMock = vi.mocked(getSettlementApproval);
const listSettlementApprovalsMock = vi.mocked(listSettlementApprovals);
const previewSettlementApprovalMock = vi.mocked(previewSettlementApproval);
const rawSettlementApprovalId = '11111111-1111-1111-1111-111111111111';

const settlementLine: SettlementApprovalLine = {
  id: 'line-1',
  financeLedgerEntryId: 'fle-sale-1',
  lineType: 'SALE',
  amountMinor: 220000,
  commissionMinor: 22000,
  commissionVatMinor: 4400,
  payableImpactMinor: 193600,
  sourceSnapshotJson: {},
  storedSettlementStatus: 'ACCRUING',
  derivedSettlementStatus: 'PAYABLE',
  payoutStatus: 'pending',
  eligibilityDecision: 'included',
  eligibilityReason: 'Derived payable because fulfillment evidence exists.',
  refundDetected: false,
};

const selectedRecentApproval: SettlementApproval = {
  ok: true,
  writesPerformed: false,
  id: rawSettlementApprovalId,
  createdAt: '2026-06-10T11:00:00.000Z',
  vendorId: 'yalispor',
  status: 'approved',
  periodStart: null,
  periodEnd: null,
  currency: 'TRY',
  grossSalesMinor: 220000,
  refundTotalMinor: 0,
  commissionMinor: 22000,
  commissionVatMinor: 4400,
  netPayableMinor: 180000,
  approvedBy: 'admin-user',
  approvedAt: '2026-06-10T12:00:00.000Z',
  cancelledBy: null,
  cancelledAt: null,
  notes: 'Approved settlement review',
  sourceSnapshotJson: {},
  lines: [settlementLine],
};

const recentApprovalsResponse: SettlementApprovalListResponse = {
  ok: true,
  writesPerformed: false,
  vendorId: 'yalispor',
  approvals: [
    {
      id: rawSettlementApprovalId,
      createdAt: '2026-06-10T11:00:00.000Z',
      vendorId: 'yalispor',
      status: 'approved',
      currency: 'TRY',
      grossSalesMinor: 220000,
      netPayableMinor: 180000,
      approvedAt: '2026-06-10T12:00:00.000Z',
      lineCount: 3,
    },
    {
      id: 'approval-1',
      createdAt: '2026-06-10T09:00:00.000Z',
      vendorId: 'yalispor',
      status: 'draft',
      currency: 'TRY',
      grossSalesMinor: 759800,
      netPayableMinor: 623036,
      approvedAt: null,
      lineCount: 2,
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/finance/settlement-approvals']}>
      <AdminSettlementApprovalsPage />
    </MemoryRouter>,
  );
}

describe('Settlement Review queue cleanup', () => {
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
    getSettlementApprovalMock.mockResolvedValue(selectedRecentApproval);
    listSettlementApprovalsMock.mockResolvedValue(recentApprovalsResponse);
    previewSettlementApprovalMock.mockRejectedValue(new Error('Preview should not run on the queue page.'));
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders the settlement review queue as the primary page', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Settlement Review' })).toBeInTheDocument();
    expect(screen.getByText('Review vendor settlements before payment approval.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Settlement executive summary')).not.toBeInTheDocument();

    const queue = screen.getByLabelText('Settlement review queue');
    expect(within(queue).getByRole('heading', { name: 'Settlement Review Queue' })).toBeInTheDocument();
    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('yalispor'));

    const workflowTabs = queue.querySelector('.settlement-review-tabs') as HTMLElement;
    expect(workflowTabs).toBeTruthy();
    ['All', 'Needs Review', 'Ready for Approval', 'Refund Review', 'Vendor Hold', 'Approved', 'Paid'].forEach((label) => {
      expect(within(workflowTabs).getByText(label)).toBeInTheDocument();
    });
    ['Vendor', 'Settlement', 'Amount', 'Issues', 'Next Action', 'Updated'].forEach((column) => {
      expect(within(queue).getByRole('columnheader', { name: column })).toBeInTheDocument();
    });
    expect(within(queue).queryByRole('columnheader', { name: 'Review' })).not.toBeInTheDocument();
    expect(within(queue).queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
    ['Settlement Summary', 'Next Action', 'Payment Impact', 'Related Records', 'Timeline'].forEach((section) => {
      expect(within(queue).getByRole('heading', { name: section })).toBeInTheDocument();
    });
    expect(within(queue).queryByText('fle-sale-1')).not.toBeInTheDocument();
    expect(within(queue).queryByText(rawSettlementApprovalId)).not.toBeInTheDocument();
    expect(within(queue).getAllByText('Settlement').length).toBeGreaterThan(0);
    expect(within(queue).getAllByText(/Ref: 11111111/i).length).toBeGreaterThan(0);
    expect(within(queue).queryByText('UNKNOWN')).not.toBeInTheDocument();
    expect(within(queue).queryByText('None loaded')).not.toBeInTheDocument();
    expect(within(queue).queryByText('Not loaded')).not.toBeInTheDocument();
    expect(within(queue).queryByText('Approval detail loaded.')).not.toBeInTheDocument();
    expect(within(queue).queryByText('Waiting')).not.toBeInTheDocument();
    expect(within(queue).getAllByText('No Action Required').length).toBeGreaterThan(0);
  });

  it('removes builder, preview, stepper, audit, invoice, history, and advanced details from the queue page', async () => {
    renderPage();

    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('yalispor'));

    expect(screen.queryByText('Candidate Builder')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Candidate source' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Current Candidate Preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview Settlement' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Settlement workflow progress')).not.toBeInTheDocument();
    expect(screen.queryByText('Candidate Selected')).not.toBeInTheDocument();
    expect(screen.queryByText('Preview Reviewed')).not.toBeInTheDocument();
    expect(screen.queryByText('Draft Created')).not.toBeInTheDocument();
    expect(screen.queryByText('Audit Loaded')).not.toBeInTheDocument();
    expect(screen.queryByText('Logo Ready')).not.toBeInTheDocument();
    expect(screen.queryByText('Invoice Records')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Audit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Logo Readiness' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Commission Invoice Records' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'History' })).not.toBeInTheDocument();
    expect(screen.queryByText('Advanced Details')).not.toBeInTheDocument();
    expect(screen.queryByText(/vendor_dashboard_dev/i)).not.toBeInTheDocument();
    expect(previewSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('selects settlement rows and updates the right panel context', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('yalispor'));
    const queue = screen.getByLabelText('Settlement review queue');
    const rows = within(queue).getAllByRole('button').filter((element) => element.classList.contains('op-table-row'));
    const settlementRow = rows[0];
    expect(settlementRow).toBeTruthy();

    await user.click(settlementRow);

    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith(rawSettlementApprovalId));
    expect(settlementRow).toHaveClass('op-row-selected');
    expect(within(queue).getByRole('heading', { name: 'Settlement Summary' })).toBeInTheDocument();
    expect(within(queue).getAllByText('Yalispor').length).toBeGreaterThan(0);
    expect(within(queue).getAllByText('TRY 1,800.00').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Loaded Approval Snapshot' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load Audit' })).not.toBeInTheDocument();
    expect(screen.queryByText('Approval detail loaded.')).not.toBeInTheDocument();
  });
});
