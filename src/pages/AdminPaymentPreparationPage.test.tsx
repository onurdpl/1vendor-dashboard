import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPaymentPreparationPage } from './AdminPaymentPreparationPage';
import {
  cancelPayoutBatch,
  getPaymentPreparationReadiness,
  listPayoutBatches,
  markPayoutBatchPaid,
  markPayoutBatchReview,
  preparePayoutBatch,
  type FinanceDashboard,
  type PayoutBatch,
} from '../features/finance/paymentPreparationApi';
import { setCurrentVendorId, setSession, type CurrentUser } from '../lib/auth';

vi.mock('../features/finance/paymentPreparationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/finance/paymentPreparationApi')>();
  return {
    ...actual,
    cancelPayoutBatch: vi.fn(),
    getPaymentPreparationReadiness: vi.fn(),
    listPayoutBatches: vi.fn(),
    markPayoutBatchPaid: vi.fn(),
    markPayoutBatchReview: vi.fn(),
    preparePayoutBatch: vi.fn(),
  };
});

const listPayoutBatchesMock = vi.mocked(listPayoutBatches);
const getPaymentPreparationReadinessMock = vi.mocked(getPaymentPreparationReadiness);
const preparePayoutBatchMock = vi.mocked(preparePayoutBatch);
const markPayoutBatchReviewMock = vi.mocked(markPayoutBatchReview);
const markPayoutBatchPaidMock = vi.mocked(markPayoutBatchPaid);
const cancelPayoutBatchMock = vi.mocked(cancelPayoutBatch);

const adminUser: CurrentUser = {
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'admin',
  status: 'active',
  vendorAccess: ['yalispor'],
  vendorDetails: [{ vendorId: 'yalispor', vendorName: 'Yalı Spor' }],
  canSwitchVendors: false,
  defaultVendorId: 'yalispor',
};

const financeDashboard: FinanceDashboard = {
  summary: {
    grossSales: 'TRY 120,000.00',
    refunds: 'TRY 2,000.00',
    netRevenue: 'TRY 118,000.00',
    platformFee: 'TRY 12,000.00',
    payoutEstimate: 'TRY 105,000.00',
    totalRevenue: 'TRY 120,000.00',
    availableBalance: 'TRY 90,000.00',
    pendingPayouts: 'TRY 15,000.00',
    refundsThisMonth: 'TRY 2,000.00',
    payableBalance: 'TRY 105,000.00',
  },
  payoutBatchSummary: {
    eligibleRowCount: 3,
    eligibleNetAmount: 'TRY 100,000.00',
    blockedRowCount: 1,
    outstandingDebtAmount: 'TRY 1,000.00',
    debtOffsetPreviewAmount: 'TRY 500.00',
    netEligibleAfterDebtOffset: 'TRY 99,500.00',
    remainingDebtAfterPreview: 'TRY 500.00',
    latestBatch: null,
  },
  transactions: [],
};

function makeBatch(overrides: Partial<PayoutBatch>): PayoutBatch {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    vendorId: 'yalispor',
    status: 'draft',
    grossAmount: 'TRY 48,000.00',
    commissionAmount: 'TRY 4,800.00',
    commissionVatAmount: 'TRY 960.00',
    shippingDeductionAmount: 'TRY 700.00',
    refundAmount: 'TRY 1,200.00',
    payableBeforeDebtOffset: 'TRY 41,300.00',
    outstandingDebtAmount: 'TRY 900.00',
    debtOffsetAmount: 'TRY 500.00',
    netAmount: 'TRY 40,800.00',
    remainingDebtAmount: 'TRY 400.00',
    currency: 'TRY',
    createdByUserId: '22222222-2222-2222-2222-222222222222',
    paidAt: null,
    paidByUserId: null,
    paymentReference: null,
    internalNote: null,
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    lineCount: 4,
    warning: 'Vendor debt remains after this payout draft.',
    ...overrides,
  };
}

const payoutBatches: PayoutBatch[] = [
  makeBatch({ id: 'batch-draft-raw-11111111', status: 'draft' }),
  makeBatch({
    id: 'batch-review-raw-22222222',
    status: 'review',
    refundAmount: 'TRY 0.00',
    outstandingDebtAmount: 'TRY 0.00',
    debtOffsetAmount: 'TRY 0.00',
    remainingDebtAmount: 'TRY 0.00',
    warning: null,
    updatedAt: '2026-07-02T10:00:00.000Z',
  }),
  makeBatch({
    id: 'batch-approved-raw-33333333',
    status: 'approved',
    refundAmount: 'TRY 0.00',
    outstandingDebtAmount: 'TRY 0.00',
    debtOffsetAmount: 'TRY 0.00',
    remainingDebtAmount: 'TRY 0.00',
    warning: null,
    updatedAt: '2026-07-03T10:00:00.000Z',
  }),
  makeBatch({
    id: 'batch-execution-raw-33333334',
    status: 'execution_pending',
    refundAmount: 'TRY 0.00',
    outstandingDebtAmount: 'TRY 0.00',
    debtOffsetAmount: 'TRY 0.00',
    remainingDebtAmount: 'TRY 0.00',
    warning: null,
    updatedAt: '2026-07-03T12:00:00.000Z',
  }),
  makeBatch({
    id: 'batch-paid-raw-44444444',
    status: 'paid',
    refundAmount: 'TRY 0.00',
    outstandingDebtAmount: 'TRY 0.00',
    debtOffsetAmount: 'TRY 0.00',
    remainingDebtAmount: 'TRY 0.00',
    warning: null,
    paidAt: '2026-07-04T11:30:00.000Z',
    paidByUserId: 'admin-user',
    paymentReference: 'EFT-2026-07-04',
    updatedAt: '2026-07-04T10:00:00.000Z',
  }),
  makeBatch({
    id: 'batch-cancelled-raw-55555555',
    vendorId: '33333333-3333-3333-3333-333333333333',
    status: 'cancelled',
    refundAmount: 'TRY 0.00',
    warning: null,
    updatedAt: '2026-07-05T10:00:00.000Z',
  }),
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/finance/payment-preparation']}>
        <Routes>
          <Route path="/admin/finance/payment-preparation" element={<AdminPaymentPreparationPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function getQueueRows() {
  return screen.getAllByRole('button').filter((element) => element.classList.contains('op-table-row'));
}

async function selectQueueRow(user: ReturnType<typeof userEvent.setup>, matcher: (row: HTMLElement) => boolean) {
  await waitFor(() => expect(getQueueRows().length).toBeGreaterThan(0));
  const row = getQueueRows().find(matcher);
  expect(row).toBeTruthy();
  await user.click(row!);
  return row!;
}

beforeEach(() => {
  setSession('test-session', adminUser);
  setCurrentVendorId('yalispor');
  listPayoutBatchesMock.mockResolvedValue(payoutBatches);
  getPaymentPreparationReadinessMock.mockResolvedValue(financeDashboard);
  preparePayoutBatchMock.mockResolvedValue(makeBatch({ id: 'batch-prepared-raw-66666666', status: 'draft' }));
  markPayoutBatchReviewMock.mockResolvedValue(makeBatch({ id: 'batch-draft-raw-11111111', status: 'review' }));
  markPayoutBatchPaidMock.mockResolvedValue(makeBatch({
    id: 'batch-review-raw-22222222',
    status: 'paid',
    paidAt: '2026-07-04T11:30:00.000Z',
    paidByUserId: 'admin-user',
    paymentReference: 'EFT-2026-07-04',
  }));
  cancelPayoutBatchMock.mockResolvedValue(makeBatch({ id: 'batch-draft-raw-11111111', status: 'cancelled' }));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('AdminPaymentPreparationPage', () => {
  it('renders the payment preparation route and workflow tabs', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Payment Preparation' })).toBeInTheDocument();
    expect(screen.getByText('ADMIN FINANCE')).toBeInTheDocument();
    expect(screen.getByText('Prepare approved vendor payments before payout execution.')).toBeInTheDocument();

    const tabs = screen.getByLabelText('Payment preparation workflow tabs');
    for (const label of ['All', 'Ready', 'Needs Review', 'In Review', 'Approved', 'Paid', 'Cancelled']) {
      expect(within(tabs).getByText(label)).toBeInTheDocument();
    }
    expect(within(tabs).queryByText('Ready to Prepare')).not.toBeInTheDocument();
  });

  it('renders the exact operational table columns', async () => {
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Payment draft').length).toBeGreaterThan(0));

    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual(['Vendor', 'Payment', 'Amount', 'Status', 'Issues', 'Next Action', 'Updated']);
    expect(screen.getAllByText('Yalı Spor').length).toBeGreaterThan(0);
    expect(screen.getByText('Ready payment preparation')).toBeInTheDocument();
    expect(screen.getAllByText('3 eligible settlement rows').length).toBeGreaterThan(0);
    expect(screen.getAllByText('TRY 99,500.00').length).toBeGreaterThan(0);
    expect(screen.queryByText('99500.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
  });

  it('selects payment preparation rows and updates the right panel', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Payment draft').length).toBeGreaterThan(0));
    const rows = screen.getAllByRole('button').filter((element) => element.classList.contains('op-table-row'));
    const draftRow = rows.find((row) => row.textContent?.includes('Payment draft'));
    expect(draftRow).toBeTruthy();

    await user.click(draftRow!);

    expect(draftRow).toHaveClass('op-row-selected');
    const panel = screen.getByLabelText('Payment preparation detail panel');
    expect(within(panel).getAllByText('TRY 48,000.00').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('Needs Review').length).toBeGreaterThan(0);
  });

  it('renders the right panel hierarchy from queue-safe fields', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Ready payment preparation')).toBeInTheDocument());

    const panel = screen.getByLabelText('Payment preparation detail panel');
    for (const section of [
      'Summary',
      'Current Blocker',
      'Next Action',
      'Payment Impact',
      'Related Records',
      'Timeline',
    ]) {
      expect(within(panel).getByText(section)).toBeInTheDocument();
    }
    expect(within(panel).getByText('Missing payment evidence')).toBeInTheDocument();
    expect(within(panel).getAllByText('Prepare Batch').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('TRY 99,500.00').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('No refund adjustment').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('No linked support').length).toBeGreaterThan(0);
    expect(within(panel).queryByText('UNKNOWN')).not.toBeInTheDocument();
    expect(within(panel).queryByText('None loaded')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Not loaded')).not.toBeInTheDocument();
  });

  it('does not expose raw IDs in the queue layer', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Payment Preparation' });

    for (const rawValue of [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      '33333333-3333-3333-3333-333333333333',
      'batch-draft-raw-11111111',
      'batch-review-raw-22222222',
      'batch-approved-raw-33333333',
      'batch-execution-raw-33333334',
      'batch-paid-raw-44444444',
      'batch-cancelled-raw-55555555',
    ]) {
      expect(screen.queryByText(rawValue)).not.toBeInTheDocument();
    }
  });

  it('filters queue records by workflow tab', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'Payment Preparation' });

    await user.click(within(screen.getByLabelText('Payment preparation workflow tabs')).getByRole('button', { name: /Paid/i }));

    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
    expect(screen.queryByText('Ready payment preparation')).not.toBeInTheDocument();
  });

  it('does not show Waiting as the next action when issues are ready', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Payment Preparation' });
    await waitFor(() => expect(screen.getAllByText('Payment draft').length).toBeGreaterThan(0));

    const tableRows = screen.getAllByRole('button').filter((element) => element.classList.contains('op-table-row'));
    const readyIssueRow = tableRows.find((row) => within(row).queryByText('Ready') && within(row).queryByText('Approved'));
    expect(readyIssueRow).toBeTruthy();
    expect(within(readyIssueRow!).getByText('No action available')).toBeInTheDocument();
    expect(within(readyIssueRow!).queryByText('Waiting')).not.toBeInTheDocument();
    expect(screen.queryByText('None / Ready')).not.toBeInTheDocument();
  });

  it('renders only supported payment actions and hides future payment actions', async () => {
    renderPage();

    await screen.findByText('Ready payment preparation');

    const panel = screen.getByLabelText('Payment preparation detail panel');
    expect(within(panel).getByRole('button', { name: 'Prepare Batch' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument();

    for (const unsupportedAction of ['Approve Payment', 'Execute Payment', 'Reopen Payment']) {
      expect(screen.queryByRole('button', { name: unsupportedAction })).not.toBeInTheDocument();
      expect(screen.queryByText(unsupportedAction)).not.toBeInTheDocument();
    }
  });

  it('shows Mark Paid only for review batches', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Ready payment preparation');
    let panel = screen.getByLabelText('Payment preparation detail panel');
    expect(within(panel).queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument();

    await selectQueueRow(user, (row) => row.textContent?.includes('Needs Review') ?? false);
    panel = screen.getByLabelText('Payment preparation detail panel');
    expect(within(panel).queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument();

    await selectQueueRow(user, (row) => row.textContent?.includes('Mark Paid') ?? false);
    panel = screen.getByLabelText('Payment preparation detail panel');
    expect(within(panel).getByRole('button', { name: 'Mark Paid' })).toBeInTheDocument();

    await selectQueueRow(user, (row) => row.textContent?.includes('Cancelled') ?? false);
    panel = screen.getByLabelText('Payment preparation detail panel');
    expect(within(panel).queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument();

    await selectQueueRow(user, (row) => {
      const text = row.textContent ?? '';
      return text.includes('Paid') && !text.includes('Mark Paid');
    });
    panel = screen.getByLabelText('Payment preparation detail panel');
    expect(within(panel).queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument();
  });

  it('prepares a payout batch with confirmation and refetches the queue', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Ready payment preparation');
    const initialBatchCalls = listPayoutBatchesMock.mock.calls.length;
    const initialReadinessCalls = getPaymentPreparationReadinessMock.mock.calls.length;

    const panel = screen.getByLabelText('Payment preparation detail panel');
    await user.click(within(panel).getByRole('button', { name: 'Prepare Batch' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('This will prepare a payout batch for the selected payment period.');
    await user.click(within(dialog).getByRole('button', { name: 'Prepare Batch' }));

    await waitFor(() => expect(preparePayoutBatchMock).toHaveBeenCalledWith('yalispor'));
    expect(await screen.findByText('Payment batch prepared.')).toBeInTheDocument();
    await waitFor(() => expect(listPayoutBatchesMock.mock.calls.length).toBeGreaterThan(initialBatchCalls));
    await waitFor(() => expect(getPaymentPreparationReadinessMock.mock.calls.length).toBeGreaterThan(initialReadinessCalls));
  });

  it('marks a draft payment batch for review with confirmation', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Payment draft').length).toBeGreaterThan(0));
    const draftRow = screen.getAllByRole('button')
      .filter((element) => element.classList.contains('op-table-row'))
      .find((row) => row.textContent?.includes('Needs Review'));
    expect(draftRow).toBeTruthy();
    await user.click(draftRow!);

    const panel = screen.getByLabelText('Payment preparation detail panel');
    expect(within(panel).getByRole('button', { name: 'Mark for Review' })).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Mark for Review' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('This payment batch will move into Finance review.');
    await user.click(within(dialog).getByRole('button', { name: 'Mark for Review' }));

    await waitFor(() => expect(markPayoutBatchReviewMock).toHaveBeenCalledWith('batch-draft-raw-11111111'));
    expect(await screen.findByText('Payment batch moved to review.')).toBeInTheDocument();
  });

  it('marks a review payment batch paid with optional confirmation evidence', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectQueueRow(user, (row) => row.textContent?.includes('Mark Paid') ?? false);

    const initialBatchCalls = listPayoutBatchesMock.mock.calls.length;
    const initialReadinessCalls = getPaymentPreparationReadinessMock.mock.calls.length;
    const panel = screen.getByLabelText('Payment preparation detail panel');
    await user.click(within(panel).getByRole('button', { name: 'Mark Paid' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Confirm that accounting has completed the EFT outside the application.');
    expect(within(dialog).getByLabelText('Payment reference optional')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Internal note optional')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Payment reference optional'), 'EFT-UI-123');
    await user.type(within(dialog).getByLabelText('Internal note optional'), 'Confirmed in bank portal');
    await user.click(within(dialog).getByRole('button', { name: 'Mark Paid' }));

    await waitFor(() => expect(markPayoutBatchPaidMock).toHaveBeenCalledWith('batch-review-raw-22222222', {
      paymentReference: 'EFT-UI-123',
      internalNote: 'Confirmed in bank portal',
    }));
    expect(await screen.findByText('Payment marked paid.')).toBeInTheDocument();
    await waitFor(() => expect(listPayoutBatchesMock.mock.calls.length).toBeGreaterThan(initialBatchCalls));
    await waitFor(() => expect(getPaymentPreparationReadinessMock.mock.calls.length).toBeGreaterThan(initialReadinessCalls));
  });

  it('allows mark paid without payment reference or internal note', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectQueueRow(user, (row) => row.textContent?.includes('Mark Paid') ?? false);

    const panel = screen.getByLabelText('Payment preparation detail panel');
    await user.click(within(panel).getByRole('button', { name: 'Mark Paid' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark Paid' }));

    await waitFor(() => expect(markPayoutBatchPaidMock).toHaveBeenCalledWith('batch-review-raw-22222222', {
      paymentReference: undefined,
      internalNote: undefined,
    }));
  });

  it('disables mark paid confirmation while pending', async () => {
    const user = userEvent.setup();
    let resolveMarkPaid: (batch: PayoutBatch) => void = () => undefined;
    markPayoutBatchPaidMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveMarkPaid = resolve;
    }));
    renderPage();

    await selectQueueRow(user, (row) => row.textContent?.includes('Mark Paid') ?? false);

    const panel = screen.getByLabelText('Payment preparation detail panel');
    await user.click(within(panel).getByRole('button', { name: 'Mark Paid' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark Paid' }));

    expect(screen.getByRole('button', { name: 'Marking paid...' })).toBeDisabled();
    resolveMarkPaid(makeBatch({
      id: 'batch-review-raw-22222222',
      status: 'paid',
      paidAt: '2026-07-04T11:30:00.000Z',
    }));
    expect(await screen.findByText('Payment marked paid.')).toBeInTheDocument();
  });

  it('shows a safe backend error when mark paid fails', async () => {
    const user = userEvent.setup();
    markPayoutBatchPaidMock.mockRejectedValueOnce(new Error('Only review payout batches can be marked paid.'));
    renderPage();

    await selectQueueRow(user, (row) => row.textContent?.includes('Mark Paid') ?? false);

    const panel = screen.getByLabelText('Payment preparation detail panel');
    await user.click(within(panel).getByRole('button', { name: 'Mark Paid' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark Paid' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Only review payout batches can be marked paid.');
    expect(screen.queryByText('Payment marked paid.')).not.toBeInTheDocument();
  });

  it('renders paid timeline only from real paid evidence', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectQueueRow(user, (row) => {
      const text = row.textContent ?? '';
      return text.includes('Paid') && !text.includes('Mark Paid');
    });

    const panel = screen.getByLabelText('Payment preparation detail panel');
    expect(within(panel).getAllByText('Paid').length).toBeGreaterThan(0);
    expect(within(panel).getByText('Payment reference EFT-2026-07-04')).toBeInTheDocument();
    expect(within(panel).queryByText('Marked paid')).not.toBeInTheDocument();
  });

  it('cancels a draft payment batch with confirmation', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Payment draft').length).toBeGreaterThan(0));
    const draftRow = screen.getAllByRole('button')
      .filter((element) => element.classList.contains('op-table-row'))
      .find((row) => row.textContent?.includes('Needs Review'));
    expect(draftRow).toBeTruthy();
    await user.click(draftRow!);

    const panel = screen.getByLabelText('Payment preparation detail panel');
    expect(within(panel).getByRole('button', { name: 'Cancel Batch' })).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Cancel Batch' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('This will cancel the selected payment batch.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel Batch' }));

    await waitFor(() => expect(cancelPayoutBatchMock).toHaveBeenCalledWith('batch-draft-raw-11111111'));
    expect(await screen.findByText('Payment batch cancelled.')).toBeInTheDocument();
  });

  it('does not render batch actions when the selected batch state is unsupported', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'Payment Preparation' });
    await user.click(within(screen.getByLabelText('Payment preparation workflow tabs')).getByRole('button', { name: /Approved/i }));

    const panel = screen.getByLabelText('Payment preparation detail panel');
    expect(within(panel).getByText('No action available')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Mark for Review' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Cancel Batch' })).not.toBeInTheDocument();
  });

  it('disables payment action confirmation while pending', async () => {
    const user = userEvent.setup();
    let resolvePrepare: (batch: PayoutBatch) => void = () => undefined;
    preparePayoutBatchMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePrepare = resolve;
    }));
    renderPage();

    await screen.findByText('Ready payment preparation');
    const panel = screen.getByLabelText('Payment preparation detail panel');
    await user.click(within(panel).getByRole('button', { name: 'Prepare Batch' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Prepare Batch' }));

    expect(screen.getByRole('button', { name: 'Preparing...' })).toBeDisabled();
    resolvePrepare(makeBatch({ id: 'batch-prepared-raw-77777777', status: 'draft' }));
    expect(await screen.findByText('Payment batch prepared.')).toBeInTheDocument();
  });
});
