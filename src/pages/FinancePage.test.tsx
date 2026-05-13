import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinancePage } from './FinancePage';
import type { FinanceDashboard } from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';

const getFinanceDashboardMock = vi.fn<() => Promise<FinanceDashboard>>();
const updateVendorFinancialProfileMock = vi.fn();

vi.mock('../features/finance/api', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/api')>('../features/finance/api');
  return {
    ...actual,
    getFinanceDashboard: () => getFinanceDashboardMock(),
    updateVendorFinancialProfile: (...args: unknown[]) => updateVendorFinancialProfileMock(...args),
  };
});

const financeDashboard: FinanceDashboard = {
  summary: {
    grossSales: '$4,000.00',
    refunds: '$725.00',
    netRevenue: '$3,275.00',
    platformFee: '$327.50',
    payoutEstimate: '$2,947.50',
    totalRevenue: '$4,000.00',
    availableBalance: '$2,947.50',
    pendingPayouts: '$0.00',
    refundsThisMonth: '$725.00',
  },
  profile: {
    vendorId: 'demo-vendor-a',
    commissionPercent: '10.00',
    commissionVatPercent: '0.00',
    deductShippingEnabled: false,
    shippingMode: 'disabled',
    fixedShippingFee: null,
    active: true,
    source: 'default',
  },
  transactions: [
    {
      id: 'ledger-refund-recorded',
      date: '2026-05-11T10:30:00Z',
      description: 'Shopify refund recorded',
      counterparty: 'Acme Supply Co.',
      category: 'Refund',
      amount: '$425.00',
      status: 'Recorded',
      shopifyOrderNumber: '1001',
      shopifyOrderId: 'gid://shopify/Order/1001',
      shopifyRefundId: 'gid://shopify/Refund/501',
    },
    {
      id: 'ledger-refund-failed',
      date: '2026-05-12T12:00:00Z',
      description: 'Refund ledger write failed',
      counterparty: 'Northwind Retail',
      category: 'Refund',
      amount: '$300.00',
      status: 'Failed',
      shopifyOrderNumber: '1002',
      shopifyOrderId: 'gid://shopify/Order/1002',
      shopifyRefundId: 'gid://shopify/Refund/502',
    },
  ],
};

function renderFinancePage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FinancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FinancePage control center', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a', 'demo-vendor-b'],
      vendorDetails: [
        { vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' },
        { vendorId: 'demo-vendor-b', vendorName: 'Demo Vendor B' },
      ],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getFinanceDashboardMock.mockReset();
    updateVendorFinancialProfileMock.mockReset();
  });

  it('renders recorded and failed finance statuses with operational hierarchy', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    expect(await screen.findByRole('heading', { name: /finance control center/i })).toBeInTheDocument();
    expect(screen.getAllByText('Recorded').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    expect(screen.getByText('Total refund amount')).toBeInTheDocument();
    expect(screen.getByText('Failed / attention')).toBeInTheDocument();
  });

  it('opens the finance detail panel for a selected ledger row', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    await screen.findByText('Refund ledger write failed');
    await userEvent.click(screen.getByText('Refund ledger write failed'));

    expect((await screen.findAllByText('gid://shopify/Refund/502')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/settlement engine is not enabled yet/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Current vendor-scoped finance query').length).toBeGreaterThan(0);
  });

  it('displays hold-equivalent refund ledger rows as Recorded instead of Failed', async () => {
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      transactions: [
        {
          ...financeDashboard.transactions[0],
          status: 'hold' as never,
        },
      ],
    });

    renderFinancePage();

    expect((await screen.findAllByText('Recorded')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ledger recorded').length).toBeGreaterThan(0);
  });

  it('shows editable vendor profile controls once for admins', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    const profilePanel = await screen.findByLabelText('Vendor finance profile settings');
    expect(screen.getByText('Demo Vendor A payout settings')).toBeInTheDocument();
    expect(within(profilePanel).getAllByLabelText(/commission %/i)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /save vendor profile/i })).toBeInTheDocument();
  });

  it('shows vendor finance profile as read-only for vendor users', async () => {
    setCurrentUser({
      email: 'vendor@demo.com',
      name: 'Demo Vendor',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    expect(await screen.findByText('Read-only vendor profile')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save vendor profile/i })).not.toBeInTheDocument();
  });

  it('refetches finance data after saving the vendor profile', async () => {
    updateVendorFinancialProfileMock.mockResolvedValue({
      ...financeDashboard.profile,
      commissionPercent: '15.00',
    });
    getFinanceDashboardMock
      .mockResolvedValueOnce(financeDashboard)
      .mockResolvedValueOnce({
        ...financeDashboard,
        summary: {
          ...financeDashboard.summary,
          platformFee: '$491.25',
          payoutEstimate: '$2,783.75',
        },
        profile: {
          ...financeDashboard.profile!,
          commissionPercent: '15.00',
        },
      });

    renderFinancePage();

    const profilePanel = await screen.findByLabelText('Vendor finance profile settings');
    const commissionInput = within(profilePanel).getByLabelText(/commission %/i);
    await userEvent.clear(commissionInput);
    await userEvent.type(commissionInput, '15');
    await userEvent.click(screen.getByRole('button', { name: /save vendor profile/i }));

    await waitFor(() => expect(updateVendorFinancialProfileMock).toHaveBeenCalled());
    await waitFor(() => expect(getFinanceDashboardMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('15.00% vendor profile')).toBeInTheDocument();
  });
});
