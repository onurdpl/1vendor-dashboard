import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OperationsAttentionDashboard,
  OperationsAttentionItem,
  OperationsQueueDashboard,
  OperationsQueueItem,
  OperationsQueueTypeFilter,
} from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';
import { AdminOperationsQueuePage } from './AdminOperationsQueuePage';

const attentionMock = vi.fn<() => Promise<OperationsAttentionDashboard>>();
const queueDashboardMock = vi.fn<(options?: { limit?: number; offset?: number; type?: OperationsQueueTypeFilter }) => Promise<OperationsQueueDashboard>>();

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    operations: {
      attention: () => attentionMock(),
      dashboard: (options?: { limit?: number; offset?: number; type?: OperationsQueueTypeFilter }) => queueDashboardMock(options),
    },
  },
}));

const dashboard: OperationsAttentionDashboard = {
  generatedAt: '2026-05-17T10:00:00.000Z',
  summary: {
    total: 3,
    critical: 1,
    warning: 2,
    info: 0,
    overdueSupport: 1,
    shipmentIssues: 1,
    returnBacklog: 0,
    financeReview: 0,
    vendorBlocked: 1,
    vendorRisks: 1,
  },
  queue: [
    {
      id: 'support-1',
      type: 'support',
      severity: 'critical',
      vendorId: 'sporjinal',
      vendorName: 'Sporjinal',
      objectType: 'Support ticket',
      objectReference: 'Order #1029',
      objectId: 'ticket-1',
      status: 'OPEN',
      ageHours: 30,
      title: 'High-priority support ticket',
      description: 'Priority: high',
      recommendedAction: 'Assign and respond',
      destinationPath: '/admin/support/ticket-1',
      createdAt: '2026-05-17T08:00:00.000Z',
    },
    {
      id: 'vendor-blocked-1091',
      type: 'vendor_blocked',
      severity: 'warning',
      vendorId: 'sporjinal',
      vendorName: 'Sporjinal',
      objectType: 'vendor_blocked',
      objectReference: 'Order #1091',
      objectId: 'alloc-1091',
      status: 'vendor_blocked',
      ageHours: 1,
      title: 'Vendor rejected allocation',
      description: 'Sporjinal rejected Order #1091. Reason: OUT_OF_STOCK. Reassignment required: yes.',
      recommendedAction: 'Review allocation',
      destinationPath: '/admin/orders/7817723773265',
      createdAt: '2026-05-17T09:30:00.000Z',
      reassignmentRequired: true,
      sourceShopifyOrderId: '7817723773265',
      sourceShopifyOrderNumber: '#1091',
      cancellationReason: 'OUT_OF_STOCK',
    },
    {
      id: 'shipment-1',
      type: 'shipment',
      severity: 'warning',
      vendorId: 'sporjinal',
      vendorName: 'Sporjinal',
      objectType: 'Shipment',
      objectReference: 'Order #1028',
      objectId: 'shipment-1',
      status: 'pending',
      ageHours: 12,
      title: 'Shipment pending carrier identifiers',
      description: 'Tracking is not available yet.',
      recommendedAction: 'Review shipment status',
      destinationPath: '/orders/alloc-1028',
      createdAt: '2026-05-17T09:00:00.000Z',
    },
  ],
  sections: [
    {
      key: 'vendor_blocked',
      title: 'Vendor blocked allocations',
      count: 1,
      critical: 0,
      warning: 1,
      items: [
        {
          id: 'vendor-blocked-1091',
          type: 'vendor_blocked',
          severity: 'warning',
          vendorId: 'sporjinal',
          vendorName: 'Sporjinal',
          objectType: 'vendor_blocked',
          objectReference: 'Order #1091',
          objectId: 'alloc-1091',
          status: 'vendor_blocked',
          ageHours: 1,
          title: 'Vendor rejected allocation',
          description: 'Sporjinal rejected Order #1091. Reason: OUT_OF_STOCK. Reassignment required: yes.',
          recommendedAction: 'Review allocation',
          destinationPath: '/admin/orders/7817723773265',
          createdAt: '2026-05-17T09:30:00.000Z',
          reassignmentRequired: true,
          sourceShopifyOrderId: '7817723773265',
          sourceShopifyOrderNumber: '#1091',
          cancellationReason: 'OUT_OF_STOCK',
        },
      ],
    },
    {
      key: 'support',
      title: 'Support attention',
      count: 1,
      critical: 1,
      warning: 0,
      items: [
        {
          id: 'support-1',
          type: 'support',
          severity: 'critical',
          vendorId: 'sporjinal',
          vendorName: 'Sporjinal',
          objectType: 'Support ticket',
          objectReference: 'Order #1029',
          objectId: 'ticket-1',
          status: 'OPEN',
          ageHours: 30,
          title: 'High-priority support ticket',
          description: 'High-priority support request needs an admin response.',
          recommendedAction: 'Assign and respond',
          destinationPath: '/admin/support/ticket-1',
          createdAt: '2026-05-17T08:00:00.000Z',
        },
      ],
    },
    {
      key: 'shipment',
      title: 'Shipment attention',
      count: 1,
      critical: 0,
      warning: 1,
      items: [],
    },
    {
      key: 'return',
      title: 'Return backlog',
      count: 0,
      critical: 0,
      warning: 0,
      items: [],
    },
    {
      key: 'finance',
      title: 'Finance review',
      count: 0,
      critical: 0,
      warning: 0,
      items: [],
    },
  ],
  recommendations: [
    {
      id: 'recommendation-vendor-blocked-1091',
      type: 'vendor_blocked_review',
      severity: 'warning',
      title: 'Vendor rejected allocation',
      description: 'Sporjinal rejected Order #1091. Reason: OUT_OF_STOCK.',
      recommendedAction: 'Review transfer, cancel/refund, or return to vendor.',
      relatedObjectType: 'vendor_blocked',
      relatedObjectId: 'alloc-1091',
      vendor: {
        id: 'sporjinal',
        name: 'Sporjinal',
      },
      createdFromSignal: 'vendor-blocked-1091',
      deepLink: '/admin/orders/7817723773265',
      vendorVisible: false,
      createdAt: '2026-05-17T09:30:00.000Z',
    },
    {
      id: 'recommendation-support-1',
      type: 'support_escalation',
      severity: 'critical',
      title: 'Escalate support request',
      description: 'Order #1029 needs an admin response.',
      recommendedAction: 'Review owner, respond, or move the ticket to the correct waiting state',
      relatedObjectType: 'Support ticket',
      relatedObjectId: 'ticket-1',
      vendor: {
        id: 'sporjinal',
        name: 'Sporjinal',
      },
      createdFromSignal: 'support-1',
      deepLink: '/admin/support/ticket-1',
      vendorVisible: false,
      createdAt: '2026-05-17T08:00:00.000Z',
    },
  ],
  vendorRisks: [
    {
      vendorId: 'sporjinal',
      vendorName: 'Sporjinal',
      riskLevel: 'critical',
      totalAttentionItems: 2,
      criticalItems: 1,
      warningItems: 1,
      supportItems: 1,
      shipmentItems: 1,
      returnItems: 0,
      financeItems: 0,
      drivers: ['1 support item', '1 shipment item'],
    },
  ],
  recentActivity: [
    {
      id: 'activity-support-1',
      type: 'support',
      severity: 'critical',
      vendorId: 'sporjinal',
      vendorName: 'Sporjinal',
      title: 'Overdue support ticket',
      description: 'Order #1029',
      occurredAt: '2026-05-17T08:00:00.000Z',
      destinationPath: '/admin/support/ticket-1',
    },
  ],
};

function buildVendorBlockedItem(orderNumber: string, index: number): OperationsAttentionItem {
  const numericOrder = orderNumber.replace(/\D/g, '') || String(index);
  return {
    id: `vendor-blocked-${numericOrder}`,
    type: 'vendor_blocked',
    severity: 'warning',
    vendorId: 'sporjinal',
    vendorName: 'Sporjinal',
    objectType: 'vendor_blocked',
    objectReference: `Order ${orderNumber}`,
    objectId: `alloc-${numericOrder}`,
    status: 'vendor_blocked',
    ageHours: index + 1,
    title: `Vendor rejected allocation ${orderNumber}`,
    description: `Sporjinal rejected Order ${orderNumber}. Reason: OUT_OF_STOCK. Reassignment required: yes.`,
    recommendedAction: 'Review allocation',
    destinationPath: `/admin/orders/${7800000000000 + index}`,
    createdAt: `2026-05-17T0${Math.min(index + 1, 9)}:00:00.000Z`,
    reassignmentRequired: true,
    sourceShopifyOrderId: String(7800000000000 + index),
    sourceShopifyOrderNumber: orderNumber,
    cancellationReason: 'OUT_OF_STOCK',
  };
}

function buildVendorBlockedPreviewDashboard(orderNumbers: string[]): OperationsAttentionDashboard {
  const vendorBlockedItems = orderNumbers.map((orderNumber, index) => buildVendorBlockedItem(orderNumber, index));

  return {
    ...dashboard,
    summary: {
      ...dashboard.summary,
      total: vendorBlockedItems.length,
      critical: 0,
      warning: vendorBlockedItems.length,
      overdueSupport: 0,
      shipmentIssues: 0,
      returnBacklog: 0,
      financeReview: 0,
      vendorBlocked: vendorBlockedItems.length,
      vendorRisks: 1,
    },
    queue: vendorBlockedItems,
    sections: [
      {
        key: 'vendor_blocked',
        title: 'Vendor blocked allocations',
        count: vendorBlockedItems.length,
        critical: 0,
        warning: vendorBlockedItems.length,
        items: vendorBlockedItems.slice(0, 5),
      },
    ],
    recommendations: [],
    vendorRisks: [],
    recentActivity: [],
  };
}

function buildVendorBlockedQueueItem(orderNumber: string, index: number): OperationsQueueItem {
  const numericOrder = orderNumber.replace(/\D/g, '') || String(index);

  return {
    id: `op-blocked-alloc-${numericOrder}`,
    type: 'vendor_blocked',
    severity: 'high',
    title: `Vendor rejected allocation ${orderNumber}`,
    description: `Sporjinal rejected Order ${orderNumber}. Reason: OUT_OF_STOCK. Reassignment required: yes.`,
    vendorId: 'sporjinal',
    vendorName: 'Sporjinal',
    relatedOrderId: `alloc-${numericOrder}`,
    relatedShopifyOrderId: String(7900000000000 + index),
    relatedShopifyOrderNumber: orderNumber,
    status: 'vendor_blocked',
    createdAt: `2026-05-17T0${Math.min(index + 1, 9)}:00:00.000Z`,
    actionLabel: 'Review allocation',
    actionTo: `/admin/orders/${7900000000000 + index}`,
    reassignmentRequired: true,
  };
}

function buildQueueDashboard(items: OperationsQueueItem[], total = items.length): OperationsQueueDashboard {
  return {
    summary: {
      total,
      critical: 0,
      warning: items.length,
      attention: 0,
      normal: 0,
      pendingReassignment: 0,
      vendorBlocked: total,
      awaitingShipment: 0,
      refundAttention: 0,
      financeIntegrityAlerts: 0,
      operationalSignals: 0,
      automationActions: 0,
    },
    items,
  };
}

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
        <AdminOperationsQueuePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminOperationsQueuePage attention center', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    attentionMock.mockReset();
    queueDashboardMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders critical attention queue, vendor risk, and cross-links', async () => {
    attentionMock.mockResolvedValueOnce(dashboard);

    renderPage();

    expect(await screen.findByRole('heading', { name: /operational attention center/i })).toBeInTheDocument();
    expect((await screen.findAllByText('High-priority support ticket')).length).toBeGreaterThan(0);
    expect(screen.getByText('Shipment pending carrier identifiers')).toBeInTheDocument();
    expect(screen.getByText('Tracking is not available yet.')).toBeInTheDocument();
    expect(screen.getAllByText('Vendor rejected allocation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Order #1091').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/OUT_OF_STOCK/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reason: OUT_OF_STOCK').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Open order').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reassignment required').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Review transfer, cancel/refund, or return to vendor.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vendor blocked').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Vendor Blocked Allocations' })).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 1 active · 0 critical · 1 warning')).toBeInTheDocument();
    expect(screen.getByText('Critical support')).toBeInTheDocument();
    expect(screen.queryByText('Overdue support')).not.toBeInTheDocument();
    expect(screen.getByText('Recommended actions')).toBeInTheDocument();
    expect(screen.getByText('Escalate support request')).toBeInTheDocument();
    expect(screen.getAllByText('Sporjinal').length).toBeGreaterThan(0);
    expect(screen.getByText('1 support item · 1 shipment item')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open ticket' })[0]).toHaveAttribute('href', '/admin/support/ticket-1');
    expect(screen.getAllByRole('link', { name: 'Open order' }).some((link) => link.getAttribute('href') === '/admin/orders/7817723773265')).toBe(true);
    expect(screen.getByRole('heading', { name: 'Recent projected activity' })).toBeInTheDocument();
    expect(screen.getByText('Latest projected activity rows, not a full audit history.')).toBeInTheDocument();
  });

  it('renders split child vendor-blocked items with split-aware copy', async () => {
    const splitDashboard: OperationsAttentionDashboard = {
      ...dashboard,
      summary: {
        ...dashboard.summary,
        total: 1,
        warning: 1,
        vendorBlocked: 1,
      },
      queue: [
        {
          id: 'vendor-blocked-split-1091',
          type: 'vendor_blocked',
          severity: 'warning',
          vendorId: 'sporjinal',
          vendorName: 'Sporjinal',
          objectType: 'vendor_blocked',
          objectReference: 'Order #1091',
          objectId: 'alloc-split-child',
          status: 'vendor_blocked',
          ageHours: 1,
          title: 'Split allocation awaiting admin resolution',
          description: 'Vendor rejected selected line items. Review the split allocation and choose transfer, refund, or return. Reason: OUT_OF_STOCK.',
          recommendedAction: 'Review allocation',
          destinationPath: '/admin/orders/7817723773265',
          createdAt: '2026-05-17T09:30:00.000Z',
          reassignmentRequired: true,
          sourceShopifyOrderId: '7817723773265',
          sourceShopifyOrderNumber: '#1091',
          cancellationReason: 'OUT_OF_STOCK',
          splitChildAllocation: true,
        },
      ],
      sections: [
        {
          key: 'vendor_blocked',
          title: 'Vendor blocked allocations',
          count: 1,
          critical: 0,
          warning: 1,
          items: [
            {
              id: 'vendor-blocked-split-1091',
              type: 'vendor_blocked',
              severity: 'warning',
              vendorId: 'sporjinal',
              vendorName: 'Sporjinal',
              objectType: 'vendor_blocked',
              objectReference: 'Order #1091',
              objectId: 'alloc-split-child',
              status: 'vendor_blocked',
              ageHours: 1,
              title: 'Split allocation awaiting admin resolution',
              description: 'Vendor rejected selected line items. Review the split allocation and choose transfer, refund, or return. Reason: OUT_OF_STOCK.',
              recommendedAction: 'Review allocation',
              destinationPath: '/admin/orders/7817723773265',
              createdAt: '2026-05-17T09:30:00.000Z',
              reassignmentRequired: true,
              sourceShopifyOrderId: '7817723773265',
              sourceShopifyOrderNumber: '#1091',
              cancellationReason: 'OUT_OF_STOCK',
              splitChildAllocation: true,
            },
          ],
        },
      ],
      recommendations: [],
      vendorRisks: [],
      recentActivity: [],
    };
    attentionMock.mockResolvedValueOnce(splitDashboard);

    renderPage();

    expect(await screen.findAllByText('Split allocation awaiting admin resolution')).toHaveLength(2);
    expect(screen.getAllByText(/Vendor rejected selected line items/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reason: OUT_OF_STOCK').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reassignment required').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Split allocation').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Open order' }).some((link) => link.getAttribute('href') === '/admin/orders/7817723773265')).toBe(true);
  });

  it('discloses that Vendor Blocked cards are a five-item preview when six active allocations exist', async () => {
    attentionMock.mockResolvedValueOnce(buildVendorBlockedPreviewDashboard(['#1201', '#1202', '#1203', '#1204', '#1205', '#1206']));
    queueDashboardMock.mockResolvedValueOnce(buildQueueDashboard(['#1201', '#1202', '#1203', '#1204', '#1205'].map(buildVendorBlockedQueueItem), 6));

    renderPage();

    expect(await screen.findByText('Showing 5 of 6 active · 0 critical · 6 warning')).toBeInTheDocument();
    expect(screen.getByText('Showing 5 of 6. This section is a preview.')).toBeInTheDocument();

    const preview = screen.getByLabelText('Vendor Blocked Allocations preview');
    expect(within(preview).getAllByText(/Vendor rejected allocation #120/)).toHaveLength(5);
    expect(within(preview).queryByText('Order #1206')).not.toBeInTheDocument();
    expect(screen.getByText('Order #1206')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View all vendor-blocked allocations' }));

    expect(await screen.findByRole('heading', { name: 'Vendor-blocked allocations in queue pages' })).toBeInTheDocument();
    expect(screen.getByText('Read-only paginated Vendor Blocked results from the Operations queue.')).toBeInTheDocument();
    expect(screen.queryByText('Filter current page')).not.toBeInTheDocument();
    expect(screen.queryByText('No vendor-blocked allocations on this queue page')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText(
          (_content, element) =>
            element?.tagName.toLowerCase() === 'span' &&
            element.textContent?.replace(/\s+/g, ' ').trim() === 'Vendor Blocked rows 1-5 of 6',
        ),
      ).toBeInTheDocument();
    });
    expect(queueDashboardMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 5, offset: 0, type: 'vendor_blocked' }));
  });

  it('keeps a #1109-like active vendor-blocked allocation discoverable from the returned unified queue when it is outside the preview', async () => {
    attentionMock.mockResolvedValueOnce(buildVendorBlockedPreviewDashboard(['#1104', '#1105', '#1106', '#1107', '#1108', '#1109']));
    queueDashboardMock.mockImplementation(async (options) => {
      const offset = options?.offset ?? 0;
      if (offset === 0) {
        return buildQueueDashboard(['#1104', '#1105', '#1106', '#1107', '#1108'].map(buildVendorBlockedQueueItem), 6);
      }

      return buildQueueDashboard([buildVendorBlockedQueueItem('#1109', 5)], 6);
    });

    renderPage();

    const preview = await screen.findByLabelText('Vendor Blocked Allocations preview');
    expect(within(preview).queryByText('Order #1109')).not.toBeInTheDocument();
    expect(screen.getByText('Order #1109')).toBeInTheDocument();
    expect(screen.getByText('Showing 5 of 6 active · 0 critical · 6 warning')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View all vendor-blocked allocations' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          (_content, element) =>
            element?.tagName.toLowerCase() === 'span' &&
            element.textContent?.replace(/\s+/g, ' ').trim() === 'Vendor Blocked rows 1-5 of 6',
        ),
      ).toBeInTheDocument();
    });
    expect(screen.queryAllByText('Order #1109')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          (_content, element) =>
            element?.tagName.toLowerCase() === 'span' &&
            element.textContent?.replace(/\s+/g, ' ').trim() === 'Vendor Blocked rows 6-6 of 6',
        ),
      ).toBeInTheDocument();
    });
    const fullList = screen.getByRole('heading', { name: 'Vendor-blocked allocations in queue pages' }).closest('article');
    expect(fullList).not.toBeNull();
    expect(await within(fullList as HTMLElement).findByText('Order #1109')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open order' }).some((link) => link.getAttribute('href') === '/admin/orders/7900000000005')).toBe(true);
    expect(queueDashboardMock).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 5, offset: 5, type: 'vendor_blocked' }));
  });

  it('discloses capped non-vendor sections without implying complete inventory', async () => {
    const sectionDisclosureDashboard: OperationsAttentionDashboard = {
      ...dashboard,
      sections: [
        {
          key: 'support',
          title: 'Support attention',
          count: 3,
          critical: 2,
          warning: 1,
          items: [
            {
              id: 'support-current-page',
              type: 'support',
              severity: 'critical',
              vendorId: 'sporjinal',
              vendorName: 'Sporjinal',
              objectType: 'Support ticket',
              objectReference: 'Order #1301',
              objectId: 'ticket-1301',
              status: 'OPEN',
              ageHours: 2,
              title: 'High-priority support ticket',
              description: 'Priority: high',
              recommendedAction: 'Assign and respond',
              destinationPath: '/admin/support/ticket-1301',
              createdAt: '2026-05-17T08:00:00.000Z',
            },
          ],
        },
      ],
      recommendations: [],
      vendorRisks: [],
      recentActivity: [],
    };
    attentionMock.mockResolvedValueOnce(sectionDisclosureDashboard);

    renderPage();

    expect(await screen.findByText('Showing 1 of 3 active · 2 critical · 1 warning')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 3. This section is a preview.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View all vendor-blocked allocations' })).not.toBeInTheDocument();
  });

  it('keeps stale attention data visible and shows a warning when background refresh fails', async () => {
    attentionMock.mockResolvedValueOnce(dashboard);

    renderPage();

    expect(await screen.findByText('Order #1091')).toBeInTheDocument();
    attentionMock.mockRejectedValueOnce(new Error('Backend temporarily unavailable'));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText(/Could not refresh/i)).toBeInTheDocument();
    expect(screen.getByText('Order #1091')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
