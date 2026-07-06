import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequirePermission } from '../components/RequirePermission';
import { clearToken, setCurrentUser, setCurrentVendorId, setToken, type CurrentUser } from '../lib/auth';
import { AdminVendorsPage } from './AdminVendorsPage';

const provisionVendorMock = vi.hoisted(() => vi.fn());

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    vendors: {
      provision: provisionVendorMock,
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

function seedUser(user: CurrentUser) {
  clearToken();
  setToken('test-token');
  setCurrentUser(user);
  setCurrentVendorId(user.defaultVendorId);
}

function renderPage(initialEntry = '/admin/vendors/new') {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/admin/vendors/new" element={<AdminVendorsPage />} />
        <Route path="/admin/vendors/:vendorId" element={<AdminVendorProfileProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function AdminVendorProfileProbe() {
  const { vendorId } = useParams<{ vendorId: string }>();
  return <div>Admin vendor profile route {vendorId}</div>;
}

function renderGuardedPage(user: CurrentUser) {
  seedUser(user);
  render(
    <MemoryRouter initialEntries={['/admin/vendors/new']}>
      <Routes>
        <Route
          path="/admin/vendors/new"
          element={
            <RequirePermission permission="orders:write">
              <AdminVendorsPage />
            </RequirePermission>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Vendor ID'), '  newvendor  ');
  await user.type(screen.getByLabelText('Vendor name'), '  New Vendor  ');
  await user.type(screen.getByLabelText('Admin name'), '  Vendor Admin  ');
  await user.type(screen.getByLabelText('Admin email'), '  ADMIN@NEWVENDOR.TEST  ');
}

function mockSuccessfulProvision() {
  provisionVendorMock.mockResolvedValue({
    vendorId: 'newvendor',
    vendorName: 'New Vendor',
    adminUserId: 'user-newvendor-admin',
    adminEmail: 'admin@newvendor.test',
    temporaryPassword: 'Temp-Password-123',
    vendorStatus: 'inactive',
    restrictionReason: 'Operational review',
  });
}

function storageDump(storage: Storage) {
  return Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index) ?? '';
    return `${key}:${storage.getItem(key) ?? ''}`;
  }).join('\n');
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.clearAllMocks();
  seedUser(adminUser);
  mockSuccessfulProvision();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe('AdminVendorsPage', () => {
  it('renders all create vendor fields and setup guidance', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Create Vendor' })).toBeInTheDocument();
    expect(screen.getByText('Create a marketplace vendor and initial vendor administrator.')).toBeInTheDocument();
    expect(screen.getByLabelText('Vendor ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Vendor name')).toBeInTheDocument();
    expect(screen.getByLabelText('Admin name')).toBeInTheDocument();
    expect(screen.getByLabelText('Admin email')).toBeInTheDocument();
    expect(screen.queryByLabelText('Restriction reason')).not.toBeInTheDocument();
    expect(screen.getByText('Vendor ID must match Shopify seller_info.')).toBeInTheDocument();
    expect(screen.getByText('New vendors start in Restricted mode while onboarding is completed.')).toBeInTheDocument();
    expect(
      screen.getByText('New vendors can sign in, view workspace information, and contact support while onboarding is completed.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Operational actions remain unavailable until activation.').length).toBeGreaterThan(0);
    expect(screen.getByText('Temporary password will be shown once after creation.')).toBeInTheDocument();
  });

  it('validates required fields before calling the provisioning API', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Create Vendor' }));

    expect(screen.getByRole('alert')).toHaveTextContent('All fields are required.');
    expect(provisionVendorMock).not.toHaveBeenCalled();
  });

  it('validates basic email format before calling the provisioning API', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Vendor ID'), 'newvendor');
    await user.type(screen.getByLabelText('Vendor name'), 'New Vendor');
    await user.type(screen.getByLabelText('Admin name'), 'Vendor Admin');
    await user.type(screen.getByLabelText('Admin email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Create Vendor' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Admin email must be a valid email address.');
    expect(provisionVendorMock).not.toHaveBeenCalled();
  });

  it('submits trimmed values to the backend provisioning API', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create Vendor' }));

    await waitFor(() => {
      expect(provisionVendorMock).toHaveBeenCalledWith({
        vendorId: 'newvendor',
        vendorName: 'New Vendor',
        adminName: 'Vendor Admin',
        adminEmail: 'ADMIN@NEWVENDOR.TEST',
        restrictionReason: 'Operational review',
      });
    });
  });

  it('shows temporary password once with copy-now warning after success', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create Vendor' }));

    const successPanel = await screen.findByRole('status');
    expect(successPanel).toHaveTextContent('Vendor created successfully');
    expect(successPanel).toHaveTextContent('newvendor');
    expect(successPanel).toHaveTextContent('admin@newvendor.test');
    expect(successPanel).toHaveTextContent('Current status');
    expect(successPanel).toHaveTextContent('Restricted');
    expect(successPanel).toHaveTextContent('Complete Vendor Profile onboarding before activating this vendor.');
    expect(successPanel).not.toHaveTextContent('inactive');
    expect(within(successPanel).getAllByText('Temp-Password-123')).toHaveLength(1);
    expect(successPanel).toHaveTextContent('Copy this password now. It will not be shown again.');
  });

  it('does not store the temporary password in localStorage or sessionStorage', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create Vendor' }));

    expect(await screen.findByText('Temp-Password-123')).toBeInTheDocument();
    expect(storageDump(window.localStorage)).not.toContain('Temp-Password-123');
    expect(storageDump(window.sessionStorage)).not.toContain('Temp-Password-123');
  });

  it('opens the created vendor admin profile route after successful provisioning', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create Vendor' }));
    await user.click(await screen.findByRole('button', { name: 'Open Vendor Profile' }));

    expect(await screen.findByText('Admin vendor profile route newvendor')).toBeInTheDocument();
  });

  it('renders duplicate vendor ID errors safely', async () => {
    const user = userEvent.setup();
    provisionVendorMock.mockRejectedValueOnce(new Error('A vendor with this ID already exists.'));
    renderPage();

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create Vendor' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A vendor with this ID already exists.');
    expect(screen.queryByText('Vendor created successfully')).not.toBeInTheDocument();
  });

  it('renders duplicate admin email errors safely', async () => {
    const user = userEvent.setup();
    provisionVendorMock.mockRejectedValueOnce(new Error('A user with this email already exists.'));
    renderPage();

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Create Vendor' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A user with this email already exists.');
    expect(screen.queryByText('Vendor created successfully')).not.toBeInTheDocument();
  });

  it('does not render the create vendor page for vendor users behind the existing permission guard', () => {
    renderGuardedPage(vendorUser);

    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Create Vendor' })).not.toBeInTheDocument();
  });
});
