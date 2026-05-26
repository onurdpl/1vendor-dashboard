import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { setCurrentUser, setToken } from '../lib/auth';
import type { FinanceDashboard, OrderDetail, OrderSummary, ReturnDetail, ReturnSummary, SupportTicket } from '../lib/api/contracts';

const listOrdersMock = vi.fn<() => Promise<OrderSummary[]>>();
const getOrderMock = vi.fn<(orderId: string) => Promise<OrderDetail>>();
const listReturnsMock = vi.fn<() => Promise<ReturnSummary[]>>();
const getReturnMock = vi.fn<(returnId: string) => Promise<ReturnDetail>>();
const listVendorSupportTicketsMock = vi.fn<() => Promise<SupportTicket[]>>();
const getFinanceDashboardMock = vi.fn<() => Promise<FinanceDashboard>>();

vi.mock('../features/orders/api', async () => {
  const actual = await vi.importActual<typeof import('../features/orders/api')>('../features/orders/api');
  return {
    ...actual,
    listOrders: () => listOrdersMock(),
    getOrder: (orderId: string) => getOrderMock(orderId),
  };
});

vi.mock('../features/returns/api', async () => {
  const actual = await vi.importActual<typeof import('../features/returns/api')>('../features/returns/api');
  return {
    ...actual,
    listReturns: () => listReturnsMock(),
    getReturn: (returnId: string) => getReturnMock(returnId),
  };
});

vi.mock('../features/support/api', async () => {
  const actual = await vi.importActual<typeof import('../features/support/api')>('../features/support/api');
  return {
    ...actual,
    listVendorSupportTickets: () => listVendorSupportTicketsMock(),
  };
});

vi.mock('../features/finance/api', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/api')>('../features/finance/api');
  return {
    ...actual,
    getFinanceDashboard: () => getFinanceDashboardMock(),
  };
});

const malformedDate = 'not-a-real-date';
const vendorId = 'demo-vendor-a';

const orderSummary = {
  id: 'order-unstable-date',
  originalVendorId: vendorId,
  assignedVendorId: vendorId,
  vendorId,
  sourceShopifyOrderId: 'gid://shopify/Order/1001',
  sourceShopifyOrderNumber: '#1001',
  status: 'Active',
  allocationStatus: 'active',
  reassignmentRequired: false,
  assignmentHistory: [],
  fulfillmentActionState: 'pending',
  fulfillmentActionAvailable: true,
  fulfillmentStatus: 'Unfulfilled',
  shippingStatus: 'Awaiting Shipment',
  trackingNumber: undefined,
  carrier: undefined,
  lineItemCount: 1,
  date: malformedDate,
  customer: 'Customer unavailable',
  amount: 'TRY 100.00',
  channel: 'Shopify',
} satisfies OrderSummary;

const orderDetail = {
  ...orderSummary,
  shippingAddress: 'Hidden',
  notes: '',
  lineItems: [],
  items: [],
  timeline: [{ label: 'Order received', at: malformedDate }],
} satisfies OrderDetail;

const returnSummary = {
  id: 'return-unstable-date',
  originalVendorId: vendorId,
  assignedVendorId: vendorId,
  vendorId,
  sourceShopifyOrderId: 'gid://shopify/Order/1001',
  sourceShopifyOrderNumber: 1001,
  sourceShopifyRefundId: '',
  sourceShopifyReturnId: 'gid://shopify/Return/2001',
  sourceType: 'shopify_return_request',
  status: 'Requested',
  relatedOrderId: 'order-unstable-date',
  date: malformedDate,
  updatedAt: malformedDate,
  customer: 'Customer unavailable',
  reason: 'Return requested',
  returnCarrierName: null,
  returnTrackingNumber: null,
  returnTrackingUrl: null,
  amount: 'TRY 0.00',
  refundedSkus: ['SKU-1'],
  resolution: 'Pending',
  refundMethod: 'Pending',
  processedBy: 'Shopify',
  refundedItems: [],
  items: [],
  timeline: [{ label: 'Return requested', at: malformedDate }],
} satisfies ReturnDetail;

const supportTicket = {
  id: 'ticket-unstable-date',
  createdAt: malformedDate,
  updatedAt: malformedDate,
  createdByUserId: 'vendor-user',
  createdByRole: 'VENDOR',
  vendorId,
  vendorName: 'Demo Vendor A',
  subject: 'Help with order',
  message: 'Shipment needs review.',
  priority: 'normal',
  status: 'WAITING_FOR_VENDOR',
  category: 'SHIPMENT',
  assigneeUserId: null,
  assigneeName: null,
  vendorUnreadCount: 1,
  adminUnreadCount: 0,
  lastReplyAt: malformedDate,
  lastReplyByRole: 'ADMIN',
  firstResponseDueAt: null,
  nextResponseDueAt: null,
  escalatedAt: null,
  escalationReason: null,
  sla: null,
  contextType: 'order',
  contextId: orderSummary.id,
  contextSummary: { orderNumber: '#1001' },
  resolvedAt: null,
  closedAt: null,
} satisfies SupportTicket;

const financeDashboard = {
  summary: [],
  transactions: [],
  vendorProfile: null,
  reconciliation: [],
  payoutBatch: null,
  invoiceExecutions: [],
  settlementExecutions: [],
  settlementRecommendations: [],
  invoiceRecommendations: [],
  manualReviewQueue: [],
  summaryCards: [],
} as unknown as FinanceDashboard;

function renderRoute(route: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('operational route render stability', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: [vendorId],
      vendorDetails: [{ vendorId, vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: vendorId,
    });
    listOrdersMock.mockReset();
    getOrderMock.mockReset();
    listReturnsMock.mockReset();
    getReturnMock.mockReset();
    listVendorSupportTicketsMock.mockReset();
    getFinanceDashboardMock.mockReset();
    listOrdersMock.mockResolvedValue([orderSummary]);
    getOrderMock.mockResolvedValue(orderDetail);
    listReturnsMock.mockResolvedValue([returnSummary]);
    getReturnMock.mockResolvedValue(returnSummary);
    listVendorSupportTicketsMock.mockResolvedValue([supportTicket]);
    getFinanceDashboardMock.mockResolvedValue(financeDashboard);
  });

  it.each([
    ['/orders', 'Orders'],
    ['/returns', 'Return requests'],
    ['/support/inbox', 'Communication center'],
    ['/support', 'Vendor Support Requests'],
  ])('renders %s without crashing on malformed timestamps', async (route, heading) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      renderRoute(route);

      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: 'This section could not load' })).not.toBeInTheDocument();
      });
      expect(consoleError.mock.calls.some((call) => call[0] === '[client-render-error]')).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});
