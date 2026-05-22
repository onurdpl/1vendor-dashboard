import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from './queryKeys';

function createRuntimeServices() {
  return {
    orders: {
      list: vi.fn().mockResolvedValue([
        {
          id: 'order-1',
          sourceShopifyOrderNumber: '1029',
          shippingStatus: 'Awaiting Shipment',
          allocationStatus: 'active',
        },
      ]),
    },
    returns: {
      list: vi.fn().mockResolvedValue([
        {
          id: 'return-1',
          sourceShopifyRefundId: 'refund-1',
          status: 'Pending',
          amount: 'TRY 25.00',
        },
      ]),
    },
    finance: {
      dashboard: vi.fn().mockResolvedValue({
        summary: {
          grossSales: 'TRY 100.00',
          refunds: 'TRY 25.00',
          netRevenue: 'TRY 75.00',
          payoutEstimate: 'TRY 67.50',
        },
      }),
    },
    automation: {
      dashboard: vi.fn().mockResolvedValue({ alerts: [] }),
    },
    operations: {
      list: vi.fn().mockResolvedValue([]),
    },
    signals: {
      list: vi.fn().mockResolvedValue({
        summary: {
          total: 0,
          critical: 0,
          high: 0,
          warning: 0,
          info: 0,
        },
        signals: [],
      }),
    },
    notifications: {
      list: vi.fn().mockResolvedValue({
        summary: {
          total: 0,
          unread: 0,
          critical: 0,
          high: 0,
          warning: 0,
        },
        notifications: [],
      }),
    },
    diagnostics: {
      reconciliation: vi.fn().mockResolvedValue(null),
    },
    observability: {
      summary: vi.fn().mockResolvedValue(null),
    },
  };
}

async function importDashboardWithServices(
  configureServices?: (
    services: ReturnType<typeof createRuntimeServices>,
    ApiError: typeof import('./errors').ApiError,
  ) => void,
  role: 'admin' | 'vendor' = 'vendor',
) {
  vi.resetModules();

  vi.doMock('../../config/runtime', () => ({
    runtimeConfig: {
      apiMode: 'real',
      apiBaseUrl: 'http://backend.test',
    },
  }));
  vi.doMock('../auth', () => ({
    getCurrentUser: () => ({
      email: role === 'admin' ? 'admin@example.com' : 'vendor@example.com',
      name: role === 'admin' ? 'Admin User' : 'Vendor User',
      role,
    }),
    getCurrentVendorContext: () => ({
      vendorId: 'stored-vendor',
      vendorName: 'Stored Vendor',
    }),
  }));

  const { ApiError } = await import('./errors');
  const services = createRuntimeServices();
  configureServices?.(services, ApiError);
  vi.doMock('../../services/runtime-services', () => ({ runtimeServices: services }));

  const { getDashboardOverview } = await import('./dashboard');
  return { getDashboardOverview, services, ApiError };
}

describe('getDashboardOverview real-mode aggregation', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('propagates 401 failures from orders instead of returning empty dashboard metrics', async () => {
    const { getDashboardOverview, services, ApiError } = await importDashboardWithServices((runtimeServices, ApiErrorClass) => {
      runtimeServices.orders.list.mockRejectedValue(
        new ApiErrorClass('Unauthorized request.', 'unauthorized', { status: 401 }),
      );
    });

    await expect(getDashboardOverview('demo-vendor-a')).rejects.toMatchObject({
      kind: 'unauthorized',
      status: 401,
    } satisfies Partial<InstanceType<typeof ApiError>>);
    expect(services.orders.list).toHaveBeenCalledWith('demo-vendor-a', expect.any(Object));
  });

  it('propagates 403 failures from finance instead of returning a partial finance snapshot', async () => {
    const { getDashboardOverview, ApiError } = await importDashboardWithServices((runtimeServices, ApiErrorClass) => {
      runtimeServices.finance.dashboard.mockRejectedValue(
        new ApiErrorClass('You do not have access to this workspace.', 'server', { status: 403 }),
      );
    });

    await expect(getDashboardOverview('demo-vendor-a')).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<InstanceType<typeof ApiError>>);
  });

  it('keeps partial dashboard warnings for non-auth subrequest failures', async () => {
    const { getDashboardOverview } = await importDashboardWithServices((runtimeServices) => {
      runtimeServices.finance.dashboard.mockRejectedValue(new Error('Finance backend timed out.'));
    });

    const overview = await getDashboardOverview('demo-vendor-a');

    expect(overview.stats.find((stat) => stat.label === 'Vendor orders')?.value).toBe('1');
    expect(overview.financeSnapshot).toBeUndefined();
    expect(overview.partialDataWarnings).toContain('Finance snapshot is temporarily unavailable.');
  });

  it('passes the dashboard vendor id to every vendor-scoped subrequest', async () => {
    const { getDashboardOverview, services } = await importDashboardWithServices();

    await getDashboardOverview('vendor-query-key');

    expect(services.orders.list).toHaveBeenCalledWith('vendor-query-key', expect.any(Object));
    expect(services.returns.list).toHaveBeenCalledWith('vendor-query-key', expect.any(Object));
    expect(services.finance.dashboard).toHaveBeenCalledWith('vendor-query-key', expect.any(Object));
    expect(services.automation.dashboard).toHaveBeenCalledWith('vendor-query-key', expect.any(Object));
    expect(services.signals.list).toHaveBeenCalledWith('vendor-query-key', expect.any(Object));
    expect(services.notifications.list).toHaveBeenCalledWith('vendor-query-key', expect.any(Object));
  });

  it('uses explicit global admin notification scope for admin dashboard aggregation', async () => {
    const { getDashboardOverview, services } = await importDashboardWithServices(undefined, 'admin');

    await getDashboardOverview('vendor-query-key');

    expect(services.orders.list).toHaveBeenCalledWith('vendor-query-key', expect.any(Object));
    expect(services.notifications.list).toHaveBeenCalledWith(null, expect.any(Object));
  });

  it('keeps admin vendor switch dashboard query keys distinct', () => {
    expect(queryKeys.dashboard.overview('demo-vendor-a')).not.toEqual(queryKeys.dashboard.overview('demo-vendor-b'));
  });
});
