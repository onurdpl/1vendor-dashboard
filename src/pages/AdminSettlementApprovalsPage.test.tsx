import { matchesSettlementSearch, settlementSummaryPeriodLabel } from '../../backend/src/modules/finance/settlement-search-presentation';
import { useLayoutEffect } from 'react';
import * as readiness from '../lib/appReadiness';
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { getCurrentVendorContext, setCurrentUser, setCurrentVendorId, setToken } from '../lib/auth';
import { AdminSettlementApprovalsPage } from './AdminSettlementApprovalsPage';
import {
  approveSettlementApproval,
  cancelSettlementApproval,
  getDatabaseHealth,
  getSettlementApproval,
  getSettlementApprovalReadiness,
  listAutoApprovalAttempts,
  listAutoApprovalOperationalErrors,
  listSettlementApprovals, listSettlementHistory, listSettlementPeriods, getSettlementWorkflowCounts,
  type SettlementHistoryPage, type SettlementHistoryQuery, type SettlementWorkflowCounts,
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
    listSettlementApprovals: vi.fn(), listSettlementHistory: vi.fn(), listSettlementPeriods: vi.fn(), getSettlementWorkflowCounts: vi.fn(),
    listAutoApprovalAttempts: vi.fn(),
    listAutoApprovalOperationalErrors: vi.fn(),
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
const historyMock = vi.mocked(listSettlementHistory);
const periodsMock = vi.mocked(listSettlementPeriods);
const countsMock = vi.mocked(getSettlementWorkflowCounts);
// Existing legacy safety fixtures also provide the default browsing response. New
// integration cases override these independently to prove the authority boundary.
async function legacyFixture(vendorId: string) {
  let index = listSettlementApprovalsMock.mock.calls.length - 1;
  while (index >= 0 && listSettlementApprovalsMock.mock.calls[index][0] !== vendorId) index--;
  return await listSettlementApprovalsMock.mock.results[index]?.value as SettlementApprovalListResponse;
}
const periodKey = (row: SettlementApprovalListResponse['approvals'][number]) => row.scheduledCycleKey || row.scheduledPeriodEnd?.slice(0,10) || row.scheduledRunDate?.slice(0,10) || row.createdAt.slice(0,7);
function workflowMatch(row: SettlementApprovalListResponse['approvals'][number], workflow: string) {
  const hold = row.status === 'cancelled' || row.netPayableMinor <= 0 && row.lineCount > 0;
  return workflow === 'all' || workflow === 'approved' && row.status === 'approved' || workflow === 'vendor_hold' && hold ||
    workflow === 'needs_review' && row.status === 'draft' && hold || workflow === 'ready_for_approval' && row.status === 'draft' && !hold;
}
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

function selectQueueVendor(vendorId: string, vendorName = vendorId) {
  act(() => {
    setCurrentUser({
      email: 'admin@demo.com', name: 'Demo Admin', role: 'admin',
      vendorAccess: vendorId ? ['yalispor', vendorId] : [],
      vendorDetails: vendorId
        ? [{ vendorId, vendorName }, ...(vendorId === 'yalispor' ? [] : [{ vendorId: 'yalispor', vendorName: 'Yalispor' }])]
        : [],
      canSwitchVendors: true, defaultVendorId: vendorId,
    });
    setCurrentVendorId(vendorId);
  });
}

function fixedWorkspaceVendors(initialVendorId = 'yalispor') {
  setCurrentUser({ email: 'admin@demo.com', name: 'Demo Admin', role: 'admin',
    vendorAccess: ['yalispor', 'sporjinal'],
    vendorDetails: [{ vendorId: 'yalispor', vendorName: 'Yalıspor' }, { vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
    canSwitchVendors: true, defaultVendorId: 'yalispor' });
  setCurrentVendorId(initialVendorId);
}

function economicList(vendorId: string): SettlementApprovalListResponse {
  const isYali = vendorId === 'yalispor';
  return { ...recentApprovalsResponse, vendorId, approvals: [{ ...recentApprovalsResponse.approvals[0],
    id: `${vendorId}-economic-record`, vendorId, grossSalesMinor: isYali ? 11111 : 99999,
    netPayableMinor: isYali ? 7777 : 88888, scheduledCycleKey: isYali ? 'YaliReference' : 'SporReference' }] };
}

function linkedFixture(vendorId: string, id: string, gross: number, net: number,
  status: SettlementApproval['status'] = 'approved') {
  const detail: SettlementApproval = { ...selectedRecentApproval, id, vendorId, status,
    grossSalesMinor: gross, netPayableMinor: net, commissionMinor: gross - net, commissionVatMinor: 0,
    approvedAt: status === 'approved' ? selectedRecentApproval.approvedAt : null,
    approvedBy: status === 'approved' ? selectedRecentApproval.approvedBy : null,
    lines: [{ ...settlementLine, id: `${id}-line`, financeLedgerEntryId: `${id}-ledger`,
      amountMinor: gross, commissionMinor: gross - net, commissionVatMinor: 0, payableImpactMinor: net }] };
  const summary = { ...recentApprovalsResponse.approvals[0], id, vendorId, status,
    grossSalesMinor: gross, netPayableMinor: net, lineCount: 1, scheduledCycleKey: `${id}Reference` };
  return { detail, summary };
}

function linkedList(vendorId: string, ...fixtures: ReturnType<typeof linkedFixture>[]): SettlementApprovalListResponse {
  return { ...recentApprovalsResponse, vendorId, approvals: fixtures.map((fixture) => fixture.summary) };
}

function DeepLinkNavigationProbe() {
  const navigate = useNavigate();
  const location = useLocation();
  return <>
    <output aria-label="Current settlement URL">{location.pathname}{location.search}</output>
    <button onClick={() => navigate('/admin/finance/settlement-approvals?approvalId=link-x')}>Link X</button>
    <button onClick={() => navigate('/admin/finance/settlement-approvals?approvalId=link-y')}>Link Y</button>
    <button onClick={() => navigate('/admin/finance/settlement-approvals?approvalId=link-foreign')}>Foreign link</button>
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
    historyMock.mockImplementation(async (vendor, query = {}) => {
      const response = await legacyFixture(vendor);
      return { ...response, approvals: response.approvals.filter(row =>
        (!query.search || matchesSettlementSearch(row, query.search, query.searchVendorName ?? '')) &&
        (!query.status || query.status === 'all' || row.status === query.status) &&
        (query.periodKey === undefined || periodKey(row) === query.periodKey) &&
        (!query.highValueOnly || Math.abs(row.netPayableMinor) >= 100000) && workflowMatch(row, query.workflow ?? 'all')),
        hasMore: false, nextCursor: null, ...(query.search ? { searchState: 'EXHAUSTED' as const } : {}) };
    });
    periodsMock.mockImplementation(async vendor => {
      const response = await legacyFixture(vendor);
      return { ok: true, writesPerformed: false, vendorId: vendor, periods: [...new Map(response.approvals.map(row =>
        [periodKey(row), { value: periodKey(row), label: settlementSummaryPeriodLabel(row) }])).values()], hasMore: false, nextCursor: null };
    });
    countsMock.mockImplementation(async vendor => {
      const response = await legacyFixture(vendor);
      const counts = Object.fromEntries(['all','needs_review','ready_for_approval','refund_review','vendor_hold','approved','paid'].map(key =>
        [key, response.approvals.filter(row => workflowMatch(row, key)).length])) as SettlementWorkflowCounts;
      return { ok: true, writesPerformed: false, vendorId: vendor, counts };
    });
    previewSettlementApprovalMock.mockRejectedValue(new Error('Preview should not run on the queue page.'));
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  function historyPage(vendor: string, items: ReturnType<typeof linkedFixture>[], nextCursor: string | null = null): SettlementHistoryPage {
    return { ...linkedList(vendor, ...items), hasMore: Boolean(nextCursor), nextCursor };
  }
  const fullCounts = { all: 73, needs_review: 3, ready_for_approval: 40, refund_review: 0, vendor_hold: 9, approved: 30, paid: 0 };

  it.each(['loaded', 'error'] as const)('does not infer a definitive action permission while authority is pending or %s', async outcome => {
    const x = linkedFixture('yalispor','authority-pending-x',8765432,6543210,'draft');
    const authority = deferred<SettlementApprovalListResponse>();
    listSettlementApprovalsMock.mockReturnValue(authority.promise);
    historyMock.mockResolvedValue(historyPage('yalispor',[x]));
    getSettlementApprovalMock.mockResolvedValue(x.detail);
    renderPage('/admin/finance/settlement-approvals?approvalId=authority-pending-x');
    const panel = await screen.findByLabelText('Settlement review detail panel');
    await waitFor(() => expect(panel).toHaveTextContent('Financial action availability is not verified while current data is loading or unavailable.'));
    expect(panel).not.toHaveTextContent('Viewing it does not authorize Approve or Cancel.');
    expect(within(panel).queryByRole('button',{name:/Approve Settlement|Cancel Settlement/})).not.toBeInTheDocument();
    await act(async () => {
      if (outcome === 'error') authority.reject(new Error('Authority unavailable'));
      else authority.resolve(linkedList('yalispor',x));
    });
    if (outcome === 'error') {
      expect(panel).toHaveTextContent('Financial action availability is not verified');
      expect(panel).not.toHaveTextContent('Viewing it does not authorize Approve or Cancel.');
      expect(within(panel).queryByRole('button',{name:/Approve Settlement|Cancel Settlement/})).not.toBeInTheDocument();
    } else {
      expect(await within(panel).findByRole('button',{name:'Approve Settlement'})).toBeInTheDocument();
      expect(panel).not.toHaveTextContent('Financial action availability is not verified');
    }
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it.each(['initial','after-empty-scan'] as const)('keeps genuine no-match Search messaging for %s exhaustion', async mode => {
    historyMock.mockImplementation(async (_,query) => !query?.search ? historyPage('yalispor',[]) :
      mode === 'after-empty-scan' && !query.cursor
        ? {...historyPage('yalispor',[],'empty-scan'),hasMore:null,searchState:'MORE_CANDIDATES'}
        : {...historyPage('yalispor',[]),searchState:'EXHAUSTED'});
    renderPage();
    fireEvent.change(screen.getByLabelText('Search'),{target:{value:'no-match'}});
    if (mode === 'after-empty-scan') {
      await screen.findByText(/Search scan incomplete/);
      await userEvent.setup().click(screen.getByRole('button',{name:'Continue Search'}));
    }
    await screen.findByText('No settlements match the selected workflow and filters.');
    expect(screen.queryByText(/Search completed. No additional settlements/)).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Next'})).toBeDisabled();
    expect(getQueueRows(screen.getByLabelText('Settlement review queue'))).toHaveLength(0);
  });

  it('explains summary counts without altering seven backend values or workflow navigation', async () => {
    countsMock.mockResolvedValue({ok:true,writesPerformed:false,vendorId:'yalispor',counts:fullCounts});
    renderPage();
    expect(screen.getByText('Workflow counts reflect settlement summaries, not payout payments or complete refund evidence. Refund and Paid are not populated by the current summary classification.')).toBeInTheDocument();
    const tabs = screen.getByLabelText('Settlement review workflow tabs');
    await within(tabs).findByRole('button',{name:'All73'});
    const labels = ['All73','Summary flags3','No summary flags40','Refund0','Hold9','Approved30','Paid0'];
    expect(within(tabs).getAllByRole('button')).toHaveLength(7);
    for (const name of labels) expect(within(tabs).getByRole('button',{name})).toBeInTheDocument();
    await userEvent.setup().click(within(tabs).getByRole('button',{name:'Paid0'}));
    await waitFor(() => expect(historyMock.mock.calls.at(-1)?.[1]?.workflow).toBe('paid'));
    expect(within(tabs).getByRole('button',{name:'Paid0'})).toHaveClass('is-active');
    expect(countsMock).toHaveBeenCalledTimes(1);
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled(); expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it.each(['later_%[raw]', 'all'].flatMap(raw => ['reload','clear','vendor','retry'].map(finish => ({raw,finish}))))(
    'retains verified period $raw across mutation metadata refresh and $finish', async ({raw,finish}) => {
      fixedWorkspaceVendors();
      const x = linkedFixture('yalispor','period-refresh-x',12345,9876,'draft');
      const approved = {...x.detail,status:'approved' as const};
      const label = `Verified label for ${raw}`;
      let mutated = false, metadataFailed = false;
      listSettlementApprovalsMock.mockImplementation(async vendor => linkedList(vendor,...(vendor === 'yalispor'
        ? [{...x,summary:{...x.summary,status:mutated ? 'approved' as const : 'draft' as const}}] : [])));
      historyMock.mockImplementation(async vendor => historyPage(vendor,vendor === 'yalispor' ? [x] : []));
      getSettlementApprovalMock.mockImplementation(async () => mutated ? approved : x.detail);
      approveSettlementApprovalMock.mockImplementation(async () => {mutated = true; return approved;});
      periodsMock.mockImplementation(async (vendor,query) => {
        if (mutated && finish === 'retry' && !query?.cursor && !metadataFailed) {
          metadataFailed = true; throw new Error('Period metadata unavailable');
        }
        return {ok:true,writesPerformed:false,vendorId:vendor,
          periods:query?.cursor ? [{value:raw,label}] : [{value:`${vendor}-first`,label:`${vendor} First period`}],
          hasMore:!query?.cursor,nextCursor:query?.cursor ? null : 'period-page2'};
      });
      renderPage();
      const user = userEvent.setup();
      await screen.findByText('yalispor First period');
      await user.click(screen.getByRole('button',{name:'Load More Periods'}));
      await screen.findByRole('option',{name:label});
      const select = screen.getByLabelText('Settlement Period');
      await user.selectOptions(select,JSON.stringify([raw]));
      await user.click(await screen.findByRole('button',{name:'Approve Settlement'}));
      await user.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Approve Settlement'}));
      await waitFor(() => expect(periodsMock).toHaveBeenCalledTimes(3));
      if (finish === 'retry') {
        await screen.findByText('Period metadata unavailable');
        expect(select).toHaveDisplayValue(label);
        await user.click(screen.getByRole('button',{name:'Retry periods'}));
        await waitFor(() => expect(periodsMock).toHaveBeenCalledTimes(4));
        expect(screen.queryByText('Period metadata unavailable')).not.toBeInTheDocument();
      }
      expect(select).toHaveValue(JSON.stringify([raw])); expect(select).toHaveDisplayValue(label);
      expect(within(select).getAllByRole('option',{name:label})).toHaveLength(1);
      expect(historyMock.mock.calls.at(-1)?.[1]?.periodKey).toBe(raw);
      expect(approveSettlementApprovalMock).toHaveBeenCalledExactlyOnceWith('period-refresh-x');
      if (finish === 'reload') {
        await user.click(screen.getByRole('button',{name:'Load More Periods'}));
        await waitFor(() => expect(periodsMock).toHaveBeenCalledTimes(4));
        expect(within(select).getAllByRole('option',{name:label})).toHaveLength(1);
        expect(within(select).getAllByRole('option').map(option => (option as HTMLOptionElement).value))
          .toEqual(['all-periods',JSON.stringify(['yalispor-first']),JSON.stringify([raw])]);
        expect(select).toHaveDisplayValue(label);
      } else if (finish === 'clear') {
        await user.selectOptions(select,'all-periods');
        expect(select).toHaveDisplayValue('All periods');
        expect(within(select).queryByRole('option',{name:label})).not.toBeInTheDocument();
        expect(historyMock.mock.calls.at(-1)?.[1]?.periodKey).toBeUndefined();
      } else if (finish === 'vendor') {
        act(() => setCurrentVendorId('sporjinal'));
        expect(within(select).queryByRole('option',{name:label})).not.toBeInTheDocument();
        await screen.findByText('sporjinal First period');
        expect(select).toHaveDisplayValue('All periods');
        expect(historyMock.mock.calls.at(-1)?.[0]).toBe('sporjinal');
        expect(historyMock.mock.calls.at(-1)?.[1]?.periodKey).toBeUndefined();
      }
      expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
    });

  it('replaces pages across more than 20 records, returns to page 1, and never expands action authority', async () => {
    const fixtures = Array.from({ length: 25 }, (_, i) => linkedFixture('yalispor', `history-${i}`, (i + 1) * 11111, 7777, 'draft'));
    historyMock.mockImplementation(async (_, query) => historyPage('yalispor', query?.cursor ? fixtures.slice(20) : fixtures.slice(0,20), query?.cursor ? null : 'page2'));
    countsMock.mockResolvedValue({ ok:true, writesPerformed:false, vendorId:'yalispor', counts:fullCounts });
    getSettlementApprovalMock.mockImplementation(async id => fixtures.find(item => item.detail.id === id)!.detail);
    renderPage();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(20));
    expect(historyMock).toHaveBeenLastCalledWith('yalispor', { limit:20, status:'all', workflow:'all', highValueOnly:false }, expect.any(AbortSignal));
    expect(screen.getByRole('button', {name:'Previous'})).toBeDisabled();
    await userEvent.setup().click(screen.getByRole('button', {name:'Next'}));
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(5));
    expect(getQueueRows(queue)[0]).toHaveTextContent('2,333.31');
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    expect(screen.getByRole('button', {name:'Next'})).toBeDisabled();
    await userEvent.setup().click(getQueueRows(queue)[0]);
    await waitFor(() => expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('history-20'));
    expect(screen.queryByRole('button', {name:'Approve Settlement'})).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', {name:'Previous'}));
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(20));
    expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('history-20');
    expect(countsMock).toHaveBeenCalledTimes(1);
    expect(periodsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', {name:/All73/})).toBeInTheDocument();
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it.each(['settlement-unique', 'yalispor', 'yalıspor', 'pprov', 'special period', '17'])(
    'sends normalized full-history Search for the %s field without client-side page filtering', async term => {
      fixedWorkspaceVendors();
      const record = linkedFixture('yalispor', 'settlement-unique', 1234567, 123456);
      record.summary.scheduledCycleKey = 'special_period'; record.summary.lineCount = 17;
      historyMock.mockImplementation(async (_, query) => ({ ...historyPage('yalispor', [record]),
        ...(query?.search ? {searchState:'EXHAUSTED' as const} : {}) }));
      renderPage();
      await screen.findByText('Gross TRY 12,345.67');
      await userEvent.setup().type(screen.getByLabelText('Search'), ` ${term.toUpperCase()} `);
      await waitFor(() => expect(historyMock).toHaveBeenLastCalledWith('yalispor', expect.objectContaining({search:term.toUpperCase().toLowerCase(), searchVendorName:'Yalıspor'}), expect.any(AbortSignal)));
      expect(getQueueRows(screen.getByLabelText('Settlement review queue'))).toHaveLength(1);
      expect(getQueueRows(screen.getByLabelText('Settlement review queue'))[0]).toHaveTextContent('12,345.67');
      expect(historyMock).toHaveBeenCalledTimes(2);
      expect(periodsMock).toHaveBeenCalledTimes(1); expect(countsMock).toHaveBeenCalledTimes(1);
    });

  it('handles empty MORE_CANDIDATES manually, retries the failed cursor, then replaces with matches and stops at EXHAUSTED', async () => {
    const match = linkedFixture('yalispor','matching-old-record',7654321,654321);
    historyMock.mockImplementation(async (_, query) => {
      if (!query?.search) return historyPage('yalispor', []);
      if (!query.cursor) return {...historyPage('yalispor', [], 'scan1'), hasMore:null, searchState:'MORE_CANDIDATES'};
      if (query.cursor === 'scan1') return {...historyPage('yalispor',[match],'matches2'), searchState:'MORE_MATCHES'};
      return {...historyPage('yalispor',[]),searchState:'EXHAUSTED'};
    });
    renderPage();
    await userEvent.setup().type(screen.getByLabelText('Search'),'matching');
    await screen.findByText(/Search scan incomplete/);
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.queryByText('No settlements match the selected workflow and filters.')).not.toBeInTheDocument();
    expect(historyMock).toHaveBeenCalledTimes(2);
    historyMock.mockRejectedValueOnce(new Error('continuation unavailable'));
    await userEvent.setup().click(screen.getByRole('button',{name:'Continue Search'}));
    await screen.findByText('continuation unavailable');
    await userEvent.setup().click(screen.getByRole('button',{name:'Retry history'}));
    await screen.findByText('Gross TRY 76,543.21');
    expect(historyMock.mock.calls.at(-1)?.[1]?.cursor).toBe('scan1');
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    expect(getQueueRows(screen.getByLabelText('Settlement review queue'))).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole('button',{name:'Next'}));
    await screen.findByText('Search completed. No additional settlements were found in this page. Use Previous to view earlier results.');
    expect(screen.queryByText('No settlements match the selected workflow and filters.')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Next'})).toBeDisabled();
    await userEvent.setup().click(screen.getByRole('button',{name:'Previous'}));
    await screen.findByText('Gross TRY 76,543.21');
    expect(getQueueRows(screen.getByLabelText('Settlement review queue'))).toHaveLength(1);
  });

  it('loads periods separately, preserves raw all and special keys, and combines server filters with cursor reset', async () => {
    const record = linkedFixture('yalispor','history-filtered',45678,34567);
    historyMock.mockResolvedValue(historyPage('yalispor',[record],'more'));
    periodsMock.mockImplementation(async (vendor, query) => ({ok:true,writesPerformed:false,vendorId:vendor,
      periods:query?.cursor ? [{value:'all',label:'Real All Cycle'},{value:'raw_%[key]',label:'Raw Cycle'}] : [{value:'all',label:'Real All Cycle'}],
      hasMore: !query?.cursor, nextCursor:query?.cursor ? null : 'period2'}));
    renderPage();
    await screen.findByText('Real All Cycle');
    expect(periodsMock).toHaveBeenCalledTimes(1);
    await userEvent.setup().click(screen.getByRole('button',{name:'Load More Periods'}));
    await screen.findByText('Raw Cycle');
    expect(screen.getAllByRole('option',{name:'Real All Cycle'})).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole('button',{name:'Next'}));
    await screen.findByText('Page 2');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Settlement Period'),JSON.stringify(['all']));
    await waitFor(() => expect(historyMock.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({periodKey:'all'})));
    expect(historyMock.mock.calls.at(-1)?.[1]?.cursor).toBeUndefined();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status',{selector:'select'}),'approved');
    await user.click(screen.getByLabelText('High Value only'));
    await user.click(screen.getByRole('button',{name:/^Approved/}));
    await waitFor(() => expect(historyMock.mock.calls.at(-1)?.[1]).toEqual({limit:20,status:'approved',workflow:'approved',highValueOnly:true,periodKey:'all'}));
    await user.selectOptions(screen.getByLabelText('Settlement Period'),JSON.stringify(['raw_%[key]']));
    expect(historyMock.mock.calls.at(-1)?.[1]?.periodKey).toBe('raw_%[key]');
    await user.selectOptions(screen.getByLabelText('Settlement Period'),'all-periods');
    expect(historyMock.mock.calls.at(-1)?.[1]?.periodKey).toBeUndefined();
    expect(countsMock).toHaveBeenCalledTimes(1); expect(periodsMock).toHaveBeenCalledTimes(2);
  });

  it('shows counts failure as unknown instead of zero and supports scoped retry', async () => {
    countsMock.mockRejectedValueOnce(new Error('counts unavailable')).mockResolvedValue({ok:true,writesPerformed:false,vendorId:'yalispor',counts:fullCounts});
    renderPage();
    await screen.findByText('counts unavailable');
    expect(screen.getByRole('button',{name:'All—'})).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'All0'})).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button',{name:'Retry counts'}));
    await screen.findByRole('button',{name:'All73'});
    expect(screen.getByRole('button',{name:'Paid0'})).toBeInTheDocument();
  });

  it.each([false,true])('rejects stale browsing, period and count results through Vendor A→B%s', async returnToA => {
    fixedWorkspaceVendors();
    const oldRows = deferred<SettlementHistoryPage>();
    const oldPeriods = deferred<Awaited<ReturnType<typeof listSettlementPeriods>>>();
    const oldCounts = deferred<Awaited<ReturnType<typeof getSettlementWorkflowCounts>>>();
    historyMock.mockReturnValueOnce(oldRows.promise).mockImplementation(async vendor => historyPage(vendor,[linkedFixture(vendor,`${vendor}-new`,12345,9876)]));
    periodsMock.mockReturnValueOnce(oldPeriods.promise).mockImplementation(async vendor => ({ok:true,writesPerformed:false,vendorId:vendor,periods:[{value:`${vendor}-new-period`,label:`${vendor} New Period`}],hasMore:false,nextCursor:null}));
    countsMock.mockReturnValueOnce(oldCounts.promise).mockImplementation(async vendor => ({ok:true,writesPerformed:false,vendorId:vendor,counts:fullCounts}));
    renderPage();
    await waitFor(() => expect(historyMock).toHaveBeenCalledTimes(1));
    act(() => setCurrentVendorId('sporjinal'));
    await screen.findByText('Gross TRY 123.45');
    if (returnToA) { act(() => setCurrentVendorId('yalispor')); await waitFor(() => expect(historyMock.mock.calls.at(-1)?.[0]).toBe('yalispor')); }
    await act(async () => {
      oldRows.resolve(historyPage('yalispor',[linkedFixture('yalispor','old-unsafe',9876543,8765432)],'old-cursor'));
      oldPeriods.resolve({ok:true,writesPerformed:false,vendorId:'yalispor',periods:[{value:'old-period',label:'Old Unsafe Period'}],hasMore:true,nextCursor:'old-period-cursor'});
      oldCounts.resolve({ok:true,writesPerformed:false,vendorId:'yalispor',counts:{...fullCounts,all:99999}});
    });
    const queue = screen.getByLabelText('Settlement review queue');
    expect(queue).not.toHaveTextContent('98,765.43'); expect(screen.queryByText('Old Unsafe Period')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'All99999'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Next'})).toBeDisabled();
    expect(getQueueRows(queue)).toHaveLength(1);
    expect(getQueueRows(queue)[0]).toHaveTextContent(returnToA ? 'Yalıspor' : 'Sporjinal');
  });

  it('invalidates a pending Search and cursor chain when the query changes, including old errors/finally', async () => {
    const stale = deferred<SettlementHistoryPage>(); const fresh = deferred<SettlementHistoryPage>();
    historyMock.mockImplementation(async (_, query) => {
      if (query?.search === 'old') return stale.promise;
      if (query?.search === 'new') return fresh.promise;
      return historyPage('yalispor',[],'old-normal-cursor');
    });
    renderPage();
    const input = screen.getByLabelText('Search');
    fireEvent.change(input,{target:{value:'old'}});
    await waitFor(() => expect(historyMock.mock.calls.at(-1)?.[1]?.search).toBe('old'));
    fireEvent.change(input,{target:{value:'new'}});
    await waitFor(() => expect(historyMock.mock.calls.at(-1)?.[1]?.search).toBe('new'));
    expect(historyMock.mock.calls.at(-1)?.[1]?.cursor).toBeUndefined();
    await act(async () => stale.reject(new Error('stale search error')));
    expect(screen.queryByText('stale search error')).not.toBeInTheDocument();
    expect(screen.getByText('Loading recent approvals...')).toBeInTheDocument();
    await act(async () => fresh.resolve({...historyPage('yalispor',[linkedFixture('yalispor','fresh-result',12345,9876)]),searchState:'EXHAUSTED'}));
    expect(getQueueRows(screen.getByLabelText('Settlement review queue'))).toHaveLength(1);
    expect(screen.getByRole('button',{name:'Next'})).toBeDisabled();
  });

  it('invalidates confirmation on page navigation without redirecting its target', async () => {
    const x = linkedFixture('yalispor','action-x',12345,9876,'draft');
    listSettlementApprovalsMock.mockResolvedValue(linkedList('yalispor',x));
    historyMock.mockImplementation(async (_, query) => historyPage('yalispor',query?.cursor ? [] : [x],query?.cursor ? null : 'second'));
    getSettlementApprovalMock.mockResolvedValue(x.detail);
    renderPage();
    await screen.findByRole('button',{name:'Approve Settlement'});
    await userEvent.setup().click(screen.getByRole('button',{name:'Approve Settlement'}));
    expect(screen.getByRole('dialog')).toHaveTextContent('Settlement: action-x');
    await userEvent.setup().click(screen.getByRole('button',{name:'Next'}));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await screen.findByText('Page 2');
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('keeps explicit historical detail when the independent browsing list fails', async () => {
    const x = linkedFixture('yalispor','history-list-failure',654321,432100,'draft');
    historyMock.mockRejectedValue(new Error('history unavailable'));
    getSettlementApprovalMock.mockResolvedValue(x.detail);
    renderPage('/admin/finance/settlement-approvals?approvalId=history-list-failure');
    await screen.findByText('history unavailable');
    const panel = await screen.findByLabelText('Settlement review detail panel');
    expect(panel).toHaveTextContent('6,543.21'); expect(panel).toHaveTextContent('history-list-failure');
    expect(within(panel).queryByRole('button',{name:/Approve Settlement|Cancel Settlement/})).not.toBeInTheDocument();
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled(); expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('opens browsing detail independently while the legacy authority request is pending', async () => {
    const old = linkedFixture('yalispor','independent-history',7654321,654321,'draft');
    listSettlementApprovalsMock.mockReturnValue(new Promise(() => {}));
    periodsMock.mockResolvedValue({ok:true,writesPerformed:false,vendorId:'yalispor',periods:[],hasMore:false,nextCursor:null});
    countsMock.mockResolvedValue({ok:true,writesPerformed:false,vendorId:'yalispor',counts:fullCounts});
    historyMock.mockResolvedValue(historyPage('yalispor',[old])); getSettlementApprovalMock.mockResolvedValue(old.detail);
    renderPage();
    await screen.findByText('Gross TRY 76,543.21');
    await userEvent.setup().click(getQueueRows(screen.getByLabelText('Settlement review queue'))[0]);
    await waitFor(() => expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('independent-history'));
    expect(screen.queryByRole('button',{name:'Approve Settlement'})).not.toBeInTheDocument();
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it.each(['storage','session reset'] as const)('clears browsing and metadata authority on %s', async event => {
    fixedWorkspaceVendors();
    const late = deferred<SettlementHistoryPage>();
    historyMock.mockResolvedValueOnce(historyPage('yalispor',[linkedFixture('yalispor','visible-old',9876543,8765432)],'old-page'))
      .mockReturnValueOnce(late.promise);
    renderPage();
    await screen.findByText('Gross TRY 98,765.43');
    if (event === 'storage') {
      act(() => {window.localStorage.setItem('vendor-dashboard.current-vendor-id','sporjinal');
        window.dispatchEvent(new StorageEvent('storage',{key:'vendor-dashboard.current-vendor-id',newValue:'sporjinal'}));});
      expect(historyMock.mock.calls.at(-1)?.[0]).toBe('sporjinal');
    } else {
      act(() => { setCurrentUser(null); setToken(null); });
    }
    expect(screen.getByLabelText('Settlement review queue')).not.toHaveTextContent('98,765.43');
    await act(async () => late.resolve(historyPage('yalispor',[linkedFixture('yalispor','late-old',9876543,8765432)],'late-old-cursor')));
    expect(screen.getByLabelText('Settlement review queue')).not.toHaveTextContent('98,765.43');
    expect(historyMock.mock.calls.some(([vendor]) => !vendor)).toBe(false);
    expect(periodsMock.mock.calls.some(([vendor]) => !vendor)).toBe(false);
    expect(countsMock.mock.calls.some(([vendor]) => !vendor)).toBe(false);
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('rejects stale successful pagination after a filter change and resets to the first page', async () => {
    const late = deferred<SettlementHistoryPage>();
    const first = linkedFixture('yalispor','first-page',12345,9876);
    const filtered = linkedFixture('yalispor','filtered-current',45678,34567,'draft');
    historyMock.mockImplementation(async (_, query) => query?.cursor ? late.promise : historyPage('yalispor', query?.status === 'draft' ? [filtered] : [first],query?.status === 'draft' ? null : 'old-next'));
    renderPage();
    await screen.findByText('Gross TRY 123.45');
    await userEvent.setup().click(screen.getByRole('button',{name:'Next'}));
    await userEvent.setup().selectOptions(screen.getByLabelText('Status',{selector:'select'}),'draft');
    await screen.findByText('Gross TRY 456.78');
    await act(async () => late.resolve(historyPage('yalispor',[linkedFixture('yalispor','stale-next',9876543,8765432)],'old-next2')));
    const rows = getQueueRows(screen.getByLabelText('Settlement review queue'));
    expect(rows).toHaveLength(1); expect(rows[0]).toHaveTextContent('456.78'); expect(rows[0]).not.toHaveTextContent('98,765.43');
    expect(screen.getByText('Page 1')).toBeInTheDocument(); expect(screen.getByRole('button',{name:'Next'})).toBeDisabled();
  });

  it('refreshes browsing at cursor zero, periods and counts after an authorized mutation', async () => {
    const x = linkedFixture('yalispor','mutation-x',12345,9876,'draft');
    const approved = {...x.detail,status:'approved' as const};
    listSettlementApprovalsMock.mockResolvedValue(linkedList('yalispor',x));
    historyMock.mockImplementation(async (_, query) => historyPage('yalispor',[x],query?.cursor ? null : 'next'));
    getSettlementApprovalMock.mockResolvedValue(x.detail); approveSettlementApprovalMock.mockResolvedValue(approved);
    renderPage();
    await screen.findByRole('button',{name:'Approve Settlement'});
    await userEvent.setup().click(screen.getByRole('button',{name:'Next'}));
    await screen.findByText('Page 2');
    await userEvent.setup().click(screen.getByRole('button',{name:'Approve Settlement'}));
    await userEvent.setup().click(within(screen.getByRole('dialog')).getByRole('button',{name:'Approve Settlement'}));
    await waitFor(() => expect(approveSettlementApprovalMock).toHaveBeenCalledWith('mutation-x'));
    await waitFor(() => expect(historyMock).toHaveBeenCalledTimes(3));
    expect(historyMock.mock.calls.at(-1)?.[1]?.cursor).toBeUndefined();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(listSettlementApprovalsMock).toHaveBeenCalledTimes(2);
    expect(periodsMock).toHaveBeenCalledTimes(2); expect(countsMock).toHaveBeenCalledTimes(2);
  });

  it('does not let stale metadata/count/list errors or finally clear a new Vendor loading state', async () => {
    fixedWorkspaceVendors();
    const oldRows = deferred<SettlementHistoryPage>(), newRows = deferred<SettlementHistoryPage>();
    const oldPeriods = deferred<Awaited<ReturnType<typeof listSettlementPeriods>>>(), newPeriods = deferred<Awaited<ReturnType<typeof listSettlementPeriods>>>();
    const oldCounts = deferred<Awaited<ReturnType<typeof getSettlementWorkflowCounts>>>(), newCounts = deferred<Awaited<ReturnType<typeof getSettlementWorkflowCounts>>>();
    historyMock.mockReturnValueOnce(oldRows.promise).mockReturnValueOnce(newRows.promise);
    periodsMock.mockReturnValueOnce(oldPeriods.promise).mockReturnValueOnce(newPeriods.promise);
    countsMock.mockReturnValueOnce(oldCounts.promise).mockReturnValueOnce(newCounts.promise);
    renderPage();
    await waitFor(() => expect(historyMock).toHaveBeenCalledTimes(1));
    act(() => setCurrentVendorId('sporjinal'));
    await waitFor(() => expect(historyMock).toHaveBeenCalledTimes(2));
    await act(async () => {oldRows.reject(new Error('old list failure')); oldPeriods.reject(new Error('old period failure')); oldCounts.reject(new Error('old counts failure'));});
    expect(screen.queryByText(/old (list|period|counts) failure/)).not.toBeInTheDocument();
    expect(screen.getByText('Loading recent approvals...')).toBeInTheDocument();
    expect(screen.getByText('Loading settlement periods...')).toBeInTheDocument();
    expect(screen.getByText('Loading workflow counts...')).toBeInTheDocument();
    await act(async () => {
      newRows.resolve(historyPage('sporjinal',[linkedFixture('sporjinal','current-only',7654321,654321)]));
      newPeriods.resolve({ok:true,writesPerformed:false,vendorId:'sporjinal',periods:[{value:'new-period',label:'Current Period'}],hasMore:false,nextCursor:null});
      newCounts.resolve({ok:true,writesPerformed:false,vendorId:'sporjinal',counts:fullCounts});
    });
    expect(getQueueRows(screen.getByLabelText('Settlement review queue'))[0]).toHaveTextContent('Sporjinal');
    expect(screen.getByText('Current Period')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'All73'})).toBeInTheDocument();
  });

  it('rejects stale successful Search results and returns to normal cursor mode when Search is cleared', async () => {
    const old = deferred<SettlementHistoryPage>();
    historyMock.mockImplementation(async (_,query) => query?.search === 'old' ? old.promise : {
      ...historyPage('yalispor',[linkedFixture('yalispor','new-result',12345,9876)]),...(query?.search ? {searchState:'EXHAUSTED' as const} : {})});
    renderPage();
    fireEvent.change(screen.getByLabelText('Search'),{target:{value:'old'}});
    await waitFor(() => expect(historyMock.mock.calls.at(-1)?.[1]?.search).toBe('old'));
    fireEvent.change(screen.getByLabelText('Search'),{target:{value:'new'}});
    await waitFor(() => expect(historyMock.mock.calls.at(-1)?.[1]?.search).toBe('new'));
    await screen.findByText('Gross TRY 123.45');
    await act(async () => old.resolve({...historyPage('yalispor',[linkedFixture('yalispor','old-result',9876543,8765432)],'old-search-cursor'),searchState:'MORE_MATCHES'}));
    expect(getQueueRows(screen.getByLabelText('Settlement review queue'))[0]).toHaveTextContent('123.45');
    expect(screen.getByRole('button',{name:'Next'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Search'),{target:{value:'   '}});
    await waitFor(() => expect(historyMock.mock.calls.at(-1)?.[1]?.search).toBeUndefined());
    expect(historyMock.mock.calls.at(-1)?.[1]?.searchVendorName).toBeUndefined();
    expect(historyMock.mock.calls.at(-1)?.[1]?.cursor).toBeUndefined();
  });

  it('rejects the first A query after rapid Status A→B→A changes', async () => {
    const first = deferred<SettlementHistoryPage>();
    historyMock.mockReturnValueOnce(first.promise).mockResolvedValue(historyPage('yalispor',[linkedFixture('yalispor','latest-query',12345,9876)]));
    renderPage();
    await waitFor(() => expect(historyMock).toHaveBeenCalledTimes(1));
    const status = screen.getByLabelText('Status',{selector:'select'});
    act(() => {
      fireEvent.change(status,{target:{value:'draft'}});
      fireEvent.change(status,{target:{value:'all'}});
    });
    await waitFor(() => expect(historyMock).toHaveBeenCalledTimes(3));
    await act(async () => first.resolve(historyPage('yalispor',[linkedFixture('yalispor','stale-query',9876543,8765432)],'stale-cursor')));
    const rows = getQueueRows(screen.getByLabelText('Settlement review queue'));
    expect(rows).toHaveLength(1); expect(rows[0]).toHaveTextContent('123.45'); expect(rows[0]).not.toHaveTextContent('98,765.43');
    expect(screen.getByRole('button',{name:'Next'})).toBeDisabled();
  });

  it('opens a full-history row without adding it to legacy financial action authority', async () => {
    const old = linkedFixture('yalispor', 'historical-browse-only', 8765432, 6543210, 'draft');
    const current = linkedFixture('yalispor', 'current-authority', 11111, 7777, 'draft');
    listSettlementApprovalsMock.mockResolvedValue(linkedList('yalispor', current));
    historyMock.mockResolvedValue({ ...linkedList('yalispor', old), hasMore: false, nextCursor: null });
    getSettlementApprovalMock.mockResolvedValue(old.detail);
    renderPage();
    await waitFor(() => expect(getQueueRows(screen.getByLabelText('Settlement review queue'))).toHaveLength(1));
    await userEvent.setup().click(getQueueRows(screen.getByLabelText('Settlement review queue'))[0]);
    const panel = screen.getByLabelText('Settlement review detail panel');
    await waitFor(() => expect(panel).toHaveTextContent('historical-browse-only'));
    expect(panel).toHaveTextContent('87,654.32');
    expect(panel).not.toHaveTextContent('current-authority');
    expect(panel).toHaveTextContent('This record is read-only under the current action-authority data. Viewing it does not authorize Approve or Cancel.');
    expect(within(panel).queryByRole('button', { name: /Approve Settlement|Cancel Settlement/ })).not.toBeInTheDocument();
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it.each([['yalispor', 'sporjinal', '111.11', '77.77', /YaliReference/i],
    ['sporjinal', 'yalispor', '999.99', '888.88', /SporReference/i]] as const)(
    'isolates economic rows and Summary immediately on %s to %s while loading', async (from, to, gross, net, reference) => {
      fixedWorkspaceVendors(from);
      const pending = deferred<SettlementApprovalListResponse>();
      listSettlementApprovalsMock.mockImplementation((id) => id === to ? pending.promise : Promise.resolve(economicList(from)));
      renderPage();
      const queue = screen.getByLabelText('Settlement review queue');
      await waitFor(() => expect(getQueueRows(queue)).toHaveLength(1));
      const panel = within(queue).getByLabelText('Settlement review detail panel');
      expect(panel).toHaveTextContent(gross);
      expect(panel).toHaveTextContent(net);
      expect(within(queue).getAllByText(reference).length).toBeGreaterThan(0);
      await userEvent.setup().click(within(queue).getByRole('button', { name: 'Cancel Settlement' }));
      expect(screen.getByRole('dialog')).toHaveTextContent(`${from}-economic-record`);
      act(() => {
        setCurrentVendorId(to);
        // Invoke the existing DOM handler before React can render/effects can run.
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel Settlement' }));
      });
      expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(getQueueRows(queue)).toHaveLength(0);
      expect(queue).not.toHaveTextContent(gross);
      expect(queue).not.toHaveTextContent(net);
      expect(within(queue).queryByText(reference)).not.toBeInTheDocument();
      expect(within(queue).getByText('Loading recent approvals...')).toBeInTheDocument();
      await act(async () => pending.resolve(economicList(to)));
      expect(getQueueRows(queue)).toHaveLength(1);
      expect(within(queue).getByLabelText('Settlement review detail panel')).toHaveTextContent(to === 'yalispor' ? '111.11' : '999.99');
      expect(screen.getByLabelText('Vendor', { selector: 'input' })).toHaveAttribute('readonly');
    });

  it('hides old financial content in the layout commit before passive context synchronization', async () => {
    fixedWorkspaceVendors();
    const originalHook = readiness.useAppReadiness;
    let override: ReturnType<typeof readiness.getAppReadinessSnapshot> | undefined;
    vi.spyOn(readiness, 'useAppReadiness').mockImplementation(() => {
      const actual = originalHook();
      return override ?? actual;
    });
    listSettlementApprovalsMock.mockImplementation((id) => id === 'sporjinal'
      ? new Promise(() => {}) : Promise.resolve(economicList('yalispor')));
    const commits: Array<{ text: string; history: boolean; dialog: boolean; requestedB: boolean; field: string }> = [];
    let record = false;
    function CommitProbe() {
      useLayoutEffect(() => {
        if (!record) return;
        commits.push({ text: screen.getByLabelText('Settlement review queue').textContent || '',
          history: Boolean(screen.queryByLabelText('Automatic approval history')),
          dialog: Boolean(screen.queryByRole('dialog')),
          requestedB: listSettlementApprovalsMock.mock.calls.some(([id]) => id === 'sporjinal'),
          field: (screen.getByLabelText('Vendor', { selector: 'input' }) as HTMLInputElement).value });
      });
      return null;
    }
    const tree = () => <MemoryRouter><AdminSettlementApprovalsPage /><CommitProbe /></MemoryRouter>;
    const view = render(tree());
    await waitFor(() => expect(getQueueRows(screen.getByLabelText('Settlement review queue'))).toHaveLength(1));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel Settlement' }));
    override = { ...readiness.getAppReadinessSnapshot(), currentVendor: {
      vendorId: 'sporjinal', vendorName: 'Sporjinal', scope: 'runtime-vendor-context' } };
    record = true;
    view.rerender(tree());
    expect(commits.length).toBeGreaterThan(0);
    expect(commits[0].requestedB).toBe(false);
    expect(commits[0].field).toBe('Sporjinal');
    expect(commits[0].text).not.toMatch(/111\.11|77\.77|YaliReference|yalispor-economic-record/i);
    expect(commits[0].history).toBe(false);
    expect(commits[0].dialog).toBe(false);
  });

  it.each(['vendor notification', 'cross-tab storage notification'] as const)(
    'rejects the first A request after batched A to B to A via %s', async (notification) => {
    fixedWorkspaceVendors();
    const oldA = deferred<SettlementApprovalListResponse>();
    const newA = deferred<SettlementApprovalListResponse>();
    listSettlementApprovalsMock.mockReturnValueOnce(oldA.promise).mockReturnValueOnce(newA.promise);
    renderPage();
    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledTimes(1));
    act(() => {
      if (notification === 'vendor notification') {
        setCurrentVendorId('sporjinal'); setCurrentVendorId('yalispor');
      } else {
        for (const id of ['sporjinal', 'yalispor']) {
          window.localStorage.setItem('vendor-dashboard.current-vendor-id', id);
          window.dispatchEvent(new StorageEvent('storage', { key: 'vendor-dashboard.current-vendor-id', newValue: id }));
        }
      }
    });
    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledTimes(2));
    await act(async () => oldA.resolve({ ...economicList('yalispor'), approvals: [{
      ...economicList('yalispor').approvals[0], grossSalesMinor: 123456, scheduledCycleKey: 'OldGeneration' }] }));
    const queue = screen.getByLabelText('Settlement review queue');
    expect(getQueueRows(queue)).toHaveLength(0);
    expect(queue).not.toHaveTextContent('1,234.56');
    expect(queue).not.toHaveTextContent('OldGeneration');
    await act(async () => newA.resolve(economicList('yalispor')));
    expect(getQueueRows(queue)).toHaveLength(1);
    expect(queue).toHaveTextContent('111.11');
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
  });

  it('preserves Search, Status, Settlement Period, High Value and normal selection', async () => {
    listSettlementApprovalsMock.mockResolvedValue({ ...recentApprovalsResponse, approvals: [
      { ...recentApprovalsResponse.approvals[0], netPayableMinor: 80000, scheduledCycleKey: 'approved-cycle' },
      { ...recentApprovalsResponse.approvals[1], scheduledCycleKey: 'draft-cycle' },
    ] });
    renderPage();
    const user = userEvent.setup();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    const search = within(queue).getByLabelText('Search');
    await user.type(search, 'no-such-record');
    expect(getQueueRows(queue)).toHaveLength(0);
    await user.clear(search);
    expect(getQueueRows(queue)).toHaveLength(2);
    await user.selectOptions(within(queue).getByLabelText('Status'), 'draft');
    expect(getQueueRows(queue)).toHaveLength(1);
    expect(getQueueRows(queue)[0]).toHaveTextContent('7,598.00');
    await user.selectOptions(within(queue).getByLabelText('Status'), 'all');
    await user.selectOptions(within(queue).getByLabelText('Settlement Period'), JSON.stringify(['approved-cycle']));
    expect(getQueueRows(queue)).toHaveLength(1);
    expect(getQueueRows(queue)[0]).toHaveTextContent('2,200.00');
    await user.selectOptions(within(queue).getByLabelText('Settlement Period'), 'all-periods');
    await user.click(within(queue).getByLabelText('High Value only'));
    expect(getQueueRows(queue)).toHaveLength(1);
    await user.click(getQueueRows(queue)[0]);
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));
    expect(screen.getByLabelText('Vendor', { selector: 'input' })).toHaveAttribute('readonly');
  });

  it.each(['Approve Settlement', 'Cancel Settlement'] as const)(
    'checks the live canonical getter before %s even before a vendor notification', async (action) => {
      fixedWorkspaceVendors();
      renderPage();
      const user = userEvent.setup();
      const queue = screen.getByLabelText('Settlement review queue');
      await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
      if (action === 'Approve Settlement') await user.click(getDraftSettlementRow(queue));
      await user.click(within(queue).getByRole('button', { name: action }));
      const dialog = screen.getByRole('dialog', { name: action });
      const readsBeforeConfirm = getSettlementApprovalMock.mock.calls.length;
      // Model storage changing before the vendor-change notification/render is delivered.
      window.localStorage.setItem('vendor-dashboard.current-vendor-id', 'sporjinal');
      await user.click(within(dialog).getByRole('button', { name: action }));
      expect(getSettlementApprovalMock).toHaveBeenCalledTimes(readsBeforeConfirm);
      expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
      expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

  it('shows the active vendor name read-only and follows vendor context changes without accepting typing', async () => {
    selectQueueVendor('yalispor', 'Yalıspor');
    listSettlementApprovalsMock.mockImplementation(async (id) =>
      id === 'sporjinal' ? vendorApprovalList(id, 'sporjinal-approval') : recentApprovalsResponse);
    const user = userEvent.setup();
    renderPage();
    const field = screen.getByLabelText('Vendor', { selector: 'input' });
    expect(field).toHaveValue('Yalıspor');
    expect(field).toHaveAttribute('readonly');
    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('yalispor'));
    await user.type(field, 'wrong-vendor');
    expect(field).toHaveValue('Yalıspor');
    expect(listSettlementApprovalsMock).not.toHaveBeenCalledWith('wrong-vendor');

    selectQueueVendor('sporjinal', 'Sporjinal');
    expect(field).toHaveValue('Sporjinal');
    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('sporjinal'));
    expect(within(screen.getByLabelText('Settlement review queue')).queryByText('Yalıspor')).not.toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText('Vendor, settlement, status'));
    expect(field).toHaveValue('Sporjinal');
  });

  it('keeps an initially missing vendor context empty without a fallback vendor request', async () => {
    selectQueueVendor('');
    renderPage();
    const field = screen.getByLabelText('Vendor', { selector: 'input' });
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('readonly');
    expect(getQueueRows(screen.getByLabelText('Settlement review queue'))).toHaveLength(0);
    await act(async () => {});
    expect(listSettlementApprovalsMock).not.toHaveBeenCalled();
  });

  it.each(['approve', 'cancel'] as const)('selects the exact same-Vendor deep link and preserves normal %s', async (action) => {
    fixedWorkspaceVendors();
    const own = linkedFixture('yalispor', 'link-x', 65432, 32100, action === 'approve' ? 'draft' : 'approved');
    const other = linkedFixture('yalispor', 'other-own', 11111, 7777);
    let current = own.detail;
    listSettlementApprovalsMock.mockImplementation(async () => linkedList('yalispor', other, {
      detail: current, summary: { ...own.summary, status: current.status } }));
    getSettlementApprovalMock.mockImplementation(async (id) => id === own.detail.id ? current : other.detail);
    const mutation = action === 'approve' ? approveSettlementApprovalMock : cancelSettlementApprovalMock;
    mutation.mockImplementation(async () => {
      current = { ...current, status: action === 'approve' ? 'approved' : 'cancelled', writesPerformed: true };
      return current;
    });
    renderPage('/admin/finance/settlement-approvals?approvalId=link-x');
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(within(queue).getByLabelText('Settlement review detail panel')).toHaveTextContent('654.32'));
    const panel = within(queue).getByLabelText('Settlement review detail panel');
    expect(panel).toHaveTextContent('321.00');
    expect(panel).toHaveTextContent('Link-Xreference');
    const title = action === 'approve' ? 'Approve Settlement' : 'Cancel Settlement';
    const user = userEvent.setup();
    await user.click(within(queue).getByRole('button', { name: title }));
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog).toHaveTextContent('Settlement: link-x');
    expect(dialog).toHaveTextContent('Vendor: yalispor');
    await user.click(within(dialog).getByRole('button', { name: title }));
    await waitFor(() => expect(mutation).toHaveBeenCalledExactlyOnceWith('link-x'));
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
  });

  it.each(['latest-20', 'empty'] as const)('keeps off-list X read-only with an %s list instead of selecting first-row Y (F01)', async (mode) => {
    const x = linkedFixture('yalispor', 'historical-x', 8765432, 6543210, 'draft');
    const others = Array.from({ length: 20 }, (_, i) => linkedFixture('yalispor', `recent-y-${i}`, 11111 + i, 7777 + i));
    x.detail.scheduledCycleKey = 'Historical-X-Reference';
    listSettlementApprovalsMock.mockResolvedValue(linkedList('yalispor', ...(mode === 'empty' ? [] : others)));
    getSettlementApprovalMock.mockResolvedValue(x.detail);
    renderPage('/admin/finance/settlement-approvals?approvalId=historical-x');
    const panel = await screen.findByLabelText('Settlement review detail panel');
    await waitFor(() => expect(panel).toHaveTextContent('87,654.32'));
    expect(panel).toHaveTextContent('65,432.10');
    expect(panel).toHaveTextContent('historical-x');
    expect(panel).toHaveTextContent('Historical-X-Reference');
    expect(panel).toHaveTextContent('DRAFT');
    expect(panel).not.toHaveTextContent('111.11');
    expect(panel).not.toHaveTextContent('77.77');
    expect(panel).not.toHaveTextContent('recent-y-0');
    expect(panel).toHaveTextContent('This record is read-only under the current action-authority data. Viewing it does not authorize Approve or Cancel.');
    expect(within(panel).queryByRole('button', { name: /Approve Settlement|Cancel Settlement/ })).not.toBeInTheDocument();
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['Search', 'Status', 'Settlement Period', 'High Value', 'Workflow'] as const)(
    'retains explicit in-list X and its guarded action when %s hides it, without falling back to Y', async (filter) => {
      const x = linkedFixture('yalispor', 'link-x', 65432, 32100, 'draft');
      const y = linkedFixture('yalispor', 'link-y', 9999999, 8888888, 'approved');
      listSettlementApprovalsMock.mockResolvedValue(linkedList('yalispor', y, x));
      getSettlementApprovalMock.mockImplementation(async (id) => id === 'link-x' ? x.detail : y.detail);
      renderPage('/admin/finance/settlement-approvals?approvalId=link-x');
      const user = userEvent.setup();
      const panel = await screen.findByLabelText('Settlement review detail panel');
      await waitFor(() => expect(panel).toHaveTextContent('654.32'));
      await user.click(await within(panel).findByRole('button', { name: 'Approve Settlement' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('Settlement: link-x');
      if (filter === 'Search') await user.type(screen.getByLabelText('Search'), 'link-y');
      if (filter === 'Status') await user.selectOptions(screen.getByLabelText('Status', { selector: 'select' }), 'approved');
      if (filter === 'Settlement Period') await user.selectOptions(screen.getByLabelText('Settlement Period'), JSON.stringify([y.summary.scheduledCycleKey!]));
      if (filter === 'High Value') await user.click(screen.getByLabelText('High Value only'));
      if (filter === 'Workflow') await user.click(within(screen.getByLabelText('Settlement review workflow tabs')).getByRole('button', { name: /^Approved/ }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(panel).toHaveTextContent('link-x');
      expect(panel).toHaveTextContent('654.32');
      expect(panel).toHaveTextContent('321.00');
      expect(panel).not.toHaveTextContent('88,888.88');
      expect(panel).toHaveTextContent(/outside the currently displayed results/);
      await user.click(await within(panel).findByRole('button', { name: 'Approve Settlement' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('Settlement: link-x');
      expect(panel).not.toHaveTextContent('Viewing it does not authorize Approve or Cancel.');
      expect(panel).not.toHaveTextContent('Financial action availability is not verified');
      expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
      expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
    });

  it('keeps verified in-list X visible and actionable when Search returns zero rows', async () => {
    const x = linkedFixture('yalispor', 'link-x', 65432, 32100, 'draft');
    listSettlementApprovalsMock.mockResolvedValue(linkedList('yalispor', x));
    getSettlementApprovalMock.mockResolvedValue(x.detail);
    renderPage('/admin/finance/settlement-approvals?approvalId=link-x');
    await waitFor(() => expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('321.00'));
    await userEvent.setup().type(screen.getByLabelText('Search'), 'no-matching-record');
    expect(await screen.findByText('No settlements match the selected workflow and filters.')).toBeInTheDocument();
    expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('link-x');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Approve Settlement' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Settlement: link-x');
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it.each(['list-first', 'detail-first'] as const)('does not substitute a target during %s loading', async (order) => {
    const x = linkedFixture('yalispor', 'link-x', 65432, 32100, 'draft');
    const y = linkedFixture('yalispor', 'link-y', 99999, 88888, 'draft');
    const list = deferred<SettlementApprovalListResponse>(); const detail = deferred<SettlementApproval>();
    listSettlementApprovalsMock.mockReturnValue(list.promise);
    getSettlementApprovalMock.mockReturnValue(detail.promise);
    renderPage('/admin/finance/settlement-approvals?approvalId=link-x');
    if (order === 'list-first') {
      await act(async () => list.resolve(linkedList('yalispor', y, x)));
      expect(screen.getByLabelText('Settlement review detail panel')).not.toHaveTextContent('888.88');
      expect(screen.queryByRole('button', { name: 'Approve Settlement' })).not.toBeInTheDocument();
      await act(async () => detail.resolve(x.detail));
    } else {
      await act(async () => detail.resolve(x.detail));
      expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('321.00');
      expect(screen.queryByRole('button', { name: 'Approve Settlement' })).not.toBeInTheDocument();
      await act(async () => list.resolve(linkedList('yalispor', y, x)));
    }
    expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('link-x');
    expect(screen.getByLabelText('Settlement review detail panel')).not.toHaveTextContent('888.88');
    expect(screen.getByRole('button', { name: 'Approve Settlement' })).toBeInTheDocument();
  });

  it.each(['verified', 'pending'] as const)('manual Y replaces a %s X link, removes its URL and rejects late X', async (state) => {
    const x = linkedFixture('yalispor', 'link-x', 65432, 32100, 'draft');
    const y = linkedFixture('yalispor', 'link-y', 99999, 88888, 'draft');
    const old = deferred<SettlementApproval>();
    listSettlementApprovalsMock.mockResolvedValue(linkedList('yalispor', x, y));
    getSettlementApprovalMock.mockImplementation((id) => id === 'link-x'
      ? state === 'pending' ? old.promise : Promise.resolve(x.detail) : Promise.resolve(y.detail));
    render(<MemoryRouter initialEntries={['/admin/finance/settlement-approvals?approvalId=link-x&keep=value']}>
      <DeepLinkNavigationProbe /><AdminSettlementApprovalsPage />
    </MemoryRouter>);
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    const user = userEvent.setup();
    if (state === 'verified') {
      await waitFor(() => expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('321.00'));
      await user.click(screen.getByRole('button', { name: 'Approve Settlement' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('Settlement: link-x');
    }
    await user.click(getQueueRows(queue)[1]);
    await waitFor(() => expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('888.88'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Current settlement URL')).toHaveTextContent('/admin/finance/settlement-approvals?keep=value');
    expect(screen.getByLabelText('Current settlement URL')).not.toHaveTextContent('approvalId');
    await act(async () => old.resolve(x.detail));
    expect(screen.getByLabelText('Settlement review detail panel')).not.toHaveTextContent('321.00');
    await user.click(screen.getByRole('button', { name: 'Approve Settlement' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Settlement: link-y');
    approveSettlementApprovalMock.mockResolvedValue({ ...y.detail, status: 'approved' });
    await user.click(within(dialog).getByRole('button', { name: 'Approve Settlement' }));
    await waitFor(() => expect(approveSettlementApprovalMock).toHaveBeenCalledExactlyOnceWith('link-y'));
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it.each(['retain X', 'select Y'] as const)('preserves exact selection after a list refresh removes X: %s', async (selection) => {
    const x = linkedFixture('yalispor', 'link-x', 65432, 32100, 'draft');
    const y = linkedFixture('yalispor', 'link-y', 99999, 88888);
    const refreshed = deferred<SettlementApproval>();
    let calls = 0;
    getSettlementApprovalMock.mockImplementation(async (id) => id === 'link-y' ? y.detail :
      ++calls === 3 ? refreshed.promise : x.detail);
    listSettlementApprovalsMock.mockResolvedValueOnce(linkedList('yalispor', x, y))
      .mockResolvedValue(linkedList('yalispor', y));
    approveSettlementApprovalMock.mockResolvedValue({ ...x.detail, status: 'approved' });
    renderPage('/admin/finance/settlement-approvals?approvalId=link-x');
    await waitFor(() => expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('321.00'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Approve Settlement' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve Settlement' }));
    await waitFor(() => expect(calls).toBe(3));
    expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('link-x');
    expect(screen.queryByRole('button', { name: 'Cancel Settlement' })).not.toBeInTheDocument();
    if (selection === 'select Y') {
      await user.click(getQueueRows(screen.getByLabelText('Settlement review queue'))[0]);
      await waitFor(() => expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('888.88'));
    }
    await act(async () => refreshed.resolve({ ...x.detail, status: 'approved' }));
    const panel = screen.getByLabelText('Settlement review detail panel');
    if (selection === 'select Y') {
      expect(panel).toHaveTextContent('link-y');
      expect(panel).not.toHaveTextContent('321.00');
    } else {
      expect(panel).toHaveTextContent('link-x');
      expect(panel).toHaveTextContent('321.00');
      expect(panel).toHaveTextContent('This record is read-only under the current action-authority data. Viewing it does not authorize Approve or Cancel.');
      expect(within(panel).queryByRole('button', { name: /Approve Settlement|Cancel Settlement/ })).not.toBeInTheDocument();
      expect(getQueueRows(screen.getByLabelText('Settlement review queue'))).toHaveLength(1);
    }
    expect(approveSettlementApprovalMock).toHaveBeenCalledExactlyOnceWith('link-x');
  });

  it.each(['approve', 'cancel'] as const)('rejects changed canonical status before an exact-target %s POST', async (action) => {
    const x = linkedFixture('yalispor', 'link-x', 65432, 32100, 'draft');
    listSettlementApprovalsMock.mockResolvedValue(linkedList('yalispor', x));
    getSettlementApprovalMock.mockResolvedValueOnce(x.detail)
      .mockResolvedValue({ ...x.detail, status: action === 'approve' ? 'approved' : 'cancelled' });
    renderPage('/admin/finance/settlement-approvals?approvalId=link-x');
    await waitFor(() => expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('321.00'));
    const title = action === 'approve' ? 'Approve Settlement' : 'Cancel Settlement';
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: title }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: title }));
    expect(await screen.findByText('Settlement target changed. Select the settlement action again.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('keeps a pending canonical GET from authorizing X after manual selection of Y', async () => {
    const x = linkedFixture('yalispor', 'link-x', 65432, 32100, 'draft');
    const y = linkedFixture('yalispor', 'link-y', 99999, 88888, 'draft');
    const canonical = deferred<SettlementApproval>(); let xReads = 0;
    listSettlementApprovalsMock.mockResolvedValue(linkedList('yalispor', x, y));
    getSettlementApprovalMock.mockImplementation((id) => id === 'link-y' ? Promise.resolve(y.detail) :
      ++xReads === 1 ? Promise.resolve(x.detail) : canonical.promise);
    renderPage('/admin/finance/settlement-approvals?approvalId=link-x');
    await waitFor(() => expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('321.00'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Approve Settlement' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve Settlement' }));
    await waitFor(() => expect(xReads).toBe(2));
    await user.click(getQueueRows(screen.getByLabelText('Settlement review queue'))[1]);
    await waitFor(() => expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('888.88'));
    await act(async () => canonical.resolve(x.detail));
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('link-y');
  });

  it.each(['approve', 'cancel'] as const)('does not apply a late %s POST response to newly selected Y', async (action) => {
    const x = linkedFixture('yalispor', 'link-x', 65432, 32100, action === 'approve' ? 'draft' : 'approved');
    const y = linkedFixture('yalispor', 'link-y', 99999, 88888, 'draft');
    const post = deferred<SettlementApproval>();
    listSettlementApprovalsMock.mockResolvedValue(linkedList('yalispor', x, y));
    getSettlementApprovalMock.mockImplementation(async (id) => id === 'link-x' ? x.detail : y.detail);
    const mutation = action === 'approve' ? approveSettlementApprovalMock : cancelSettlementApprovalMock;
    mutation.mockReturnValue(post.promise);
    renderPage('/admin/finance/settlement-approvals?approvalId=link-x');
    await waitFor(() => expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('321.00'));
    const user = userEvent.setup(); const title = action === 'approve' ? 'Approve Settlement' : 'Cancel Settlement';
    await user.click(screen.getByRole('button', { name: title }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: title }));
    await waitFor(() => expect(mutation).toHaveBeenCalledExactlyOnceWith('link-x'));
    await user.click(getQueueRows(screen.getByLabelText('Settlement review queue'))[1]);
    await waitFor(() => expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('888.88'));
    await act(async () => post.resolve({ ...x.detail, status: action === 'approve' ? 'approved' : 'cancelled' }));
    expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('link-y');
    expect(screen.getByLabelText('Settlement review detail panel')).not.toHaveTextContent('321.00');
    expect(screen.queryByText(action === 'approve' ? 'Settlement approved.' : 'Settlement cancelled.')).not.toBeInTheDocument();
    expect(listSettlementApprovalsMock).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledExactlyOnceWith('link-x');
  });

  it('opens the exact off-list settlement from the real embedded History link', async () => {
    const x = linkedFixture('yalispor', 'old-history-x', 8765432, 6543210, 'draft');
    const y = linkedFixture('yalispor', 'recent-y', 11111, 7777);
    listSettlementApprovalsMock.mockResolvedValue(linkedList('yalispor', y));
    getSettlementApprovalMock.mockResolvedValue(x.detail);
    vi.mocked(listAutoApprovalAttempts).mockResolvedValue({ ok: true, writesPerformed: false,
      attempts: [{ id: 'historic-attempt-x', settlementApprovalId: x.detail.id,
        vendorId: 'yalispor', vendorName: 'Yalispor', actorId: 'system:settlement_auto_approval',
        outcome: 'BLOCKED', reasonCode: 'SOURCE_BLOCKED', createdAt: x.detail.createdAt,
        completedAt: x.detail.createdAt, currentSettlementStatus: 'DRAFT', exactSuccessfulAttempt: false,
        latestEvent: null, eventCount: 0 }], nextCursor: null });
    vi.mocked(listAutoApprovalOperationalErrors).mockResolvedValue({ ok: true, writesPerformed: false,
      operationalErrors: [], nextCursor: null });
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Review automatic approval history' }));
    const link = await screen.findByRole('link', { name: 'old-history-x' });
    await userEvent.setup().click(link);
    await waitFor(() => expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('87,654.32'));
    expect(screen.getByLabelText('Settlement review detail panel')).toHaveTextContent('old-history-x');
    expect(screen.getByLabelText('Settlement review detail panel')).not.toHaveTextContent('77.77');
    expect(screen.queryByRole('button', { name: /Approve Settlement|Cancel Settlement/ })).not.toBeInTheDocument();
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('rejects a foreign deep link with a mismatch message while preserving the active financial list and actions', async () => {
    fixedWorkspaceVendors();
    const own = linkedFixture('yalispor', 'own-record', 11111, 7777);
    const foreign = linkedFixture('sporjinal', 'link-foreign', 987654, 765432, 'draft');
    listSettlementApprovalsMock.mockResolvedValue(linkedList('yalispor', own));
    getSettlementApprovalMock.mockImplementation(async (id) => id === foreign.detail.id ? foreign.detail : own.detail);
    renderPage('/admin/finance/settlement-approvals?approvalId=link-foreign');
    expect(await screen.findByText(/requested settlement belongs to a different Vendor/)).toBeInTheDocument();
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(1));
    expect(queue).toHaveTextContent('111.11');
    expect(within(queue).queryByRole('button', { name: 'Cancel Settlement' })).not.toBeInTheDocument();
    expect(within(queue).getByLabelText('Settlement review detail panel')).not.toHaveTextContent('77.77');
    await userEvent.setup().click(getQueueRows(queue)[0]);
    const panel = within(queue).getByLabelText('Settlement review detail panel');
    await waitFor(() => expect(panel).toHaveTextContent('77.77'));
    expect(panel).toHaveTextContent('Own-Recordreference');
    expect(document.body).not.toHaveTextContent('9,876.54');
    expect(document.body).not.toHaveTextContent('7,654.32');
    expect(document.body).not.toHaveTextContent(/link-foreignreference/i);
    expect(getSettlementApprovalReadinessMock).not.toHaveBeenCalledWith('link-foreign');
    expect(listSettlementApprovalsMock).not.toHaveBeenCalledWith('sporjinal');
    expect(screen.getByLabelText('Vendor', { selector: 'input' })).toHaveValue('Yalıspor');
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
    await userEvent.setup().click(within(queue).getByRole('button', { name: 'Cancel Settlement' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Settlement: own-record');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('link-foreign');
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', '   ', 42])('rejects unverifiable deep-link Vendor identity %s without changing context', async (identity) => {
    const foreign = linkedFixture('sporjinal', 'link-foreign', 987654, 765432);
    getSettlementApprovalMock.mockResolvedValue({ ...foreign.detail, vendorId: identity } as unknown as SettlementApproval);
    renderPage('/admin/finance/settlement-approvals?approvalId=link-foreign');
    expect(await screen.findByText('The requested settlement Vendor identity could not be verified.')).toBeInTheDocument();
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
    expect(document.body).not.toHaveTextContent('9,876.54');
    expect(listSettlementApprovalsMock).not.toHaveBeenCalledWith('sporjinal');
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it.each(['wrong-id', '', undefined])('rejects returned settlement identity %s', async (id) => {
    getSettlementApprovalMock.mockResolvedValue({ ...selectedRecentApproval, id, grossSalesMinor: 987654 } as unknown as SettlementApproval);
    renderPage('/admin/finance/settlement-approvals?approvalId=link-x');
    expect(await screen.findByText('The requested settlement response identity could not be verified.')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('9,876.54');
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('does not resolve a deep link without a canonical Vendor', async () => {
    selectQueueVendor('');
    renderPage('/admin/finance/settlement-approvals?approvalId=link-foreign');
    expect(await screen.findByText('Select a Vendor in your workspace to open this settlement.')).toBeInTheDocument();
    expect(getSettlementApprovalMock).not.toHaveBeenCalled();
    expect(listSettlementApprovalsMock).not.toHaveBeenCalled();
    expect(getCurrentVendorContext().vendorId).toBe('');
  });

  it('keeps the latest URL settlement selected when an older deep-link GET resolves last', async () => {
    fixedWorkspaceVendors();
    const x = linkedFixture('yalispor', 'link-x', 11111, 7777);
    const y = linkedFixture('yalispor', 'link-y', 65432, 32100);
    const pendingX = deferred<SettlementApproval>();
    const pendingY = deferred<SettlementApproval>();
    listSettlementApprovalsMock.mockResolvedValue(linkedList('yalispor', x, y));
    getSettlementApprovalMock.mockImplementation((id) => id === 'link-x' ? pendingX.promise : pendingY.promise);
    render(<MemoryRouter initialEntries={['/admin/finance/settlement-approvals?approvalId=link-x']}>
      <DeepLinkNavigationProbe /><AdminSettlementApprovalsPage />
    </MemoryRouter>);
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('link-x'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Link Y' }));
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('link-y'));
    await act(async () => pendingY.resolve({ ...y.detail, periodStart: '2001-01-01T00:00:00.000Z' }));
    const queue = screen.getByLabelText('Settlement review queue');
    const panel = within(queue).getByLabelText('Settlement review detail panel');
    expect(panel).toHaveTextContent('654.32');
    expect(panel).toHaveTextContent('321.00');
    expect(panel).toHaveTextContent('2001');
    await userEvent.setup().click(within(queue).getByRole('button', { name: 'Cancel Settlement' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Settlement: link-y');
    await act(async () => pendingX.resolve({ ...x.detail, periodStart: '1990-01-01T00:00:00.000Z' }));
    expect(panel).toHaveTextContent('654.32');
    expect(panel).toHaveTextContent('2001');
    expect(panel).not.toHaveTextContent('1990');
    expect(screen.getByRole('dialog')).toHaveTextContent('Settlement: link-y');
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('clears a foreign mismatch when navigation opens a valid same-Vendor settlement', async () => {
    fixedWorkspaceVendors();
    const own = linkedFixture('yalispor', 'link-x', 65432, 32100);
    const foreign = linkedFixture('sporjinal', 'link-foreign', 987654, 765432);
    listSettlementApprovalsMock.mockResolvedValue(linkedList('yalispor', own));
    getSettlementApprovalMock.mockImplementation(async (id) => id === 'link-x' ?
      { ...own.detail, periodStart: '2001-01-01T00:00:00.000Z' } : foreign.detail);
    render(<MemoryRouter initialEntries={['/admin/finance/settlement-approvals?approvalId=link-foreign']}>
      <DeepLinkNavigationProbe /><AdminSettlementApprovalsPage />
    </MemoryRouter>);
    expect(await screen.findByText(/requested settlement belongs to a different Vendor/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Link X' }));
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(within(queue).getByLabelText('Settlement review detail panel')).toHaveTextContent('2001'));
    expect(screen.queryByText(/requested settlement belongs to a different Vendor/)).not.toBeInTheDocument();
    expect(queue).toHaveTextContent('654.32');
    expect(queue).toHaveTextContent('321.00');
    expect(document.body).not.toHaveTextContent('9,876.54');
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
    await userEvent.setup().click(within(queue).getByRole('button', { name: 'Cancel Settlement' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Settlement: link-x');
  });

  it('requires a fresh GET after manually switching to the previously blocked target Vendor', async () => {
    fixedWorkspaceVendors();
    const own = linkedFixture('yalispor', 'own-record', 11111, 7777);
    const foreign = linkedFixture('sporjinal', 'link-foreign', 987654, 765432);
    const fresh = deferred<SettlementApproval>();
    getSettlementApprovalMock.mockResolvedValueOnce({ ...foreign.detail, periodStart: '1990-01-01T00:00:00.000Z' })
      .mockReturnValueOnce(fresh.promise);
    listSettlementApprovalsMock.mockImplementation(async (id) => id === 'yalispor' ? linkedList(id, own) : linkedList(id, foreign));
    renderPage('/admin/finance/settlement-approvals?approvalId=link-foreign');
    expect(await screen.findByText(/requested settlement belongs to a different Vendor/)).toBeInTheDocument();
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
    expect(getSettlementApprovalMock).toHaveBeenCalledTimes(1);
    act(() => setCurrentVendorId('sporjinal'));
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledTimes(2));
    expect(getSettlementApprovalMock).toHaveBeenNthCalledWith(2, 'link-foreign');
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(1));
    expect(queue).not.toHaveTextContent('1990');
    await act(async () => fresh.resolve({ ...foreign.detail, periodStart: '2001-01-01T00:00:00.000Z' }));
    expect(within(queue).getByLabelText('Settlement review detail panel')).toHaveTextContent('2001');
    expect(queue).toHaveTextContent('9,876.54');
    expect(queue).toHaveTextContent('7,654.32');
    expect(queue).not.toHaveTextContent('111.11');
    expect(queue).not.toHaveTextContent('1990');
    expect(screen.queryByText(/requested settlement belongs to a different Vendor/)).not.toBeInTheDocument();
    expect(getCurrentVendorContext().vendorId).toBe('sporjinal');
  });

  it('ignores a pending A deep-link result after switching to B and accepts only B fresh validation', async () => {
    fixedWorkspaceVendors();
    const own = linkedFixture('yalispor', 'link-x', 11111, 7777);
    const b = linkedFixture('sporjinal', 'b-record', 99999, 88888);
    const old = deferred<SettlementApproval>();
    const fresh = deferred<SettlementApproval>();
    getSettlementApprovalMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    listSettlementApprovalsMock.mockImplementation(async (id) => id === 'yalispor' ? linkedList(id, own) : linkedList(id, b));
    renderPage('/admin/finance/settlement-approvals?approvalId=link-x');
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledTimes(1));
    const queue = screen.getByLabelText('Settlement review queue');
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(1));
    expect(within(queue).queryByRole('button', { name: 'Cancel Settlement' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => setCurrentVendorId('sporjinal'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(queue).toHaveTextContent('999.99'));
    await act(async () => old.resolve({ ...own.detail, periodStart: '1990-01-01T00:00:00.000Z' }));
    expect(screen.queryByText(/requested settlement belongs to a different Vendor/)).not.toBeInTheDocument();
    expect(queue).not.toHaveTextContent('1990');
    expect(queue).not.toHaveTextContent('111.11');
    expect(queue).toHaveTextContent('888.88');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The still-linked A record is foreign in B; only the fresh B-context GET may report that mismatch.
    await act(async () => fresh.resolve(own.detail));
    expect(await screen.findByText(/requested settlement belongs to a different Vendor/)).toBeInTheDocument();
    expect(queue).toHaveTextContent('999.99');
    expect(queue).not.toHaveTextContent('111.11');
    expect(getCurrentVendorContext().vendorId).toBe('sporjinal');
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
  });

  it('rejects the original deep-link generation after A to B to A even when the Vendor ID matches again', async () => {
    fixedWorkspaceVendors();
    const own = linkedFixture('yalispor', 'link-x', 65432, 32100);
    const old = deferred<SettlementApproval>();
    const fresh = deferred<SettlementApproval>();
    getSettlementApprovalMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    listSettlementApprovalsMock.mockImplementation(async (id) => id === 'yalispor' ? linkedList(id, own) : economicList(id));
    renderPage('/admin/finance/settlement-approvals?approvalId=link-x');
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledTimes(1));
    act(() => { setCurrentVendorId('sporjinal'); setCurrentVendorId('yalispor'); });
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledTimes(2));
    await act(async () => old.resolve({ ...own.detail, periodStart: '1990-01-01T00:00:00.000Z' }));
    const queue = screen.getByLabelText('Settlement review queue');
    expect(queue).not.toHaveTextContent('1990');
    await act(async () => fresh.resolve({ ...own.detail, periodStart: '2001-01-01T00:00:00.000Z' }));
    const panel = within(queue).getByLabelText('Settlement review detail panel');
    expect(panel).toHaveTextContent('2001');
    expect(panel).toHaveTextContent('654.32');
    expect(panel).toHaveTextContent('321.00');
    expect(panel).not.toHaveTextContent('1990');
    expect(queue).not.toHaveTextContent('999.99');
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
  });

  it.each(['Settlement not found', 'Settlement service unavailable'])(
    'clears the previous linked detail and preserves active rows on API error: %s', async (message) => {
      const own = linkedFixture('yalispor', 'link-x', 65432, 32100);
      getSettlementApprovalMock.mockResolvedValueOnce({ ...own.detail, periodStart: '1990-01-01T00:00:00.000Z' })
        .mockRejectedValueOnce(new Error(message));
      listSettlementApprovalsMock.mockResolvedValue(linkedList('yalispor', own));
      render(<MemoryRouter initialEntries={['/admin/finance/settlement-approvals?approvalId=link-x']}>
        <DeepLinkNavigationProbe /><AdminSettlementApprovalsPage />
      </MemoryRouter>);
      const queue = screen.getByLabelText('Settlement review queue');
      await waitFor(() => expect(within(queue).getByLabelText('Settlement review detail panel')).toHaveTextContent('1990'));
      await userEvent.setup().click(screen.getByRole('button', { name: 'Link Y' }));
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(queue).not.toHaveTextContent('1990');
      expect(getQueueRows(queue)).toHaveLength(1);
      expect(queue).toHaveTextContent('654.32');
      expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
      expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
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
    expect(screen.getAllByText('Vendor B unavailable').length).toBeGreaterThan(0);
    expect(within(queue).queryByText('No settlement approvals found.')).not.toBeInTheDocument();
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
    expect(screen.getByLabelText('Vendor', { selector: 'input' })).toHaveValue('vendor-b');
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
    expect(screen.getByLabelText('Vendor', { selector: 'input' })).toHaveValue('vendor-b');
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
    expect(screen.getByLabelText('Vendor', { selector: 'input' })).toHaveValue('vendor-b');
    expect(getQueueRows(screen.getByLabelText('Settlement review queue'))).toHaveLength(1);
    expect(within(screen.getByLabelText('Settlement review queue')).getAllByText('vendor-b').length).toBeGreaterThan(0);
  });

  it('ignores repeated late responses for the same deep link after an explicit vendor change', async () => {
    const first = deferred<SettlementApproval>();
    const second = deferred<SettlementApproval>();
    const third = deferred<SettlementApproval>();
    getSettlementApprovalMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
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
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Clear link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore link' }));
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledTimes(3));
    await act(async () => third.resolve({ ...selectedRecentApproval, id: 'approval-a', vendorId: 'yalispor' }));
    await act(async () => second.resolve({ ...selectedRecentApproval, id: 'approval-a', vendorId: 'yalispor' }));
    await act(async () => first.resolve({ ...selectedRecentApproval, id: 'approval-a', vendorId: 'yalispor' }));
    expect(screen.getByLabelText('Vendor', { selector: 'input' })).toHaveValue('vendor-b');
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
    expect(screen.getByLabelText('Vendor', { selector: 'input' })).toHaveValue('vendor-b');
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
    expect(screen.getByLabelText('Vendor', { selector: 'input' })).toHaveValue('vendor-b');
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
    expect(screen.getByLabelText('Vendor', { selector: 'input' })).toHaveValue('sporjinal');
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
    expect(screen.getByLabelText('Vendor', { selector: 'input' })).toHaveValue('sporjinal');
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
    await waitFor(() => expect(getDraftSettlementRow(queue)).toBeInTheDocument());
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
    const authority = deferred<SettlementApprovalListResponse>();
    const browsing = deferred<SettlementHistoryPage>();
    listSettlementApprovalsMock.mockReturnValue(authority.promise);
    historyMock.mockReturnValue(browsing.promise);
    cancelSettlementApprovalMock.mockRejectedValue(new Error('Settlement approval cannot be cancelled because an active commission invoice record exists.'));

    renderPage();

    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('yalispor'));
    const queue = screen.getByLabelText('Settlement review queue');
    expect(within(queue).getByText('Loading recent approvals...')).toBeInTheDocument();
    expect(within(queue).queryByRole('button', { name: 'Cancel Settlement' })).not.toBeInTheDocument();
    // Calling the legacy loader does not establish browsing or action authority.
    await act(async () => browsing.resolve({ ...recentApprovalsResponse, hasMore: false, nextCursor: null }));
    await waitFor(() => expect(getQueueRows(queue)).toHaveLength(2));
    expect(within(queue).queryByRole('button', { name: 'Cancel Settlement' })).not.toBeInTheDocument();
    await act(async () => authority.resolve(recentApprovalsResponse));

    const cancelButton = await within(queue).findByRole('button', { name: 'Cancel Settlement' });
    expect(getQueueRows(queue)[0]).toHaveClass('op-row-selected');
    expect(getQueueRows(queue)[0]).toHaveTextContent('Yalispor');
    expect(getQueueRows(queue)[0]).toHaveTextContent('Gross TRY 2,200.00');
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
    await user.click(cancelButton);

    const dialog = screen.getByRole('dialog', { name: 'Cancel Settlement' });
    expect(dialog).toHaveTextContent('Vendor: yalispor');
    expect(dialog).toHaveTextContent(`Settlement: ${rawSettlementApprovalId}`);
    expect(cancelSettlementApprovalMock).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel Settlement' }));

    await waitFor(() => expect(cancelSettlementApprovalMock).toHaveBeenCalledExactlyOnceWith(rawSettlementApprovalId));
    expect(getSettlementApprovalMock).toHaveBeenCalledExactlyOnceWith(rawSettlementApprovalId);
    expect(screen.getByText('Settlement approval cannot be cancelled because an active commission invoice record exists.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Cancel Settlement' })).toBe(dialog);
    expect(dialog).toHaveTextContent('Vendor: yalispor');
    expect(dialog).toHaveTextContent(`Settlement: ${rawSettlementApprovalId}`);
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
    expect(approveSettlementApprovalMock).not.toHaveBeenCalled();
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
