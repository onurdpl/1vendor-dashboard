import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationsAttentionDashboard } from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';
import { AdminOperationsQueuePage } from './AdminOperationsQueuePage';

const attentionMock = vi.fn<() => Promise<OperationsAttentionDashboard>>();

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    operations: {
      attention: () => attentionMock(),
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
      title: 'Overdue support ticket',
      description: 'Overdue by 6h',
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
      items: [],
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
      title: 'Escalate overdue support request',
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
  });

  it('renders critical attention queue, vendor risk, and cross-links', async () => {
    attentionMock.mockResolvedValueOnce(dashboard);

    renderPage();

    expect(await screen.findByRole('heading', { name: /operational attention center/i })).toBeInTheDocument();
    expect((await screen.findAllByText('Overdue support ticket')).length).toBeGreaterThan(0);
    expect(screen.getByText('Shipment pending carrier identifiers')).toBeInTheDocument();
    expect(screen.getByText('Tracking is not available yet.')).toBeInTheDocument();
    expect(screen.getAllByText('Vendor rejected allocation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Order #1091').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/OUT_OF_STOCK/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reason: OUT_OF_STOCK').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Review allocation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Review transfer, cancel/refund, or return to vendor.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vendor blocked').length).toBeGreaterThan(0);
    expect(screen.getByText('Vendor blocked allocations')).toBeInTheDocument();
    expect(screen.getByText('Recommended actions')).toBeInTheDocument();
    expect(screen.getByText('Escalate overdue support request')).toBeInTheDocument();
    expect(screen.getAllByText('Sporjinal').length).toBeGreaterThan(0);
    expect(screen.getByText('1 support item · 1 shipment item')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open' })[0]).toHaveAttribute('href', '/admin/support/ticket-1');
    expect(screen.getAllByRole('link', { name: 'Review allocation' }).some((link) => link.getAttribute('href') === '/admin/orders/7817723773265')).toBe(true);
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
    expect(screen.getAllByRole('link', { name: 'Review allocation' }).some((link) => link.getAttribute('href') === '/admin/orders/7817723773265')).toBe(true);
  });
});
