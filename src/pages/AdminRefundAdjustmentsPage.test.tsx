import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRefundAdjustmentsPage } from './AdminRefundAdjustmentsPage';
import {
  listRefundAdjustments,
  type RefundAdjustmentRecord,
  type RefundAdjustmentsListResponse,
} from '../features/finance/refundAdjustmentsApi';
import { setCurrentVendorId, setSession, type CurrentUser } from '../lib/auth';

vi.mock('../features/finance/refundAdjustmentsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/finance/refundAdjustmentsApi')>();
  return {
    ...actual,
    listRefundAdjustments: vi.fn(),
  };
});

const listRefundAdjustmentsMock = vi.mocked(listRefundAdjustments);

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

function makeAdjustment(overrides: Partial<RefundAdjustmentRecord>): RefundAdjustmentRecord {
  return {
    id: 'raw-adjustment-id-00000000',
    refundRecordId: 'raw-refund-record-id-00000000',
    refundFinanceLedgerEntryId: 'raw-ledger-id-00000000',
    vendorId: 'yalispor',
    originalOrderId: 'raw-order-id-00000000',
    originalSettlementApprovalId: 'raw-settlement-id-00000000',
    originalSettlementApprovalLineId: 'raw-settlement-line-id-00000000',
    originalSettlementCommissionInvoiceId: 'raw-commission-invoice-id-00000000',
    status: 'pending',
    amountMinor: 42500,
    originalAmountMinor: 42500,
    appliedAmountMinor: 0,
    remainingAmountMinor: 42500,
    currencyCode: 'TRY',
    reason: 'Refund review required before vendor payment.',
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    appliedSettlementApprovalId: null,
    appliedSettlementApprovalLineId: null,
    blockedReason: null,
    createdBy: 'admin@example.com',
    applications: [],
    events: [
      {
        id: 'raw-event-id-00000000',
        eventType: 'created',
        createdAt: '2026-07-01T09:05:00.000Z',
      },
    ],
    references: {
      orderLabel: 'Order #1097',
      refundLabel: 'Refund #RF-1097',
      originalSettlementLabel: 'SET-20260701-YALISPOR',
      originalCommissionInvoiceLabel: 'Invoice INV-1097',
    },
    ...overrides,
  };
}

const adjustments: RefundAdjustmentRecord[] = [
  makeAdjustment({ id: 'adjustment-pending', status: 'pending' }),
  makeAdjustment({
    id: 'adjustment-partial',
    status: 'partially_applied',
    amountMinor: 98000,
    originalAmountMinor: 98000,
    appliedAmountMinor: 36000,
    remainingAmountMinor: 62000,
    reason: 'Vendor debt balance offset pending.',
    updatedAt: '2026-07-02T10:00:00.000Z',
    references: {
      orderLabel: 'Order #1098',
      refundLabel: 'Refund #RF-1098',
      originalSettlementLabel: 'SET-20260702-YALISPOR',
      originalCommissionInvoiceLabel: null,
    },
  }),
  makeAdjustment({ id: 'adjustment-applied', status: 'applied', updatedAt: '2026-07-03T10:00:00.000Z' }),
  makeAdjustment({
    id: 'adjustment-blocked',
    status: 'blocked',
    blockedReason: 'Vendor debt exists',
    updatedAt: '2026-07-04T10:00:00.000Z',
  }),
  makeAdjustment({ id: 'adjustment-cancelled', status: 'cancelled', updatedAt: '2026-07-05T10:00:00.000Z' }),
];

function response(records = adjustments): RefundAdjustmentsListResponse {
  return {
    ok: true,
    writesPerformed: false,
    count: records.length,
    statuses: {
      pending: records.filter((record) => record.status === 'pending').length,
      partially_applied: records.filter((record) => record.status === 'partially_applied').length,
      applied: records.filter((record) => record.status === 'applied').length,
      blocked: records.filter((record) => record.status === 'blocked').length,
      cancelled: records.filter((record) => record.status === 'cancelled').length,
    },
    records,
  };
}

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
      <MemoryRouter initialEntries={['/admin/finance/refund-adjustments']}>
        <Routes>
          <Route path="/admin/finance/refund-adjustments" element={<AdminRefundAdjustmentsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setSession('test-session', adminUser);
  setCurrentVendorId('yalispor');
  listRefundAdjustmentsMock.mockResolvedValue(response());
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('AdminRefundAdjustmentsPage', () => {
  it('renders the refund adjustments route and workflow tabs', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Refund Adjustments' })).toBeInTheDocument();
    expect(screen.getByText('Review refund deductions and balance adjustments before vendor payment.')).toBeInTheDocument();

    const tabs = screen.getByLabelText('Refund adjustment workflow tabs');
    for (const label of ['All', 'Needs Review', 'Partially Applied', 'Applied', 'Blocked', 'Cancelled']) {
      expect(within(tabs).getByText(label)).toBeInTheDocument();
    }
  });

  it('renders the exact operational table columns', async () => {
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Order #1097').length).toBeGreaterThan(0));

    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual(['Vendor', 'Refund', 'Adjustment', 'Amount', 'Status', 'Next Action', 'Updated']);
    expect(screen.getAllByText('Yalı Spor').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Order #1097').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refund reference RF-1097').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
  });

  it('selects refund adjustment rows and updates the right panel', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Order #1097').length).toBeGreaterThan(0));
    const rows = screen.getAllByRole('button').filter((element) => element.classList.contains('op-table-row'));
    const partialRow = rows.find((row) => row.textContent?.includes('Order #1098'));
    expect(partialRow).toBeTruthy();

    await user.click(partialRow!);

    expect(partialRow).toHaveClass('op-row-selected');
    const panel = screen.getByLabelText('Refund adjustment detail panel');
    expect(within(panel).getAllByText(/Order #1098/).length).toBeGreaterThan(0);
    expect(within(panel).getByText('Balance offset pending')).toBeInTheDocument();
  });

  it('renders the right panel hierarchy from queue-safe fields', async () => {
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Order #1097').length).toBeGreaterThan(0));

    const panel = screen.getByLabelText('Refund adjustment detail panel');
    for (const section of ['Adjustment Summary', 'Why is this waiting?', 'Next Action', 'Payment Impact', 'Related Records', 'Timeline']) {
      expect(within(panel).getByText(section)).toBeInTheDocument();
    }
    expect(within(panel).getByText('Refund review required')).toBeInTheDocument();
    expect(within(panel).getByText('Review')).toBeInTheDocument();
    expect(within(panel).getByText('No debt adjustment')).toBeInTheDocument();
    expect(within(panel).getByText('No linked support')).toBeInTheDocument();
    expect(within(panel).queryByText('UNKNOWN')).not.toBeInTheDocument();
    expect(within(panel).queryByText('None loaded')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Not loaded')).not.toBeInTheDocument();
  });

  it('does not expose raw ledger or reference IDs in the queue layer', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Refund Adjustments' });

    for (const rawValue of [
      'raw-adjustment-id-00000000',
      'raw-refund-record-id-00000000',
      'raw-ledger-id-00000000',
      'raw-order-id-00000000',
      'raw-settlement-id-00000000',
      'raw-commission-invoice-id-00000000',
      'raw-event-id-00000000',
    ]) {
      expect(screen.queryByText(rawValue)).not.toBeInTheDocument();
    }
  });

  it('filters queue records by workflow tab', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'Refund Adjustments' });

    await user.click(screen.getByRole('button', { name: /Blocked/i }));

    expect(screen.getByText('Vendor debt exists')).toBeInTheDocument();
    expect(screen.queryByText('Balance offset')).not.toBeInTheDocument();
  });
});
