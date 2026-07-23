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
  SupportAttentionTicket,
  SupportAttentionTicketsPage,
} from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';
import { AdminOperationsQueuePage } from './AdminOperationsQueuePage';

const attentionMock = vi.fn<() => Promise<OperationsAttentionDashboard>>();
const queueDashboardMock = vi.fn<(options?: { limit?: number; offset?: number; type?: OperationsQueueTypeFilter }) => Promise<OperationsQueueDashboard>>();
const supportAttentionMock = vi.fn<(options?: { limit?: number; offset?: number }) => Promise<SupportAttentionTicketsPage>>();

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    operations: {
      attention: () => attentionMock(),
      dashboard: (options?: { limit?: number; offset?: number; type?: OperationsQueueTypeFilter }) => queueDashboardMock(options),
    },
    support: {
      listAdminAttention: (options?: { limit?: number; offset?: number }) => supportAttentionMock(options),
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

function buildShipmentQueueItem(
  orderNumber: string,
  index: number,
  overrides: Partial<OperationsQueueItem> = {},
): OperationsQueueItem {
  return {
    id: `op-shipment-shipment-${index}`,
    type: 'awaiting_shipment',
    severity: index % 2 === 0 ? 'critical' : 'high',
    title: index % 2 === 0 ? 'Shipment execution failed' : 'Shipment pending carrier identifiers',
    description: index % 2 === 0 ? 'Tracking is not available yet.' : 'Carrier record exists; tracking should be reviewed.',
    vendorId: 'sporjinal',
    vendorName: 'Sporjinal',
    relatedOrderId: `alloc-shipment-${index}`,
    relatedShopifyOrderId: String(7950000000000 + index),
    relatedShopifyOrderNumber: orderNumber,
    status: index % 2 === 0 ? 'failed' : 'pending',
    createdAt: `2026-05-${String(Math.min(index + 1, 28)).padStart(2, '0')}T08:00:00.000Z`,
    actionLabel: index % 2 === 0 ? 'Review provider response' : 'Review shipment status',
    actionTo: `/admin/orders/${7950000000000 + index}`,
    ...overrides,
  };
}

function buildReturnReviewQueueItem(
  returnId: string,
  orderNumber: string,
  index: number,
  overrides: Partial<OperationsQueueItem> = {},
): OperationsQueueItem {
  return {
    id: `op-refund-${returnId}`,
    type: 'refund_attention',
    severity: 'medium',
    title: 'Return requires review',
    description: `Return ${returnId} is waiting for review.`,
    vendorId: 'sporjinal',
    vendorName: 'Sporjinal',
    relatedOrderId: `alloc-return-${index}`,
    relatedShopifyOrderId: String(7960000000000 + index),
    relatedShopifyOrderNumber: orderNumber,
    status: 'awaiting_review',
    createdAt: `2026-05-${String(Math.min(index + 1, 28)).padStart(2, '0')}T07:00:00.000Z`,
    actionLabel: 'Review return',
    actionTo: `/returns/${returnId}`,
    ...overrides,
  };
}

function buildFinanceIntegrityQueueItem(
  alertId: string,
  orderNumber: string | null,
  index: number,
  overrides: Partial<OperationsQueueItem> = {},
): OperationsQueueItem {
  return {
    id: `op-finance-integrity-${alertId}`,
    type: 'finance_integrity_alert',
    severity: index % 2 === 0 ? 'critical' : 'high',
    title: 'Finance integrity alert',
    description: `Category: missing_active_sale_ledger. Reason: finance_integrity_${index}.`,
    vendorId: 'sporjinal',
    vendorName: 'Sporjinal',
    relatedOrderId: `alloc-finance-${index}`,
    relatedShopifyOrderId: String(7970000000000 + index),
    relatedShopifyOrderNumber: orderNumber ?? undefined,
    status: index % 2 === 0 ? 'open' : 'acknowledged',
    createdAt: `2026-05-${String(Math.min(index + 1, 28)).padStart(2, '0')}T06:00:00.000Z`,
    actionLabel: 'Investigate finance alert',
    actionTo: `/admin/orders/${7970000000000 + index}`,
    financeIntegrityAlertId: alertId,
    financeIntegrityCategory: index % 2 === 0 ? 'missing_active_sale_ledger' : 'voided_sale_ledger_without_successor',
    financeIntegrityReason: index % 2 === 0 ? 'no_active_sale_ledger' : 'voided_sale_ledger_without_successor',
    vendorAllocationId: `alloc-finance-${index}`,
    allocationEconomicTransferId: `transfer-finance-${index}`,
    ...overrides,
  };
}

function buildFinanceReviewQueueItem(
  ledgerId: string,
  orderNumber: string | null,
  index: number,
  overrides: Partial<OperationsQueueItem> = {},
): OperationsQueueItem {
  return {
    id: `op-finance-review-${ledgerId}`,
    type: 'finance_review',
    severity: 'critical',
    title: 'Payout review needed',
    description: index % 2 === 0 ? 'Settlement hold requires admin review.' : 'Ledger is disputed.',
    vendorId: 'sporjinal',
    vendorName: 'Sporjinal',
    relatedOrderId: `alloc-finance-review-${index}`,
    relatedShopifyOrderId: String(7980000000000 + index),
    relatedShopifyOrderNumber: orderNumber ?? undefined,
    status: index % 2 === 0 ? 'hold' : 'disputed',
    createdAt: `2026-05-${String(Math.min(index + 1, 28)).padStart(2, '0')}T05:00:00.000Z`,
    actionLabel: 'Review finance',
    actionTo: '/finance',
    financeLedgerEntryId: ledgerId,
    financeReviewReason: index % 2 === 0 ? 'Settlement hold requires admin review.' : 'Ledger is disputed.',
    financeReviewAmount: `${1000 + index}.00`,
    payoutStatus: index % 2 === 0 ? 'HOLD' : 'PENDING',
    settlementStatus: index % 2 === 0 ? 'HELD' : 'DISPUTED',
    vendorAllocationId: `alloc-finance-review-${index}`,
    ...overrides,
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
      financeReview: 0,
      financeIntegrityAlerts: 0,
      operationalSignals: 0,
      automationActions: 0,
    },
    items,
  };
}

function buildFinanceIntegrityQueueDashboard(items: OperationsQueueItem[], total = items.length): OperationsQueueDashboard {
  return {
    summary: {
      total,
      critical: items.filter((item) => item.severity === 'critical').length,
      warning: total - items.filter((item) => item.severity === 'critical').length,
      attention: 0,
      normal: 0,
      pendingReassignment: 0,
      vendorBlocked: 0,
      awaitingShipment: 0,
      refundAttention: 0,
      financeReview: 0,
      financeIntegrityAlerts: total,
      operationalSignals: 0,
      automationActions: 0,
    },
    items,
  };
}

function buildReturnReviewQueueDashboard(items: OperationsQueueItem[], total = items.length): OperationsQueueDashboard {
  return {
    summary: {
      total,
      critical: 0,
      warning: 0,
      attention: total,
      normal: 0,
      pendingReassignment: 0,
      vendorBlocked: 0,
      awaitingShipment: 0,
      refundAttention: total,
      financeReview: 0,
      financeIntegrityAlerts: 0,
      operationalSignals: 0,
      automationActions: 0,
    },
    items,
  };
}

function buildShipmentQueueDashboard(items: OperationsQueueItem[], total = items.length): OperationsQueueDashboard {
  return {
    summary: {
      total,
      critical: items.filter((item) => item.severity === 'critical').length,
      warning: total - items.filter((item) => item.severity === 'critical').length,
      attention: 0,
      normal: 0,
      pendingReassignment: 0,
      vendorBlocked: 0,
      awaitingShipment: total,
      refundAttention: 0,
      financeReview: 0,
      financeIntegrityAlerts: 0,
      operationalSignals: 0,
      automationActions: 0,
    },
    items,
  };
}

function buildFinanceReviewQueueDashboard(items: OperationsQueueItem[], total = items.length): OperationsQueueDashboard {
  return {
    summary: {
      total,
      critical: total,
      warning: 0,
      attention: 0,
      normal: 0,
      pendingReassignment: 0,
      vendorBlocked: 0,
      awaitingShipment: 0,
      refundAttention: 0,
      financeReview: total,
      financeIntegrityAlerts: 0,
      operationalSignals: 0,
      automationActions: 0,
    },
    items,
  };
}

function buildSupportAttentionTicket(overrides: Partial<SupportAttentionTicket> = {}): SupportAttentionTicket {
  return {
    id: 'ticket-1',
    ticketReference: 'ticket-1',
    subject: 'High-priority support ticket',
    status: 'OPEN',
    priority: 'high',
    category: 'ORDER',
    vendorId: 'sporjinal',
    vendorName: 'Sporjinal',
    relatedOrderReference: '#1029',
    contextType: 'order',
    contextId: '1029',
    sla: {
      isOverdue: true,
      dueLabel: 'Overdue by 6h',
      escalationLevel: 'overdue',
      dueAt: '2026-05-17T02:00:00.000Z',
      overdueByHours: 6,
    },
    severity: 'critical',
    createdAt: '2026-05-16T08:00:00.000Z',
    updatedAt: '2026-05-17T08:00:00.000Z',
    waitingSince: '2026-05-17T08:00:00.000Z',
    ageHours: 30,
    destinationPath: '/admin/support/ticket-1',
    ...overrides,
  };
}

function buildSupportAttentionPage(
  items: SupportAttentionTicket[],
  total = items.length,
  offset = 0,
): SupportAttentionTicketsPage {
  return {
    generatedAt: '2026-05-17T10:00:00.000Z',
    total,
    limit: 10,
    offset,
    sort: 'updatedAt_asc_id_asc',
    items,
  };
}

function buildDefaultQueueDashboardForOptions(options?: { type?: OperationsQueueTypeFilter }): OperationsQueueDashboard {
  if (options?.type === 'awaiting_shipment') {
    return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
  }
  if (options?.type === 'return_review') {
    return buildReturnReviewQueueDashboard([], 0);
  }
  if (options?.type === 'finance_review') {
    return buildFinanceReviewQueueDashboard([], 0);
  }
  if (options?.type === 'finance_integrity_alert') {
    return buildFinanceIntegrityQueueDashboard([], 0);
  }
  return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
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
    supportAttentionMock.mockReset();
    queueDashboardMock.mockImplementation(async (options) => buildDefaultQueueDashboardForOptions(options));
    supportAttentionMock.mockResolvedValue(buildSupportAttentionPage([buildSupportAttentionTicket()]));
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
    expect(screen.getAllByText('Tracking is not available yet.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vendor rejected allocation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Order #1091').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/OUT_OF_STOCK/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Reason: OUT_OF_STOCK/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Open order').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Review transfer, cancel/refund, or return to vendor.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vendor blocked').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Vendor Blocked Allocations' })).toBeInTheDocument();
    expect(await screen.findByText('Vendor Blocked rows 1-1 of 1')).toBeInTheDocument();
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

  it('renders Support attention as a server-paginated table while preserving unified queue support rows', async () => {
    attentionMock.mockResolvedValueOnce(dashboard);
    supportAttentionMock.mockResolvedValueOnce(buildSupportAttentionPage([
      buildSupportAttentionTicket({
        id: 'ticket-table-1',
        ticketReference: 'ticket-table-1',
        subject: 'Table support ticket',
        destinationPath: '/admin/support/ticket-table-1',
      }),
    ], 21));

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Support attention' })).toBeInTheDocument();
    expect(await screen.findByText('Table support ticket')).toBeInTheDocument();
    expect(screen.getByText('Authoritative unresolved support tickets · 1-10 of 21')).toBeInTheDocument();
    expect(screen.getByText('Support rows 1-10 of 21')).toBeInTheDocument();
    expect(screen.getByText('SLA / Waiting')).toBeInTheDocument();
    expect(screen.queryByText('Showing 1 of 1 active · 1 critical · 0 warning')).not.toBeInTheDocument();
    expect(screen.queryByText('Showing 1 of 1. This section is a preview.')).not.toBeInTheDocument();
    expect(screen.getAllByText('High-priority support ticket').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Open ticket' }).some((link) => link.getAttribute('href') === '/admin/support/ticket-table-1')).toBe(true);
    expect(document.querySelector('.support-attention-table')).not.toBeNull();
    expect(supportAttentionMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 0 }));
  });

  it('stacks operational sections in the main column while preserving right sidebar cards', async () => {
    attentionMock.mockResolvedValueOnce(dashboard);

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Support attention' })).toBeInTheDocument();
    expect(await screen.findByText('Support rows 1-1 of 1')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Vendor Blocked Allocations' })).toBeInTheDocument();
    expect(await screen.findByText('Vendor Blocked rows 1-1 of 1')).toBeInTheDocument();
    expect(await screen.findByText('Shipment rows 1-1 of 1')).toBeInTheDocument();

    const operationalStack = document.querySelector('.attention-sections-stack');
    expect(operationalStack).not.toBeNull();
    expect(document.querySelector('.attention-sections-grid')).toBeNull();
    expect(
      Array.from((operationalStack as HTMLElement).querySelectorAll('.attention-card-heading h3')).map((heading) => heading.textContent),
    ).toEqual([
      'Support attention',
      'Vendor Blocked Allocations',
      'Shipment attention',
      'Return review',
      'Finance Review',
      'Finance Integrity',
    ]);

    const sidebar = document.querySelector('.attention-side-column');
    expect(sidebar).not.toBeNull();
    expect(within(sidebar as HTMLElement).getByRole('heading', { name: 'Operational health' })).toBeInTheDocument();
    expect(within(sidebar as HTMLElement).getByRole('heading', { name: 'Recent projected activity' })).toBeInTheDocument();
  });

  it('pages Support attention with server offsets and keeps resolved tickets out of the table', async () => {
    attentionMock.mockResolvedValueOnce({
      ...dashboard,
      queue: [],
      sections: [],
      recommendations: [],
      vendorRisks: [],
      recentActivity: [],
    });
    supportAttentionMock.mockImplementation(async (options) => {
      const offset = options?.offset ?? 0;
      if (offset === 0) {
        return buildSupportAttentionPage([
          buildSupportAttentionTicket({
            id: 'ticket-page-1',
            ticketReference: 'ticket-page-1',
            subject: 'First page support ticket',
            status: 'OPEN',
            destinationPath: '/admin/support/ticket-page-1',
          }),
        ], 21, 0);
      }

      return buildSupportAttentionPage([
        buildSupportAttentionTicket({
          id: 'ticket-page-11',
          ticketReference: 'ticket-page-11',
          subject: 'Second page support ticket',
          status: 'WAITING_FOR_VENDOR',
          priority: 'normal',
          severity: 'warning',
          destinationPath: '/admin/support/ticket-page-11',
        }),
      ], 21, 10);
    });

    renderPage();

    expect(await screen.findByText('First page support ticket')).toBeInTheDocument();
    expect(screen.queryByText('Resolved support ticket')).not.toBeInTheDocument();

    const supportList = screen.getByRole('heading', { name: 'Support attention' }).closest('article');
    expect(supportList).not.toBeNull();

    fireEvent.click(within(supportList as HTMLElement).getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Second page support ticket')).toBeInTheDocument();
    expect(screen.getByText('Support rows 11-20 of 21')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open ticket' })).toHaveAttribute('href', '/admin/support/ticket-page-11');
    expect(supportAttentionMock).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 10 }));
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
    queueDashboardMock.mockImplementation(async (options) =>
      options?.type === 'awaiting_shipment'
        ? buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)])
        : options?.type === 'return_review'
          ? buildReturnReviewQueueDashboard([], 0)
          : options?.type === 'finance_review'
            ? buildFinanceReviewQueueDashboard([], 0)
            : options?.type === 'finance_integrity_alert'
              ? buildFinanceIntegrityQueueDashboard([], 0)
        : buildQueueDashboard([
            {
              ...buildVendorBlockedQueueItem('#1091', 0),
              title: 'Split allocation awaiting admin resolution',
              splitChildAllocation: true,
            },
          ]),
    );

    renderPage();

    expect(await screen.findAllByText('Split allocation awaiting admin resolution')).toHaveLength(2);
    expect(screen.getAllByText(/Vendor rejected selected line items/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Reason: OUT_OF_STOCK/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Open order' }).some((link) => link.getAttribute('href') === '/admin/orders/7817723773265')).toBe(true);
  });

  it('renders Vendor Blocked as a 10-row server-paginated table without preview controls', async () => {
    const orderNumbers = Array.from({ length: 12 }, (_unused, index) => `#12${String(index + 1).padStart(2, '0')}`);
    attentionMock.mockResolvedValueOnce(buildVendorBlockedPreviewDashboard(orderNumbers));
    queueDashboardMock.mockImplementation(async (options) =>
      options?.type === 'awaiting_shipment'
        ? buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)])
        : options?.type === 'return_review'
          ? buildReturnReviewQueueDashboard([], 0)
          : options?.type === 'finance_review'
            ? buildFinanceReviewQueueDashboard([], 0)
            : options?.type === 'finance_integrity_alert'
              ? buildFinanceIntegrityQueueDashboard([], 0)
        : buildQueueDashboard(orderNumbers.slice(0, 10).map(buildVendorBlockedQueueItem), 12),
    );

    renderPage();

    const vendorBlockedList = await screen.findByRole('heading', { name: 'Vendor Blocked Allocations' }).then((heading) => heading.closest('article'));
    expect(vendorBlockedList).not.toBeNull();
    await waitFor(() => {
      expect(
        within(vendorBlockedList as HTMLElement).getByText(
          (_content, element) =>
            element?.textContent?.replace(/\s+/g, ' ').trim() ===
            'Authoritative vendor-blocked allocations · 1-10 of 12',
        ),
      ).toBeInTheDocument();
    });
    expect(within(vendorBlockedList as HTMLElement).getByText('Vendor Blocked rows 1-10 of 12')).toBeInTheDocument();
    expect(within(vendorBlockedList as HTMLElement).getAllByRole('row')).toHaveLength(11);
    expect(within(vendorBlockedList as HTMLElement).getByText('Order #1201')).toBeInTheDocument();
    expect(within(vendorBlockedList as HTMLElement).getByText('Order #1210')).toBeInTheDocument();
    expect(within(vendorBlockedList as HTMLElement).queryByText('Order #1211')).not.toBeInTheDocument();
    expect(document.querySelector('.vendor-blocked-attention-table')).not.toBeNull();
    expect(screen.queryByLabelText('Vendor Blocked Allocations preview')).not.toBeInTheDocument();
    expect(screen.queryByText('Showing 5 of 12. This section is a preview.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View all vendor-blocked allocations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Vendor-blocked allocations in queue pages' })).not.toBeInTheDocument();
    expect(queueDashboardMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 0, type: 'vendor_blocked' }));
  });

  it('pages Vendor Blocked independently so a #1109-like active allocation remains discoverable outside the first table page', async () => {
    const firstPageOrders = ['#1201', '#1202', '#1203', '#1204', '#1205', '#1206', '#1207', '#1208', '#1209', '#1210'];
    attentionMock.mockResolvedValueOnce(buildVendorBlockedPreviewDashboard([...firstPageOrders, '#1109', '#1212']));
    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard([], 0);
      }
      const offset = options?.offset ?? 0;
      if (offset === 0) {
        return buildQueueDashboard(firstPageOrders.map(buildVendorBlockedQueueItem), 12);
      }

      return buildQueueDashboard([buildVendorBlockedQueueItem('#1109', 10), buildVendorBlockedQueueItem('#1212', 11)], 12);
    });

    renderPage();

    const vendorBlockedList = await screen.findByRole('heading', { name: 'Vendor Blocked Allocations' }).then((heading) => heading.closest('article'));
    expect(vendorBlockedList).not.toBeNull();
    expect(await within(vendorBlockedList as HTMLElement).findByText('Vendor Blocked rows 1-10 of 12')).toBeInTheDocument();
    expect(within(vendorBlockedList as HTMLElement).queryByText('Order #1109')).not.toBeInTheDocument();

    fireEvent.click(within(vendorBlockedList as HTMLElement).getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(
        within(vendorBlockedList as HTMLElement).getByText(
          (_content, element) =>
            element?.tagName.toLowerCase() === 'span' &&
            element.textContent?.replace(/\s+/g, ' ').trim() === 'Vendor Blocked rows 11-12 of 12',
        ),
      ).toBeInTheDocument();
    });
    expect(await within(vendorBlockedList as HTMLElement).findByText('Order #1109')).toBeInTheDocument();
    expect(within(vendorBlockedList as HTMLElement).getAllByRole('link', { name: 'Open order' }).some((link) => link.getAttribute('href') === '/admin/orders/7900000000010')).toBe(true);
    expect(queueDashboardMock).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 10, offset: 10, type: 'vendor_blocked' }));
  });

  it('renders Shipment as an authoritative table without using the attention preview rows', async () => {
    const authoritativeItems = [
      buildShipmentQueueItem('#1302', 2),
      buildShipmentQueueItem('#1301', 1),
    ];
    const shipmentPreviewDashboard: OperationsAttentionDashboard = {
      ...dashboard,
      sections: dashboard.sections.map((section) =>
        section.key === 'shipment'
          ? {
              ...section,
              count: 3,
              critical: 2,
              warning: 1,
              items: [
                {
                  id: 'shipment-preview-only',
                  type: 'shipment',
                  severity: 'critical',
                  vendorId: 'preview-vendor',
                  vendorName: 'Preview Vendor',
                  objectType: 'Shipment',
                  objectReference: 'Order #PREVIEW',
                  objectId: 'shipment-preview-only',
                  status: 'failed',
                  ageHours: 2,
                  title: 'Preview-only shipment row',
                  description: 'This attention row must not render in the Shipment section.',
                  recommendedAction: 'Review shipment status',
                  destinationPath: '/orders/preview-allocation',
                  createdAt: '2026-05-17T08:00:00.000Z',
                },
              ],
            }
          : section,
      ),
    };
    attentionMock.mockResolvedValueOnce(shipmentPreviewDashboard);
    queueDashboardMock.mockImplementation(async (options) =>
      options?.type === 'awaiting_shipment'
        ? buildShipmentQueueDashboard(authoritativeItems, 12)
        : options?.type === 'return_review'
          ? buildReturnReviewQueueDashboard([], 0)
          : options?.type === 'finance_review'
            ? buildFinanceReviewQueueDashboard([], 0)
            : options?.type === 'finance_integrity_alert'
              ? buildFinanceIntegrityQueueDashboard([], 0)
        : buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]),
    );

    renderPage();

    const shipmentList = await screen.findByRole('heading', { name: 'Shipment attention' }).then((heading) => heading.closest('article'));
    expect(shipmentList).not.toBeNull();
    expect(await within(shipmentList as HTMLElement).findByText('Authoritative shipment items · 1-10 of 12')).toBeInTheDocument();
    expect(within(shipmentList as HTMLElement).getByText('Shipment rows 1-10 of 12')).toBeInTheDocument();
    expect(within(shipmentList as HTMLElement).getAllByRole('row')).toHaveLength(3);
    expect(within(shipmentList as HTMLElement).getByText('Order #1302')).toBeInTheDocument();
    expect(within(shipmentList as HTMLElement).getByText('Order #1301')).toBeInTheDocument();
    expect(within(shipmentList as HTMLElement).queryByText('Preview-only shipment row')).not.toBeInTheDocument();
    expect(within(shipmentList as HTMLElement).queryByText(/This section is a preview/)).not.toBeInTheDocument();
    expect(document.querySelector('.shipment-attention-table')).not.toBeNull();
    expect(queueDashboardMock).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10,
      offset: 0,
      type: 'awaiting_shipment',
    }));

    const dataRows = within(shipmentList as HTMLElement).getAllByRole('row').slice(1);
    expect(dataRows[0]).toHaveTextContent('Order #1302');
    expect(dataRows[1]).toHaveTextContent('Order #1301');
  });

  it('pages Shipment independently in both directions and disables controls at page boundaries', async () => {
    attentionMock.mockResolvedValueOnce(dashboard);
    const firstPage = Array.from({ length: 10 }, (_unused, index) => buildShipmentQueueItem(`#13${String(index + 1).padStart(2, '0')}`, index));
    const secondPage = [
      buildShipmentQueueItem('#1311', 10),
      buildShipmentQueueItem('#1312', 11),
    ];
    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard((options.offset ?? 0) === 0 ? firstPage : secondPage, 12);
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard([], 0);
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    renderPage();

    const shipmentList = await screen.findByRole('heading', { name: 'Shipment attention' }).then((heading) => heading.closest('article'));
    expect(shipmentList).not.toBeNull();
    expect(await within(shipmentList as HTMLElement).findByText('Shipment rows 1-10 of 12')).toBeInTheDocument();
    const previous = within(shipmentList as HTMLElement).getByRole('button', { name: 'Previous' });
    const next = within(shipmentList as HTMLElement).getByRole('button', { name: 'Next' });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();

    fireEvent.click(next);

    expect(await within(shipmentList as HTMLElement).findByText('Shipment rows 11-12 of 12')).toBeInTheDocument();
    expect(await within(shipmentList as HTMLElement).findByText('Order #1311')).toBeInTheDocument();
    expect(previous).toBeEnabled();
    expect(next).toBeDisabled();
    expect(queueDashboardMock).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10,
      offset: 10,
      type: 'awaiting_shipment',
    }));
    expect(queueDashboardMock.mock.calls.filter(([options]) => options?.type === 'vendor_blocked').every(([options]) => options?.offset === 0)).toBe(true);
    expect(supportAttentionMock.mock.calls.every(([options]) => options?.offset === 0)).toBe(true);

    fireEvent.click(previous);

    expect(await within(shipmentList as HTMLElement).findByText('Shipment rows 1-10 of 12')).toBeInTheDocument();
    expect(queueDashboardMock.mock.calls.filter(([options]) => options?.type === 'awaiting_shipment').at(-1)?.[0]).toEqual(
      expect.objectContaining({ limit: 10, offset: 0, type: 'awaiting_shipment' }),
    );
  });

  it('renders section-scoped Shipment empty, loading, and error states without preview fallback', async () => {
    attentionMock.mockResolvedValue(dashboard);
    queueDashboardMock.mockImplementation(async (options) =>
      options?.type === 'awaiting_shipment'
        ? buildShipmentQueueDashboard([], 0)
        : options?.type === 'return_review'
          ? buildReturnReviewQueueDashboard([], 0)
        : buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]),
    );

    const emptyRender = renderPage();
    const emptyShipmentList = await screen.findByRole('heading', { name: 'Shipment attention' }).then((heading) => heading.closest('article'));
    expect(emptyShipmentList).not.toBeNull();
    expect(await within(emptyShipmentList as HTMLElement).findByText('No shipment attention items')).toBeInTheDocument();
    expect(within(emptyShipmentList as HTMLElement).queryByText(/Shipment rows 0-0/)).not.toBeInTheDocument();
    expect(within(emptyShipmentList as HTMLElement).queryByText('Shipment pending carrier identifiers')).not.toBeInTheDocument();
    emptyRender.unmount();

    let resolveShipment: ((value: OperationsQueueDashboard) => void) | undefined;
    const pendingShipment = new Promise<OperationsQueueDashboard>((resolve) => {
      resolveShipment = resolve;
    });
    queueDashboardMock.mockImplementation(async (options) =>
      options?.type === 'awaiting_shipment'
        ? pendingShipment
        : options?.type === 'return_review'
          ? buildReturnReviewQueueDashboard([], 0)
          : options?.type === 'finance_review'
            ? buildFinanceReviewQueueDashboard([], 0)
            : options?.type === 'finance_integrity_alert'
              ? buildFinanceIntegrityQueueDashboard([], 0)
        : buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]),
    );

    const loadingRender = renderPage();
    expect(await screen.findByText('Loading shipment attention')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Support attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vendor Blocked Allocations' })).toBeInTheDocument();
    resolveShipment?.(buildShipmentQueueDashboard([], 0));
    loadingRender.unmount();

    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        throw new Error('Shipment queue unavailable');
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard([], 0);
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    renderPage();
    const errorShipmentList = await screen.findByRole('heading', { name: 'Shipment attention' }).then((heading) => heading.closest('article'));
    expect(errorShipmentList).not.toBeNull();
    expect(await within(errorShipmentList as HTMLElement).findByText('Shipment attention unavailable')).toBeInTheDocument();
    expect(within(errorShipmentList as HTMLElement).getByText('Shipment queue unavailable')).toBeInTheDocument();
    expect(within(errorShipmentList as HTMLElement).queryByText('Shipment pending carrier identifiers')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Operational health' })).toBeInTheDocument();
  });

  it('renders Return as an authoritative table without using the attention preview rows', async () => {
    const authoritativeItems = [
      buildReturnReviewQueueItem('return-2', '#1402', 2),
      buildReturnReviewQueueItem('return-1', '#1401', 1),
    ];
    const sectionDisclosureDashboard: OperationsAttentionDashboard = {
      ...dashboard,
      sections: dashboard.sections.map((section) =>
        section.key === 'return'
          ? {
              ...section,
              count: 3,
              critical: 2,
              warning: 1,
              items: [
                {
                  id: 'return-preview-only',
                  type: 'return',
                  severity: 'critical',
                  vendorId: 'preview-vendor',
                  vendorName: 'Preview Vendor',
                  objectType: 'Return',
                  objectReference: 'Order #PREVIEW',
                  objectId: 'return-preview-only',
                  status: 'open',
                  ageHours: 2,
                  title: 'Preview-only return row',
                  description: 'This attention row must not render in the Return section.',
                  recommendedAction: 'Open return',
                  destinationPath: '/returns/preview-return',
                  createdAt: '2026-05-17T08:00:00.000Z',
                },
              ],
            }
          : section,
      ),
      recommendations: [],
      vendorRisks: [],
      recentActivity: [],
    };
    attentionMock.mockResolvedValueOnce(sectionDisclosureDashboard);
    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard(authoritativeItems, 12);
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard([], 0);
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    renderPage();

    const returnList = await screen.findByRole('heading', { name: 'Return review' }).then((heading) => heading.closest('article'));
    expect(returnList).not.toBeNull();
    expect(await within(returnList as HTMLElement).findByText('Authoritative return review items · 1-10 of 12')).toBeInTheDocument();
    expect(within(returnList as HTMLElement).getByText('Return rows 1-10 of 12')).toBeInTheDocument();
    expect(within(returnList as HTMLElement).getAllByRole('row')).toHaveLength(3);
    expect(within(returnList as HTMLElement).getByText('op-refund-return-2')).toBeInTheDocument();
    expect(within(returnList as HTMLElement).getByText('op-refund-return-1')).toBeInTheDocument();
    expect(within(returnList as HTMLElement).queryByText('Preview-only return row')).not.toBeInTheDocument();
    expect(within(returnList as HTMLElement).queryByText(/This section is a preview/)).not.toBeInTheDocument();
    expect(document.querySelector('.return-review-attention-table')).not.toBeNull();
    expect(queueDashboardMock).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10,
      offset: 0,
      type: 'return_review',
    }));
    expect(within(returnList as HTMLElement).getAllByRole('link', { name: 'Open return' }).map((link) => link.getAttribute('href'))).toEqual([
      '/returns/return-2',
      '/returns/return-1',
    ]);
    const dataRows = within(returnList as HTMLElement).getAllByRole('row').slice(1);
    expect(dataRows[0]).toHaveTextContent('op-refund-return-2');
    expect(dataRows[1]).toHaveTextContent('op-refund-return-1');
  });

  it('pages Return independently while preserving one row per ReturnRecord', async () => {
    attentionMock.mockResolvedValueOnce(dashboard);
    const firstPage = Array.from({ length: 10 }, (_unused, index) =>
      buildReturnReviewQueueItem(`return-${index + 1}`, `#14${String(index + 1).padStart(2, '0')}`, index, {
        relatedShopifyOrderNumber: '#1450',
      }),
    );
    const secondPage = [
      buildReturnReviewQueueItem('return-11', '#1450', 10, { relatedShopifyOrderNumber: '#1450' }),
      buildReturnReviewQueueItem('return-12', '#1450', 11, { relatedShopifyOrderNumber: '#1450' }),
    ];
    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard((options.offset ?? 0) === 0 ? firstPage : secondPage, 12);
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard([], 0);
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    renderPage();

    const returnList = await screen.findByRole('heading', { name: 'Return review' }).then((heading) => heading.closest('article'));
    expect(returnList).not.toBeNull();
    expect(await within(returnList as HTMLElement).findByText('Return rows 1-10 of 12')).toBeInTheDocument();
    expect(within(returnList as HTMLElement).getAllByRole('row')).toHaveLength(11);
    expect(within(returnList as HTMLElement).getAllByText('Order #1450').length).toBe(10);
    const previous = within(returnList as HTMLElement).getByRole('button', { name: 'Previous' });
    const next = within(returnList as HTMLElement).getByRole('button', { name: 'Next' });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();

    fireEvent.click(next);

    expect(await within(returnList as HTMLElement).findByText('Return rows 11-12 of 12')).toBeInTheDocument();
    expect(await within(returnList as HTMLElement).findByText('op-refund-return-11')).toBeInTheDocument();
    expect(await within(returnList as HTMLElement).findByText('op-refund-return-12')).toBeInTheDocument();
    expect(previous).toBeEnabled();
    expect(next).toBeDisabled();
    expect(queueDashboardMock).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10,
      offset: 10,
      type: 'return_review',
    }));
    expect(queueDashboardMock.mock.calls.filter(([options]) => options?.type === 'vendor_blocked').every(([options]) => options?.offset === 0)).toBe(true);
    expect(queueDashboardMock.mock.calls.filter(([options]) => options?.type === 'awaiting_shipment').every(([options]) => options?.offset === 0)).toBe(true);
    expect(supportAttentionMock.mock.calls.every(([options]) => options?.offset === 0)).toBe(true);

    fireEvent.click(previous);

    expect(await within(returnList as HTMLElement).findByText('Return rows 1-10 of 12')).toBeInTheDocument();
    expect(queueDashboardMock.mock.calls.filter(([options]) => options?.type === 'return_review').at(-1)?.[0]).toEqual(
      expect.objectContaining({ limit: 10, offset: 0, type: 'return_review' }),
    );
  });

  it('renders section-scoped Return empty, loading, and error states without preview fallback', async () => {
    const returnPreviewDashboard: OperationsAttentionDashboard = {
      ...dashboard,
      sections: dashboard.sections.map((section) =>
        section.key === 'return'
          ? {
              ...section,
              count: 1,
              critical: 1,
              warning: 0,
              items: [
                {
                  id: 'return-preview-only',
                  type: 'return',
                  severity: 'critical',
                  vendorId: 'preview-vendor',
                  vendorName: 'Preview Vendor',
                  objectType: 'Return',
                  objectReference: 'Order #PREVIEW',
                  objectId: 'return-preview-only',
                  status: 'open',
                  ageHours: 2,
                  title: 'Preview-only return row',
                  description: 'This attention row must not render in the Return section.',
                  recommendedAction: 'Open return',
                  destinationPath: '/returns/preview-return',
                  createdAt: '2026-05-17T08:00:00.000Z',
                },
              ],
            }
          : section,
      ),
    };
    attentionMock.mockResolvedValue(returnPreviewDashboard);
    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard([], 0);
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    const emptyRender = renderPage();
    const emptyReturnList = await screen.findByRole('heading', { name: 'Return review' }).then((heading) => heading.closest('article'));
    expect(emptyReturnList).not.toBeNull();
    expect(await within(emptyReturnList as HTMLElement).findByText('No return review items')).toBeInTheDocument();
    expect(within(emptyReturnList as HTMLElement).queryByText(/Return rows 0-0/)).not.toBeInTheDocument();
    expect(within(emptyReturnList as HTMLElement).queryByText('Preview-only return row')).not.toBeInTheDocument();
    emptyRender.unmount();

    let resolveReturnReview: ((value: OperationsQueueDashboard) => void) | undefined;
    const pendingReturnReview = new Promise<OperationsQueueDashboard>((resolve) => {
      resolveReturnReview = resolve;
    });
    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        return pendingReturnReview;
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard([], 0);
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    const loadingRender = renderPage();
    expect(await screen.findByText('Loading return review')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Support attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vendor Blocked Allocations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shipment attention' })).toBeInTheDocument();
    resolveReturnReview?.(buildReturnReviewQueueDashboard([], 0));
    loadingRender.unmount();

    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        throw new Error('Return queue unavailable');
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard([], 0);
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    renderPage();
    const errorReturnList = await screen.findByRole('heading', { name: 'Return review' }).then((heading) => heading.closest('article'));
    expect(errorReturnList).not.toBeNull();
    expect(await within(errorReturnList as HTMLElement).findByText('Return review unavailable')).toBeInTheDocument();
    expect(within(errorReturnList as HTMLElement).getByText('Return queue unavailable')).toBeInTheDocument();
    expect(within(errorReturnList as HTMLElement).queryByText('Preview-only return row')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Operational health' })).toBeInTheDocument();
  });

  it('renders Finance Review as an authoritative table without using the attention preview rows', async () => {
    const authoritativeItems = [
      buildFinanceReviewQueueItem('ledger-review-2', '#1602', 2, {
        financeReviewReason: 'Disputed settlement needs operator review.',
        financeReviewAmount: '2400.00',
        payoutStatus: 'PENDING',
        settlementStatus: 'DISPUTED',
        status: 'disputed',
      }),
      buildFinanceReviewQueueItem('ledger-review-1', '#1601', 1, {
        financeReviewReason: 'Vendor payout is on hold.',
        financeReviewAmount: '4584.35',
        payoutStatus: 'HOLD',
        settlementStatus: 'HELD',
        status: 'hold',
      }),
    ];
    const financePreviewDashboard: OperationsAttentionDashboard = {
      ...dashboard,
      sections: dashboard.sections.map((section) =>
        section.key === 'finance'
          ? {
              ...section,
              count: 3,
              critical: 2,
              warning: 1,
              items: [
                {
                  id: 'finance-preview-only',
                  type: 'finance',
                  severity: 'critical',
                  vendorId: 'preview-vendor',
                  vendorName: 'Preview Vendor',
                  objectType: 'Finance',
                  objectReference: 'Order #PREVIEW',
                  objectId: 'finance-preview-only',
                  status: 'review',
                  ageHours: 2,
                  title: 'Preview-only finance row',
                  description: 'This attention row must not render in the Finance Review section.',
                  recommendedAction: 'Review finance',
                  destinationPath: '/admin/finance',
                  createdAt: '2026-05-17T08:00:00.000Z',
                },
              ],
            }
          : section,
      ),
    };
    attentionMock.mockResolvedValueOnce(financePreviewDashboard);
    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard(authoritativeItems, 12);
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard([], 0);
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    renderPage();

    const financeReviewList = await screen.findByRole('heading', { name: 'Finance Review' }).then((heading) => heading.closest('article'));
    expect(financeReviewList).not.toBeNull();
    expect(await within(financeReviewList as HTMLElement).findByText('Held and disputed finance entries requiring operator review')).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).queryByText('Held and disputed finance entries requiring operator review · 1-10 of 12')).not.toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByText('Finance Review rows 1-10 of 12')).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getAllByRole('row')).toHaveLength(3);
    expect(within(financeReviewList as HTMLElement).getByRole('columnheader', { name: 'Payout' })).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByRole('columnheader', { name: 'Settlement' })).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByRole('columnheader', { name: 'Order' })).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByRole('columnheader', { name: 'Vendor' })).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByRole('columnheader', { name: 'Reason' })).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByRole('columnheader', { name: 'Age' })).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).queryByRole('columnheader', { name: 'Action' })).not.toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).queryByText('ledger-review-2')).not.toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).queryByText('ledger-review-1')).not.toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByText('Pending')).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByText('Hold')).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByText('Disputed')).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByText('Held')).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).queryByText('Finance review')).not.toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByText('Disputed settlement needs operator review.')).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByText('Vendor payout is on hold.')).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByTitle('Disputed settlement needs operator review.')).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).queryByText('Payout review needed')).not.toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByText('2,400.00')).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByText('4,584.35')).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).queryByText(/TRY|TL|₺/)).not.toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByText('Order #1602')).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getByText('Order #1601')).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).queryByText('alloc-finance-review-2')).not.toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).queryByText('alloc-finance-review-1')).not.toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getAllByText('Sporjinal').length).toBeGreaterThan(0);
    expect(within(financeReviewList as HTMLElement).queryByText('sporjinal')).not.toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getAllByText(/\d+d|<1h|\d+h/).length).toBeGreaterThan(0);
    expect(within(financeReviewList as HTMLElement).queryByText(/May \d+, 2026/)).not.toBeInTheDocument();
    expect((financeReviewList as HTMLElement).querySelector('[title*="May "]')).not.toBeNull();
    expect(within(financeReviewList as HTMLElement).queryByRole('link', { name: 'Review finance' })).not.toBeInTheDocument();
    expect(document.querySelector('.finance-review-attention-table')).not.toBeNull();
    expect(within(financeReviewList as HTMLElement).queryByText('Preview-only finance row')).not.toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).queryByText(/This section is a preview/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Finance Integrity' })).toBeInTheDocument();
    expect(queueDashboardMock).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10,
      offset: 0,
      type: 'finance_review',
    }));
  });

  it('pages Finance Review independently with authoritative totals and boundary controls', async () => {
    attentionMock.mockResolvedValueOnce(dashboard);
    const firstPage = Array.from({ length: 10 }, (_unused, index) =>
      buildFinanceReviewQueueItem(`ledger-page-${index + 1}`, '#1601', index, {
        relatedShopifyOrderNumber: '#1601',
      }),
    );
    const secondPage = [
      buildFinanceReviewQueueItem('ledger-page-11', '#1601', 10),
      buildFinanceReviewQueueItem('ledger-page-12', '#1601', 11),
    ];
    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard((options.offset ?? 0) === 0 ? firstPage : secondPage, 12);
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard([], 0);
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    renderPage();

    const financeReviewList = await screen.findByRole('heading', { name: 'Finance Review' }).then((heading) => heading.closest('article'));
    expect(financeReviewList).not.toBeNull();
    expect(await within(financeReviewList as HTMLElement).findByText('Finance Review rows 1-10 of 12')).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).getAllByRole('row')).toHaveLength(11);
    const previous = within(financeReviewList as HTMLElement).getByRole('button', { name: 'Previous' });
    const next = within(financeReviewList as HTMLElement).getByRole('button', { name: 'Next' });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();

    fireEvent.click(next);

    expect(await within(financeReviewList as HTMLElement).findByText('Finance Review rows 11-12 of 12')).toBeInTheDocument();
    expect(await within(financeReviewList as HTMLElement).findByText('Ledger is disputed.')).toBeInTheDocument();
    expect(within(financeReviewList as HTMLElement).queryByText('ledger-page-11')).not.toBeInTheDocument();
    expect(previous).toBeEnabled();
    expect(next).toBeDisabled();
    expect(queueDashboardMock).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10,
      offset: 10,
      type: 'finance_review',
    }));
    expect(queueDashboardMock.mock.calls.filter(([options]) => options?.type === 'vendor_blocked').every(([options]) => options?.offset === 0)).toBe(true);
    expect(queueDashboardMock.mock.calls.filter(([options]) => options?.type === 'awaiting_shipment').every(([options]) => options?.offset === 0)).toBe(true);
    expect(queueDashboardMock.mock.calls.filter(([options]) => options?.type === 'return_review').every(([options]) => options?.offset === 0)).toBe(true);
    expect(queueDashboardMock.mock.calls.filter(([options]) => options?.type === 'finance_integrity_alert').every(([options]) => options?.offset === 0)).toBe(true);
    expect(supportAttentionMock.mock.calls.every(([options]) => options?.offset === 0)).toBe(true);

    fireEvent.click(previous);

    expect(await within(financeReviewList as HTMLElement).findByText('Finance Review rows 1-10 of 12')).toBeInTheDocument();
    expect(queueDashboardMock.mock.calls.filter(([options]) => options?.type === 'finance_review').at(-1)?.[0]).toEqual(
      expect.objectContaining({ limit: 10, offset: 0, type: 'finance_review' }),
    );
  });

  it('renders section-scoped Finance Review empty, loading, and error states without preview fallback', async () => {
    const financePreviewDashboard: OperationsAttentionDashboard = {
      ...dashboard,
      sections: dashboard.sections.map((section) =>
        section.key === 'finance'
          ? {
              ...section,
              count: 1,
              critical: 1,
              warning: 0,
              items: [
                {
                  id: 'finance-preview-only',
                  type: 'finance',
                  severity: 'critical',
                  vendorId: 'preview-vendor',
                  vendorName: 'Preview Vendor',
                  objectType: 'Finance',
                  objectReference: 'Order #PREVIEW',
                  objectId: 'finance-preview-only',
                  status: 'review',
                  ageHours: 2,
                  title: 'Preview-only finance row',
                  description: 'This attention row must not render in the Finance Review section.',
                  recommendedAction: 'Review finance',
                  destinationPath: '/admin/finance',
                  createdAt: '2026-05-17T08:00:00.000Z',
                },
              ],
            }
          : section,
      ),
    };
    attentionMock.mockResolvedValue(financePreviewDashboard);
    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard([], 0);
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    const emptyRender = renderPage();
    const emptyFinanceReviewList = await screen.findByRole('heading', { name: 'Finance Review' }).then((heading) => heading.closest('article'));
    expect(emptyFinanceReviewList).not.toBeNull();
    expect(await within(emptyFinanceReviewList as HTMLElement).findByText('No finance review items')).toBeInTheDocument();
    expect(within(emptyFinanceReviewList as HTMLElement).queryByText(/Finance Review rows 0-0/)).not.toBeInTheDocument();
    expect(within(emptyFinanceReviewList as HTMLElement).queryByText('Preview-only finance row')).not.toBeInTheDocument();
    emptyRender.unmount();

    let resolveFinanceReview: ((value: OperationsQueueDashboard) => void) | undefined;
    const pendingFinanceReview = new Promise<OperationsQueueDashboard>((resolve) => {
      resolveFinanceReview = resolve;
    });
    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_review') {
        return pendingFinanceReview;
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard([], 0);
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    const loadingRender = renderPage();
    expect(await screen.findByText('Loading finance review')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Support attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vendor Blocked Allocations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shipment attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Return review' })).toBeInTheDocument();
    resolveFinanceReview?.(buildFinanceReviewQueueDashboard([], 0));
    loadingRender.unmount();

    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_review') {
        throw new Error('Finance review queue unavailable');
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard([], 0);
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    renderPage();
    const errorFinanceReviewList = await screen.findByRole('heading', { name: 'Finance Review' }).then((heading) => heading.closest('article'));
    expect(errorFinanceReviewList).not.toBeNull();
    expect(await within(errorFinanceReviewList as HTMLElement).findByText('Finance review unavailable')).toBeInTheDocument();
    expect(within(errorFinanceReviewList as HTMLElement).getByText('Finance review queue unavailable')).toBeInTheDocument();
    expect(within(errorFinanceReviewList as HTMLElement).queryByText('Preview-only finance row')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Finance Integrity' })).toBeInTheDocument();
  });

  it('renders Finance Integrity as an authoritative table using structured diagnostic fields', async () => {
    const authoritativeItems = [
      buildFinanceIntegrityQueueItem('fin-alert-2', '#1501', 2, {
        financeIntegrityCategory: 'missing_active_sale_ledger',
        financeIntegrityReason: 'no_active_sale_ledger',
        vendorAllocationId: 'alloc-finance-same-order-a',
        allocationEconomicTransferId: 'transfer-finance-same-order-a',
        relatedShopifyOrderId: '7970000001501',
        relatedShopifyOrderNumber: '#1501',
        actionTo: '/admin/orders/7970000001501',
      }),
      buildFinanceIntegrityQueueItem('fin-alert-1', '#1501', 1, {
        financeIntegrityCategory: 'voided_sale_ledger_without_successor',
        financeIntegrityReason: 'voided_sale_ledger_without_successor',
        vendorAllocationId: 'alloc-finance-same-order-b',
        allocationEconomicTransferId: 'transfer-finance-same-order-b',
        relatedShopifyOrderId: '7970000001501',
        relatedShopifyOrderNumber: '#1501',
        actionTo: '/admin/orders/7970000001501',
      }),
      buildFinanceIntegrityQueueItem('fin-alert-no-number', null, 3, {
        relatedShopifyOrderId: '7970000001503',
        relatedShopifyOrderNumber: undefined,
        vendorAllocationId: 'alloc-finance-fallback',
        allocationEconomicTransferId: null,
        actionTo: '/admin/orders/7970000001503',
      }),
    ];
    const sectionDisclosureDashboard: OperationsAttentionDashboard = {
      ...dashboard,
      sections: [
        {
          key: 'finance',
          title: 'Finance review',
          count: 3,
          critical: 2,
          warning: 1,
          items: [
            {
              id: 'finance-current-page',
              type: 'finance',
              severity: 'critical',
              vendorId: 'sporjinal',
              vendorName: 'Sporjinal',
              objectType: 'Finance',
              objectReference: 'Order #1501',
              objectId: 'finance-1501',
              status: 'review',
              ageHours: 2,
              title: 'Preview-only finance row',
              description: 'Finance review is pending.',
              recommendedAction: 'Review finance',
              destinationPath: '/admin/finance',
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
    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard(authoritativeItems, 12);
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    renderPage();

    const financeList = await screen.findByRole('heading', { name: 'Finance Integrity' }).then((heading) => heading.closest('article'));
    expect(financeList).not.toBeNull();
    expect(await within(financeList as HTMLElement).findByText('Authoritative finance integrity alerts · 1-10 of 12')).toBeInTheDocument();
    expect(within(financeList as HTMLElement).getByText('Finance rows 1-10 of 12')).toBeInTheDocument();
    expect(within(financeList as HTMLElement).getAllByRole('row')).toHaveLength(4);
    expect(within(financeList as HTMLElement).getByText('fin-alert-2')).toBeInTheDocument();
    expect(within(financeList as HTMLElement).getByText('fin-alert-1')).toBeInTheDocument();
    expect(within(financeList as HTMLElement).getByText('fin-alert-no-number')).toBeInTheDocument();
    expect(within(financeList as HTMLElement).getByText('Missing Active Sale Ledger')).toBeInTheDocument();
    expect(within(financeList as HTMLElement).getAllByText('voided_sale_ledger_without_successor').length).toBeGreaterThan(0);
    expect(within(financeList as HTMLElement).getByText('no_active_sale_ledger')).toBeInTheDocument();
    expect(within(financeList as HTMLElement).getAllByText('Order #1501')).toHaveLength(2);
    expect(within(financeList as HTMLElement).getByText('Shopify order 7970000001503')).toBeInTheDocument();
    expect(within(financeList as HTMLElement).getByText('Allocation alloc-finance-same-order-a')).toBeInTheDocument();
    expect(within(financeList as HTMLElement).getByText('Transfer transfer-finance-same-order-a')).toBeInTheDocument();
    expect(within(financeList as HTMLElement).getAllByText('Sporjinal').length).toBeGreaterThan(0);
    expect(within(financeList as HTMLElement).getByText('Open')).toBeInTheDocument();
    expect(within(financeList as HTMLElement).getAllByText('Acknowledged').length).toBeGreaterThan(0);
    expect(within(financeList as HTMLElement).getAllByRole('link', { name: 'Review' }).map((link) => link.getAttribute('href'))).toEqual([
      '/admin/orders/7970000001501',
      '/admin/orders/7970000001501',
      '/admin/orders/7970000001503',
    ]);
    expect(document.querySelector('.finance-integrity-attention-table')).not.toBeNull();
    expect(document.querySelector('.finance-integrity-mobile-card')).toBeNull();
    expect(within(financeList as HTMLElement).queryByText('Preview-only finance row')).not.toBeInTheDocument();
    expect(within(financeList as HTMLElement).queryByText(/This section is a preview/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Return review' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View all vendor-blocked allocations' })).not.toBeInTheDocument();
    expect(queueDashboardMock).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10,
      offset: 0,
      type: 'finance_integrity_alert',
    }));

    const dataRows = within(financeList as HTMLElement).getAllByRole('row').slice(1);
    expect(dataRows[0]).toHaveTextContent('fin-alert-2');
    expect(dataRows[1]).toHaveTextContent('fin-alert-1');
    expect(dataRows[2]).toHaveTextContent('fin-alert-no-number');
  });

  it('pages Finance Integrity independently with authoritative totals and boundary controls', async () => {
    attentionMock.mockResolvedValueOnce(dashboard);
    const firstPage = Array.from({ length: 10 }, (_unused, index) =>
      buildFinanceIntegrityQueueItem(`finance-page-${index + 1}`, '#1501', index, {
        relatedShopifyOrderNumber: '#1501',
      }),
    );
    const secondPage = [
      buildFinanceIntegrityQueueItem('finance-page-11', '#1501', 10),
      buildFinanceIntegrityQueueItem('finance-page-12', '#1501', 11),
    ];
    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard((options.offset ?? 0) === 0 ? firstPage : secondPage, 12);
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    renderPage();

    const financeList = await screen.findByRole('heading', { name: 'Finance Integrity' }).then((heading) => heading.closest('article'));
    expect(financeList).not.toBeNull();
    expect(await within(financeList as HTMLElement).findByText('Finance rows 1-10 of 12')).toBeInTheDocument();
    expect(within(financeList as HTMLElement).getAllByRole('row')).toHaveLength(11);
    const previous = within(financeList as HTMLElement).getByRole('button', { name: 'Previous' });
    const next = within(financeList as HTMLElement).getByRole('button', { name: 'Next' });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();

    fireEvent.click(next);

    expect(await within(financeList as HTMLElement).findByText('Finance rows 11-12 of 12')).toBeInTheDocument();
    expect(await within(financeList as HTMLElement).findByText('finance-page-11')).toBeInTheDocument();
    expect(previous).toBeEnabled();
    expect(next).toBeDisabled();
    expect(queueDashboardMock).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10,
      offset: 10,
      type: 'finance_integrity_alert',
    }));
    expect(queueDashboardMock.mock.calls.filter(([options]) => options?.type === 'vendor_blocked').every(([options]) => options?.offset === 0)).toBe(true);
    expect(queueDashboardMock.mock.calls.filter(([options]) => options?.type === 'awaiting_shipment').every(([options]) => options?.offset === 0)).toBe(true);
    expect(queueDashboardMock.mock.calls.filter(([options]) => options?.type === 'return_review').every(([options]) => options?.offset === 0)).toBe(true);
    expect(supportAttentionMock.mock.calls.every(([options]) => options?.offset === 0)).toBe(true);

    fireEvent.click(previous);

    expect(await within(financeList as HTMLElement).findByText('Finance rows 1-10 of 12')).toBeInTheDocument();
    expect(queueDashboardMock.mock.calls.filter(([options]) => options?.type === 'finance_integrity_alert').at(-1)?.[0]).toEqual(
      expect.objectContaining({ limit: 10, offset: 0, type: 'finance_integrity_alert' }),
    );
  });

  it('renders section-scoped Finance empty, loading, and error states without preview fallback', async () => {
    const financePreviewDashboard: OperationsAttentionDashboard = {
      ...dashboard,
      sections: dashboard.sections.map((section) =>
        section.key === 'finance'
          ? {
              ...section,
              count: 1,
              critical: 1,
              warning: 0,
              items: [
                {
                  id: 'finance-preview-only',
                  type: 'finance',
                  severity: 'critical',
                  vendorId: 'preview-vendor',
                  vendorName: 'Preview Vendor',
                  objectType: 'Finance',
                  objectReference: 'Order #PREVIEW',
                  objectId: 'finance-preview-only',
                  status: 'review',
                  ageHours: 2,
                  title: 'Preview-only finance row',
                  description: 'This attention row must not render in the Finance section.',
                  recommendedAction: 'Review finance',
                  destinationPath: '/admin/finance',
                  createdAt: '2026-05-17T08:00:00.000Z',
                },
              ],
            }
          : section,
      ),
    };
    attentionMock.mockResolvedValue(financePreviewDashboard);
    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_integrity_alert') {
        return buildFinanceIntegrityQueueDashboard([], 0);
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    const emptyRender = renderPage();
    const emptyFinanceList = await screen.findByRole('heading', { name: 'Finance Integrity' }).then((heading) => heading.closest('article'));
    expect(emptyFinanceList).not.toBeNull();
    expect(await within(emptyFinanceList as HTMLElement).findByText('No finance integrity alerts')).toBeInTheDocument();
    expect(within(emptyFinanceList as HTMLElement).queryByText(/Finance rows 0-0/)).not.toBeInTheDocument();
    expect(within(emptyFinanceList as HTMLElement).queryByText('Preview-only finance row')).not.toBeInTheDocument();
    emptyRender.unmount();

    let resolveFinanceIntegrity: ((value: OperationsQueueDashboard) => void) | undefined;
    const pendingFinanceIntegrity = new Promise<OperationsQueueDashboard>((resolve) => {
      resolveFinanceIntegrity = resolve;
    });
    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_integrity_alert') {
        return pendingFinanceIntegrity;
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    const loadingRender = renderPage();
    expect(await screen.findByText('Loading finance integrity')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Support attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vendor Blocked Allocations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shipment attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Return review' })).toBeInTheDocument();
    resolveFinanceIntegrity?.(buildFinanceIntegrityQueueDashboard([], 0));
    loadingRender.unmount();

    queueDashboardMock.mockImplementation(async (options) => {
      if (options?.type === 'awaiting_shipment') {
        return buildShipmentQueueDashboard([buildShipmentQueueItem('#1028', 0)]);
      }
      if (options?.type === 'return_review') {
        return buildReturnReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_review') {
        return buildFinanceReviewQueueDashboard([], 0);
      }
      if (options?.type === 'finance_integrity_alert') {
        throw new Error('Finance queue unavailable');
      }
      return buildQueueDashboard([buildVendorBlockedQueueItem('#1091', 0)]);
    });

    renderPage();
    const errorFinanceList = await screen.findByRole('heading', { name: 'Finance Integrity' }).then((heading) => heading.closest('article'));
    expect(errorFinanceList).not.toBeNull();
    expect(await within(errorFinanceList as HTMLElement).findByText('Finance integrity unavailable')).toBeInTheDocument();
    expect(within(errorFinanceList as HTMLElement).getByText('Finance queue unavailable')).toBeInTheDocument();
    expect(within(errorFinanceList as HTMLElement).queryByText('Preview-only finance row')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Operational health' })).toBeInTheDocument();
  });

  it('keeps stale attention data visible and shows a warning when background refresh fails', async () => {
    attentionMock.mockResolvedValueOnce(dashboard);

    renderPage();

    expect((await screen.findAllByText('Order #1091')).length).toBeGreaterThan(0);
    attentionMock.mockRejectedValueOnce(new Error('Backend temporarily unavailable'));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByText(/Could not refresh/i)).toBeInTheDocument();
    expect(screen.getAllByText('Order #1091').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
