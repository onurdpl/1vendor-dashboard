import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPaymentPreparationPage } from './AdminPaymentPreparationPage';
import {
  getPaymentPreparationReadiness,
  listPayoutBatches,
  type FinanceDashboard,
  type PayoutBatch,
} from '../features/finance/paymentPreparationApi';
import { setCurrentVendorId, setSession, type CurrentUser } from '../lib/auth';

vi.mock('../features/finance/paymentPreparationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/finance/paymentPreparationApi')>();
  return {
    ...actual,
    getPaymentPreparationReadiness: vi.fn(),
    listPayoutBatches: vi.fn(),
  };
});

const listPayoutBatchesMock = vi.mocked(listPayoutBatches);
const getPaymentPreparationReadinessMock = vi.mocked(getPaymentPreparationReadiness);

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
    warning: null,
    updatedAt: '2026-07-03T10:00:00.000Z',
  }),
  makeBatch({
    id: 'batch-paid-raw-44444444',
    status: 'paid_placeholder',
    refundAmount: 'TRY 0.00',
    warning: null,
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

beforeEach(() => {
  setSession('test-session', adminUser);
  setCurrentVendorId('yalispor');
  listPayoutBatchesMock.mockResolvedValue(payoutBatches);
  getPaymentPreparationReadinessMock.mockResolvedValue(financeDashboard);
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
    expect(screen.getByText('Prepare approved vendor payments before payout execution.')).toBeInTheDocument();

    const tabs = screen.getByLabelText('Payment preparation workflow tabs');
    for (const label of ['All', 'Ready to Prepare', 'Draft', 'In Review', 'Approved', 'Paid', 'Cancelled']) {
      expect(within(tabs).getByText(label)).toBeInTheDocument();
    }
  });

  it('renders the exact operational table columns', async () => {
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Payment draft').length).toBeGreaterThan(0));

    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual(['Vendor', 'Payment', 'Amount', 'Status', 'Issues', 'Next Action', 'Updated', 'Open']);
    expect(screen.getAllByText('Yalı Spor').length).toBeGreaterThan(0);
    expect(screen.getByText('Ready payment preparation')).toBeInTheDocument();
    expect(screen.getAllByText('3 eligible settlement rows').length).toBeGreaterThan(0);
  });

  it('renders the right panel hierarchy from queue-safe fields', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Ready payment preparation')).toBeInTheDocument());

    const panel = screen.getByLabelText('Payment preparation detail panel');
    for (const section of [
      'Payment Summary',
      'Why is this waiting?',
      'Next Action',
      'Payment Impact',
      'Related Records',
      'Timeline',
    ]) {
      expect(within(panel).getByText(section)).toBeInTheDocument();
    }
    expect(within(panel).getByText('Missing payment evidence')).toBeInTheDocument();
    expect(within(panel).getByText('Investigate')).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: /Paid/i }));

    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
    expect(screen.queryByText('Ready payment preparation')).not.toBeInTheDocument();
  });
});
