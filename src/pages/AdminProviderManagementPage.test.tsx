import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToken, setCurrentUser, setCurrentVendorId, setToken } from '../lib/auth';
import type { VendorIntegrationProviderManagement } from '../lib/api/contracts';
import { AdminProviderManagementPage } from './AdminProviderManagementPage';

const providersMock = vi.hoisted(() => vi.fn());
const revokeProviderTokenMock = vi.hoisted(() => vi.fn());

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    vendorIntegration: {
      providers: providersMock,
      revokeProviderToken: revokeProviderTokenMock,
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
        {
          method: 'POST',
          path: '/api/vendor-integration/orders/alloc-1/status',
          statusCode: 202,
          requestId: 'req-2',
          createdAt: '2026-06-02T11:05:00.000Z',
        },
        {
          method: 'POST',
          path: '/api/vendor-integration/orders/alloc-1/shipment',
          statusCode: 200,
          requestId: 'req-3',
          createdAt: '2026-06-02T11:05:00.000Z',
        },
        {
          method: 'POST',
          path: '/api/vendor-integration/orders/alloc-1/invoice',
          statusCode: 200,
          requestId: 'req-4',
          createdAt: '2026-06-02T11:05:00.000Z',
        },
        {
          method: 'GET',
          path: '/api/vendor-integration/orders',
          statusCode: 429,
          requestId: 'req-5',
          createdAt: '2026-06-02T10:55:00.000Z',
        },
        {
          method: 'POST',
          path: '/api/vendor-integration/orders/alloc-1/status',
          statusCode: 403,
          requestId: 'req-6',
          createdAt: '2026-06-02T10:50:00.000Z',
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

const revokedProviderManagement: VendorIntegrationProviderManagement = {
  ...providerManagement,
  providers: [
    {
      ...providerManagement.providers[0],
      enabled: false,
      revokedAt: '2026-06-02T12:00:00.000Z',
      updatedAt: '2026-06-02T12:00:00.000Z',
    },
    providerManagement.providers[1],
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
    revokeProviderTokenMock.mockResolvedValue({
      clientId: 'client-active',
      vendorIdentifier: 'sporjinal',
      providerName: 'Ayensoftware',
      enabled: false,
      revokedAt: '2026-06-02T12:00:00.000Z',
    });
  });

  it('renders active and revoked providers with metadata-only audit logs', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Integration Clients' })).toBeInTheDocument();
    expect(screen.getByText('Monitor vendor integration clients, permissions, activity and token status.')).toBeInTheDocument();
    expect(screen.getByText(/Last refreshed/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Clients' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'API Activity' })).toBeInTheDocument();
    expect(screen.getByText('Total clients')).toBeInTheDocument();
    expect(screen.getByText('Audited requests (24h)')).toBeInTheDocument();
    expect(screen.getByText('Rate limited (24h)')).toBeInTheDocument();
    const providerList = await screen.findByLabelText('Integration client list');
    expect(within(providerList).getByRole('button', { name: /Ayensoftware/ })).toBeInTheDocument();
    expect(within(providerList).getByRole('button', { name: /Entegra/ })).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Revoked').length).toBeGreaterThan(0);
    expect(within(providerList).getAllByText('Read Orders').length).toBeGreaterThan(0);
    expect(within(providerList).getAllByText('Update Status').length).toBeGreaterThan(0);
    expect(within(providerList).getAllByText('Update Shipment').length).toBeGreaterThan(0);
    expect(within(providerList).getAllByText('Update Invoice').length).toBeGreaterThan(0);
    expect(within(providerList).getAllByText('Requests 24h').length).toBeGreaterThan(0);
    expect(within(providerList).getAllByText('Last activity').length).toBeGreaterThan(0);
    expect(within(providerList).queryByText('client-active')).not.toBeInTheDocument();
    expect(within(providerList).queryByText('429 24h')).not.toBeInTheDocument();
    const detail = await screen.findByLabelText('Integration Client');
    expect(within(detail).getByRole('heading', { name: 'Current Client' })).toBeInTheDocument();
    expect(within(detail).getByRole('heading', { name: 'Current Access' })).toBeInTheDocument();
    expect(within(detail).getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(within(detail).getByRole('heading', { name: 'Recent Activity' })).toBeInTheDocument();
    expect(within(detail).getByText('Rate limited 24h')).toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Revoke token' })).toBeInTheDocument();
    const timeline = within(detail).getByLabelText('Recent Activity');
    expect(within(timeline).getByText('Orders synced')).toBeInTheDocument();
    expect(within(timeline).getByText('Status updated')).toBeInTheDocument();
    expect(within(timeline).getByText('Shipment received')).toBeInTheDocument();
    expect(within(timeline).getByText('Invoice received')).toBeInTheDocument();
    expect(within(timeline).getAllByText('Rate limited').length).toBeGreaterThan(0);
    expect(within(timeline).getByText('Access rejected')).toBeInTheDocument();
    expect(within(timeline).getAllByText('Success').length).toBeGreaterThan(0);
    expect(within(timeline).getByText('Rejected')).toBeInTheDocument();
    const groupedTimestamp = within(timeline).getByText('Status updated').closest('.provider-activity-time-group');
    expect(groupedTimestamp).toBe(within(timeline).getByText('Shipment received').closest('.provider-activity-time-group'));
    expect(groupedTimestamp).toBe(within(timeline).getByText('Invoice received').closest('.provider-activity-time-group'));
    expect(groupedTimestamp?.querySelectorAll('.provider-activity-time-heading')).toHaveLength(1);
    expect(within(timeline).queryByText('Allocation alloc-1')).not.toBeInTheDocument();
    const rawShipmentPath = within(timeline).getByText('/api/vendor-integration/orders/alloc-1/shipment');
    const shipmentDetails = rawShipmentPath.closest('details');
    expect(rawShipmentPath).not.toBeVisible();
    expect(within(shipmentDetails as HTMLElement).getByText('req-3')).not.toBeVisible();
    await user.click(within(shipmentDetails as HTMLElement).getByText('Details'));
    expect(rawShipmentPath).toBeVisible();
    expect(within(shipmentDetails as HTMLElement).getByText('req-3')).toBeVisible();
    const technicalDetails = within(detail).getByText('Technical Details').closest('details');
    expect(technicalDetails).not.toHaveAttribute('open');
    expect(within(technicalDetails as HTMLElement).getByText('client-active')).not.toBeVisible();
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

    const detail = screen.getByLabelText('Integration Client');
    expect(within(detail).getByRole('heading', { name: 'Current Client' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Entegra/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(detail).getByText('No client activity recorded yet.')).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Revoke token' })).not.toBeInTheDocument();
  });

  it('confirms revoke, calls revoke endpoint service, and refreshes provider state', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    providersMock.mockReset();
    providersMock.mockResolvedValueOnce(providerManagement).mockResolvedValueOnce(revokedProviderManagement);

    renderPage();

    const detail = await screen.findByLabelText('Integration Client');
    await user.click(within(detail).getByRole('button', { name: 'Revoke token' }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'This will disable this integration token. Existing integrations using this token will stop working. Historical activity remains visible, and continued access requires a newly issued token.',
    );
    expect(revokeProviderTokenMock).toHaveBeenCalledWith('client-active');
    expect((await screen.findAllByText('Revoked')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Revoke token' })).not.toBeInTheDocument();
  });

  it('shows a safe error when revoke fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    revokeProviderTokenMock.mockRejectedValueOnce(new Error('tokenHash leaked internal detail'));

    renderPage();

    const detail = await screen.findByLabelText('Integration Client');
    await user.click(within(detail).getByRole('button', { name: 'Revoke token' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Integration token could not be revoked. Please retry.');
    expect(JSON.stringify(document.body.textContent)).not.toContain('tokenHash leaked internal detail');
    expect(JSON.stringify(document.body.textContent)).not.toContain('spg_vi_');
  });

  it('renders an empty state safely', async () => {
    providersMock.mockResolvedValueOnce({
      generatedAt: '2026-06-02T12:00:00.000Z',
      providers: [],
    });

    renderPage();

    expect(await screen.findByText('No integration clients')).toBeInTheDocument();
    expect(screen.getByText('No vendor integration clients are registered yet.')).toBeInTheDocument();
  });

  it('renders an error state safely', async () => {
    providersMock.mockRejectedValueOnce(new Error('Integration client load failed'));

    renderPage();

    expect(await screen.findByText('Integration clients unavailable')).toBeInTheDocument();
    expect(screen.getByText('Integration client load failed')).toBeInTheDocument();
  });
});
