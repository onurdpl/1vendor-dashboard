import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminScheduledSettlementsPage } from './AdminScheduledSettlementsPage';
import type {
  SettlementScheduleAutoDraftJobResponse,
  SettlementScheduleAutoDraftJobStatusResponse,
  SettlementScheduleCreateDraftsResponse,
  SettlementScheduleDryRunResponse,
} from '../lib/api/contracts';
import type { SettlementApprovalListResponse } from '../features/finance/settlementApprovalsApi';

const getSettlementScheduleDryRunMock = vi.fn<() => Promise<SettlementScheduleDryRunResponse>>();
const createSettlementScheduleDraftsMock = vi.fn<() => Promise<SettlementScheduleCreateDraftsResponse>>();
const getSettlementScheduleAutoDraftJobStatusMock = vi.fn<() => Promise<SettlementScheduleAutoDraftJobStatusResponse>>();
const runSettlementScheduleAutoDraftJobMock = vi.fn<() => Promise<SettlementScheduleAutoDraftJobResponse>>();
const listSettlementApprovalsMock = vi.fn<(vendorId: string) => Promise<SettlementApprovalListResponse>>();

vi.mock('../features/finance/api', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/api')>('../features/finance/api');
  return {
    ...actual,
    getSettlementScheduleDryRun: () => getSettlementScheduleDryRunMock(),
    createSettlementScheduleDrafts: (input: unknown) => createSettlementScheduleDraftsMock(input as never),
    getSettlementScheduleAutoDraftJobStatus: () => getSettlementScheduleAutoDraftJobStatusMock(),
    runSettlementScheduleAutoDraftJob: (input: unknown) => runSettlementScheduleAutoDraftJobMock(input as never),
  };
});

vi.mock('../features/finance/settlementApprovalsApi', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/settlementApprovalsApi')>(
    '../features/finance/settlementApprovalsApi',
  );
  return {
    ...actual,
    listSettlementApprovals: (vendorId: string) => listSettlementApprovalsMock(vendorId),
  };
});

const dryRunResponse: SettlementScheduleDryRunResponse = {
  ok: true,
  writesPerformed: false,
  runDate: '2026-06-24',
  periodEnd: '2026-06-24T23:59:59.999Z',
  summary: {
    vendorsChecked: 5,
    dueVendors: 4,
    autoDraftEligibleVendors: 1,
    totalEligibleLineCount: 3,
    totalNetPayableMinor: 8334348,
  },
  vendors: [
    {
      vendorId: 'yalispor',
      vendorName: 'Yalı Spor',
      due: true,
      dueReason: 'Weekly WEDNESDAY run is due.',
      schedule: {
        settlementDelayDays: 21,
        settlementFrequencyType: 'WEEKLY',
        weeklySettlementDay: 'WEDNESDAY',
        autoSettlementDraftEnabled: true,
        autoSettlementApproveEnabled: false,
        autoSettlementInvoiceEnabled: false,
      },
      eligibleLineCount: 2,
      excludedActiveApprovalRowCount: 0,
      netPayableMinor: 623036,
      pendingRefundAdjustmentCount: 2,
      pendingRefundAdjustmentTotalMinor: 972654,
      netAfterPendingRefundAdjustmentsMinor: -349618,
      canCreateDraft: true,
      blockedReason: null,
      warnings: [],
    },
    {
      vendorId: 'sporjinal',
      vendorName: 'Sporjinal',
      due: false,
      dueReason: 'Configured settlement weekday is FRIDAY; run date is WEDNESDAY.',
      schedule: {
        settlementDelayDays: 14,
        settlementFrequencyType: 'BIWEEKLY',
        weeklySettlementDay: 'FRIDAY',
        autoSettlementDraftEnabled: true,
        autoSettlementApproveEnabled: false,
        autoSettlementInvoiceEnabled: false,
      },
      eligibleLineCount: 4,
      excludedActiveApprovalRowCount: 0,
      netPayableMinor: 120000,
      pendingRefundAdjustmentCount: 0,
      pendingRefundAdjustmentTotalMinor: 0,
      netAfterPendingRefundAdjustmentsMinor: 120000,
      canCreateDraft: false,
      blockedReason: 'Configured settlement weekday is FRIDAY; run date is WEDNESDAY.',
      warnings: [],
    },
    {
      vendorId: 'disabled-vendor',
      vendorName: 'Disabled Vendor',
      due: true,
      dueReason: 'Weekly WEDNESDAY run is due.',
      schedule: {
        settlementDelayDays: 21,
        settlementFrequencyType: 'WEEKLY',
        weeklySettlementDay: 'WEDNESDAY',
        autoSettlementDraftEnabled: false,
        autoSettlementApproveEnabled: false,
        autoSettlementInvoiceEnabled: false,
      },
      eligibleLineCount: 1,
      excludedActiveApprovalRowCount: 0,
      netPayableMinor: 75000,
      pendingRefundAdjustmentCount: 0,
      pendingRefundAdjustmentTotalMinor: 0,
      netAfterPendingRefundAdjustmentsMinor: 75000,
      canCreateDraft: false,
      blockedReason: 'Auto settlement draft is disabled for this vendor.',
      warnings: [],
    },
    {
      vendorId: 'empty-vendor',
      vendorName: 'Empty Vendor',
      due: true,
      dueReason: 'Weekly WEDNESDAY run is due.',
      schedule: {
        settlementDelayDays: 21,
        settlementFrequencyType: 'WEEKLY',
        weeklySettlementDay: 'WEDNESDAY',
        autoSettlementDraftEnabled: true,
        autoSettlementApproveEnabled: false,
        autoSettlementInvoiceEnabled: false,
      },
      eligibleLineCount: 0,
      excludedActiveApprovalRowCount: 0,
      netPayableMinor: 0,
      pendingRefundAdjustmentCount: 0,
      pendingRefundAdjustmentTotalMinor: 0,
      netAfterPendingRefundAdjustmentsMinor: 0,
      canCreateDraft: false,
      blockedReason: 'No eligible settlement rows are available for auto draft.',
      warnings: [],
    },
    {
      vendorId: 'draft-vendor',
      vendorName: 'Draft Vendor',
      due: true,
      dueReason: 'Weekly WEDNESDAY run is due.',
      schedule: {
        settlementDelayDays: 21,
        settlementFrequencyType: 'WEEKLY',
        weeklySettlementDay: 'WEDNESDAY',
        autoSettlementDraftEnabled: true,
        autoSettlementApproveEnabled: false,
        autoSettlementInvoiceEnabled: false,
      },
      eligibleLineCount: 1,
      excludedActiveApprovalRowCount: 2,
      netPayableMinor: 50000,
      pendingRefundAdjustmentCount: 0,
      pendingRefundAdjustmentTotalMinor: 0,
      netAfterPendingRefundAdjustmentsMinor: 50000,
      canCreateDraft: false,
      blockedReason: 'Settlement rows are already locked in an active approval.',
      warnings: [],
    },
  ],
  notes: [
    'Dry run is read-only and reuses settlement approval preview eligibility.',
    'Phase 4A creates drafts only; approval, Logo invoicing, and payout execution are not automated.',
  ],
};

const autoDraftJobStatus: SettlementScheduleAutoDraftJobStatusResponse = {
  ok: true,
  writesPerformed: false,
  enabled: true,
  dryRun: true,
  mode: 'DRY_RUN',
  lastRun: {
    id: 'job-run-1',
    runDate: '2026-06-17',
    status: 'COMPLETED',
    writesPerformed: false,
    createdDraftCount: 0,
    skippedCount: 1,
    blockedCount: 0,
    startedAt: '2026-06-17T01:00:00.000Z',
    finishedAt: '2026-06-17T01:00:02.000Z',
  },
  notes: [
    'Scheduled settlement auto-draft job creates draft settlement approvals only.',
    'Dry-run mode is enabled; job trigger will not create drafts.',
  ],
};

const autoDraftJobResult: SettlementScheduleAutoDraftJobResponse = {
  ok: true,
  writesPerformed: false,
  runDate: '2026-06-24',
  mode: 'DRY_RUN',
  enabled: true,
  dryRun: true,
  summary: {
    vendorsChecked: 5,
    dueVendors: 4,
    readyVendors: 1,
    createdDrafts: 0,
    skipped: 0,
    blocked: 0,
    existingDrafts: 0,
  },
  vendors: [
    {
      vendorId: 'yalispor',
      state: 'READY',
      due: true,
      autoDraftEnabled: true,
      eligibleLineCount: 2,
      pendingRefundAdjustmentCount: 2,
      estimatedNetPayableMinor: 623036,
      createdSettlementApprovalId: null,
      skippedReason: null,
      blockers: [],
    },
  ],
  notes: ['SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN is true; this response is preview-only.'],
  jobRun: null,
};

function approvalsResponse(vendorId: string, draftId?: string): SettlementApprovalListResponse {
  return {
    ok: true,
    writesPerformed: false,
    vendorId,
    approvals: draftId
      ? [
          {
            id: draftId,
            createdAt: '2026-06-20T08:00:00Z',
            vendorId,
            status: 'draft',
            currency: 'TRY',
            grossSalesMinor: 759800,
            netPayableMinor: 623036,
            approvedAt: null,
            lineCount: 2,
          },
        ]
      : [],
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <AdminScheduledSettlementsPage />
    </MemoryRouter>,
  );
}

function getSummaryCard(summary: HTMLElement, label: string) {
  const card = within(summary).getByText(label).closest('article');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

describe('AdminScheduledSettlementsPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    getSettlementScheduleDryRunMock.mockReset();
    createSettlementScheduleDraftsMock.mockReset();
    getSettlementScheduleAutoDraftJobStatusMock.mockReset();
    runSettlementScheduleAutoDraftJobMock.mockReset();
    listSettlementApprovalsMock.mockReset();
    getSettlementScheduleDryRunMock.mockResolvedValue(dryRunResponse);
    getSettlementScheduleAutoDraftJobStatusMock.mockResolvedValue(autoDraftJobStatus);
    runSettlementScheduleAutoDraftJobMock.mockResolvedValue(autoDraftJobResult);
    createSettlementScheduleDraftsMock.mockResolvedValue({
      ok: true,
      writesPerformed: true,
      runDate: '2026-06-24',
      periodEnd: '2026-06-24T23:59:59.999Z',
      summary: {
        vendorsChecked: 5,
        dueVendors: 4,
        created: 1,
        skipped: 3,
        failed: 1,
      },
      createdDrafts: [
        {
          vendorId: 'yalispor',
          settlementApprovalId: 'approval-yalispor-draft',
          status: 'draft',
          lineCount: 2,
          netPayableMinor: 623036,
        },
      ],
      skipped: [{ vendorId: 'empty-vendor', reason: 'No eligible settlement rows are available for auto draft.' }],
      failed: [{ vendorId: 'blocked-vendor', reason: 'Requires review.' }],
      dryRun: dryRunResponse,
    });
    listSettlementApprovalsMock.mockImplementation((vendorId) =>
      Promise.resolve(approvalsResponse(vendorId, vendorId === 'draft-vendor' ? 'approval-existing-draft' : undefined)),
    );
  });

  it('loads dry run data and renders summary cards, state labels, blockers, draft links, and refund badges', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Scheduled Settlements' })).toBeInTheDocument();
    const summary = screen.getByLabelText('Scheduled settlement summary');
    expect(within(summary).getByText('Vendors checked')).toBeInTheDocument();
    expect(within(summary).getByText('Due vendors')).toBeInTheDocument();
    expect(within(summary).getByText('Ready for draft')).toBeInTheDocument();
    expect(within(summary).getByText('Draft exists')).toBeInTheDocument();
    expect(within(summary).getByText('Estimated net payable')).toBeInTheDocument();
    expect(getSummaryCard(summary, 'Ready for draft')).toHaveTextContent('1');
    expect(getSummaryCard(summary, 'Draft exists')).toHaveTextContent('1');
    expect(screen.getAllByText('Ready')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Not due')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Auto draft off')[0]).toBeInTheDocument();
    expect(screen.getByText('No eligible rows')).toBeInTheDocument();

    await waitFor(() => expect(screen.getAllByText('Draft exists').length).toBeGreaterThan(1));
    const vendorList = screen.getByLabelText('Scheduled vendor list');
    expect(within(vendorList).getAllByText('21 days delay · Weekly · Wednesday')[0]).toBeInTheDocument();
    expect(within(vendorList).getByText((_, element) =>
      element?.textContent === 'Refund adjustments 2 (TRY\u00a09,726.54)',
    )).toBeInTheDocument();
    expect(screen.getAllByText('1 blocker')[0]).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settlement' })).toHaveAttribute(
      'href',
      '/admin/finance/settlement-approvals?approvalId=approval-existing-draft',
    );
  });

  it('keeps ready summary and header count aligned while excluding draft-exists vendors', async () => {
    listSettlementApprovalsMock.mockImplementation((vendorId) =>
      Promise.resolve(approvalsResponse(
        vendorId,
        vendorId === 'yalispor'
          ? 'approval-yalispor-existing'
          : vendorId === 'draft-vendor'
            ? 'approval-existing-draft'
            : undefined,
      )),
    );

    renderPage();

    await waitFor(() => expect(screen.getAllByText('Draft exists').length).toBeGreaterThan(1));
    const summary = screen.getByLabelText('Scheduled settlement summary');
    expect(getSummaryCard(summary, 'Ready for draft')).toHaveTextContent('0');
    expect(getSummaryCard(summary, 'Draft exists')).toHaveTextContent('2');
    expect(screen.getByText('0 ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Scheduled Drafts' })).toBeDisabled();
  });

  it('shows compact blocker chips in the vendor list and full blocker details in the drawer', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Draft Vendor');
    const vendorList = screen.getByLabelText('Scheduled vendor list');
    expect(screen.getAllByText('1 blocker')[0]).toBeInTheDocument();
    expect(within(vendorList).queryByText('Settlement rows are already locked in an active approval.')).not.toBeInTheDocument();

    await user.click(screen.getByText('Draft Vendor'));
    const drawer = screen.getByRole('complementary');
    expect(within(drawer).getByText('Settlement rows are already locked in an active approval.')).toBeInTheDocument();
  });

  it('renders scheduled auto draft job status and last run metadata', async () => {
    renderPage();

    const panel = await screen.findByLabelText('Scheduled auto draft job');
    expect(within(panel).getByText('Enabled')).toBeInTheDocument();
    expect(within(panel).getByText('Dry-run mode')).toBeInTheDocument();
    expect(within(panel).getByText('2026-06-17 · Completed')).toBeInTheDocument();
    expect(within(panel).getByText('Auto draft job is running in dry-run mode. It will preview results but will not create drafts.')).toBeInTheDocument();
  });

  it('shows disabled scheduled auto draft job state without exposing a write action', async () => {
    getSettlementScheduleAutoDraftJobStatusMock.mockResolvedValue({
      ...autoDraftJobStatus,
      enabled: false,
      lastRun: null,
    });

    renderPage();

    const panel = await screen.findByLabelText('Scheduled auto draft job');
    expect(within(panel).getByText('Disabled')).toBeInTheDocument();
    expect(within(panel).getByText('Auto draft job is disabled in this environment. Drafts will not be created automatically until the environment gate is enabled.')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Run Auto Draft Job' })).toBeDisabled();
  });

  it('runs scheduled auto draft job in dry-run mode without confirmation modal', async () => {
    const user = userEvent.setup();
    renderPage();

    const panel = await screen.findByLabelText('Scheduled auto draft job');
    await user.click(within(panel).getByRole('button', { name: 'Run Auto Draft Job' }));

    await waitFor(() => expect(runSettlementScheduleAutoDraftJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ confirmScheduledSettlementAutoDraftJob: true }),
    ));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Scheduled auto draft job result')).toHaveTextContent('Writes performed');
    expect(screen.getByText('SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN is true; this response is preview-only.')).toBeInTheDocument();
  });

  it('requires confirmation before running write-mode scheduled auto draft job', async () => {
    const user = userEvent.setup();
    getSettlementScheduleAutoDraftJobStatusMock.mockResolvedValue({
      ...autoDraftJobStatus,
      dryRun: false,
      mode: 'WRITE',
      notes: ['Write mode is enabled; confirmation is required before drafts can be created.'],
    });
    runSettlementScheduleAutoDraftJobMock.mockResolvedValue({
      ...autoDraftJobResult,
      writesPerformed: true,
      mode: 'WRITE',
      dryRun: false,
      summary: {
        ...autoDraftJobResult.summary,
        createdDrafts: 1,
      },
      vendors: [
        {
          ...autoDraftJobResult.vendors[0],
          state: 'CREATED',
          createdSettlementApprovalId: 'approval-yalispor-auto',
        },
      ],
      notes: ['Scheduled settlement auto-draft job completed using existing settlement draft creation logic.'],
    });

    renderPage();

    const panel = await screen.findByLabelText('Scheduled auto draft job');
    expect(within(panel).getByText('Write mode')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Run Auto Draft Job' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Create settlement drafts for all READY vendors?');
    await user.click(within(dialog).getByLabelText('I understand this will create settlement drafts for all READY vendors.'));
    await user.click(within(dialog).getByRole('button', { name: 'Run Auto Draft Job' }));

    await waitFor(() => expect(runSettlementScheduleAutoDraftJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ confirmScheduledSettlementAutoDraftJob: true }),
    ));
    const resultPanel = await screen.findByLabelText('Scheduled auto draft job result');
    expect(resultPanel).toHaveTextContent('Created drafts');
    expect(within(resultPanel).getByRole('link', { name: 'Open Settlement' })).toHaveAttribute(
      'href',
      '/admin/finance/settlement-approvals?approvalId=approval-yalispor-auto',
    );
  });

  it('renders vendor detail drawer for the selected schedule row', async () => {
    const user = userEvent.setup();
    renderPage();

    const row = await screen.findByText('Sporjinal');
    await user.click(row);

    const drawer = screen.getByRole('complementary');
    expect(within(drawer).getByText('Sporjinal')).toBeInTheDocument();
    expect(within(drawer).getByText('14 days delay · Biweekly on Friday')).toBeInTheDocument();
    expect(within(drawer).getAllByText('Not due')[0]).toBeInTheDocument();
    expect(within(drawer).getAllByText('Configured settlement weekday is FRIDAY; run date is WEDNESDAY.')[0]).toBeInTheDocument();
  });

  it('shows a clean empty state when no vendors are ready for the selected run date', async () => {
    getSettlementScheduleDryRunMock.mockResolvedValue({
      ...dryRunResponse,
      summary: {
        ...dryRunResponse.summary,
        autoDraftEligibleVendors: 0,
      },
      vendors: dryRunResponse.vendors.map((vendor) => ({
        ...vendor,
        canCreateDraft: false,
        blockedReason: vendor.blockedReason ?? 'No eligible settlement rows are available for auto draft.',
      })),
    });

    renderPage();

    expect(await screen.findByText('No scheduled drafts ready for this run date.')).toBeInTheDocument();
    expect(screen.getByText('Try the next settlement day or review vendor schedule settings.')).toBeInTheDocument();
  });

  it('requires confirmation before creating drafts and posts to the existing scheduled drafts endpoint client', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findAllByText('Ready');
    await user.click(screen.getByRole('button', { name: 'Create Scheduled Drafts' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Create settlement drafts for all READY vendors?');

    await user.click(screen.getByLabelText('I understand this will create settlement drafts.'));
    await user.click(screen.getByRole('button', { name: 'Create drafts' }));

    await waitFor(() => expect(createSettlementScheduleDraftsMock).toHaveBeenCalledWith(
      expect.objectContaining({ confirmAutoSettlementDrafts: true }),
    ));
    expect(await screen.findByLabelText('Scheduled draft creation result')).toHaveTextContent('Created');
  });

  it('does not expose Logo interactions from the scheduled settlement workspace', async () => {
    renderPage();

    expect((await screen.findAllByText('Vendor Schedule'))[0]).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /logo/i })).not.toBeInTheDocument();
  });
});
