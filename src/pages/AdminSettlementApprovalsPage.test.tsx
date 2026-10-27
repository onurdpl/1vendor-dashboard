import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { setCurrentUser, setCurrentVendorId, setToken } from '../lib/auth';
import { AdminSettlementApprovalsPage } from './AdminSettlementApprovalsPage';
import {
  approveSettlementApproval,
  cancelSettlementApproval,
  getDatabaseHealth,
  getSettlementApproval,
  getSettlementApprovalReadiness,
  listSettlementApprovals,
  previewSettlementApproval,
  type SettlementApproval,
  type SettlementApprovalLine,
  type SettlementApprovalListResponse,
  type SettlementApprovalReadiness,
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
    getSettlementApprovalReadiness: vi.fn(),
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
const getSettlementApprovalReadinessMock = vi.mocked(getSettlementApprovalReadiness);
const listSettlementApprovalsMock = vi.mocked(listSettlementApprovals);
const previewSettlementApprovalMock = vi.mocked(previewSettlementApproval);
const approveSettlementApprovalMock = vi.mocked(approveSettlementApproval);
const cancelSettlementApprovalMock = vi.mocked(cancelSettlementApproval);
const rawSettlementApprovalId = '11111111-1111-1111-1111-111111111111';

const blockedReadiness: SettlementApprovalReadiness = {
  ok: true, writesPerformed: false, settlementApprovalId: 'approval-1', vendorId: 'yalispor',
  currency: 'TRY', status: 'DRAFT', classification: 'BLOCKED', adminReviewRequired: true,
  sourceValidation: { evaluated: true, ok: false, reasons: [
    { settlementApprovalLineId: 'line-1', financeLedgerEntryId: 'fle-sale-1',
      code: 'refund_arrived_after_draft', reason: 'Refund arrived after draft creation' },
  ] },
  blockers: ['Refund arrived after draft creation'], missingEvidence: [],
};

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

const refundSettlementLine: SettlementApprovalLine = {
  id: 'line-refund-1',
  financeLedgerEntryId: 'fle-refund-1',
  lineType: 'REFUND',
  amountMinor: -54000,
  commissionMinor: 0,
  commissionVatMinor: 0,
  payableImpactMinor: -54000,
  sourceSnapshotJson: {},
  storedSettlementStatus: 'REFUNDED',
  derivedSettlementStatus: 'REFUNDED',
  payoutStatus: 'pending',
  eligibilityDecision: 'included',
  eligibilityReason: 'Refund offset captured for settlement review.',
  refundDetected: true,
  refundCount: 1,
  shippingEvidencePresent: false,
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

const selectedDraftRefundApproval: SettlementApproval = {
  ok: true,
  writesPerformed: false,
  id: 'approval-1',
  createdAt: '2026-06-10T09:00:00.000Z',
  vendorId: 'yalispor',
  status: 'draft',
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-06-10T00:00:00.000Z',
  currency: 'TRY',
  grossSalesMinor: 759800,
  refundTotalMinor: 54000,
  commissionMinor: 98000,
  commissionVatMinor: 19600,
  netPayableMinor: 623036,
  approvedBy: null,
  approvedAt: null,
  cancelledBy: null,
  cancelledAt: null,
  notes: 'Draft settlement review',
  sourceSnapshotJson: {},
  lines: [settlementLine, refundSettlementLine],
};

const approvedDraftRefundApproval: SettlementApproval = {
  ...selectedDraftRefundApproval,
  status: 'approved',
  approvedBy: 'admin-user',
  approvedAt: '2026-06-10T13:00:00.000Z',
};

const cancelledDraftRefundApproval: SettlementApproval = {
  ...selectedDraftRefundApproval,
  status: 'cancelled',
  cancelledBy: 'admin-user',
  cancelledAt: '2026-06-10T13:30:00.000Z',
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

const approvalsAfterApproveResponse: SettlementApprovalListResponse = {
  ...recentApprovalsResponse,
  approvals: recentApprovalsResponse.approvals.map((approval) =>
    approval.id === selectedDraftRefundApproval.id
      ? {
          ...approval,
          status: 'approved',
          approvedAt: approvedDraftRefundApproval.approvedAt,
        }
      : approval,
  ),
};

const approvalsAfterCancelResponse: SettlementApprovalListResponse = {
  ...recentApprovalsResponse,
  approvals: recentApprovalsResponse.approvals.map((approval) =>
    approval.id === selectedDraftRefundApproval.id
      ? {
          ...approval,
          status: 'cancelled',
        }
      : approval,
  ),
};

function getStyleBlock(styles: string, selector: string) {
  const start = styles.indexOf(selector);
  const end = styles.indexOf('}', start);
  return start >= 0 && end > start ? styles.slice(start, end + 1) : '';
}

function renderPage(initialEntry = '/admin/finance/settlement-approvals') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AdminSettlementApprovalsPage />
    </MemoryRouter>,
  );
}

function getQueueRows(queue: HTMLElement) {
  return within(queue).getAllByRole('button').filter((element) => element.classList.contains('op-table-row'));
}

function getDraftSettlementRow(queue: HTMLElement) {
  const row = getQueueRows(queue).find((element) => within(element).queryByText('Gross TRY 7,598.00'));
  if (!row) {
    throw new Error('Draft settlement row was not found.');
  }
  return row;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function vendorApprovalList(vendorId: string, id: string): SettlementApprovalListResponse {
  return {
    ...recentApprovalsResponse,
    vendorId,
    approvals: [{ ...recentApprovalsResponse.approvals[0], id, vendorId }],
  };
}

function selectQueueVendor(vendorId: string) {
  fireEvent.change(screen.getByPlaceholderText('Vendor id'), { target: { value: vendorId } });
}

function DeepLinkNavigationProbe() {
  const navigate = useNavigate();
  return <>
    <button onClick={() => navigate('/admin/finance/settlement-approvals')}>Clear link</button>
    <button onClick={() => navigate('/admin/finance/settlement-approvals?approvalId=approval-a')}>Restore link</button>
  </>;
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
    getSettlementApprovalMock.mockImplementation(async (id: string) =>
      id === selectedDraftRefundApproval.id ? selectedDraftRefundApproval : selectedRecentApproval,
    );
    getSettlementApprovalReadinessMock.mockResolvedValue(blockedReadiness);
    listSettlementApprovalsMock.mockResolvedValue(recentApprovalsResponse);
    previewSettlementApprovalMock.mockRejectedValue(new Error('Preview should not run on the queue page.'));
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('opens an explicit replacement deep link from the scheduled settlement page', async () => {
    const linked = { ...selectedRecentApproval, id: 'replacement-draft-id', vendorId: 'replacement-vendor' };
    getSettlementApprovalMock.mockResolvedValue(linked);
    renderPage('/admin/finance/settlement-approvals?approvalId=replacement-draft-id');

    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('replacement-draft-id'));
    await waitFor(() => expect(screen.getByPlaceholderText('Vendor id')).toHaveValue('replacement-vendor'));
  });

  it('hides the previous vendor rows and actions immediately, and keeps them hidden after a failed request or empty filter', async () => {
    const vendorB = deferred<SettlementApprovalListResponse>();
    listSettlementApprovalsMock.mockImplementation((id) =>
      id === 'vendor-b' ? vendorB.promise : Promise.resolve(recentApprovalsResponse));
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));

    selectQueueVendor('vendor-b');
    expect(getQueueRows(queue)).toHaveLength(0);
    expect(within(queue).queryByRole('button', { name: 'Approve Settlement' })).not.toBeInTheDocument();
    expect(within(queue).queryByRole('button', { name: 'Cancel Settlement' })).not.toBeInTheDocument();
    expect(within(queue).getByText('Loading recent approvals...')).toBeInTheDocument();

    await act(async () => vendorB.reject(new Error('Vendor B unavailable')));
    expect(within(queue).getByText('No settlement approvals found.')).toBeInTheDocument();
    expect(getQueueRows(queue)).toHaveLength(0);
    selectQueueVendor('');
    expect(getQueueRows(queue)).toHaveLength(0);
    expect(listSettlementApprovalsMock).not.toHaveBeenCalledWith('');
  });

  it('rejects a list response whose envelope or settlement row belongs to another vendor', async () => {
    listSettlementApprovalsMock.mockImplementation(async (id) =>
      id === 'vendor-b'
        ? { ...vendorApprovalList('vendor-b', 'approval-b'), approvals: recentApprovalsResponse.approvals }
        : recentApprovalsResponse);
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    selectQueueVendor('vendor-b');
    await waitFor(() => expect(screen.getByText('Settlement list vendor identity did not match the selected vendor.')).toBeInTheDocument());
    expect(getQueueRows(queue)).toHaveLength(0);
  });

  it('ignores out-of-order A and B list responses after the filter reaches C', async () => {
    const responses = {
      yalispor: deferred<SettlementApprovalListResponse>(),
      'vendor-b': deferred<SettlementApprovalListResponse>(),
      'vendor-c': deferred<SettlementApprovalListResponse>(),
    };
    listSettlementApprovalsMock.mockImplementation((id) => responses[id as keyof typeof responses].promise);
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    selectQueueVendor('vendor-b');
    selectQueueVendor('vendor-c');
    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('vendor-c'));

    await act(async () => responses.yalispor.resolve(recentApprovalsResponse));
    await act(async () => responses['vendor-b'].resolve(vendorApprovalList('vendor-b', 'approval-b')));
    expect(getQueueRows(queue)).toHaveLength(0);
    await act(async () => responses['vendor-c'].resolve(vendorApprovalList('vendor-c', 'approval-c')));
    expect(getQueueRows(queue)).toHaveLength(1);
    expect(within(getQueueRows(queue)[0]).getByText('vendor-c')).toBeInTheDocument();
  });

  it('does not let a late A detail response change the selected B vendor or detail', async () => {
    const delayedA = deferred<SettlementApproval>();
    const vendorBDetail = { ...selectedRecentApproval, id: 'approval-b', vendorId: 'vendor-b' };
    getSettlementApprovalMock.mockImplementation((id) =>
      id === selectedDraftRefundApproval.id ? delayedA.promise : Promise.resolve(vendorBDetail));
    listSettlementApprovalsMock.mockImplementation(async (id) =>
      id === 'vendor-b' ? vendorApprovalList('vendor-b', 'approval-b') : recentApprovalsResponse);
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    await user.click(getDraftSettlementRow(queue));
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));

    selectQueueVendor('vendor-b');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(1));
    await user.click(getQueueRows(queue)[0]);
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('approval-b'));
    await act(async () => delayedA.resolve(selectedDraftRefundApproval));
    expect(screen.getByPlaceholderText('Vendor id')).toHaveValue('vendor-b');
    expect(getQueueRows(queue)).toHaveLength(1);
    expect(within(queue).getAllByText('vendor-b').length).toBeGreaterThan(0);
  });

  it('does not show an old vendor detail error under the new vendor', async () => {
    const delayedA = deferred<SettlementApproval>();
    getSettlementApprovalMock.mockReturnValue(delayedA.promise);
    listSettlementApprovalsMock.mockImplementation(async (id) =>
      id === 'vendor-b' ? vendorApprovalList('vendor-b', 'approval-b') : recentApprovalsResponse);
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    await user.click(getDraftSettlementRow(queue));
    selectQueueVendor('vendor-b');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(1));
    await act(async () => delayedA.reject(new Error('Old vendor detail failed')));
    expect(screen.queryByText('Old vendor detail failed')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Vendor id')).toHaveValue('vendor-b');
  });

  it('preserves the explicit vendor selection when a deep-link detail arrives late', async () => {
    const delayedLink = deferred<SettlementApproval>();
    getSettlementApprovalMock.mockReturnValue(delayedLink.promise);
    listSettlementApprovalsMock.mockImplementation(async (id) =>
      id === 'vendor-b' ? vendorApprovalList('vendor-b', 'approval-b') : recentApprovalsResponse);
    renderPage('/admin/finance/settlement-approvals?approvalId=approval-a');
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('approval-a'));
    selectQueueVendor('vendor-b');
    await act(async () => delayedLink.resolve({ ...selectedRecentApproval, id: 'approval-a', vendorId: 'yalispor' }));
    expect(screen.getByPlaceholderText('Vendor id')).toHaveValue('vendor-b');
    expect(getQueueRows(screen.getByLabelText('Settlement review queue'))).toHaveLength(1);
    expect(within(screen.getByLabelText('Settlement review queue')).getAllByText('vendor-b').length).toBeGreaterThan(0);
  });

  it('ignores repeated late responses for the same deep link after an explicit vendor change', async () => {
    const first = deferred<SettlementApproval>();
    const second = deferred<SettlementApproval>();
    getSettlementApprovalMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    listSettlementApprovalsMock.mockImplementation(async (id) =>
      id === 'vendor-b' ? vendorApprovalList('vendor-b', 'approval-b') : recentApprovalsResponse);
    render(
      <MemoryRouter initialEntries={['/admin/finance/settlement-approvals?approvalId=approval-a']}>
        <DeepLinkNavigationProbe />
        <AdminSettlementApprovalsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledTimes(1));
    selectQueueVendor('vendor-b');
    fireEvent.click(screen.getByRole('button', { name: 'Clear link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore link' }));
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledTimes(2));
    await act(async () => second.resolve({ ...selectedRecentApproval, id: 'approval-a', vendorId: 'yalispor' }));
    await act(async () => first.resolve({ ...selectedRecentApproval, id: 'approval-a', vendorId: 'yalispor' }));
    expect(screen.getByPlaceholderText('Vendor id')).toHaveValue('vendor-b');
    expect(getQueueRows(screen.getByLabelText('Settlement review queue'))).toHaveLength(1);
  });

  it('does not apply an old vendor mutation refetch after the new vendor list has loaded', async () => {
    const oldRefetch = deferred<SettlementApprovalListResponse>();
    let oldVendorCalls = 0;
    listSettlementApprovalsMock.mockImplementation((id) => {
      if (id === 'vendor-b') return Promise.resolve(vendorApprovalList('vendor-b', 'approval-b'));
      oldVendorCalls += 1;
      return oldVendorCalls === 1 ? Promise.resolve(recentApprovalsResponse) : oldRefetch.promise;
    });
    getSettlementApprovalMock.mockResolvedValue(selectedDraftRefundApproval);
    approveSettlementApprovalMock.mockResolvedValue(approvedDraftRefundApproval);
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    await user.click(getDraftSettlementRow(queue));
    await user.click(within(queue).getByRole('button', { name: 'Approve Settlement' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Approve Settlement' })).getByRole('button', { name: 'Approve Settlement' }));
    await waitFor(() => expect(oldVendorCalls).toBe(2));

    selectQueueVendor('vendor-b');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(1));
    await act(async () => oldRefetch.resolve(approvalsAfterApproveResponse));
    expect(screen.getByPlaceholderText('Vendor id')).toHaveValue('vendor-b');
    expect(getQueueRows(queue)).toHaveLength(1);
    expect(within(getQueueRows(queue)[0]).getByText('vendor-b')).toBeInTheDocument();
  });

  it('does not apply an old vendor detail refetch after a vendor switch', async () => {
    const oldDetailRefetch = deferred<SettlementApproval>();
    let detailCalls = 0;
    getSettlementApprovalMock.mockImplementation((id) => {
      if (id !== 'approval-1') return Promise.resolve(selectedRecentApproval);
      detailCalls += 1;
      return detailCalls === 1 ? Promise.resolve(selectedDraftRefundApproval) : oldDetailRefetch.promise;
    });
    listSettlementApprovalsMock.mockImplementation(async (id) =>
      id === 'vendor-b' ? vendorApprovalList('vendor-b', 'approval-b') : recentApprovalsResponse);
    approveSettlementApprovalMock.mockResolvedValue(approvedDraftRefundApproval);
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    await user.click(getDraftSettlementRow(queue));
    await user.click(within(queue).getByRole('button', { name: 'Approve Settlement' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Approve Settlement' })).getByRole('button', { name: 'Approve Settlement' }));
    await waitFor(() => expect(detailCalls).toBe(2));
    selectQueueVendor('vendor-b');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(1));
    await act(async () => oldDetailRefetch.resolve(approvedDraftRefundApproval));
    expect(screen.getByPlaceholderText('Vendor id')).toHaveValue('vendor-b');
    expect(within(getQueueRows(queue)[0]).getByText('vendor-b')).toBeInTheDocument();
  });

  it('renders the settlement review queue as the primary page', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Settlement Review' })).toBeInTheDocument();
    expect(screen.getByText('Review vendor settlements before payment approval.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Settlement executive summary')).not.toBeInTheDocument();

    const queue = screen.getByLabelText('Settlement review queue');
    expect(screen.getByText('ADMIN FINANCE')).toBeInTheDocument();
    expect(within(queue).queryByRole('heading', { name: 'Settlement Review Queue' })).not.toBeInTheDocument();
    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('yalispor'));
    await within(queue).findByRole('columnheader', { name: 'Vendor' });

    const workflowTabs = queue.querySelector('.settlement-review-tabs') as HTMLElement;
    expect(workflowTabs).toBeTruthy();
    ['All', 'Summary flags', 'No summary flags', 'Refund', 'Hold', 'Approved', 'Paid'].forEach((label) => {
      expect(within(workflowTabs).getByText(label)).toBeInTheDocument();
    });
    expect(within(queue).getByText(/Queue groups and badges use summary data, not verified financial readiness/)).toBeInTheDocument();
    ['Vendor', 'Settlement', 'Amount', 'Issues', 'Next Action', 'Updated'].forEach((column) => {
      expect(within(queue).getByRole('columnheader', { name: column })).toBeInTheDocument();
    });
    expect(within(queue).queryByRole('columnheader', { name: 'Review' })).not.toBeInTheDocument();
    expect(within(queue).queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
    ['Summary', 'Next Action', 'Payment Impact', 'Related Records', 'Timeline'].forEach((section) => {
      expect(within(queue).getByRole('heading', { name: section })).toBeInTheDocument();
    });
    expect(within(queue).queryByText('fle-sale-1')).not.toBeInTheDocument();
    expect(within(queue).queryByText(rawSettlementApprovalId)).not.toBeInTheDocument();
    expect(within(queue).getAllByText('Settlement').length).toBeGreaterThan(0);
    expect(within(queue).queryByText(/Ref: 11111111/i)).not.toBeInTheDocument();
    expect(within(queue).queryByText('UNKNOWN')).not.toBeInTheDocument();
    expect(within(queue).queryByText('None loaded')).not.toBeInTheDocument();
    expect(within(queue).queryByText('Not loaded')).not.toBeInTheDocument();
    expect(within(queue).queryByText('Approval detail loaded.')).not.toBeInTheDocument();
    expect(within(queue).queryByText('Waiting')).not.toBeInTheDocument();
    expect(within(queue).getAllByText('View').length).toBeGreaterThan(0);
  });

  it('keeps admin finance queue cells and badges wrap-safe', () => {
    const styles = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');
    const tableGridSelectors = [
      '.settlement-review-table .op-table-head',
      '.scheduled-settlements-table .op-table-head',
      '.refund-adjustments-table .op-table-head',
      '.payment-preparation-table .op-table-head',
    ];

    tableGridSelectors.forEach((selector) => {
      const block = getStyleBlock(styles, selector);
      expect(block).toContain('minmax(0,');
      expect(block).not.toMatch(/minmax\(\d+px/);
    });

    const layoutBlock = getStyleBlock(styles, '.settlement-review-layout');
    expect(layoutBlock).toContain('min-width: 0;');
    expect(layoutBlock).toContain('overflow: hidden;');

    const issueListBlock = getStyleBlock(styles, '.settlement-review-issue-list');
    expect(issueListBlock).toContain('flex-wrap: wrap;');
    expect(issueListBlock).toContain('gap: 5px 6px;');
    expect(issueListBlock).toContain('min-width: 0;');

    const issueBadgeBlock = getStyleBlock(styles, '.settlement-review-issue-list .op-badge');
    expect(issueBadgeBlock).toContain('white-space: normal;');
    expect(issueBadgeBlock).toContain('overflow-wrap: anywhere;');
    expect(issueBadgeBlock).not.toContain('white-space: nowrap;');
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
    const settlementRow = await waitFor(() => {
      const rows = within(queue).getAllByRole('button').filter((element) => element.classList.contains('op-table-row'));
      if (!rows[0]) {
        throw new Error('Expected settlement queue rows to render');
      }
      return rows[0];
    });

    await user.click(settlementRow);

    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith(rawSettlementApprovalId));
    expect(settlementRow).toHaveClass('op-row-selected');
    expect(within(queue).getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(within(queue).getAllByText('Yalispor').length).toBeGreaterThan(0);
    expect(within(queue).getAllByText('TRY 1,800.00').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Loaded Approval Snapshot' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load Audit' })).not.toBeInTheDocument();
    expect(screen.queryByText('Approval detail loaded.')).not.toBeInTheDocument();
  });

  it('keeps queue classification stable when selected detail contains refund evidence', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('yalispor'));
    const queue = screen.getByLabelText('Settlement review queue');
    const tabs = within(queue).getByLabelText('Settlement review workflow tabs');
    expect(within(tabs).getByRole('button', { name: /All2/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: /Summary flags0/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: /No summary flags1/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: /Refund0/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: /Paid0/i })).toBeInTheDocument();

    const rows = within(queue).getAllByRole('button').filter((element) => element.classList.contains('op-table-row'));
    const draftRow = rows.find((row) => within(row).queryByText('Gross TRY 7,598.00')) as HTMLElement | undefined;
    const approvedRow = rows.find((row) => within(row).queryByText('Gross TRY 2,200.00')) as HTMLElement | undefined;
    expect(draftRow).toBeTruthy();
    expect(approvedRow).toBeTruthy();
    expect(within(draftRow as HTMLElement).getByText('No summary flags')).toBeInTheDocument();
    expect(within(draftRow as HTMLElement).getByText('Review for approval')).toBeInTheDocument();
    expect(within(draftRow as HTMLElement).queryByText('Refund')).not.toBeInTheDocument();
    expect(within(draftRow as HTMLElement).queryByText('Shipping')).not.toBeInTheDocument();
    expect(within(approvedRow as HTMLElement).getByText('No summary flags')).toBeInTheDocument();
    expect(within(approvedRow as HTMLElement).getByText('View')).toBeInTheDocument();

    await user.click(draftRow as HTMLElement);

    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));
    const updatedRows = within(queue).getAllByRole('button').filter((element) => element.classList.contains('op-table-row'));
    const updatedDraftRow = updatedRows.find((row) => within(row).queryByText('Gross TRY 7,598.00')) as HTMLElement | undefined;
    const updatedApprovedRow = updatedRows.find((row) => within(row).queryByText('Gross TRY 2,200.00')) as HTMLElement | undefined;
    expect(updatedDraftRow).toHaveClass('op-row-selected');
    expect(within(updatedDraftRow as HTMLElement).getByText('No summary flags')).toBeInTheDocument();
    expect(within(updatedDraftRow as HTMLElement).getByText('Review for approval')).toBeInTheDocument();
    expect(within(updatedDraftRow as HTMLElement).queryByText('Refund')).not.toBeInTheDocument();
    expect(within(updatedDraftRow as HTMLElement).queryByText('Shipping')).not.toBeInTheDocument();
    expect(within(updatedApprovedRow as HTMLElement).getByText('No summary flags')).toBeInTheDocument();
    expect(within(updatedApprovedRow as HTMLElement).getByText('View')).toBeInTheDocument();

    const updatedTabs = within(queue).getByLabelText('Settlement review workflow tabs');
    expect(within(updatedTabs).getByRole('button', { name: /All2/i })).toBeInTheDocument();
    expect(within(updatedTabs).getByRole('button', { name: /Summary flags0/i })).toBeInTheDocument();
    expect(within(updatedTabs).getByRole('button', { name: /No summary flags1/i })).toBeInTheDocument();
    expect(within(updatedTabs).getByRole('button', { name: /Refund0/i })).toBeInTheDocument();
    expect(within(updatedTabs).getByRole('button', { name: /Paid0/i })).toBeInTheDocument();

    const panel = within(queue).getByLabelText('Settlement review detail panel');
    expect(within(panel).getByText('Refund review')).toBeInTheDocument();
    expect(within(panel).getByText('Linked refund activity')).toBeInTheDocument();
    expect(within(panel).getByText('Investigate')).toBeInTheDocument();
  });

  it('shows only backend-supported settlement actions in the right panel', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('yalispor'));
    const queue = screen.getByLabelText('Settlement review queue');
    expect(within(queue).queryByRole('button', { name: 'Approve Settlement' })).not.toBeInTheDocument();
    expect(await within(queue).findByRole('button', { name: 'Cancel Settlement' })).toBeInTheDocument();

    await user.click(getDraftSettlementRow(queue));

    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));
    expect(within(queue).getByRole('button', { name: 'Approve Settlement' })).toBeInTheDocument();
    expect(within(queue).getByRole('button', { name: 'Cancel Settlement' })).toBeInTheDocument();
    expect(within(queue).queryByText('Reject')).not.toBeInTheDocument();
    expect(within(queue).queryByText('Return to Review')).not.toBeInTheDocument();
    expect(within(queue).queryByText('Mark Paid')).not.toBeInTheDocument();
    expect(within(queue).queryByText('Apply Refund')).not.toBeInTheDocument();
  });

  it('shows the selected DRAFT readiness diagnostic without approving it', async () => {
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await within(queue).findByRole('columnheader', { name: 'Vendor' });
    await user.click(getDraftSettlementRow(queue));

    await waitFor(() => expect(getSettlementApprovalReadinessMock).toHaveBeenCalledWith('approval-1'));
    const readiness = within(queue).getByLabelText('Settlement approval readiness');
    expect(await within(readiness).findByText('BLOCKED')).toBeInTheDocument();
    expect(within(readiness).getByText('Refund arrived after draft creation')).toBeInTheDocument();
    expect(within(readiness).getByText(/Admin review required/)).toBeInTheDocument();
    expect(within(queue).getByRole('button', { name: /No summary flags1/i })).toBeInTheDocument();
    expect(within(getDraftSettlementRow(queue)).getByText('No summary flags')).toBeInTheDocument();
    expect(within(getDraftSettlementRow(queue)).getByText('Review for approval')).toBeInTheDocument();
    expect(getSettlementApprovalReadinessMock).toHaveBeenCalledTimes(1);
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('shows UNKNOWN as an unverified selected DRAFT while keeping summary groups unchanged', async () => {
    getSettlementApprovalReadinessMock.mockResolvedValue({
      ...blockedReadiness,
      classification: 'UNKNOWN',
      sourceValidation: { evaluated: true, ok: true, reasons: [] },
      blockers: ['Correction authority requires Admin review'],
    });
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await within(queue).findByRole('columnheader', { name: 'Vendor' });
    await user.click(getDraftSettlementRow(queue));

    const readiness = within(queue).getByLabelText('Settlement approval readiness');
    expect(await within(readiness).findByText('UNKNOWN')).toBeInTheDocument();
    expect(within(readiness).getByText('Correction authority requires Admin review')).toBeInTheDocument();
    expect(within(queue).getByRole('button', { name: /No summary flags1/i })).toBeInTheDocument();
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('does not imply verified readiness while the selected DRAFT check is loading or fails', async () => {
    getSettlementApprovalReadinessMock.mockReturnValue(new Promise<SettlementApprovalReadiness>(() => undefined));
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await within(queue).findByRole('columnheader', { name: 'Vendor' });
    await user.click(getDraftSettlementRow(queue));

    const readiness = within(queue).getByLabelText('Settlement approval readiness');
    expect(await within(readiness).findByText('Checking current approval evidence…')).toBeInTheDocument();
    expect(within(readiness).queryByText('VERIFIED_BY_EXISTING_CHECKS')).not.toBeInTheDocument();
    expect(within(queue).getByRole('button', { name: /No summary flags1/i })).toBeInTheDocument();
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('shows readiness errors without presenting the summary candidate as financially verified', async () => {
    getSettlementApprovalReadinessMock.mockRejectedValue(new Error('Readiness check unavailable'));
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await within(queue).findByRole('columnheader', { name: 'Vendor' });
    await user.click(getDraftSettlementRow(queue));

    const readiness = within(queue).getByLabelText('Settlement approval readiness');
    expect(await within(readiness).findByText('Readiness unavailable: Readiness check unavailable')).toBeInTheDocument();
    expect(within(readiness).queryByText('VERIFIED_BY_EXISTING_CHECKS')).not.toBeInTheDocument();
    expect(within(queue).getByRole('button', { name: /No summary flags1/i })).toBeInTheDocument();
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('labels a verified selected DRAFT as a backend check, not automatic approval authority', async () => {
    getSettlementApprovalReadinessMock.mockResolvedValue({
      ...blockedReadiness,
      classification: 'VERIFIED_BY_EXISTING_CHECKS',
      sourceValidation: { evaluated: true, ok: true, reasons: [] },
      blockers: [],
    });
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await within(queue).findByRole('columnheader', { name: 'Vendor' });
    await user.click(getDraftSettlementRow(queue));

    const readiness = within(queue).getByLabelText('Settlement approval readiness');
    expect(await within(readiness).findByText('VERIFIED_BY_EXISTING_CHECKS')).toBeInTheDocument();
    expect(within(readiness).getByText(/Admin review required/)).toBeInTheDocument();
    expect(within(readiness).getByText(/manual approval revalidates current authority/)).toBeInTheDocument();
    expect(within(getDraftSettlementRow(queue)).getByText('Review for approval')).toBeInTheDocument();
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('shows the actual Sporjinal settlement and vendor in a Cancel confirmation', async () => {
    listSettlementApprovalsMock.mockImplementation(async (id) =>
      id === 'sporjinal' ? vendorApprovalList('sporjinal', 'sporjinal-approval') : recentApprovalsResponse);
    const user = userEvent.setup();
    renderPage();
    selectQueueVendor('sporjinal');
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(1));
    await user.click(within(queue).getByRole('button', { name: 'Cancel Settlement' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel Settlement' });
    expect(dialog).toHaveTextContent('Vendor: sporjinal');
    expect(dialog).toHaveTextContent('Settlement: sporjinal-approval');
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('invalidates an Approve confirmation when the vendor or selected settlement changes', async () => {
    listSettlementApprovalsMock.mockImplementation(async (id) =>
      id === 'sporjinal' ? vendorApprovalList('sporjinal', 'sporjinal-approval') : recentApprovalsResponse);
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    await user.click(getDraftSettlementRow(queue));
    await user.click(within(queue).getByRole('button', { name: 'Approve Settlement' }));
    expect(screen.getByRole('dialog', { name: 'Approve Settlement' })).toBeInTheDocument();
    await user.click(getQueueRows(queue)[0]);
    expect(screen.queryByRole('dialog', { name: 'Approve Settlement' })).not.toBeInTheDocument();

    await user.click(getDraftSettlementRow(queue));
    await user.click(within(queue).getByRole('button', { name: 'Approve Settlement' }));
    selectQueueVendor('sporjinal');
    expect(screen.queryByRole('dialog', { name: 'Approve Settlement' })).not.toBeInTheDocument();
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('invalidates a Cancel confirmation when the selected vendor changes', async () => {
    listSettlementApprovalsMock.mockImplementation(async (id) =>
      id === 'sporjinal' ? vendorApprovalList('sporjinal', 'sporjinal-approval') : recentApprovalsResponse);
    const user = userEvent.setup();
    renderPage();
    selectQueueVendor('sporjinal');
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(1));
    await user.click(within(queue).getByRole('button', { name: 'Cancel Settlement' }));
    selectQueueVendor('yalispor');
    expect(screen.queryByRole('dialog', { name: 'Cancel Settlement' })).not.toBeInTheDocument();
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('invalidates confirmation when queue filters change the visible settlement selection', async () => {
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    await user.click(getDraftSettlementRow(queue));
    await user.click(within(queue).getByRole('button', { name: 'Approve Settlement' }));
    fireEvent.change(within(queue).getByPlaceholderText('Vendor, settlement, status'), { target: { value: 'no-match' } });
    expect(screen.queryByRole('dialog', { name: 'Approve Settlement' })).not.toBeInTheDocument();
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('blocks the financial POST if the vendor changes during the read-only target check', async () => {
    const targetCheck = deferred<SettlementApproval>();
    getSettlementApprovalMock
      .mockResolvedValueOnce(selectedDraftRefundApproval)
      .mockReturnValueOnce(targetCheck.promise);
    listSettlementApprovalsMock.mockImplementation(async (id) =>
      id === 'sporjinal' ? vendorApprovalList('sporjinal', 'sporjinal-approval') : recentApprovalsResponse);
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    await user.click(getDraftSettlementRow(queue));
    await user.click(within(queue).getByRole('button', { name: 'Approve Settlement' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Approve Settlement' })).getByRole('button', { name: 'Approve Settlement' }));
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledTimes(2));
    selectQueueVendor('sporjinal');
    await act(async () => targetCheck.resolve(selectedDraftRefundApproval));
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Vendor id')).toHaveValue('sporjinal');
    expect(screen.queryByRole('dialog', { name: 'Approve Settlement' })).not.toBeInTheDocument();
  });

  it('rejects a canonical detail whose vendor does not own the confirmed settlement', async () => {
    getSettlementApprovalMock
      .mockResolvedValueOnce(selectedDraftRefundApproval)
      .mockResolvedValueOnce({ ...selectedDraftRefundApproval, vendorId: 'sporjinal' });
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    await user.click(getDraftSettlementRow(queue));
    await user.click(within(queue).getByRole('button', { name: 'Approve Settlement' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Approve Settlement' })).getByRole('button', { name: 'Approve Settlement' }));
    await waitFor(() => expect(screen.getByText('Settlement target changed. Select the settlement action again.')).toBeInTheDocument());
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Approve Settlement' })).not.toBeInTheDocument();
  });

  it('keeps a confirmation open after a read-only target-check failure without sending a POST', async () => {
    getSettlementApprovalMock
      .mockResolvedValueOnce(selectedDraftRefundApproval)
      .mockRejectedValueOnce(new Error('Target check unavailable'));
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    await user.click(getDraftSettlementRow(queue));
    await user.click(within(queue).getByRole('button', { name: 'Approve Settlement' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Approve Settlement' })).getByRole('button', { name: 'Approve Settlement' }));
    expect(await screen.findByText('Target check unavailable')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Approve Settlement' })).toBeInTheDocument();
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('uses a synchronous guard against two submits of the same confirmation', async () => {
    const targetCheck = deferred<SettlementApproval>();
    getSettlementApprovalMock
      .mockResolvedValueOnce(selectedDraftRefundApproval)
      .mockReturnValueOnce(targetCheck.promise)
      .mockResolvedValueOnce(approvedDraftRefundApproval);
    approveSettlementApprovalMock.mockResolvedValue(approvedDraftRefundApproval);
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    await user.click(getDraftSettlementRow(queue));
    await user.click(within(queue).getByRole('button', { name: 'Approve Settlement' }));
    const confirm = within(screen.getByRole('dialog', { name: 'Approve Settlement' })).getByRole('button', { name: 'Approve Settlement' });
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(getSettlementApprovalMock).toHaveBeenCalledTimes(2);
    await act(async () => targetCheck.resolve(selectedDraftRefundApproval));
    await waitFor(() => expect(approveSettlementApprovalMock).toHaveBeenCalledTimes(1));
    expect(approveSettlementApprovalMock).toHaveBeenCalledWith('approval-1');
  });

  it('keeps an in-flight POST on its original target and hides its late result under another vendor', async () => {
    const lateApproval = deferred<SettlementApproval>();
    approveSettlementApprovalMock.mockReturnValue(lateApproval.promise);
    listSettlementApprovalsMock.mockImplementation(async (id) =>
      id === 'sporjinal' ? vendorApprovalList('sporjinal', 'sporjinal-approval') : recentApprovalsResponse);
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    await user.click(getDraftSettlementRow(queue));
    await user.click(within(queue).getByRole('button', { name: 'Approve Settlement' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Approve Settlement' })).getByRole('button', { name: 'Approve Settlement' }));
    await waitFor(() => expect(approveSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));
    selectQueueVendor('sporjinal');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(1));
    expect(within(queue).getByRole('button', { name: 'Cancel Settlement' })).toBeDisabled();
    await act(async () => lateApproval.resolve(approvedDraftRefundApproval));
    await waitFor(() => expect(within(queue).getByRole('button', { name: 'Cancel Settlement' })).not.toBeDisabled());
    expect(approveSettlementApprovalMock).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText('Vendor id')).toHaveValue('sporjinal');
    expect(within(getQueueRows(queue)[0]).getByText('sporjinal')).toBeInTheDocument();
    expect(screen.queryByText('Settlement approved.')).not.toBeInTheDocument();
    expect(listSettlementApprovalsMock).toHaveBeenCalledTimes(2);
  });

  it('does not report success or refetch when a POST response identifies another settlement', async () => {
    approveSettlementApprovalMock.mockResolvedValue({ ...approvedDraftRefundApproval, id: 'other-approval' });
    const user = userEvent.setup();
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    await user.click(getDraftSettlementRow(queue));
    await user.click(within(queue).getByRole('button', { name: 'Approve Settlement' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Approve Settlement' })).getByRole('button', { name: 'Approve Settlement' }));
    expect(await screen.findByText('Settlement response did not match the requested target. Review its current state before another action.')).toBeInTheDocument();
    expect(screen.queryByText('Settlement approved.')).not.toBeInTheDocument();
    expect(listSettlementApprovalsMock).toHaveBeenCalledTimes(1);
  });

  it('confirms and executes approve settlement with list and detail refetch', async () => {
    const user = userEvent.setup();
    listSettlementApprovalsMock
      .mockResolvedValueOnce(recentApprovalsResponse)
      .mockResolvedValueOnce(approvalsAfterApproveResponse);
    getSettlementApprovalMock
      .mockResolvedValueOnce(selectedDraftRefundApproval)
      .mockResolvedValueOnce(selectedDraftRefundApproval)
      .mockResolvedValueOnce(approvedDraftRefundApproval);
    approveSettlementApprovalMock.mockResolvedValue(approvedDraftRefundApproval);

    renderPage();

    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('yalispor'));
    const queue = screen.getByLabelText('Settlement review queue');
    await user.click(getDraftSettlementRow(queue));
    await user.click(within(queue).getByRole('button', { name: 'Approve Settlement' }));

    const dialog = screen.getByRole('dialog', { name: 'Approve Settlement' });
    expect(dialog).toHaveTextContent('This will approve the settlement for vendor payment review.');
    expect(dialog).toHaveTextContent('Vendor: yalispor');
    expect(dialog).toHaveTextContent('Settlement: approval-1');
    await user.click(within(dialog).getByRole('button', { name: 'Approve Settlement' }));

    await waitFor(() => expect(approveSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));
    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledTimes(3));
    expect(screen.getByText('Settlement approved.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Approve Settlement' })).not.toBeInTheDocument();
    expect(within(queue).queryByRole('button', { name: 'Approve Settlement' })).not.toBeInTheDocument();
  });

  it('shows approve failures safely without closing the confirmation', async () => {
    const user = userEvent.setup();
    approveSettlementApprovalMock.mockRejectedValue(new Error('Settlement approval could not be approved.'));

    renderPage();

    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('yalispor'));
    const queue = screen.getByLabelText('Settlement review queue');
    await user.click(getDraftSettlementRow(queue));
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));
    await user.click(within(queue).getByRole('button', { name: 'Approve Settlement' }));

    const dialog = screen.getByRole('dialog', { name: 'Approve Settlement' });
    await user.click(within(dialog).getByRole('button', { name: 'Approve Settlement' }));

    await waitFor(() => expect(approveSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));
    expect(screen.getByText('Settlement approval could not be approved.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Approve Settlement' })).toBeInTheDocument();
  });

  it('confirms and executes cancel settlement with list and detail refetch', async () => {
    const user = userEvent.setup();
    listSettlementApprovalsMock
      .mockResolvedValueOnce(recentApprovalsResponse)
      .mockResolvedValueOnce(approvalsAfterCancelResponse);
    getSettlementApprovalMock
      .mockResolvedValueOnce(selectedDraftRefundApproval)
      .mockResolvedValueOnce(selectedDraftRefundApproval)
      .mockResolvedValueOnce(cancelledDraftRefundApproval);
    cancelSettlementApprovalMock.mockResolvedValue(cancelledDraftRefundApproval);

    renderPage();

    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('yalispor'));
    const queue = screen.getByLabelText('Settlement review queue');
    await user.click(getDraftSettlementRow(queue));
    await user.click(within(queue).getByRole('button', { name: 'Cancel Settlement' }));

    const dialog = screen.getByRole('dialog', { name: 'Cancel Settlement' });
    expect(dialog).toHaveTextContent('This will cancel the settlement approval. Active refund adjustment applications may be reversed by the backend.');
    expect(dialog).toHaveTextContent('Vendor: yalispor');
    expect(dialog).toHaveTextContent('Settlement: approval-1');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel Settlement' }));

    await waitFor(() => expect(cancelSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));
    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledTimes(3));
    expect(screen.getByText('Settlement cancelled.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Cancel Settlement' })).not.toBeInTheDocument();
    expect(within(queue).getByText('No action available')).toBeInTheDocument();
  });

  it('shows cancel failures safely without closing the confirmation', async () => {
    const user = userEvent.setup();
    cancelSettlementApprovalMock.mockRejectedValue(new Error('Settlement approval cannot be cancelled because an active commission invoice record exists.'));

    renderPage();

    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('yalispor'));
    const queue = screen.getByLabelText('Settlement review queue');
    await user.click(within(queue).getByRole('button', { name: 'Cancel Settlement' }));

    const dialog = screen.getByRole('dialog', { name: 'Cancel Settlement' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel Settlement' }));

    await waitFor(() => expect(cancelSettlementApprovalMock).toHaveBeenCalledWith(rawSettlementApprovalId));
    expect(screen.getByText('Settlement approval cannot be cancelled because an active commission invoice record exists.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Cancel Settlement' })).toBeInTheDocument();
  });

  it('disables settlement action buttons while a mutation is pending', async () => {
    const user = userEvent.setup();
    let resolveApprove: (value: SettlementApproval) => void = () => undefined;
    approveSettlementApprovalMock.mockReturnValue(new Promise<SettlementApproval>((resolve) => {
      resolveApprove = resolve;
    }));
    listSettlementApprovalsMock
      .mockResolvedValueOnce(recentApprovalsResponse)
      .mockResolvedValueOnce(approvalsAfterApproveResponse);
    getSettlementApprovalMock
      .mockResolvedValueOnce(selectedDraftRefundApproval)
      .mockResolvedValueOnce(selectedDraftRefundApproval)
      .mockResolvedValueOnce(approvedDraftRefundApproval);

    renderPage();

    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('yalispor'));
    const queue = screen.getByLabelText('Settlement review queue');
    const draftRow = await waitFor(() => getDraftSettlementRow(queue));
    await user.click(draftRow);
    await user.click(within(queue).getByRole('button', { name: 'Approve Settlement' }));

    const dialog = screen.getByRole('dialog', { name: 'Approve Settlement' });
    const confirmButton = within(dialog).getByRole('button', { name: 'Approve Settlement' });
    const cancelButton = within(dialog).getByRole('button', { name: 'Cancel' });
    await user.click(confirmButton);

    await waitFor(() => expect(confirmButton).toBeDisabled());
    expect(cancelButton).toBeDisabled();

    resolveApprove(approvedDraftRefundApproval);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Approve Settlement' })).not.toBeInTheDocument());
  });

  it('uses stable settlement ids for queue row keys', () => {
    const source = readFileSync(`${process.cwd()}/src/pages/AdminSettlementApprovalsPage.tsx`, 'utf8');
    expect(source).toMatch(/<OperationalTableRow[\s\S]{0,160}key=\{item\.id\}[\s\S]{0,160}selected=\{item\.id === selectedQueueApproval\?\.id\}/);
  });
});
