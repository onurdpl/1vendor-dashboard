import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VendorProfilePage } from './VendorProfilePage';
import type { FinanceDashboard, SupportTicket, VendorBillingProfile, VendorShippingConfig } from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';

const getVendorShippingConfigMock = vi.fn<() => Promise<VendorShippingConfig>>();
const getFinanceDashboardMock = vi.fn<() => Promise<FinanceDashboard>>();
const getVendorBillingProfileMock = vi.fn<() => Promise<VendorBillingProfile | null>>();
const listVendorSupportTicketsMock = vi.fn<() => Promise<SupportTicket[]>>();
const listAdminSupportTicketsMock = vi.fn<() => Promise<SupportTicket[]>>();
const createSupportTicketMock = vi.fn();

vi.mock('../features/orders/api', async () => {
  const actual = await vi.importActual<typeof import('../features/orders/api')>('../features/orders/api');
  return {
    ...actual,
    getVendorShippingConfig: () => getVendorShippingConfigMock(),
  };
});

vi.mock('../features/finance/api', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/api')>('../features/finance/api');
  return {
    ...actual,
    getFinanceDashboard: () => getFinanceDashboardMock(),
  };
});

vi.mock('../features/vendors/api', async () => {
  const actual = await vi.importActual<typeof import('../features/vendors/api')>('../features/vendors/api');
  return {
    ...actual,
    getVendorBillingProfile: () => getVendorBillingProfileMock(),
  };
});

vi.mock('../features/support/api', async () => {
  const actual = await vi.importActual<typeof import('../features/support/api')>('../features/support/api');
  return {
    ...actual,
    createSupportTicket: (...args: unknown[]) => createSupportTicketMock(...args),
    listAdminSupportTickets: () => listAdminSupportTicketsMock(),
    listVendorSupportTickets: () => listVendorSupportTicketsMock(),
  };
});

const shippingConfig: VendorShippingConfig = {
  vendorId: 'demo-vendor-a',
  preferredProvider: 'navlungo',
  shippingEnabled: true,
  defaultDesi: '3.00',
  cargoIntegrationId: '2547',
  defaultWarehouseId: '55574',
  shippingVatPercent: '18.00',
  source: 'configured',
  updatedAt: '2026-05-20T10:00:00Z',
  warehouses: [
    {
      id: 'warehouse-demo-a',
      vendorId: 'demo-vendor-a',
      provider: 'navlungo',
      warehouseId: '55574',
      name: 'Main warehouse',
      address: 'Istanbul warehouse',
      isDefault: true,
    },
  ],
  providerMetadata: {
    navlungoSenderAddressId: '55574',
    navlungoSenderCity: 'Mugla',
    navlungoSenderDistrict: 'Fethiye',
    navlungoReturnRecipientAddressId: '55578',
    navlungoReturnRecipientCity: 'Konya',
    navlungoReturnRecipientDistrict: 'Selcuklu',
  },
};

const financeDashboard: FinanceDashboard = {
  summary: {
    grossSales: '$10,000.00',
    refunds: '$500.00',
    netRevenue: '$9,500.00',
    platformFee: '$1,187.50',
    payoutEstimate: '$8,312.50',
    totalRevenue: '$10,000.00',
    availableBalance: '$8,312.50',
    pendingPayouts: '$0.00',
    refundsThisMonth: '$500.00',
  },
  profile: {
    vendorId: 'demo-vendor-a',
    commissionPercent: '12.50',
    commissionVatPercent: '20.00',
    deductShippingEnabled: true,
    shippingMode: 'external_provider',
    fixedShippingFee: null,
    active: true,
    source: 'configured',
  },
  payoutBatchSummary: {
    eligibleRowCount: 0,
    eligibleNetAmount: '$0.00',
    blockedRowCount: 0,
    latestBatch: null,
  },
  transactions: [],
};

const billingProfile: VendorBillingProfile = {
  id: 'billing-demo-vendor-a',
  vendorId: 'demo-vendor-a',
  legalCompanyName: 'Demo Vendor A Ltd.',
  taxNumber: '1111111111',
  taxOffice: 'Kadikoy',
  billingAddress: 'Billing Street 1, Istanbul',
  iban: 'TR000000000000000000000000',
  authorizedPerson: 'Demo Authorized Person',
  billingEmail: 'billing@example.test',
  billingPhone: '+905551112233',
  createdAt: '2026-06-05T10:00:00Z',
  updatedAt: '2026-06-05T10:00:00Z',
};

function supportTicket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: 'support-profile-1',
    createdAt: '2026-05-20T10:00:00Z',
    updatedAt: '2026-05-20T10:00:00Z',
    createdByUserId: 'vendor-user',
    createdByRole: 'vendor',
    vendorId: 'demo-vendor-a',
    vendorName: 'Demo Vendor A',
    subject: 'Vendor profile settings correction',
    message: 'Please review settings.',
    priority: 'normal',
    status: 'OPEN',
    category: 'OTHER',
    assigneeUserId: null,
    assigneeName: null,
    vendorUnreadCount: 0,
    adminUnreadCount: 0,
    lastReplyAt: null,
    lastReplyByRole: null,
    firstResponseDueAt: null,
    nextResponseDueAt: null,
    escalatedAt: null,
    escalationReason: null,
    sla: null,
    contextType: 'general',
    contextId: 'demo-vendor-a',
    contextSummary: {
      route: 'vendor_profile_settings',
      path: '/vendor/profile',
      status: 'correction_requested',
    },
    resolvedAt: null,
    closedAt: null,
    ...overrides,
  };
}

function renderVendorProfilePage(initialEntries = ['/vendor/profile']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/vendor/profile" element={<VendorProfilePage />} />
          <Route path="/orders" element={<div>Orders queue route</div>} />
          <Route path="/returns" element={<div>Returns queue route</div>} />
          <Route path="/finance" element={<div>Finance route</div>} />
          <Route path="/automation" element={<div>Automation route</div>} />
          <Route path="/support" element={<div>Support workspace route</div>} />
          <Route path="/support/:ticketId" element={<div>Vendor support detail route</div>} />
          <Route path="/admin/support/:ticketId" element={<div>Admin support detail route</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VendorProfilePage', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'vendor-a@demo.com',
      name: 'Vendor A User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorShippingConfigMock.mockReset();
    getVendorShippingConfigMock.mockResolvedValue(shippingConfig);
    getFinanceDashboardMock.mockReset();
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);
    getVendorBillingProfileMock.mockReset();
    getVendorBillingProfileMock.mockResolvedValue(null);
    listVendorSupportTicketsMock.mockReset();
    listVendorSupportTicketsMock.mockResolvedValue([]);
    listAdminSupportTicketsMock.mockReset();
    listAdminSupportTicketsMock.mockResolvedValue([]);
    createSupportTicketMock.mockReset();
  });

  it('renders a read-only marketplace vendor profile summary from existing config', async () => {
    renderVendorProfilePage();

    expect(await screen.findByRole('heading', { name: 'Demo Vendor A' })).toBeInTheDocument();
    expect(screen.getByText('Marketplace seller workspace')).toBeInTheDocument();
    expect(screen.getByText('Read-only vendor view')).toBeInTheDocument();
    expect(screen.getByText('Active workspace')).toBeInTheDocument();
    expect(screen.getByText('Legal name')).toBeInTheDocument();
    expect(screen.getAllByText('Not modeled yet').length).toBeGreaterThan(0);
    expect(await screen.findByText('12.50%')).toBeInTheDocument();
    expect(screen.getByText('External provider cost')).toBeInTheDocument();
    expect(screen.getAllByText('Navlungo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('55574').length).toBeGreaterThan(0);
    expect(screen.getByText('55578')).toBeInTheDocument();
    expect(screen.getByText('Mugla / Fethiye')).toBeInTheDocument();
    expect(screen.getByText('Konya / Selcuklu')).toBeInTheDocument();
    expect(screen.getByText('Forward warehouse')).toBeInTheDocument();
    expect(screen.getByText('Return destination')).toBeInTheDocument();
    expect(screen.getByLabelText('Vendor operational readiness')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shipping ready' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Returns ready' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Finance visibility ready' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Support channel active' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workflow access ready' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Automation visibility ready' })).toBeInTheDocument();
    expect(screen.getAllByText('Shipping enabled').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Provider configured').length).toBeGreaterThan(0);
    expect(screen.getByText('Warehouse configured')).toBeInTheDocument();
    expect(screen.getByText('Finance readiness means estimate visibility only, not payout or accounting execution.')).toBeInTheDocument();
    expect(screen.getByText('Integration status')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Billing / Legal Profile' })).toBeInTheDocument();
    expect(screen.getByText('Admin-managed')).toBeInTheDocument();
    expect(screen.getByText('Not available in vendor view')).toBeInTheDocument();
    expect(getVendorBillingProfileMock).not.toHaveBeenCalled();
    expect(screen.getByText('Shopify workspace')).toBeInTheDocument();
    expect(screen.getAllByText('Provider configuration status').length).toBeGreaterThan(0);
    expect(screen.getByText('Fields not modeled yet')).toBeInTheDocument();
    expect(screen.getByText('Legal entity name, tax office, and tax identity')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('renders readiness states from missing config truth without fake ready states', async () => {
    getVendorShippingConfigMock.mockResolvedValue({
      ...shippingConfig,
      shippingEnabled: false,
      preferredProvider: 'navlungo',
      defaultWarehouseId: null,
      warehouses: [],
      providerMetadata: {},
      source: 'default',
    });
    getFinanceDashboardMock.mockResolvedValue({
      ...financeDashboard,
      profile: {
        ...financeDashboard.profile!,
        active: false,
        source: 'default',
      },
    });

    renderVendorProfilePage();

    const shippingHeading = await screen.findByRole('heading', { name: 'Shipping ready' });
    const shippingCard = shippingHeading.closest('article');
    expect(shippingCard).not.toBeNull();
    await waitFor(() =>
      expect(within(shippingCard!).getAllByText('Requires configuration review').length).toBeGreaterThan(0),
    );
    expect(within(shippingCard!).queryByText('Ready')).not.toBeInTheDocument();
    expect(within(shippingCard!).getByText('Enable shipping before shipment workflows can rely on this vendor setup.')).toBeInTheDocument();
    expect(within(shippingCard!).getByText('Review the provider metadata before treating shipping as ready.')).toBeInTheDocument();
    expect(within(shippingCard!).getByText('Configure a warehouse or sender address for shipment work.')).toBeInTheDocument();

    const returnsHeading = screen.getByRole('heading', { name: 'Returns ready' });
    const returnsCard = returnsHeading.closest('article');
    expect(returnsCard).not.toBeNull();
    expect(within(returnsCard!).getByText('Review the return recipient destination before return workflows rely on it.')).toBeInTheDocument();

    const financeHeading = screen.getByRole('heading', { name: 'Finance visibility ready' });
    const financeCard = financeHeading.closest('article');
    expect(financeCard).not.toBeNull();
    expect(within(financeCard!).getByText('Marketplace terms require verification before treating finance visibility as ready.')).toBeInTheDocument();
  });

  it('renders readiness guidance links to existing workflow routes', async () => {
    renderVendorProfilePage();

    await screen.findByRole('heading', { name: 'Operational readiness' });
    expect(screen.getByRole('button', { name: 'Open shipping workflow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open returns review' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open settlement preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open support workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open orders queue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open automation queue' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open settlement preview' }));

    expect(await screen.findByText('Finance route')).toBeInTheDocument();
  });

  it('creates a vendor profile correction support ticket with safe context', async () => {
    const createdTicket = supportTicket({ id: 'support-created' });
    createSupportTicketMock.mockResolvedValue(createdTicket);

    renderVendorProfilePage();

    const contactButtons = await screen.findAllByRole('button', { name: 'Request profile correction' });
    await waitFor(() => expect(contactButtons[0]).not.toBeDisabled());
    await userEvent.click(contactButtons[0]);

    await waitFor(() =>
      expect(createSupportTicketMock).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'OTHER',
          contextType: 'general',
          contextId: 'demo-vendor-a',
          contextSnapshot: expect.objectContaining({
            route: 'vendor_profile_settings',
            path: '/vendor/profile',
            vendorId: 'demo-vendor-a',
            shippingProvider: 'navlungo',
            returnRecipientConfigured: true,
          }),
        }),
      ),
    );
    expect(await screen.findByText('Vendor support detail route')).toBeInTheDocument();
  });

  it('opens an existing profile correction ticket instead of creating a duplicate', async () => {
    listVendorSupportTicketsMock.mockResolvedValue([supportTicket({ id: 'support-existing' })]);

    renderVendorProfilePage();

    const supportButtons = await screen.findAllByRole('button', { name: 'Open correction ticket' });
    await waitFor(() => expect(supportButtons[0]).not.toBeDisabled());
    await userEvent.click(supportButtons[0]);

    expect(await screen.findByText('Vendor support detail route')).toBeInTheDocument();
    expect(createSupportTicketMock).not.toHaveBeenCalled();
  });

  it('shows admin-owned profile badges without rendering a broad editor', async () => {
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
    listAdminSupportTicketsMock.mockResolvedValue([supportTicket({ id: 'admin-profile-ticket' })]);

    renderVendorProfilePage();

    expect(await screen.findByText('Admin view')).toBeInTheDocument();
    expect(screen.getByText('Admin-owned configuration')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();

    const supportButtons = await screen.findAllByRole('button', { name: 'Open correction ticket' });
    await waitFor(() => expect(supportButtons[0]).not.toBeDisabled());
    await userEvent.click(supportButtons[0]);
    expect(await screen.findByText('Admin support detail route')).toBeInTheDocument();
    expect(createSupportTicketMock).not.toHaveBeenCalled();
  });

  it('renders admin billing profile values read-only when configured', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue(billingProfile);

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();
    expect(await screen.findByText('Demo Vendor A Ltd.')).toBeInTheDocument();
    expect(screen.getByText('1111111111')).toBeInTheDocument();
    expect(screen.getByText('Kadikoy')).toBeInTheDocument();
    expect(screen.getByText('Billing Street 1, Istanbul')).toBeInTheDocument();
    expect(screen.getByText('billing@example.test')).toBeInTheDocument();
    expect(within(billingSection!).getByText('Configured')).toBeInTheDocument();
    expect(within(billingSection!).getByText('Deferred')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save billing/i })).not.toBeInTheDocument();
  });
});
