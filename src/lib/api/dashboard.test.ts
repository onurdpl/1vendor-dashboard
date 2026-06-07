import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from './queryKeys';

function createRuntimeServices() {
  return {
    dashboard: {
      summary: vi.fn().mockResolvedValue({
        vendorId: 'vendor-query-key',
        orders: {
          total: 1,
          awaitingShipment: 1,
          blocked: 0,
          pendingReassignment: 0,
          vendorBlocked: 0,
        },
        returns: {
          refundAttention: 1,
        },
      }),
    },
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
      dashboard: vi.fn().mockResolvedValue({
        summary: {
          total: 0,
          critical: 0,
          warning: 0,
          attention: 0,
          normal: 0,
          pendingReassignment: 0,
          vendorBlocked: 0,
          awaitingShipment: 0,
          refundAttention: 0,
          operationalSignals: 0,
          automationActions: 0,
        },
        items: [],
      }),
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
    support: {
      listAdmin: vi.fn().mockResolvedValue([]),
      listVendor: vi.fn().mockResolvedValue([]),
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
      vendorId: 'vendor-query-key',
      vendorName: 'Stored Vendor',
    }),
  }));

  const { ApiError } = await import('./errors');
  const services = createRuntimeServices();
  configureServices?.(services, ApiError);
  vi.doMock('../../services/runtime-services', () => ({ runtimeServices: services }));

  const { getDashboardDeferredOverview, getDashboardOverview } = await import('./dashboard');
  return { getDashboardDeferredOverview, getDashboardOverview, services, ApiError };
}

describe('dashboard real-mode loading', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('propagates 401 failures from orders instead of returning empty dashboard metrics', async () => {
    const { getDashboardDeferredOverview, services, ApiError } = await importDashboardWithServices((runtimeServices, ApiErrorClass) => {
      runtimeServices.orders.list.mockRejectedValue(
        new ApiErrorClass('Unauthorized request.', 'unauthorized', { status: 401 }),
      );
    });

    await expect(getDashboardDeferredOverview('demo-vendor-a')).rejects.toMatchObject({
      kind: 'unauthorized',
      status: 401,
    } satisfies Partial<InstanceType<typeof ApiError>>);
    expect(services.orders.list).toHaveBeenCalledWith('demo-vendor-a', expect.any(Object));
  });

  it('propagates 403 failures from finance instead of returning a partial finance snapshot', async () => {
    const { getDashboardDeferredOverview, ApiError } = await importDashboardWithServices((runtimeServices, ApiErrorClass) => {
      runtimeServices.finance.dashboard.mockRejectedValue(
        new ApiErrorClass('You do not have access to this workspace.', 'server', { status: 403 }),
      );
    });

    await expect(getDashboardDeferredOverview('demo-vendor-a')).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<InstanceType<typeof ApiError>>);
  });

  it('keeps partial dashboard warnings for non-auth subrequest failures', async () => {
    const { getDashboardDeferredOverview } = await importDashboardWithServices((runtimeServices) => {
      runtimeServices.finance.dashboard.mockRejectedValue(new Error('Finance backend timed out.'));
    });

    const overview = await getDashboardDeferredOverview('demo-vendor-a');

    expect(overview.stats.find((stat) => stat.label === 'Vendor orders')?.value).toBe('1');
    expect(overview.financeSnapshot).toBeUndefined();
    expect(overview.partialDataWarnings).toContain('Finance snapshot is temporarily unavailable.');
  });

  it('keeps the initial real dashboard overview as a lightweight shell', async () => {
    const { getDashboardOverview, services } = await importDashboardWithServices();

    const overview = await getDashboardOverview('demo-vendor-a');

    expect(overview.loadPhase).toBe('initial');
    expect(overview.title).toBe('Stored Vendor command center');
    expect(services.orders.list).not.toHaveBeenCalled();
    expect(services.returns.list).not.toHaveBeenCalled();
    expect(services.finance.dashboard).not.toHaveBeenCalled();
    expect(services.diagnostics.reconciliation).not.toHaveBeenCalled();
    expect(services.observability.summary).not.toHaveBeenCalled();
  });

  it('passes the dashboard vendor id to every vendor-scoped subrequest', async () => {
    const { getDashboardDeferredOverview, services } = await importDashboardWithServices();

    await getDashboardDeferredOverview('vendor-query-key');

    expect(services.dashboard.summary).toHaveBeenCalledWith('vendor-query-key', expect.any(Object));
    expect(services.orders.list).toHaveBeenCalledWith('vendor-query-key', expect.any(Object));
    expect(services.returns.list).toHaveBeenCalledWith('vendor-query-key', expect.any(Object));
    expect(services.finance.dashboard).toHaveBeenCalledWith('vendor-query-key', expect.any(Object));
    expect(services.automation.dashboard).toHaveBeenCalledWith('vendor-query-key', expect.any(Object));
    expect(services.signals.list).toHaveBeenCalledWith('vendor-query-key', expect.any(Object));
    expect(services.notifications.list).toHaveBeenCalledWith('vendor-query-key', expect.any(Object));
    expect(services.support.listVendor).toHaveBeenCalledWith(expect.any(Object));
  });

  it('uses explicit global admin notification scope for admin dashboard aggregation', async () => {
    const { getDashboardDeferredOverview, services } = await importDashboardWithServices(undefined, 'admin');

    await getDashboardDeferredOverview('vendor-query-key');

    expect(services.orders.list).toHaveBeenCalledWith('vendor-query-key', expect.any(Object));
    expect(services.notifications.list).toHaveBeenCalledWith(null, expect.any(Object));
    expect(services.support.listAdmin).toHaveBeenCalledWith(expect.any(Object));
    expect(services.operations.dashboard).toHaveBeenCalledWith(expect.any(Object));
    const operationsOptions = services.operations.dashboard.mock.calls[0]?.[0] as { headers?: Record<string, string>; limit?: number } | undefined;
    expect(operationsOptions?.headers?.['X-Dashboard-Deferred-Load']).toBe('true');
    expect(operationsOptions?.headers).not.toHaveProperty('X-Dashboard-Initial-Load');
    expect(operationsOptions?.limit).toBe(20);
  });

  it('marks deferred dashboard subrequests with deferred headers and small list limits', async () => {
    const { getDashboardDeferredOverview, services } = await importDashboardWithServices();

    await getDashboardDeferredOverview('vendor-query-key');

    const orderOptions = services.orders.list.mock.calls[0]?.[1] as { headers?: Record<string, string>; limit?: number } | undefined;
    const returnOptions = services.returns.list.mock.calls[0]?.[1] as { headers?: Record<string, string>; limit?: number } | undefined;
    const financeOptions = services.finance.dashboard.mock.calls[0]?.[1] as { headers?: Record<string, string>; limit?: number } | undefined;
    const summaryOptions = services.dashboard.summary.mock.calls[0]?.[1] as { headers?: Record<string, string>; limit?: number } | undefined;

    expect(orderOptions?.headers?.['X-Request-Id']).toEqual(expect.any(String));
    expect(orderOptions?.headers?.['X-Dashboard-Deferred-Load']).toBe('true');
    expect(orderOptions?.headers).not.toHaveProperty('X-Dashboard-Initial-Load');
    expect(summaryOptions?.headers?.['X-Dashboard-Deferred-Load']).toBe('true');
    expect(summaryOptions?.headers).not.toHaveProperty('X-Dashboard-Initial-Load');
    expect(summaryOptions?.limit).toBeUndefined();
    expect(orderOptions?.limit).toBe(10);
    expect(returnOptions?.limit).toBe(10);
    expect(financeOptions?.limit).toBe(10);
  });

  it('uses dashboard summary counts for primary metrics instead of limited arrays', async () => {
    const { getDashboardDeferredOverview } = await importDashboardWithServices((runtimeServices) => {
      runtimeServices.orders.list.mockResolvedValue(
        Array.from({ length: 10 }, (_, index) => ({
          id: `order-${index + 1}`,
          sourceShopifyOrderNumber: `${1000 + index}`,
          shippingStatus: 'Awaiting Shipment',
          allocationStatus: 'active',
        })),
      );
      runtimeServices.returns.list.mockResolvedValue(
        Array.from({ length: 10 }, (_, index) => ({
          id: `return-${index + 1}`,
          sourceShopifyRefundId: `refund-${index + 1}`,
          status: 'Pending',
          amount: 'TRY 25.00',
        })),
      );
      runtimeServices.dashboard.summary.mockResolvedValue({
        vendorId: 'vendor-query-key',
        orders: {
          total: 30,
          awaitingShipment: 15,
          blocked: 12,
          pendingReassignment: 7,
          vendorBlocked: 5,
        },
        returns: {
          refundAttention: 14,
        },
      });
    });

    const overview = await getDashboardDeferredOverview('vendor-query-key');

    expect(overview.stats.find((stat) => stat.label === 'Vendor orders')?.value).toBe('30');
    expect(overview.stats.find((stat) => stat.label === 'Awaiting shipment')?.value).toBe('15');
    expect(overview.stats.find((stat) => stat.label === 'Blocked / attention')?.value).toBe('26');
    expect(overview.priorityWork.find((item) => item.label === 'Blocked allocations')?.value).toBe('12');
    expect(overview.priorityWork.find((item) => item.label === 'Awaiting shipment')?.value).toBe('15');
    expect(overview.priorityWork.find((item) => item.label === 'Refund attention')?.value).toBe('14');
    expect(overview.priorityWork.map((item) => item.value).join(' ')).not.toContain('in latest');
    expect(overview.stats.map((stat) => stat.value).join(' ')).not.toContain('latest');
    expect(overview.priorityWork.find((item) => item.label === 'Awaiting shipment')?.description).toContain('Latest 10 order allocations');
    expect(overview.normalizedOperationalCounts?.financeReviewItemCount).toBeNull();
    expect(overview.workspaceStatus).toContain('30 vendor allocations');
  });

  it('uses the existing operations summary total instead of limited operation items', async () => {
    const { getDashboardDeferredOverview } = await importDashboardWithServices((runtimeServices) => {
      runtimeServices.operations.dashboard.mockResolvedValue({
        summary: {
          total: 37,
          critical: 0,
          warning: 0,
          attention: 0,
          normal: 37,
          pendingReassignment: 0,
          vendorBlocked: 0,
          awaitingShipment: 0,
          refundAttention: 0,
          operationalSignals: 0,
          automationActions: 0,
        },
        items: [],
      });
    }, 'admin');

    const overview = await getDashboardDeferredOverview('vendor-query-key');

    expect(overview.workspaceStatus).toContain('Admin queue currently tracks 37 operational items');
  });

  it('returns normalized dashboard operational counts from existing backend payloads', async () => {
    const { getDashboardDeferredOverview } = await importDashboardWithServices((runtimeServices) => {
      runtimeServices.finance.dashboard.mockResolvedValue({
        summary: {
          grossSales: 'TRY 100.00',
          refunds: 'TRY 25.00',
          netRevenue: 'TRY 75.00',
          payoutEstimate: 'TRY 67.50',
        },
        transactions: [
          {
            id: 'finance-1',
            date: '2026-05-13T10:00:00.000Z',
            description: 'Pending settlement',
            counterparty: 'Platform ledger',
            category: 'Invoice',
            amount: 'TRY 100.00',
            status: 'Pending',
            settlement: {
              status: 'pending',
              payoutReady: false,
              eligibleAt: null,
              accruedAt: null,
              payableAt: null,
              settledAt: null,
              holdReason: null,
              note: 'Pending review',
            },
          },
          {
            id: 'finance-2',
            date: '2026-05-13T11:00:00.000Z',
            description: 'Completed settlement',
            counterparty: 'Platform ledger',
            category: 'Invoice',
            amount: 'TRY 50.00',
            status: 'Completed',
            settlement: {
              status: 'settled',
              payoutReady: false,
              eligibleAt: null,
              accruedAt: null,
              payableAt: null,
              settledAt: '2026-05-13T11:30:00.000Z',
              holdReason: null,
              note: 'Settled',
            },
          },
        ],
      });
      runtimeServices.automation.dashboard.mockResolvedValue({
        alerts: [
          {
            id: 'alert-1',
            type: 'Warning',
            message: 'Fulfillment is stale',
            status: 'New',
            timestamp: '2026-05-13T10:00:00.000Z',
            source: 'fulfillment',
          },
          {
            id: 'alert-2',
            type: 'Warning',
            message: 'Fulfillment is stale',
            status: 'In Progress',
            timestamp: '2026-05-13T10:05:00.000Z',
            source: 'fulfillment',
          },
        ],
      });
      runtimeServices.support.listVendor.mockResolvedValue([
        {
          id: 'support-1',
          createdAt: '2026-05-13T10:00:00.000Z',
          updatedAt: '2026-05-13T10:00:00.000Z',
          createdByUserId: 'vendor-user',
          createdByRole: 'vendor',
          vendorId: 'vendor-query-key',
          vendorName: 'Stored Vendor',
          subject: 'Help with order #1061',
          message: 'Need help.',
          priority: 'normal',
          status: 'OPEN',
          category: 'ORDER',
          assigneeUserId: null,
          assigneeName: null,
          vendorUnreadCount: 0,
          adminUnreadCount: 1,
          lastReplyAt: null,
          lastReplyByRole: null,
          firstResponseDueAt: null,
          nextResponseDueAt: null,
          escalatedAt: null,
          escalationReason: null,
          sla: null,
          contextType: 'order',
          contextId: 'order-1061',
          contextSummary: null,
          resolvedAt: null,
          closedAt: null,
        },
        {
          id: 'support-2',
          createdAt: '2026-05-13T10:05:00.000Z',
          updatedAt: '2026-05-13T10:05:00.000Z',
          createdByUserId: 'vendor-user',
          createdByRole: 'vendor',
          vendorId: 'vendor-query-key',
          vendorName: 'Stored Vendor',
          subject: 'Duplicate help with order #1061',
          message: 'Need help again.',
          priority: 'high',
          status: 'IN_REVIEW',
          category: 'ORDER',
          assigneeUserId: null,
          assigneeName: null,
          vendorUnreadCount: 0,
          adminUnreadCount: 1,
          lastReplyAt: null,
          lastReplyByRole: null,
          firstResponseDueAt: null,
          nextResponseDueAt: null,
          escalatedAt: null,
          escalationReason: null,
          sla: null,
          contextType: 'order',
          contextId: 'order-1061',
          contextSummary: null,
          resolvedAt: null,
          closedAt: null,
        },
        {
          id: 'support-closed',
          createdAt: '2026-05-13T09:00:00.000Z',
          updatedAt: '2026-05-13T09:00:00.000Z',
          createdByUserId: 'vendor-user',
          createdByRole: 'vendor',
          vendorId: 'vendor-query-key',
          vendorName: 'Stored Vendor',
          subject: 'Closed ticket',
          message: 'Done.',
          priority: 'normal',
          status: 'CLOSED',
          category: 'ORDER',
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
          contextType: 'order',
          contextId: 'order-1062',
          contextSummary: null,
          resolvedAt: null,
          closedAt: '2026-05-13T09:30:00.000Z',
        },
      ]);
      runtimeServices.signals.list.mockResolvedValue({
        summary: {
          total: 2,
          critical: 0,
          high: 2,
          warning: 0,
          info: 0,
        },
        signals: [
          {
            id: 'signal-1',
            type: 'rule',
            severity: 'high',
            sourceArea: 'fulfillment',
            vendorId: 'vendor-query-key',
            allocationId: 'allocation-1',
            financeLedgerEntryId: null,
            payoutBatchId: null,
            operationalJobId: null,
            title: 'Fulfillment is stale',
            description: 'Allocation is stale.',
            suggestedAction: 'Review shipment',
            status: 'active',
            ruleKey: 'fulfillment.stale_awaiting_shipment',
            triggeredAt: '2026-05-13T10:00:00.000Z',
            resolvedAt: null,
          },
          {
            id: 'signal-2',
            type: 'rule',
            severity: 'high',
            sourceArea: 'fulfillment',
            vendorId: 'vendor-query-key',
            allocationId: 'allocation-1',
            financeLedgerEntryId: null,
            payoutBatchId: null,
            operationalJobId: null,
            title: 'Fulfillment is stale',
            description: 'Duplicate stale evidence.',
            suggestedAction: 'Review shipment',
            status: 'active',
            ruleKey: 'fulfillment.stale_awaiting_shipment',
            triggeredAt: '2026-05-13T10:05:00.000Z',
            resolvedAt: null,
          },
        ],
      });
    });

    const overview = await getDashboardDeferredOverview('vendor-query-key');

    const automationWork = overview.priorityWork.find((item) => item.label === 'Automation issue groups');
    expect(automationWork?.value).toBe('2');
    expect(automationWork?.description).toContain('Grouped automation and rules issues');
    expect(overview.normalizedOperationalCounts?.openSupportIssueCount).toBe(1);
    expect(overview.normalizedOperationalCounts?.metadata.openSupportIssueCount.rawCount).toBe(2);
    expect(overview.normalizedOperationalCounts?.groupedAutomationIssueCount).toBe(2);
    expect(overview.normalizedOperationalCounts?.metadata.groupedAutomationIssueCount.rawCount).toBe(4);
    expect(overview.normalizedOperationalCounts?.financeReviewItemCount).toBeNull();
    expect(overview.normalizedOperationalCounts?.staleFulfillmentGroupCount).toBe(1);
    expect(overview.workspaceStatus).toContain('2 grouped automation/rules issues');
  });

  it('keeps admin vendor switch dashboard query keys distinct', () => {
    expect(queryKeys.dashboard.overview('demo-vendor-a')).not.toEqual(queryKeys.dashboard.overview('demo-vendor-b'));
  });
});
