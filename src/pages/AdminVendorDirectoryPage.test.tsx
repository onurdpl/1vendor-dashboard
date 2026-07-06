import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequirePermission } from '../components/RequirePermission';
import type { VendorDirectoryItem, VendorDirectoryResponse, VendorDirectoryStatusFilter } from '../lib/api/contracts';
import { clearToken, setCurrentUser, setCurrentVendorId, setToken, type CurrentUser } from '../lib/auth';
import { AdminVendorDirectoryPage } from './AdminVendorDirectoryPage';

const directoryMock = vi.hoisted(() => vi.fn());

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    vendors: {
      directory: directoryMock,
    },
  },
}));

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

const vendorUser: CurrentUser = {
  email: 'vendor@example.com',
  name: 'Vendor User',
  role: 'vendor',
  status: 'active',
  vendorAccess: ['yalispor'],
  vendorDetails: [{ vendorId: 'yalispor', vendorName: 'Yalı Spor' }],
  canSwitchVendors: false,
  defaultVendorId: 'yalispor',
};

const vendorRows: VendorDirectoryItem[] = [
  {
    vendorId: 'restricted-vendor',
    vendorName: 'Restricted Vendor',
    status: 'inactive',
    statusLabel: 'Restricted',
    restrictionReason: 'Operational review',
    restrictedAt: '2026-07-02T10:00:00.000Z',
    updatedAt: '2026-07-06T10:00:00.000Z',
    createdAt: '2026-07-01T10:00:00.000Z',
    profileUrl: '/admin/vendors/restricted-vendor',
  },
  {
    vendorId: 'active-vendor',
    vendorName: 'Active Vendor',
    status: 'active',
    statusLabel: 'Active',
    restrictionReason: null,
    restrictedAt: null,
    updatedAt: '2026-07-05T10:00:00.000Z',
    createdAt: '2026-07-01T09:00:00.000Z',
    profileUrl: '/admin/vendors/active-vendor',
  },
];

function buildResponse(
  vendors: VendorDirectoryItem[],
  options: { search?: string | null; status?: VendorDirectoryStatusFilter } = {},
): VendorDirectoryResponse {
  return {
    vendors,
    generatedAt: '2026-07-06T12:00:00.000Z',
    filters: {
      search: options.search ?? null,
      status: options.status ?? 'all',
      limit: 100,
    },
  };
}

function seedUser(user: CurrentUser) {
  clearToken();
  setToken('test-token');
  setCurrentUser(user);
  setCurrentVendorId(user.defaultVendorId);
}

function mockDirectoryResponse() {
  directoryMock.mockImplementation(
    async (options: { search?: string | null; status?: VendorDirectoryStatusFilter } = {}) => {
      const normalizedSearch = options.search?.trim().toLowerCase() ?? '';
      const status = options.status ?? 'all';
      const vendors = vendorRows.filter((vendor) => {
        const matchesSearch = !normalizedSearch
          || vendor.vendorId.toLowerCase().includes(normalizedSearch)
          || vendor.vendorName.toLowerCase().includes(normalizedSearch);
        const matchesStatus = status === 'all' || vendor.statusLabel.toLowerCase() === status;
        return matchesSearch && matchesStatus;
      });
      return buildResponse(vendors, { search: options.search ?? null, status });
    },
  );
}

function AdminVendorProfileProbe() {
  const { vendorId } = useParams<{ vendorId: string }>();
  return <div>Admin vendor profile route {vendorId}</div>;
}

function renderPage(user: CurrentUser = adminUser, initialEntry = '/admin/vendors') {
  seedUser(user);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/admin/vendors"
            element={
              <RequirePermission permission="orders:write">
                <AdminVendorDirectoryPage />
              </RequirePermission>
            }
          />
          <Route path="/admin/vendors/new" element={<div>Create vendor route</div>} />
          <Route path="/admin/vendors/:vendorId" element={<AdminVendorProfileProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  mockDirectoryResponse();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('AdminVendorDirectoryPage', () => {
  it('renders the admin vendor directory header, summary, and create vendor CTA', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Vendors' })).toBeInTheDocument();
    expect(screen.getByText('ADMIN WORKSPACE')).toBeInTheDocument();
    expect(screen.getByText('Manage marketplace sellers, onboarding status, and vendor workspaces.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create Vendor' })).toHaveAttribute('href', '/admin/vendors/new');
    expect(screen.getByText('Total vendors')).toBeInTheDocument();
    expect(screen.getByText('Recently updated')).toBeInTheDocument();
  });

  it('renders vendor rows with product status labels instead of raw inactive', async () => {
    renderPage();

    expect(await screen.findByText('Restricted Vendor')).toBeInTheDocument();
    expect(screen.getByText('restricted-vendor')).toBeInTheDocument();
    expect(screen.getByText('Operational review')).toBeInTheDocument();
    expect(screen.getByText('Active Vendor')).toBeInTheDocument();
    expect(screen.getAllByText('Restricted').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.queryByText('inactive')).not.toBeInTheDocument();
  });

  it('searches vendors by ID or name through the directory service', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Restricted Vendor');
    await user.type(screen.getByLabelText('Search vendor ID or name'), 'restricted');

    await waitFor(() => {
      expect(directoryMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: 'restricted',
          status: 'all',
        }),
      );
    });
    expect(await screen.findByText('Restricted Vendor')).toBeInTheDocument();
    expect(screen.queryByText('Active Vendor')).not.toBeInTheDocument();
  });

  it('filters vendors by restricted status', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Active Vendor');
    await user.selectOptions(screen.getByLabelText('Vendor status filter'), 'restricted');

    await waitFor(() => {
      expect(directoryMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: null,
          status: 'restricted',
        }),
      );
    });
    expect(await screen.findByText('Restricted Vendor')).toBeInTheDocument();
    expect(screen.queryByText('Active Vendor')).not.toBeInTheDocument();
  });

  it('renders the empty directory state with a create CTA', async () => {
    directoryMock.mockResolvedValueOnce(buildResponse([]));
    renderPage();

    expect(await screen.findByText('No vendors found.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Create Vendor' })[0]).toHaveAttribute('href', '/admin/vendors/new');
  });

  it('renders the filtered empty state and clears filters', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Restricted Vendor');
    await user.type(screen.getByLabelText('Search vendor ID or name'), 'does-not-exist');

    expect(await screen.findByText('No vendors match this search.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByText('Restricted Vendor')).toBeInTheDocument();
    expect(screen.getByLabelText('Search vendor ID or name')).toHaveValue('');
    expect(screen.getByLabelText('Vendor status filter')).toHaveValue('all');
  });

  it('renders backend errors safely', async () => {
    directoryMock.mockRejectedValueOnce(new Error('Vendor directory could not be loaded.'));
    renderPage();

    expect(await screen.findByText('Vendor directory unavailable')).toBeInTheDocument();
    expect(screen.getByText('Vendor directory could not be loaded.')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('stack');
  });

  it('navigates to create vendor and vendor profile routes', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Restricted Vendor');
    await user.click(screen.getByRole('link', { name: 'Create Vendor' }));
    expect(await screen.findByText('Create vendor route')).toBeInTheDocument();

    cleanup();
    mockDirectoryResponse();
    renderPage();
    await screen.findByText('Restricted Vendor');
    await user.click(screen.getAllByText('Open Profile')[0]);
    expect(await screen.findByText('Admin vendor profile route restricted-vendor')).toBeInTheDocument();
  });

  it('does not render the directory for vendor users behind the existing permission guard', () => {
    renderPage(vendorUser);

    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Vendors' })).not.toBeInTheDocument();
    expect(directoryMock).not.toHaveBeenCalled();
  });
});
