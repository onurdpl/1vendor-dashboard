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

const getSettlementScheduleDryRunMock = vi.fn<() => Promise<SettlementScheduleDryRunResponse>>();
const createSettlementScheduleDraftsMock = vi.fn<() => Promise<SettlementScheduleCreateDraftsResponse>>();
const getSettlementScheduleAutoDraftJobStatusMock = vi.fn<() => Promise<SettlementScheduleAutoDraftJobStatusResponse>>();
const runSettlementScheduleAutoDraftJobMock = vi.fn<() => Promise<SettlementScheduleAutoDraftJobResponse>>();

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

function renderPage() {
  render(
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
    runSettlementScheduleAutoDraftJobMock.mockReset();
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
  });

  it('renders scheduled settlements as an operational queue with workflow tabs, filters, table, and right panel', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Scheduled Settlements' })).toBeInTheDocument();
    expect(screen.getByText('Review vendors due for scheduled settlement draft preparation.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Scheduled settlement summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Candidate Builder')).not.toBeInTheDocument();
    expect(screen.queryByText('Current Candidate Preview')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Dry Run' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview Schedule' })).toBeInTheDocument();

    const tabs = screen.getByLabelText('Scheduled settlement workflow tabs');
    expect(within(tabs).getByRole('button', { name: /All5/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: /Due Today4/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: /Ready for Draft1/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: /Blocked2/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: /Already Drafted1/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: /Not Due1/i })).toBeInTheDocument();

    expect(screen.getByRole('columnheader', { name: 'Vendor' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Schedule' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Issues' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Next Action' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Updated' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Review' })).toBeInTheDocument();

    expect(screen.getAllByText('Yalı Spor').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ready for Draft').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Create Draft').length).toBeGreaterThan(0);
    expect(screen.getByText('Refund')).toBeInTheDocument();

    const panel = screen.getByLabelText('Scheduled settlement detail panel');
    expect(within(panel).getByText('Schedule Summary')).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: /Already Drafted1/i }));
    expect(screen.getAllByText('Draft Vendor').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No Action Required').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Not Due1/i }));
    expect(screen.getAllByText('Sporjinal').length).toBeGreaterThan(0);
    const panel = screen.getByLabelText('Scheduled settlement detail panel');
    expect(within(panel).getByText('Why is this waiting?')).toBeInTheDocument();
    expect(within(panel).getAllByText('Not due for this run date')[0]).toBeInTheDocument();
  });

  it('moves run notes and scheduler diagnostics into a collapsed advanced details area', async () => {
    renderPage();

    await screen.findAllByText('Yalı Spor');
    const advancedDetails = screen.getByLabelText('Advanced run details');
    expect(advancedDetails).not.toHaveAttribute('open');
    expect(screen.getByText('Advanced run details')).toBeInTheDocument();
    expect(within(advancedDetails).getByText('Run Notes')).not.toBeVisible();
    expect(within(advancedDetails).getByText('Cycle key')).not.toBeVisible();
    expect(screen.getByText('Phase 4A creates drafts only; approval, Logo invoicing, and payout execution are not automated.')).not.toBeVisible();
  });

  it('keeps scheduled auto draft job behavior reachable from advanced run details', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findAllByText('Yalı Spor');
    await user.click(screen.getByText('Advanced run details'));

    const advancedDetails = screen.getByLabelText('Advanced run details');
    const jobPanel = within(advancedDetails).getByLabelText('Scheduled auto draft job');
    expect(within(jobPanel).getByText('Enabled')).toBeInTheDocument();
    expect(within(jobPanel).getByText('Dry-run mode')).toBeInTheDocument();
    await user.click(within(jobPanel).getByRole('button', { name: 'Run Auto Draft Job' }));

    await waitFor(() => expect(runSettlementScheduleAutoDraftJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ confirmScheduledSettlementAutoDraftJob: true }),
    ));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await within(advancedDetails).findByLabelText('Scheduled auto draft job result')).toHaveTextContent('Writes performed');
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

  it('requires confirmation before creating drafts and posts to the existing scheduled drafts endpoint client', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findAllByText('Ready for Draft');
    await user.click(screen.getByRole('button', { name: 'Create Scheduled Drafts' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Create settlement drafts for all READY vendors?');

    await user.click(screen.getByLabelText('I understand this will create settlement drafts.'));
    await user.click(screen.getByRole('button', { name: 'Create drafts' }));

    await waitFor(() => expect(createSettlementScheduleDraftsMock).toHaveBeenCalledWith(
      expect.objectContaining({ confirmAutoSettlementDrafts: true }),
    ));
    await user.click(screen.getByText('Advanced run details'));
    expect(await screen.findByLabelText('Scheduled draft creation result')).toHaveTextContent('Created');
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
