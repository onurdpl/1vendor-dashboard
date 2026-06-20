import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminScheduledSettlementsPage } from './AdminScheduledSettlementsPage';
import type { SettlementScheduleCreateDraftsResponse, SettlementScheduleDryRunResponse } from '../lib/api/contracts';
import type { SettlementApprovalListResponse } from '../features/finance/settlementApprovalsApi';

const getSettlementScheduleDryRunMock = vi.fn<() => Promise<SettlementScheduleDryRunResponse>>();
const createSettlementScheduleDraftsMock = vi.fn<() => Promise<SettlementScheduleCreateDraftsResponse>>();
const listSettlementApprovalsMock = vi.fn<(vendorId: string) => Promise<SettlementApprovalListResponse>>();

vi.mock('../features/finance/api', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/api')>('../features/finance/api');
  return {
    ...actual,
    getSettlementScheduleDryRun: () => getSettlementScheduleDryRunMock(),
    createSettlementScheduleDrafts: (input: unknown) => createSettlementScheduleDraftsMock(input as never),
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

describe('AdminScheduledSettlementsPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    getSettlementScheduleDryRunMock.mockReset();
    createSettlementScheduleDraftsMock.mockReset();
    listSettlementApprovalsMock.mockReset();
    getSettlementScheduleDryRunMock.mockResolvedValue(dryRunResponse);
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
    expect(within(summary).getByText('Auto draft eligible')).toBeInTheDocument();
    expect(within(summary).getByText('Estimated net payable')).toBeInTheDocument();
    expect(screen.getAllByText('Ready for draft creation')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Settlement day not reached')[0]).toBeInTheDocument();
    expect(screen.getByText('Auto draft disabled')).toBeInTheDocument();
    expect(screen.getByText('No eligible finance rows')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('Draft already exists')).toBeInTheDocument());
    expect(screen.getByText('Refund Adjustments: 2')).toBeInTheDocument();
    expect(screen.getByText('Settlement rows are already locked in an active approval.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settlement' })).toHaveAttribute(
      'href',
      '/admin/finance/settlement-approvals?approvalId=approval-existing-draft',
    );
  });

  it('renders vendor detail drawer for the selected schedule row', async () => {
    const user = userEvent.setup();
    renderPage();

    const row = await screen.findByText('Sporjinal');
    await user.click(row);

    const drawer = screen.getByRole('complementary');
    expect(within(drawer).getByText('Sporjinal')).toBeInTheDocument();
    expect(within(drawer).getByText('14 days')).toBeInTheDocument();
    expect(within(drawer).getByText('Biweekly')).toBeInTheDocument();
    expect(within(drawer).getByText('Friday')).toBeInTheDocument();
    expect(within(drawer).getAllByText('Configured settlement weekday is FRIDAY; run date is WEDNESDAY.')[0]).toBeInTheDocument();
  });

  it('requires confirmation before creating drafts and posts to the existing scheduled drafts endpoint client', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findAllByText('Ready for draft creation');
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

    expect((await screen.findAllByText('Vendor Schedule Table'))[0]).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /logo/i })).not.toBeInTheDocument();
  });
});
