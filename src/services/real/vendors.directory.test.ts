import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGetMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api-client', () => ({ apiClient: { get: apiGetMock } }));

const { listAdminVendors } = await import('./vendors');

describe('Admin Vendor Directory request', () => {
  beforeEach(() => apiGetMock.mockReset());

  it('passes backend search and the opaque continuation cursor without altering either', async () => {
    const signal = new AbortController().signal;
    await listAdminVendors({ search: '  Spor  ', cursor: 'opaque_cursor-1', limit: 100, signal });
    expect(apiGetMock).toHaveBeenCalledWith(
      '/admin/vendors?search=Spor&limit=100&cursor=opaque_cursor-1',
      { signal },
    );
  });

  it('does not add an unfiltered cursor to a new search', async () => {
    await listAdminVendors({ search: 'Yalı', cursor: null });
    expect(apiGetMock).toHaveBeenCalledWith('/admin/vendors?search=Yal%C4%B1', { signal: undefined });
  });
});
