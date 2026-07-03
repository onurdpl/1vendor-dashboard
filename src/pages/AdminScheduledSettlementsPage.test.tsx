import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminScheduledSettlementsPage } from './AdminScheduledSettlementsPage';
import type {
  SettlementScheduleAutoDraftJobStatusResponse,
  SettlementScheduleCreateDraftsResponse,
  SettlementScheduleDryRunResponse,
} from '../lib/api/contracts';

const getSettlementScheduleDryRunMock = vi.fn<(input?: unknown) => Promise<SettlementScheduleDryRunResponse>>();
const createSettlementScheduleDraftsMock = vi.fn<(input?: unknown) => Promise<SettlementScheduleCreateDraftsResponse>>();
const getSettlementScheduleAutoDraftJobStatusMock = vi.fn<() => Promise<SettlementScheduleAutoDraftJobStatusResponse>>();

vi.mock('../features/finance/api', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/api')>('../features/finance/api');
  return {
    ...actual,
    getSettlementScheduleDryRun: (input: unknown) => getSettlementScheduleDryRunMock(input),
    createSettlementScheduleDrafts: (input: unknown) => createSettlementScheduleDraftsMock(input as never),
    getSettlementScheduleAutoDraftJobStatus: () => getSettlementScheduleAutoDraftJobStatusMock(),
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
      state: 'READY',
      scheduledCycleKey: 'scheduled-settlement:yalispor:2026-06-24',
      existingSettlementApprovalId: null,
      existingSettlementApprovalStatus: null,
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
      state: 'NOT_DUE',
      scheduledCycleKey: 'scheduled-settlement:sporjinal:2026-06-24',
      existingSettlementApprovalId: null,
      existingSettlementApprovalStatus: null,
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
      state: 'AUTO_DRAFT_DISABLED',
      scheduledCycleKey: 'scheduled-settlement:disabled-vendor:2026-06-24',
      existingSettlementApprovalId: null,
      existingSettlementApprovalStatus: null,
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
      state: 'NO_ELIGIBLE_ROWS',
      scheduledCycleKey: 'scheduled-settlement:empty-vendor:2026-06-24',
      existingSettlementApprovalId: null,
      existingSettlementApprovalStatus: null,
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
      state: 'DRAFT_EXISTS',
      scheduledCycleKey: 'scheduled-settlement:draft-vendor:2026-06-24',
      existingSettlementApprovalId: 'approval-existing-draft',
      existingSettlementApprovalStatus: 'draft',
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

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminScheduledSettlementsPage />
    </MemoryRouter>,
  );
}

describe('AdminScheduledSettlementsPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    getSettlementScheduleDryRunMock.mockReset();
    createSettlementScheduleDraftsMock.mockReset();
    getSettlementScheduleAutoDraftJobStatusMock.mockReset();
    getSettlementScheduleDryRunMock.mockResolvedValue(dryRunResponse);
    getSettlementScheduleAutoDraftJobStatusMock.mockResolvedValue(autoDraftJobStatus);
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
  });

  it('renders scheduled settlements as an operational queue with workflow tabs, filters, table, and right panel', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Scheduled Settlements' })).toBeInTheDocument();
    expect(screen.getByText('Review vendors due for scheduled settlement draft preparation.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Scheduled settlement summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Candidate Builder')).not.toBeInTheDocument();
    expect(screen.queryByText('Current Candidate Preview')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Dry Run' })).not.toBeInTheDocument();
    expect(screen.getByText('ADMIN FINANCE')).toBeInTheDocument();
    const filterActions = within(screen.getByLabelText('Scheduled settlement filters')).getByLabelText('Scheduled settlement actions');
    expect(within(filterActions).getByRole('button', { name: 'Preview Schedule' })).toBeInTheDocument();
    expect(within(filterActions).getByRole('button', { name: 'Create Scheduled Drafts' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Scheduled settlement filters')).getByLabelText('Search')).toBeInTheDocument();

    const tabs = screen.getByLabelText('Scheduled settlement workflow tabs');
    expect(within(tabs).getByRole('button', { name: /All5/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: /Due Today4/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: /Ready1/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: /Blocked2/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: /In Review1/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: /Not Due1/i })).toBeInTheDocument();

    expect(screen.getByRole('columnheader', { name: 'Vendor' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Schedule' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Issues' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Next Action' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Updated' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Action' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();

    expect(screen.getAllByText('Yalı Spor').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Create Draft').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refund').length).toBeGreaterThan(0);
    expect(screen.queryByText('Sporjinal')).not.toBeInTheDocument();

    const panel = screen.getByLabelText('Scheduled settlement detail panel');
    expect(within(panel).getByText('Summary')).toBeInTheDocument();
    expect(within(panel).getByText('Next Action')).toBeInTheDocument();
    expect(within(panel).getByText('Payment Impact')).toBeInTheDocument();
    expect(within(panel).getByText('Related Records')).toBeInTheDocument();
    expect(within(panel).getByText('Timeline')).toBeInTheDocument();
  });

  it('filters the queue with workflow tabs using existing loaded schedule data', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findAllByText('Yalı Spor');
    await user.click(screen.getByRole('button', { name: /Blocked2/i }));
    expect(screen.getAllByText('Disabled Vendor').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Empty Vendor').length).toBeGreaterThan(0);
    expect(screen.queryByText('Yalı Spor')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /In Review1/i }));
    expect(screen.getAllByText('Draft Vendor').length).toBeGreaterThan(0);
    expect(screen.getAllByText('View').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Not Due1/i }));
    expect(screen.getAllByText('Sporjinal').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument();
    const panel = screen.getByLabelText('Scheduled settlement detail panel');
    expect(within(panel).getByText('Current Blocker')).toBeInTheDocument();
    expect(within(panel).getByText('This vendor is not scheduled for the selected settlement run.')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Preview Schedule' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Create Scheduled Drafts' })).not.toBeInTheDocument();
  });

  it('orders all schedules by operational priority and keeps not due rows informational', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findAllByText('Yalı Spor');
    await user.click(screen.getByRole('button', { name: /All5/i }));

    const queueText = screen.getByLabelText('Scheduled settlement queue').textContent ?? '';
    expect(queueText.indexOf('Yalı Spor')).toBeGreaterThanOrEqual(0);
    expect(queueText.indexOf('Sporjinal')).toBeGreaterThanOrEqual(0);
    expect(queueText.indexOf('Yalı Spor')).toBeLessThan(queueText.indexOf('Sporjinal'));

    await user.click(screen.getByRole('button', { name: /Not Due1/i }));
    expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument();
    expect(screen.queryByText('Waiting')).not.toBeInTheDocument();
  });

  it('selects scheduled settlement rows and updates the schedule detail panel', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findAllByText('Yalı Spor');
    await user.click(screen.getByRole('button', { name: /Blocked2/i }));
    const rows = screen.getAllByRole('button').filter((element) => element.classList.contains('op-table-row'));
    const disabledVendorRow = rows.find((row) => row.textContent?.includes('Disabled Vendor'));
    expect(disabledVendorRow).toBeTruthy();

    await user.click(disabledVendorRow!);

    expect(disabledVendorRow).toHaveClass('op-row-selected');
    const panel = screen.getByLabelText('Scheduled settlement detail panel');
    expect(within(panel).getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(within(panel).getAllByText('Disabled Vendor').length).toBeGreaterThan(0);
    expect(within(panel).getByText('Auto settlement draft is disabled for this vendor.')).toBeInTheDocument();
  });

  it('shows only one highest-priority issue badge per vendor row', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();

    await screen.findAllByText('Yalı Spor');
    await user.click(screen.getByRole('button', { name: /All5/i }));

    const issueLists = container.querySelectorAll('.scheduled-settlements-table .settlement-review-issue-list');
    expect(issueLists.length).toBeGreaterThan(0);
    issueLists.forEach((list) => {
      expect(list.querySelectorAll('.op-badge')).toHaveLength(1);
    });
  });

  it('shows an operational empty state instead of defaulting to not due vendors', async () => {
    const user = userEvent.setup();
    getSettlementScheduleDryRunMock.mockResolvedValue({
      ...dryRunResponse,
      summary: {
        ...dryRunResponse.summary,
        dueVendors: 1,
        autoDraftEligibleVendors: 0,
      },
      vendors: [
        {
          ...dryRunResponse.vendors[1],
          vendorId: 'not-due-only',
          vendorName: 'Not Due Vendor',
          state: 'NOT_DUE',
          due: false,
        },
        {
          ...dryRunResponse.vendors[4],
          vendorId: 'already-prepared',
          vendorName: 'Already Prepared Vendor',
          state: 'DRAFT_EXISTS',
          due: true,
        },
      ],
    });

    renderPage();

    expect(await screen.findByText('Nothing requires settlement preparation today.')).toBeInTheDocument();
    expect(screen.getByText('All vendors are either not due or already prepared.')).toBeInTheDocument();
    expect(screen.queryByText('Not Due Vendor')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show all schedules' }));
    expect(await screen.findByText('Already Prepared Vendor')).toBeInTheDocument();
    expect(screen.getAllByText('Not Due Vendor').length).toBeGreaterThan(0);
  });

  it('moves run notes and scheduler diagnostics into a collapsed advanced details area', async () => {
    renderPage();

    await screen.findAllByText('Yalı Spor');
    expect(screen.getAllByText('Last run').length).toBeGreaterThan(0);
    const advancedDetails = screen.getByLabelText('Advanced run details');
    expect(advancedDetails).not.toHaveAttribute('open');
    expect(screen.getByText('Advanced run details')).toBeInTheDocument();
    expect(within(advancedDetails).getByText('Run Notes')).not.toBeVisible();
    expect(within(advancedDetails).getByText('Cycle key')).not.toBeVisible();
    expect(screen.getByText('Phase 4A creates drafts only; approval, Logo invoicing, and payout execution are not automated.')).not.toBeVisible();
  });

  it('previews the schedule with the dry-run service and shows success feedback', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findAllByText('Yalı Spor');
    getSettlementScheduleDryRunMock.mockClear();

    const filterActions = within(screen.getByLabelText('Scheduled settlement filters')).getByLabelText('Scheduled settlement actions');
    await user.click(within(filterActions).getByRole('button', { name: 'Preview Schedule' }));

    await waitFor(() => expect(getSettlementScheduleDryRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ runDate: '2026-07-03', vendorId: null }),
    ));
    expect(await screen.findByText('Schedule preview updated.')).toBeInTheDocument();
  });

  it('disables Preview Schedule while dry-run preview is pending', async () => {
    const user = userEvent.setup();
    let resolvePreview: (response: SettlementScheduleDryRunResponse) => void = () => undefined;
    getSettlementScheduleDryRunMock
      .mockReset()
      .mockResolvedValueOnce(dryRunResponse)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolvePreview = resolve;
      }));

    renderPage();

    await screen.findAllByText('Yalı Spor');
    const filterActions = within(screen.getByLabelText('Scheduled settlement filters')).getByLabelText('Scheduled settlement actions');
    await user.click(within(filterActions).getByRole('button', { name: 'Preview Schedule' }));

    expect(within(filterActions).getByRole('button', { name: 'Previewing...' })).toBeDisabled();

    resolvePreview(dryRunResponse);
    expect(await screen.findByText('Schedule preview updated.')).toBeInTheDocument();
  });

  it('does not expose the scheduled auto draft job action in this phase', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findAllByText('Yalı Spor');
    await user.click(screen.getByText('Advanced run details'));

    const advancedDetails = screen.getByLabelText('Advanced run details');
    expect(within(advancedDetails).queryByLabelText('Scheduled auto draft job')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Auto Draft Job' })).not.toBeInTheDocument();
    expect(screen.queryByText('Scheduled Auto Draft Job')).not.toBeInTheDocument();
  });

  it('disables draft creation when no vendors are ready for draft', async () => {
    getSettlementScheduleDryRunMock.mockResolvedValue({
      ...dryRunResponse,
      summary: {
        ...dryRunResponse.summary,
        autoDraftEligibleVendors: 0,
      },
      vendors: dryRunResponse.vendors.map((vendor) => ({
        ...vendor,
        state: vendor.existingSettlementApprovalId ? vendor.state : 'NO_ELIGIBLE_ROWS',
        canCreateDraft: false,
        blockedReason: vendor.blockedReason ?? 'No eligible settlement rows are available for auto draft.',
      })),
    });

    renderPage();

    await screen.findByText('Empty Vendor');
    expect(screen.getByRole('button', { name: 'Create Scheduled Drafts' })).toBeDisabled();
  });

  it('shows state-based scheduled actions in the right panel', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findAllByText('Yalı Spor');
    let panel = screen.getByLabelText('Scheduled settlement detail panel');
    expect(within(panel).getByRole('button', { name: 'Create Scheduled Drafts' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Not Due1/i }));
    panel = screen.getByLabelText('Scheduled settlement detail panel');
    expect(within(panel).getByRole('button', { name: 'Preview Schedule' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Create Scheduled Drafts' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /In Review1/i }));
    panel = screen.getByLabelText('Scheduled settlement detail panel');
    expect(within(panel).getByText('No action available')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Create Scheduled Drafts' })).not.toBeInTheDocument();
  });

  it('requires confirmation before creating drafts and posts to the existing scheduled drafts endpoint client', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findAllByText('Ready');
    const filterActions = within(screen.getByLabelText('Scheduled settlement filters')).getByLabelText('Scheduled settlement actions');
    await user.click(within(filterActions).getByRole('button', { name: 'Create Scheduled Drafts' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Create scheduled drafts for eligible vendors?');
    expect(screen.getByRole('dialog')).toHaveTextContent('This will create settlement drafts for all eligible vendors in the selected run date.');

    await user.click(screen.getByLabelText('I understand this creates drafts for all eligible vendors in the selected run date.'));
    await user.click(screen.getByRole('button', { name: 'Create drafts' }));

    await waitFor(() => expect(createSettlementScheduleDraftsMock).toHaveBeenCalledWith(
      expect.objectContaining({ confirmAutoSettlementDrafts: true }),
    ));
    expect(await screen.findByText('Scheduled settlement drafts created.')).toBeInTheDocument();
    await user.click(screen.getByText('Advanced run details'));
    expect(await screen.findByLabelText('Scheduled draft creation result')).toHaveTextContent('Created');
  });

  it('shows backend errors when scheduled draft creation fails', async () => {
    const user = userEvent.setup();
    createSettlementScheduleDraftsMock.mockRejectedValueOnce(new Error('Backend refused scheduled draft creation.'));
    renderPage();

    await screen.findAllByText('Ready');
    const filterActions = within(screen.getByLabelText('Scheduled settlement filters')).getByLabelText('Scheduled settlement actions');
    await user.click(within(filterActions).getByRole('button', { name: 'Create Scheduled Drafts' }));
    await user.click(screen.getByLabelText('I understand this creates drafts for all eligible vendors in the selected run date.'));
    await user.click(screen.getByRole('button', { name: 'Create drafts' }));

    expect(await screen.findByText('Backend refused scheduled draft creation.')).toBeInTheDocument();
  });

  it('does not expose old queue-builder or accounting evidence controls in the primary queue', async () => {
    renderPage();

    expect((await screen.findAllByText('Yalı Spor')).length).toBeGreaterThan(0);
    expect(screen.getByText('Run Notes')).not.toBeVisible();
    expect(screen.queryByText('Logo Readiness')).not.toBeInTheDocument();
    expect(screen.queryByText('Commission Invoice Records')).not.toBeInTheDocument();
    expect(screen.queryByText('Candidate Selected')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /logo/i })).not.toBeInTheDocument();
  });
});
