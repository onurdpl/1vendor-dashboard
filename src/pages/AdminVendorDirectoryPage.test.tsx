import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  options: { search?: string | null; status?: VendorDirectoryStatusFilter; nextCursor?: string | null } = {},
): VendorDirectoryResponse {
  return {
    vendors,
    hasMore: Boolean(options.nextCursor),
    nextCursor: options.nextCursor ?? null,
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
    expect(screen.getByText('Vendors on this page')).toBeInTheDocument();
    expect(screen.queryByText('Total vendors')).not.toBeInTheDocument();
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

  const manyVendors = Array.from({ length: 103 }, (_, index): VendorDirectoryItem => ({
    ...vendorRows[1],
    vendorId: `vendor-${index + 1}`,
    vendorName: `Directory Vendor ${index + 1}`,
    profileUrl: `/admin/vendors/vendor-${index + 1}`,
  }));
  const nextCursor = 'opaque-page-two_abc123';

  function mockPages() {
    directoryMock.mockImplementation(async (options: { cursor?: string | null }) =>
      options.cursor === nextCursor
        ? buildResponse(manyVendors.slice(100))
        : buildResponse(manyVendors.slice(0, 100), { nextCursor }));
  }

  it('browses 103 Vendors using opaque Next and Previous cursors and page-specific counts', async () => {
    mockPages();
    renderPage({ ...adminUser, vendorAccess: [], vendorDetails: [], defaultVendorId: '' });
    const user = userEvent.setup();
    await screen.findByText('Directory Vendor 100');
    expect(screen.queryByText('Directory Vendor 101')).not.toBeInTheDocument();
    const summary = screen.getByText('Vendors on this page').closest('article')!;
    expect(within(summary).getByText('100')).toBeInTheDocument();
    expect(within(summary).getByText('Current page only')).toBeInTheDocument();
    expect(screen.getByText('On this page · Operational accounts')).toBeInTheDocument();
    expect(screen.getByText('On this page · Onboarding or read-only')).toBeInTheDocument();
    expect(screen.getByText('On this page · Last 7 days')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Directory Vendor 103');
    expect(directoryMock).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: nextCursor }));
    expect(screen.queryByText('Directory Vendor 1')).not.toBeInTheDocument();
    expect(within(summary).getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    await screen.findByText('Directory Vendor 1');
    expect(directoryMock).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: null }));
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.queryByText('Total vendors')).not.toBeInTheDocument();
  });

  it.each(['search', 'status'] as const)('resets the cursor when %s changes on page two', async (filter) => {
    mockPages();
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('Directory Vendor 100');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Directory Vendor 103');
    if (filter === 'search') {
      fireEvent.change(screen.getByLabelText('Search vendor ID or name'), { target: { value: '  Directory  ' } });
    } else {
      await user.selectOptions(screen.getByLabelText('Vendor status filter'), 'restricted');
    }
    await screen.findByText('Directory Vendor 1');
    expect(directoryMock).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: null,
      search: filter === 'search' ? 'Directory' : null,
      status: filter === 'status' ? 'restricted' : 'all',
    }));
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });

  it('hides old rows while the next page loads and retries a failed page without losing its cursor', async () => {
    let rejectPage!: (error: Error) => void;
    directoryMock.mockResolvedValueOnce(buildResponse(manyVendors.slice(0, 100), { nextCursor }))
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectPage = reject; }))
      .mockResolvedValueOnce(buildResponse(manyVendors.slice(100)));
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('Directory Vendor 1');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Loading vendors')).toBeInTheDocument();
    expect(screen.queryByText('Directory Vendor 1')).not.toBeInTheDocument();
    expect(screen.queryByText('No vendors found.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await act(async () => rejectPage(new Error('Temporary page failure')));
    expect(await screen.findByText('Vendor directory unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No vendors found.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Directory Vendor 103');
    expect(directoryMock).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: nextCursor }));
    expect(screen.getByText('Page 2')).toBeInTheDocument();
  });

  it('ignores an obsolete page response after search resets pagination', async () => {
    let resolvePage!: (value: VendorDirectoryResponse) => void;
    directoryMock.mockResolvedValueOnce(buildResponse(manyVendors.slice(0, 100), { nextCursor }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePage = resolve; }))
      .mockResolvedValueOnce(buildResponse([vendorRows[0]], { search: 'restricted' }));
    renderPage();
    const user = userEvent.setup();
    await screen.findByText('Directory Vendor 1');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    const pageSignal = directoryMock.mock.calls[1][0].signal as AbortSignal;
    fireEvent.change(screen.getByLabelText('Search vendor ID or name'), { target: { value: 'restricted' } });
    await screen.findByText('Restricted Vendor');
    expect(pageSignal.aborted).toBe(true);
    await act(async () => resolvePage(buildResponse(manyVendors.slice(100))));
    expect(screen.queryByText('Directory Vendor 103')).not.toBeInTheDocument();
    expect(screen.getByText('Restricted Vendor')).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
  });

  it('rejects the first response after a search A to B to A cycle', async () => {
    let resolveFirst!: (value: VendorDirectoryResponse) => void;
    directoryMock.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(buildResponse([vendorRows[0]], { search: 'restricted' }))
      .mockResolvedValueOnce(buildResponse([vendorRows[1]]));
    renderPage();
    const search = screen.getByLabelText('Search vendor ID or name');
    await waitFor(() => expect(directoryMock).toHaveBeenCalledTimes(1));
    fireEvent.change(search, { target: { value: 'restricted' } });
    await screen.findByText('Restricted Vendor');
    fireEvent.change(search, { target: { value: '' } });
    await screen.findByText('Active Vendor');
    await act(async () => resolveFirst(buildResponse([vendorRows[0]])));
    expect(screen.queryByText('Restricted Vendor')).not.toBeInTheDocument();
    expect(screen.getByText('Active Vendor')).toBeInTheDocument();
    expect(directoryMock).toHaveBeenCalledTimes(3);
  });

  it('does not enable Next without both a continuation flag and cursor', async () => {
    directoryMock.mockResolvedValueOnce({ ...buildResponse(vendorRows), hasMore: true, nextCursor: null });
    renderPage();
    await screen.findByText('Active Vendor');
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });
});
