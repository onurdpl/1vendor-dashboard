import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGetMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api-client', () => ({
  apiClient: {
    get: apiGetMock,
  },
}));

const { listDashboardSignals, listOperationalSignals } = await import('./signals');

describe('real operational signals service', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiGetMock.mockResolvedValue({
      summary: {
        total: 0,
        critical: 0,
        high: 0,
        warning: 0,
        info: 0,
      },
      signals: [],
    });
  });

  it('forwards dashboard signal limits to GET /signals', async () => {
    await listOperationalSignals('sporjinal', {
      limit: 10,
      headers: {
        'X-Dashboard-Deferred-Load': 'true',
      },
    });

    expect(apiGetMock).toHaveBeenCalledWith('/signals?limit=10', {
      vendorId: 'sporjinal',
      signal: undefined,
      headers: {
        'X-Dashboard-Deferred-Load': 'true',
      },
    });
  });

  it('loads dashboard signals through the dashboard projection endpoint', async () => {
    await listDashboardSignals('sporjinal', {
      limit: 10,
      offset: 0,
      headers: {
        'X-Dashboard-Deferred-Load': 'true',
      },
    });

    expect(apiGetMock).toHaveBeenCalledWith('/signals/dashboard?limit=10&offset=0', {
      vendorId: 'sporjinal',
      signal: undefined,
      headers: {
        'X-Dashboard-Deferred-Load': 'true',
      },
    });
    expect(apiGetMock).not.toHaveBeenCalledWith(expect.stringMatching(/^\/signals(?:\?|$)/), expect.anything());
  });
});
