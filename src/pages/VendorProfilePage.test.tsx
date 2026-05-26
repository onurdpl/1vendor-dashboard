import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VendorProfilePage } from './VendorProfilePage';
import type { FinanceDashboard, SupportTicket, VendorShippingConfig } from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';

const getVendorShippingConfigMock = vi.fn<() => Promise<VendorShippingConfig>>();
const getFinanceDashboardMock = vi.fn<() => Promise<FinanceDashboard>>();
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
    navlungoReturnRecipientAddressId: '55578',
    navlungoReturnRecipientCity: 'Istanbul',
    navlungoReturnRecipientDistrict: 'Kadikoy',
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
    listVendorSupportTicketsMock.mockReset();
    listVendorSupportTicketsMock.mockResolvedValue([]);
    listAdminSupportTicketsMock.mockReset();
    listAdminSupportTicketsMock.mockResolvedValue([]);
    createSupportTicketMock.mockReset();
  });

  it('renders a read-only marketplace vendor profile summary from existing config', async () => {
    renderVendorProfilePage();

    expect(await screen.findByRole('heading', { name: 'Demo Vendor A' })).toBeInTheDocument();
    expect(screen.getByText('Read-only vendor view')).toBeInTheDocument();
    expect(screen.getByText('Legal name')).toBeInTheDocument();
    expect(screen.getAllByText('Not modeled yet').length).toBeGreaterThan(0);
    expect(await screen.findByText('12.50%')).toBeInTheDocument();
    expect(screen.getByText('External provider cost')).toBeInTheDocument();
    expect(screen.getAllByText('Navlungo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('55574').length).toBeGreaterThan(0);
    expect(screen.getByText('55578')).toBeInTheDocument();
    expect(screen.getByText('Istanbul / Kadikoy')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('creates a vendor profile correction support ticket with safe context', async () => {
    const createdTicket = supportTicket({ id: 'support-created' });
    createSupportTicketMock.mockResolvedValue(createdTicket);

    renderVendorProfilePage();

    const contactButtons = await screen.findAllByRole('button', { name: 'Contact support' });
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

    const supportButtons = await screen.findAllByRole('button', { name: 'Open support ticket' });
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

    const supportButtons = await screen.findAllByRole('button', { name: 'Open support ticket' });
    await waitFor(() => expect(supportButtons[0]).not.toBeDisabled());
    await userEvent.click(supportButtons[0]);
    expect(await screen.findByText('Admin support detail route')).toBeInTheDocument();
    expect(createSupportTicketMock).not.toHaveBeenCalled();
  });
});
