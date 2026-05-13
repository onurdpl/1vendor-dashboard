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
const preparePayoutBatchMock = vi.fn();

vi.mock('../features/finance/api', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/api')>('../features/finance/api');
  return {
    ...actual,
    getFinanceDashboard: () => getFinanceDashboardMock(),
    preparePayoutBatch: (...args: unknown[]) => preparePayoutBatchMock(...args),
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
  payoutBatchSummary: {
    eligibleRowCount: 1,
    eligibleNetAmount: '$3,059.10',
    blockedRowCount: 1,
    latestBatch: null,
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
      id: 'ledger-sale-recorded',
      date: '2026-05-10T09:15:00Z',
      description: 'Shopify order sale recorded',
      counterparty: 'gid://shopify/Order/1021',
      category: 'Invoice',
      amount: '$3,399.00',
      status: 'Recorded',
      shopifyOrderNumber: '1021',
      shopifyOrderId: '7616544244049',
      payoutCalculation: {
        grossAmount: '$3,399.00',
        commission: '$339.90',
        commissionVat: '$0.00',
        shippingDeduction: '$0.00',
        refundImpact: '$0.00',
        estimatedPayout: '$3,059.10',
        shippingApplied: false,
        shippingMode: 'disabled',
        profileSource: 'snapshot',
        commissionPercent: '10.00',
        commissionVatPercent: '0.00',
      },
    },
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
      payoutCalculation: {
        grossAmount: '$0.00',
        commission: '$0.00',
        commissionVat: '$0.00',
        shippingDeduction: '$0.00',
        refundImpact: '$425.00',
        estimatedPayout: '-$425.00',
        shippingApplied: false,
        shippingMode: 'disabled',
        profileSource: 'snapshot',
        commissionPercent: '10.00',
        commissionVatPercent: '0.00',
      },
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
    preparePayoutBatchMock.mockReset();
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
    expect(screen.getAllByText(/Payout execution is not enabled yet/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Current vendor-scoped finance query').length).toBeGreaterThan(0);
  });

  it('shows applied snapshot commission and VAT rates in compact ledger detail', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    await userEvent.click(await screen.findByText('Shopify order sale recorded'));

    expect(await screen.findByText('Commission (10.00%)')).toBeInTheDocument();
    expect(screen.getByText('Commission VAT (0.00%)')).toBeInTheDocument();
    expect(screen.getByText('Snapshot at sale creation')).toBeInTheDocument();
    expect(screen.getByText('Applied commission')).toBeInTheDocument();
    expect(screen.getByText('Applied commission VAT')).toBeInTheDocument();
    expect(screen.getByText('Current vendor profile')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'View' }).length).toBeGreaterThan(0);
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

  it('shows admin payout preparation controls and prepares a draft batch', async () => {
    preparePayoutBatchMock.mockResolvedValue({
      id: 'batch-demo-vendor-a',
      vendorId: 'demo-vendor-a',
      status: 'draft',
      grossAmount: '$3,399.00',
      commissionAmount: '$339.90',
      commissionVatAmount: '$0.00',
      shippingDeductionAmount: '$0.00',
      refundAmount: '$0.00',
      netAmount: '$3,059.10',
      currency: 'TRY',
      createdByUserId: 'admin',
      createdAt: '2026-05-13T12:00:00Z',
      updatedAt: '2026-05-13T12:00:00Z',
      lineCount: 1,
      warning: null,
    });
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);

    renderFinancePage();

    expect(await screen.findByText('Demo Vendor A upcoming payout')).toBeInTheDocument();
    expect(screen.getByText('Eligible rows')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /prepare draft payout/i }));

    await waitFor(() => expect(preparePayoutBatchMock).toHaveBeenCalledWith('demo-vendor-a'));
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
    expect(screen.getByText('Read-only upcoming payout')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save vendor profile/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /prepare draft payout/i })).not.toBeInTheDocument();
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
        transactions: [
          financeDashboard.transactions[0],
          {
            ...financeDashboard.transactions[1],
            payoutCalculation: {
              ...financeDashboard.transactions[1].payoutCalculation!,
              commission: '$63.75',
              estimatedPayout: '-$488.75',
            },
          },
          financeDashboard.transactions[2],
        ],
      });

    renderFinancePage();

    await userEvent.click(await screen.findByText('Shopify refund recorded'));
    expect((await screen.findAllByText('-$425.00')).length).toBeGreaterThan(0);
    const profilePanel = await screen.findByLabelText('Vendor finance profile settings');
    const commissionInput = within(profilePanel).getByLabelText(/commission %/i);
    await userEvent.clear(commissionInput);
    await userEvent.type(commissionInput, '15');
    await userEvent.click(screen.getByRole('button', { name: /save vendor profile/i }));

    await waitFor(() => expect(updateVendorFinancialProfileMock).toHaveBeenCalled());
    await waitFor(() => expect(getFinanceDashboardMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('15.00% vendor profile')).toBeInTheDocument();
    expect(await screen.findByText('-$488.75')).toBeInTheDocument();
  });

  it('refreshes selected invoice payout detail after saving commission and VAT profile changes', async () => {
    updateVendorFinancialProfileMock.mockResolvedValue({
      ...financeDashboard.profile,
      commissionPercent: '15.00',
      commissionVatPercent: '18.00',
      deductShippingEnabled: true,
      shippingMode: 'external_provider',
      fixedShippingFee: '88.00',
      source: 'configured',
    });
    getFinanceDashboardMock
      .mockResolvedValueOnce(financeDashboard)
      .mockResolvedValueOnce({
        ...financeDashboard,
        summary: {
          ...financeDashboard.summary,
          platformFee: '$509.85',
          commissionVat: '$91.77',
          shippingDeductions: '$0.00',
          payoutEstimate: '$2,797.38',
        },
        profile: {
          ...financeDashboard.profile!,
          commissionPercent: '15.00',
          commissionVatPercent: '18.00',
          deductShippingEnabled: true,
          shippingMode: 'external_provider',
          fixedShippingFee: '88.00',
          source: 'configured',
        },
        transactions: [
          {
            ...financeDashboard.transactions[0],
            payoutCalculation: {
              ...financeDashboard.transactions[0].payoutCalculation!,
              commission: '$509.85',
              commissionVat: '$91.77',
              shippingDeduction: '$0.00',
              estimatedPayout: '$2,797.38',
              shippingApplied: false,
              shippingMode: 'external_provider',
            },
          },
          financeDashboard.transactions[1],
          financeDashboard.transactions[2],
        ],
      });

    renderFinancePage();

    await userEvent.click(await screen.findByText('Shopify order sale recorded'));
    expect(await screen.findByText('-$339.90')).toBeInTheDocument();
    expect((await screen.findAllByText('$0.00')).length).toBeGreaterThan(0);

    const profilePanel = await screen.findByLabelText('Vendor finance profile settings');
    await userEvent.clear(within(profilePanel).getByLabelText(/^commission %$/i));
    await userEvent.type(within(profilePanel).getByLabelText(/^commission %$/i), '15');
    await userEvent.clear(within(profilePanel).getByLabelText(/commission VAT %/i));
    await userEvent.type(within(profilePanel).getByLabelText(/commission VAT %/i), '18');
    await userEvent.selectOptions(within(profilePanel).getByLabelText(/shipping mode/i), 'external_provider');
    await userEvent.clear(within(profilePanel).getByLabelText(/fixed shipping fee/i));
    await userEvent.type(within(profilePanel).getByLabelText(/fixed shipping fee/i), '88');
    await userEvent.click(within(profilePanel).getByLabelText(/deduct shipping after fulfillment/i));
    await userEvent.click(screen.getByRole('button', { name: /save vendor profile/i }));

    await waitFor(() =>
      expect(updateVendorFinancialProfileMock).toHaveBeenCalledWith('demo-vendor-a', {
        commissionPercent: 15,
        commissionVatPercent: 18,
        deductShippingEnabled: true,
        shippingMode: 'external_provider',
        fixedShippingFee: 88,
      }),
    );
    await waitFor(() => expect(getFinanceDashboardMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('15.00% vendor profile')).toBeInTheDocument();
    expect((await screen.findAllByText('$509.85')).length).toBeGreaterThan(0);
    expect(await screen.findByText('-$91.77')).toBeInTheDocument();
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
    expect((await screen.findAllByText('$2,797.38')).length).toBeGreaterThan(0);
  });

  it('sends edited form values when changing a persisted profile from 15/18 to 12/20', async () => {
    const configuredDashboard: FinanceDashboard = {
      ...financeDashboard,
      summary: {
        ...financeDashboard.summary,
        platformFee: '$509.85',
        commissionVat: '$91.77',
        payoutEstimate: '$2,797.38',
      },
      profile: {
        ...financeDashboard.profile!,
        commissionPercent: '15.00',
        commissionVatPercent: '18.00',
        deductShippingEnabled: true,
        shippingMode: 'external_provider',
        fixedShippingFee: '88.00',
        source: 'configured',
      },
      transactions: [
        {
          ...financeDashboard.transactions[0],
          payoutCalculation: {
            ...financeDashboard.transactions[0].payoutCalculation!,
            commission: '$509.85',
            commissionVat: '$91.77',
            estimatedPayout: '$2,797.38',
            shippingMode: 'external_provider',
          },
        },
        financeDashboard.transactions[1],
        financeDashboard.transactions[2],
      ],
    };
    updateVendorFinancialProfileMock.mockResolvedValue({
      ...configuredDashboard.profile!,
      commissionPercent: '12.00',
      commissionVatPercent: '20.00',
    });
    getFinanceDashboardMock
      .mockResolvedValueOnce(configuredDashboard)
      .mockResolvedValueOnce({
        ...configuredDashboard,
        summary: {
          ...configuredDashboard.summary,
          platformFee: '$407.88',
          commissionVat: '$81.58',
          payoutEstimate: '$2,909.54',
        },
        profile: {
          ...configuredDashboard.profile!,
          commissionPercent: '12.00',
          commissionVatPercent: '20.00',
        },
        transactions: [
          {
            ...configuredDashboard.transactions[0],
            payoutCalculation: {
              ...configuredDashboard.transactions[0].payoutCalculation!,
              commission: '$407.88',
              commissionVat: '$81.58',
              estimatedPayout: '$2,909.54',
            },
          },
          configuredDashboard.transactions[1],
          configuredDashboard.transactions[2],
        ],
      });

    renderFinancePage();

    await userEvent.click(await screen.findByText('Shopify order sale recorded'));
    const profilePanel = await screen.findByLabelText('Vendor finance profile settings');
    await userEvent.clear(within(profilePanel).getByLabelText(/^commission %$/i));
    await userEvent.type(within(profilePanel).getByLabelText(/^commission %$/i), '12');
    await userEvent.clear(within(profilePanel).getByLabelText(/commission VAT %/i));
    await userEvent.type(within(profilePanel).getByLabelText(/commission VAT %/i), '20');
    await userEvent.click(screen.getByRole('button', { name: /save vendor profile/i }));

    await waitFor(() =>
      expect(updateVendorFinancialProfileMock).toHaveBeenCalledWith('demo-vendor-a', {
        commissionPercent: 12,
        commissionVatPercent: 20,
        deductShippingEnabled: true,
        shippingMode: 'external_provider',
        fixedShippingFee: 88,
      }),
    );
    expect(await screen.findByText('12.00% vendor profile')).toBeInTheDocument();
    expect((await screen.findAllByText('$407.88')).length).toBeGreaterThan(0);
    expect(await screen.findByText('-$81.58')).toBeInTheDocument();
    expect((await screen.findAllByText('$2,909.54')).length).toBeGreaterThan(0);
  });

  it('surfaces vendor profile save failures', async () => {
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);
    updateVendorFinancialProfileMock.mockRejectedValue(new Error('Profile save failed'));

    renderFinancePage();

    const profilePanel = await screen.findByLabelText('Vendor finance profile settings');
    await userEvent.clear(within(profilePanel).getByLabelText(/^commission %$/i));
    await userEvent.type(within(profilePanel).getByLabelText(/^commission %$/i), '12');
    await userEvent.click(screen.getByRole('button', { name: /save vendor profile/i }));

    expect(await screen.findByText('Profile save failed')).toBeInTheDocument();
  });
});
