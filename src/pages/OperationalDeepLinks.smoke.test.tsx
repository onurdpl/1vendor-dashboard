import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderDetail, OrderSummary } from '../features/orders/api';
import type { ReturnDetail, ReturnSummary } from '../features/returns/api';
import type { FinanceDashboard, FinanceTransaction, ReturnFinanceRecordsResponse } from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';
import { FinancePage } from './FinancePage';
import { OrderDetailPage } from './OrderDetailPage';
import { OrdersPage } from './OrdersPage';
import { ReturnDetailPage } from './ReturnDetailPage';
import { ReturnsPage } from './ReturnsPage';

const listOrdersMock = vi.fn<(options?: { vendorId?: string | null }) => Promise<OrderSummary[]>>();
const getOrderMock = vi.fn<(orderId: string, options?: { vendorId?: string | null }) => Promise<OrderDetail>>();
const listReturnsMock = vi.fn<(options?: { vendorId?: string | null }) => Promise<ReturnSummary[]>>();
const getReturnMock = vi.fn<(returnId: string, options?: { vendorId?: string | null }) => Promise<ReturnDetail>>();
const getFinanceDashboardMock = vi.fn<(options?: { vendorId?: string | null }) => Promise<FinanceDashboard>>();
const getReturnFinanceRecordsMock = vi.fn<() => Promise<ReturnFinanceRecordsResponse>>();
const listAdminSupportTicketsMock = vi.fn();
const listVendorSupportTicketsMock = vi.fn();

vi.mock('../features/orders/api', async () => {
  const actual = await vi.importActual<typeof import('../features/orders/api')>('../features/orders/api');
  return {
    ...actual,
    listOrders: (options?: { vendorId?: string | null }) => listOrdersMock(options),
    getOrder: (orderId: string, options?: { vendorId?: string | null }) => getOrderMock(orderId, options),
    getShippingProviderDiagnostics: vi.fn(),
    createShipmentExecution: vi.fn(),
    retryShipmentExecution: vi.fn(),
    submitFulfillmentTracking: vi.fn(),
  };
});

vi.mock('../features/returns/api', async () => {
  const actual = await vi.importActual<typeof import('../features/returns/api')>('../features/returns/api');
  return {
    ...actual,
    listReturns: (options?: { vendorId?: string | null }) => listReturnsMock(options),
    getReturn: (returnId: string, options?: { vendorId?: string | null }) => getReturnMock(returnId, options),
    markReturnReceived: vi.fn(),
    reviewReturn: vi.fn(),
  };
});

vi.mock('../features/finance/api', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/api')>('../features/finance/api');
  return {
    ...actual,
    getFinanceDashboard: (options?: { vendorId?: string | null }) => getFinanceDashboardMock(options),
    getReturnFinanceRecords: () => getReturnFinanceRecordsMock(),
    attachShippingCost: vi.fn(),
    preparePayoutBatch: vi.fn(),
    updateVendorFinancialProfile: vi.fn(),
  };
});

vi.mock('../features/support/api', async () => {
  const actual = await vi.importActual<typeof import('../features/support/api')>('../features/support/api');
  return {
    ...actual,
    listAdminSupportTickets: () => listAdminSupportTicketsMock(),
    listVendorSupportTickets: () => listVendorSupportTicketsMock(),
    createSupportTicket: vi.fn(),
  };
});

const vendorId = 'demo-vendor-a';

function orderFixture(overrides: Partial<OrderDetail>): OrderDetail {
  const id = overrides.id ?? 'alloc-order';
  const sourceShopifyOrderNumber = overrides.sourceShopifyOrderNumber ?? '#1001';
  const sourceShopifyOrderId = overrides.sourceShopifyOrderId ?? 'gid://shopify/Order/1001';

  return {
    originalVendorId: vendorId,
    assignedVendorId: vendorId,
    vendorId,
    id,
    sourceShopifyOrderId,
    sourceShopifyOrderNumber,
    status: 'Processing',
    allocationStatus: 'active',
    reassignmentRequired: false,
    assignmentHistory: [],
    fulfillmentActionState: 'awaiting_shipment',
    fulfillmentActionAvailable: true,
    fulfillmentStatus: 'Processing',
    shippingStatus: 'Awaiting Shipment',
    date: '2026-05-15T10:00:00Z',
    customer: 'Customer unavailable',
    amount: '$100.00',
    channel: 'Shopify',
    shippingAddress: 'Unknown',
    notes: '—',
    lineItems: [
      {
        originalVendorId: vendorId,
        assignedVendorId: vendorId,
        vendorId,
        id: `${id}-line`,
        sku: `${id}-sku`,
        variantTitle: 'Standard',
        name: 'Deep-link product',
        quantity: 1,
        price: '$100.00',
        fulfillmentStatus: 'Processing',
        allocationStatus: 'active',
        reassignmentRequired: false,
        fulfillmentActionState: 'awaiting_shipment',
        fulfillmentActionAvailable: true,
        shippingStatus: 'Awaiting Shipment',
      },
    ],
    items: [],
    timeline: [{ label: 'Order received', at: '2026-05-15T10:00:00Z' }],
    ...overrides,
  };
}

function returnFixture(overrides: Partial<ReturnDetail>): ReturnDetail {
  const id = overrides.id ?? 'return-1001';
  const sourceShopifyOrderNumber = overrides.sourceShopifyOrderNumber ?? '#1001';

  return {
    originalVendorId: vendorId,
    assignedVendorId: vendorId,
    vendorId,
    id,
    sourceShopifyOrderId: 'gid://shopify/Order/1001',
    sourceShopifyOrderNumber,
    sourceShopifyRefundId: '',
    sourceShopifyReturnId: 'gid://shopify/Return/1001',
    sourceType: 'shopify_return_request',
    status: 'Requested',
    relatedOrderId: 'alloc-order-1001',
    date: '2026-05-15T11:00:00Z',
    updatedAt: '2026-05-15T11:10:00Z',
    customer: 'Customer unavailable',
    reason: 'Return requested',
    returnCarrierName: null,
    returnTrackingNumber: null,
    returnTrackingUrl: null,
    amount: '$0.00',
    itemTitle: 'Returned item',
    displayTitle: 'Returned item',
    variantTitle: 'Standard',
    refundedSkus: ['RET-SKU'],
    resolution: 'Return requested',
    refundMethod: 'Pending',
    processedBy: 'Shopify',
    refundedItems: [
      {
        originalVendorId: vendorId,
        assignedVendorId: vendorId,
        vendorId,
        id: `${id}-line`,
        sku: 'RET-SKU',
        variantTitle: 'Standard',
        name: 'Returned item',
        quantity: 1,
        condition: 'Opened',
        refundAmount: '$0.00',
      },
    ],
    items: [],
    timeline: [{ label: 'Return requested', at: '2026-05-15T11:00:00Z' }],
    ...overrides,
  };
}

const firstOrder = orderFixture({
  id: 'alloc-first',
  sourceShopifyOrderId: 'gid://shopify/Order/1001',
  sourceShopifyOrderNumber: '#1001',
  customer: 'First order customer',
  amount: '$101.00',
});

const targetOrder = orderFixture({
  id: 'alloc-target-1030',
  sourceShopifyOrderId: 'gid://shopify/Order/7616544244030',
  sourceShopifyOrderNumber: '#1030',
  customer: 'Target order customer',
  amount: 'TRY 1,030.00',
});

const firstReturn = returnFixture({
  id: 'return-first',
  sourceShopifyOrderId: 'gid://shopify/Order/1001',
  sourceShopifyOrderNumber: '#1001',
  sourceShopifyRefundId: 'gid://shopify/Refund/501',
  sourceType: 'shopify_refund',
  status: 'Processed',
  amount: '$50.00',
  itemTitle: 'First returned item',
  displayTitle: 'First returned item',
});

const targetReturn = returnFixture({
  id: 'return-target-1031',
  sourceShopifyOrderId: 'gid://shopify/Order/1031',
  sourceShopifyOrderNumber: '#1031',
  sourceShopifyRefundId: 'gid://shopify/Refund/777',
  sourceShopifyReturnId: 'gid://shopify/Return/888',
  sourceType: 'shopify_refund',
  status: 'Processed',
  relatedOrderId: 'alloc-return-order-1031',
  amount: '$77.00',
  itemTitle: 'Target returned item',
  displayTitle: 'Target returned item',
  refundedSkus: ['RET-1031'],
  refundedItems: [
    {
      originalVendorId: vendorId,
      assignedVendorId: vendorId,
      vendorId,
      id: 'target-return-line',
      sku: 'RET-1031',
      variantTitle: 'Target variant',
      name: 'Target returned item',
      quantity: 1,
      condition: 'Opened',
      refundAmount: '$77.00',
    },
  ],
});

const firstFinanceRow: FinanceTransaction = {
  id: 'ledger-first',
  date: '2026-05-15T09:00:00Z',
  description: 'First visible sale',
  counterparty: 'Shopify',
  category: 'Invoice',
  amount: '$101.00',
  status: 'Recorded',
  shopifyOrderNumber: '1001',
  shopifyOrderId: 'gid://shopify/Order/1001',
};

const targetSaleFinanceRow: FinanceTransaction = {
  id: 'ledger-sale-1030',
  date: '2026-05-15T10:00:00Z',
  description: 'Target order sale',
  counterparty: 'Shopify',
  category: 'Invoice',
  amount: 'TRY 1,030.00',
  status: 'Recorded',
  shopifyOrderNumber: '1030',
  shopifyOrderId: 'gid://shopify/Order/999999999',
};

const targetRefundFinanceRow: FinanceTransaction = {
  id: 'ledger-refund-1031',
  date: '2026-05-15T11:00:00Z',
  description: 'Target return refund',
  counterparty: 'Shopify',
  category: 'Refund',
  amount: '$77.00',
  status: 'Recorded',
  shopifyOrderNumber: '1031',
  shopifyOrderId: 'gid://shopify/Order/1031',
  shopifyRefundId: 'gid://shopify/Refund/777',
};

const financeDashboard: FinanceDashboard = {
  summary: {
    grossSales: 'TRY 1,131.00',
    refunds: '$77.00',
    netRevenue: 'TRY 1,054.00',
    platformFee: '$0.00',
    payoutEstimate: 'TRY 1,054.00',
    totalRevenue: 'TRY 1,131.00',
    availableBalance: 'TRY 1,054.00',
    pendingPayouts: '$0.00',
    refundsThisMonth: '$77.00',
  },
  profile: {
    vendorId,
    commissionPercent: '10.00',
    commissionVatPercent: '0.00',
    deductShippingEnabled: false,
    shippingMode: 'disabled',
    fixedShippingFee: null,
    settlementDelayDays: 21,
    settlementFrequencyType: 'WEEKLY',
    weeklySettlementDay: 'WEDNESDAY',
    monthlySettlementDay: 28,
    autoSettlementDraftEnabled: false,
    autoSettlementApproveEnabled: false,
    autoSettlementInvoiceEnabled: false,
    active: true,
    source: 'default',
  },
  payoutBatchSummary: {
    eligibleRowCount: 1,
    eligibleNetAmount: 'TRY 1,030.00',
    blockedRowCount: 0,
    latestBatch: null,
  },
  transactions: [firstFinanceRow, targetSaleFinanceRow, targetRefundFinanceRow],
};

function toOrderSummary(detail: OrderDetail): OrderSummary {
  const {
    shippingAddress: _shippingAddress,
    notes: _notes,
    lineItems: _lineItems,
    items: _items,
    timeline: _timeline,
    shipmentExecution: _shipmentExecution,
    ...summary
  } = detail;
  return summary;
}

function toReturnSummary(detail: ReturnDetail): ReturnSummary {
  const {
    resolution: _resolution,
    refundMethod: _refundMethod,
    processedBy: _processedBy,
    items: _items,
    timeline: _timeline,
    ...summary
  } = detail;
  return summary;
}

function renderOperationalRoutes(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
          <Route path="/returns" element={<ReturnsPage />} />
          <Route path="/returns/:returnId" element={<ReturnDetailPage />} />
          <Route path="/finance" element={<FinancePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setupApiMocks() {
  listOrdersMock.mockResolvedValue([toOrderSummary(firstOrder), toOrderSummary(targetOrder)]);
  getOrderMock.mockImplementation(async (orderId) => {
    if (orderId === targetOrder.id) {
      return targetOrder;
    }
    return firstOrder;
  });
  listReturnsMock.mockResolvedValue([toReturnSummary(firstReturn), toReturnSummary(targetReturn)]);
  getReturnMock.mockImplementation(async (returnId) => {
    if (returnId === targetReturn.id) {
      return targetReturn;
    }
    return firstReturn;
  });
  getFinanceDashboardMock.mockResolvedValue(financeDashboard);
  getReturnFinanceRecordsMock.mockResolvedValue({
    records: [
      {
        id: targetRefundFinanceRow.id,
        category: targetRefundFinanceRow.category,
        amount: targetRefundFinanceRow.amount,
        status: targetRefundFinanceRow.status,
        date: targetRefundFinanceRow.date,
      },
    ],
  });
  listAdminSupportTicketsMock.mockResolvedValue([]);
  listVendorSupportTicketsMock.mockResolvedValue([]);
}

function getLinkedRecordAnchor(label: string) {
  const anchor = screen
    .getAllByText(label)
    .map((node) => node.closest('a'))
    .find((link): link is HTMLAnchorElement => Boolean(link));

  expect(anchor).toBeDefined();
  return anchor;
}

async function findLinkedRecordAnchor(label: string) {
  await screen.findByText(label);
  return getLinkedRecordAnchor(label);
}

describe('operational deep-link smoke navigation', () => {
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
    getFinanceDashboardMock.mockReset();
    getReturnFinanceRecordsMock.mockReset();
    listAdminSupportTicketsMock.mockReset();
    listVendorSupportTicketsMock.mockReset();
    setupApiMocks();
  });

  it('navigates Order Detail → Finance linked record and selects the correct finance row', async () => {
    const user = userEvent.setup();

    renderOperationalRoutes(`/orders/${targetOrder.id}`);

    await screen.findByRole('heading', { name: 'Order #1030' });
    await user.click(await findLinkedRecordAnchor('Settlement activity'));

    expect(await screen.findByRole('heading', { name: 'Order #1030' })).toBeInTheDocument();
    expect((await screen.findAllByText('TRY 1,030.00')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Recorded').length).toBeGreaterThan(0);
    expect(getFinanceDashboardMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId }));
  });

  it('navigates Return Detail → Finance linked record and selects the correct refund row', async () => {
    const user = userEvent.setup();

    renderOperationalRoutes(`/returns/${targetReturn.id}`);

    await screen.findByRole('heading', { name: 'Return request' });
    await user.click(await findLinkedRecordAnchor('Refund impact'));

    expect(await screen.findByRole('heading', { name: 'Order #1031' })).toBeInTheDocument();
    expect((await screen.findAllByText('-$77.00')).length).toBeGreaterThan(0);
    expect(getFinanceDashboardMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId }));
  });

  it('navigates Finance linked Order to Orders workspace and selects the target order', async () => {
    const user = userEvent.setup();

    renderOperationalRoutes(`/finance?ledgerId=${targetSaleFinanceRow.id}`);

    await screen.findByRole('heading', { name: 'Order #1030' });
    const linkedOrder = getLinkedRecordAnchor('Order #1030');
    expect(linkedOrder).toHaveAttribute(
      'href',
      '/orders?order=1030&shopifyOrderId=gid%3A%2F%2Fshopify%2FOrder%2F999999999',
    );
    await user.click(linkedOrder);

    await waitFor(() => expect(getOrderMock).toHaveBeenCalledWith(targetOrder.id, expect.objectContaining({ vendorId })));
    expect((await screen.findAllByText('Target order customer')).length).toBeGreaterThan(0);
    expect(getOrderMock).not.toHaveBeenCalledWith(firstOrder.id, expect.objectContaining({ vendorId }));
  });

  it('navigates Finance linked Return to Returns workspace and selects the target return', async () => {
    const user = userEvent.setup();

    renderOperationalRoutes(`/finance?ledgerId=${targetRefundFinanceRow.id}`);

    await screen.findByRole('heading', { name: 'Order #1031' });
    await user.click(getLinkedRecordAnchor('Related return'));

    await waitFor(() => expect(getReturnMock).toHaveBeenCalledWith(targetReturn.id, expect.objectContaining({ vendorId })));
    expect((await screen.findAllByText('Target returned item')).length).toBeGreaterThan(0);
    expect(getReturnMock).not.toHaveBeenCalledWith(firstReturn.id, expect.objectContaining({ vendorId }));
  });

  it('shows unavailable for missing Finance deep-link targets without selecting the first row', async () => {
    renderOperationalRoutes('/finance?ledgerId=missing-ledger');

    expect(await screen.findByText('Linked finance record unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Order #1001' })).not.toBeInTheDocument();
    expect(screen.queryByText('Customer invoice/accounting')).not.toBeInTheDocument();
  });
});
