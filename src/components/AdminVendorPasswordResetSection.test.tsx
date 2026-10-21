import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminVendorPasswordResetSection } from './AdminVendorPasswordResetSection';
import { ApiError } from '../lib/api/errors';

const api = vi.hoisted(() => ({
  list: vi.fn(), reset: vi.fn(), status: vi.fn(),
}));
vi.mock('../features/vendors/api', () => ({
  listVendorLoginUsers: api.list,
  resetVendorUserPassword: api.reset,
  getVendorPasswordResetOperation: api.status,
}));

const user = {
  userId: 'vendor-user', name: 'Vendor User', email: 'vendor@example.test', role: 'VENDOR',
  status: 'active', vendorMembershipCount: 1, credentialVersion: 0,
  resetEligible: true, ineligibilityReason: null,
};

describe('Admin vendor password reset section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    api.list.mockResolvedValue({ vendorId: 'vendor-a', users: [user] });
    api.reset.mockResolvedValue({
      operationId: 'op', vendorId: 'vendor-a', targetUserId: user.userId,
      credentialVersion: 1, createdAt: '2026-10-21T00:00:00.000Z', temporaryPassword: 'spg_test-only-secret',
    });
  });
  afterEach(() => cleanup());

  it('requires confirmation and displays the temporary password only in transient UI state', async () => {
    const actor = userEvent.setup();
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    const view = render(<AdminVendorPasswordResetSection vendorId="vendor-a" />);
    await screen.findByText('vendor@example.test');
    await actor.click(screen.getByRole('button', { name: 'Generate New Temporary Password' }));
    expect(api.reset).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Confirm password reset' })).toBeTruthy();
    await actor.click(screen.getByRole('button', { name: 'Confirm reset' }));
    expect(await screen.findByText('spg_test-only-secret')).toBeTruthy();
    expect(api.reset).toHaveBeenCalledTimes(1);
    expect(api.reset.mock.calls[0]?.[2]).toMatchObject({ expectedCredentialVersion: 0 });
    await actor.click(screen.getByRole('button', { name: 'Copy password' }));
    expect(copy).toHaveBeenCalledWith('spg_test-only-secret');
    expect(sessionStorage.getItem('admin-password-reset-pending:vendor-a')).toBeNull();
    view.unmount();
    render(<AdminVendorPasswordResetSection vendorId="vendor-a" />);
    expect(screen.queryByText('spg_test-only-secret')).toBeNull();
  });

  it('disables users with more than one vendor', async () => {
    api.list.mockResolvedValue({ vendorId: 'vendor-a', users: [{ ...user,
      vendorMembershipCount: 2, resetEligible: false, ineligibilityReason: 'multiple_vendor_memberships',
    }] });
    render(<AdminVendorPasswordResetSection vendorId="vendor-a" />);
    const action = await screen.findByRole('button', { name: 'Generate New Temporary Password' });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/linked to multiple vendors/)).toBeTruthy();
  });

  it('does not replay an ambiguous reset; status lookup never redisplays a password', async () => {
    const actor = userEvent.setup();
    api.reset.mockRejectedValue(new Error('connection lost'));
    api.status.mockResolvedValue({ operationId: 'op', status: 'COMMITTED' });
    render(<AdminVendorPasswordResetSection vendorId="vendor-a" />);
    await screen.findByText('vendor@example.test');
    await actor.click(screen.getByRole('button', { name: 'Generate New Temporary Password' }));
    await actor.click(screen.getByRole('button', { name: 'Confirm reset' }));
    await screen.findByText(/outcome is uncertain/);
    expect(sessionStorage.getItem('admin-password-reset-pending:vendor-a')).not.toContain('spg_test-only-secret');
    expect(api.reset).toHaveBeenCalledTimes(1);
    await actor.click(screen.getByRole('button', { name: 'Check reset status' }));
    await waitFor(() => expect(api.status).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/one-time password cannot be recovered/)).toBeTruthy();
    expect(api.reset).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('spg_test-only-secret')).toBeNull();
  });

  it('presents a known version conflict without treating it as an ambiguous commit', async () => {
    const actor = userEvent.setup();
    api.reset.mockRejectedValue(new ApiError('Conflict', 'server', {
      status: 409, details: { code: 'credential_version_conflict' },
    }));
    render(<AdminVendorPasswordResetSection vendorId="vendor-a" />);
    await screen.findByText('vendor@example.test');
    await actor.click(screen.getByRole('button', { name: 'Generate New Temporary Password' }));
    await actor.click(screen.getByRole('button', { name: 'Confirm reset' }));
    expect(await screen.findByText(/No reset was performed by this request/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check reset status' })).toBeNull();
    expect(api.reset).toHaveBeenCalledTimes(1);
  });
});
