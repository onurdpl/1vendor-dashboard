import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToken, setCurrentUser, setCurrentVendorId, setToken } from '../lib/auth';
import type { VendorIntegrationProviderManagement } from '../lib/api/contracts';
import { AdminProviderManagementPage } from './AdminProviderManagementPage';

const providersMock = vi.hoisted(() => vi.fn());

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    vendorIntegration: {
      providers: providersMock,
    },
  },
}));

const providerManagement: VendorIntegrationProviderManagement = {
  generatedAt: '2026-06-02T12:00:00.000Z',
  providers: [
    {
      clientId: 'client-active',
      providerName: 'Ayensoftware',
      vendorIdentifier: 'sporjinal',
      scopes: ['orders:read', 'status:write'],
      enabled: true,
      revokedAt: null,
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:05:00.000Z',
      lastUsedAt: '2026-06-02T11:00:00.000Z',
      lastRequestAt: '2026-06-02T11:15:00.000Z',
      requestsLast24h: 8,
      rateLimitedLast24h: 1,
      authFailuresLast24h: null,
      recentAuditLogs: [
        {
          method: 'GET',
          path: '/api/vendor-integration/orders',
          statusCode: 200,
          requestId: 'req-1',
          createdAt: '2026-06-02T11:15:00.000Z',
        },
      ],
    },
    {
      clientId: 'client-revoked',
      providerName: 'Entegra',
      vendorIdentifier: 'yalispor',
      scopes: ['orders:read'],
      enabled: false,
      revokedAt: '2026-06-02T10:00:00.000Z',
      createdAt: '2026-06-01T09:00:00.000Z',
      updatedAt: '2026-06-02T10:00:00.000Z',
      lastUsedAt: null,
      lastRequestAt: null,
      requestsLast24h: 0,
      rateLimitedLast24h: 0,
      authFailuresLast24h: null,
      recentAuditLogs: [],
    },
  ],
};

function renderPage() {
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
        <AdminProviderManagementPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminProviderManagementPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    clearToken();
    setToken('admin-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal', 'yalispor'],
      vendorDetails: [
        { vendorId: 'sporjinal', vendorName: 'Sporjinal' },
        { vendorId: 'yalispor', vendorName: 'Yali Spor' },
      ],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    setCurrentVendorId('sporjinal');
    providersMock.mockResolvedValue(providerManagement);
  });

  it('renders active and revoked providers with metadata-only audit logs', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Provider Management' })).toBeInTheDocument();
    const providerList = await screen.findByLabelText('Provider list');
    expect(within(providerList).getByRole('button', { name: /Ayensoftware/ })).toBeInTheDocument();
    expect(within(providerList).getByRole('button', { name: /Entegra/ })).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Revoked').length).toBeGreaterThan(0);
    expect(within(providerList).getAllByText('Orders').length).toBeGreaterThan(0);
    expect(within(providerList).getAllByText('Status').length).toBeGreaterThan(0);
    expect(within(providerList).getAllByText('Shipment').length).toBeGreaterThan(0);
    expect(within(providerList).getAllByText('Invoice').length).toBeGreaterThan(0);
    expect(within(providerList).getAllByText('Requests 24h').length).toBeGreaterThan(0);
    expect(within(providerList).getAllByText('Last Activity').length).toBeGreaterThan(0);
    expect(within(providerList).queryByText('client-active')).not.toBeInTheDocument();
    expect(within(providerList).queryByText('429 24h')).not.toBeInTheDocument();
    expect(screen.getAllByText('orders:read, status:write').length).toBeGreaterThan(0);
    expect(screen.getByText('/api/vendor-integration/orders')).toBeInTheDocument();
    expect(screen.getByText('req-1')).toBeInTheDocument();
    expect(screen.getByText('Not derivable')).toBeInTheDocument();
    expect(JSON.stringify(document.body.textContent)).not.toContain('tokenHash');
    expect(JSON.stringify(document.body.textContent)).not.toContain('spg_vi_');
    expect(JSON.stringify(document.body.textContent)).not.toContain('requestBody');
    expect(JSON.stringify(document.body.textContent)).not.toContain('responseBody');
  });

  it('switches the detail section to a revoked provider', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findAllByText('Ayensoftware');
    await user.click(screen.getByText('Entegra'));

    const detail = screen.getByLabelText('Provider detail');
    expect(within(detail).getByRole('heading', { name: 'Entegra' })).toBeInTheDocument();
    expect(detail).toHaveTextContent('yalispor');
    expect(within(detail).getByText('No audit logs')).toBeInTheDocument();
  });

  it('renders an empty state safely', async () => {
    providersMock.mockResolvedValueOnce({
      generatedAt: '2026-06-02T12:00:00.000Z',
      providers: [],
    });

    renderPage();

    expect(await screen.findByText('No integration providers')).toBeInTheDocument();
    expect(screen.getByText('No vendor integration clients are registered yet.')).toBeInTheDocument();
  });

  it('renders an error state safely', async () => {
    providersMock.mockRejectedValueOnce(new Error('Provider management failed'));

    renderPage();

    expect(await screen.findByText('Provider management unavailable')).toBeInTheDocument();
    expect(screen.getByText('Provider management failed')).toBeInTheDocument();
  });
});
