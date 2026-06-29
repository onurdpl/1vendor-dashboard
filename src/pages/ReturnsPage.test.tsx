import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReturnsPage } from './ReturnsPage';
import type { ReturnDetail, ReturnSummary } from '../features/returns/api';
import { clearToken, setCurrentUser, setToken } from '../lib/auth';

const listReturnsMock = vi.fn<(options?: { vendorId?: string | null }) => Promise<ReturnSummary[]>>();
const getReturnMock = vi.fn<(returnId: string, options?: { vendorId?: string | null }) => Promise<ReturnDetail>>();

vi.mock('../features/returns/api', async () => {
  const actual = await vi.importActual<typeof import('../features/returns/api')>('../features/returns/api');
  return {
    ...actual,
    listReturns: (options?: { vendorId?: string | null }) => listReturnsMock(options),
    getReturn: (returnId: string, options?: { vendorId?: string | null }) => getReturnMock(returnId, options),
  };
});

const pendingReturn: ReturnDetail = {
  id: 'RET-A-REQUEST-1001',
  originalVendorId: 'demo-vendor-a',
  assignedVendorId: 'demo-vendor-a',
  vendorId: 'demo-vendor-a',
  sourceShopifyOrderId: 'gid://shopify/Order/1001',
  sourceShopifyOrderNumber: 1001,
  sourceShopifyRefundId: '',
  sourceShopifyReturnId: 'gid://shopify/Return/9001',
  sourceType: 'shopify_return_request',
  status: 'Requested',
  relatedOrderId: 'ORD-A-1001',
  date: '2026-05-10T08:20:00Z',
  updatedAt: '2026-05-10T08:32:00Z',
  customer: 'Acme Supply Co.',
  reason: 'Customer requested a return.',
  returnCarrierName: null,
  returnTrackingNumber: null,
  returnTrackingUrl: null,
  vendorReceivedAt: null,
  vendorReviewedAt: null,
  vendorDecision: null,
  amount: '$0.00',
  refundedSkus: ['SKU-A-1'],
  resolution: 'Pending merchant review.',
  refundMethod: 'Pending return request',
  processedBy: 'Shopify return lifecycle webhook ingestion via backend',
  refundedItems: [
    {
      id: 'line-a-1',
      originalVendorId: 'demo-vendor-a',
      assignedVendorId: 'demo-vendor-a',
      vendorId: 'demo-vendor-a',
      sku: 'SKU-A-1',
      variantTitle: 'Medium',
      name: 'Wireless label printer',
      imageUrl: 'https://cdn.example.com/wireless-label-printer.png',
      quantity: 1,
      condition: 'Opened',
      refundAmount: '$0.00',
    },
  ],
  items: [],
  timeline: [
    { label: 'Return requested', at: '2026-05-10T08:20:00Z' },
    { label: 'Awaiting review', at: '2026-05-10T08:32:00Z' },
  ],
};

const processedRefund: ReturnDetail = {
  id: 'RET-A-REFUND-1002',
  originalVendorId: 'demo-vendor-a',
  assignedVendorId: 'demo-vendor-a',
  vendorId: 'demo-vendor-a',
  sourceShopifyOrderId: 'gid://shopify/Order/1002',
  sourceShopifyOrderNumber: 1002,
  sourceShopifyRefundId: 'gid://shopify/Refund/5002',
  sourceShopifyReturnId: null,
  sourceType: 'shopify_refund',
  status: 'Processed',
  relatedOrderId: 'ORD-A-1002',
  date: '2026-05-09T15:10:00Z',
  updatedAt: '2026-05-09T16:18:00Z',
  customer: 'Northwind Retail',
  reason: 'Refund processed from Shopify.',
  returnCarrierName: null,
  returnTrackingNumber: null,
  returnTrackingUrl: null,
  amount: '$650.00',
  refundedSkus: ['SKU-A-2', 'SKU-A-3'],
  resolution: 'Refund processed.',
  refundMethod: 'Original payment method',
  processedBy: 'Shopify webhook ingestion via backend',
  refundedItems: [
    {
      id: 'line-a-2',
      originalVendorId: 'demo-vendor-a',
      assignedVendorId: 'demo-vendor-a',
      vendorId: 'demo-vendor-a',
      sku: 'SKU-A-2',
      variantTitle: 'Standard',
      name: 'Barcode gateway license',
      quantity: 1,
      condition: 'Damaged',
      refundAmount: '$650.00',
    },
  ],
  items: [],
  timeline: [
    { label: 'Refund received', at: '2026-05-09T15:10:00Z' },
    { label: 'Refund completed', at: '2026-05-09T16:18:00Z' },
  ],
};

const awaitingReviewReturn: ReturnDetail = {
  ...pendingReturn,
  id: 'RET-A-AWAITING-1071',
  sourceShopifyOrderNumber: 1071,
  status: 'Awaiting Review',
  vendorReceivedAt: '2026-05-11T10:00:00Z',
  vendorReviewedAt: null,
  vendorDecision: null,
  timeline: [
    { label: 'Return requested', at: '2026-05-10T08:20:00Z' },
    { label: 'Received by vendor', at: '2026-05-11T10:00:00Z' },
    { label: 'Awaiting review', at: '2026-05-10T08:32:00Z' },
  ],
};

const receivedNeedsActionReturn: ReturnDetail = {
  ...pendingReturn,
  id: 'RET-A-RECEIVED-1072',
  sourceShopifyOrderNumber: 1072,
  vendorReceivedAt: '2026-05-11T10:00:00Z',
  vendorReviewedAt: null,
  vendorDecision: null,
  timeline: [
    { label: 'Return requested', at: '2026-05-10T08:20:00Z' },
    { label: 'Received by vendor', at: '2026-05-11T10:00:00Z' },
  ],
};

const approvedRefundPendingReturn: ReturnDetail = {
  ...pendingReturn,
  id: 'RET-A-APPROVED-1099',
  sourceShopifyOrderNumber: 1099,
  status: 'Approved',
  sourceShopifyRefundId: '',
  vendorReceivedAt: '2026-06-21T10:00:00Z',
  vendorReviewedAt: '2026-06-21T10:05:00Z',
  vendorDecision: 'approved',
  timeline: [
    { label: 'Return requested', at: '2026-06-20T10:00:00Z' },
    { label: 'Received by vendor', at: '2026-06-21T10:00:00Z' },
    { label: 'Approved by vendor', at: '2026-06-21T10:05:00Z' },
  ],
};

const closedRefundedReturnRequest: ReturnDetail = {
  ...pendingReturn,
  id: 'RET-A-CLOSED-1098',
  sourceShopifyOrderNumber: 1098,
  sourceShopifyRefundId: 'gid://shopify/Refund/1098',
  status: 'Closed',
  amount: '$4099.00',
  reason: 'Return closed after refund.',
  resolution: 'Refund processed.',
  vendorReceivedAt: '2026-06-20T10:00:00Z',
  vendorReviewedAt: '2026-06-20T10:05:00Z',
  vendorDecision: 'approved',
  timeline: [
    { label: 'Return requested', at: '2026-06-19T10:00:00Z' },
    { label: 'Refund processed', at: '2026-06-20T10:10:00Z' },
  ],
};

const refundedUnreviewedReturnRequest: ReturnDetail = {
  ...closedRefundedReturnRequest,
  id: 'RET-A-REFUNDED-1096',
  sourceShopifyOrderNumber: 1096,
  status: 'Refunded',
  returnLifecycleStatus: 'Refunded',
  vendorReceivedAt: null,
  vendorReviewedAt: null,
  vendorDecision: null,
};

const otherVendorReturn: ReturnDetail = {
  ...processedRefund,
  id: 'RET-B-REFUND-1002',
  assignedVendorId: 'demo-vendor-b',
  vendorId: 'demo-vendor-b',
  customer: 'Cobalt Logistics',
  refundedSkus: ['SKU-B-1'],
};

const nestedProductReturn = {
  ...pendingReturn,
  id: 'RET-A-REQUEST-1018',
  sourceShopifyOrderNumber: 1018,
  refundedItems: [
    {
      id: 'line-a-nested',
      originalVendorId: 'demo-vendor-a',
      assignedVendorId: 'demo-vendor-a',
      vendorId: 'demo-vendor-a',
      sku: 'SKU-NESTED',
      variantTitle: 'Return item',
      name: 'Return item',
      quantity: 1,
      condition: 'Opened',
      refundAmount: '$0.00',
      merchandise: {
        product: {
          title: 'Nested product trainer',
        },
        title: 'Nested variant name',
      },
    },
  ],
} as ReturnDetail;

function toSummary(detail: ReturnDetail): ReturnSummary {
  const { resolution: _resolution, refundMethod: _refundMethod, processedBy: _processedBy, items: _items, timeline: _timeline, ...summary } = detail;
  return summary;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderReturnsPage(initialEntries = ['/returns']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <ReturnsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function ReturnsNavigationHarness({ target }: { target: string }) {
  const navigate = useNavigate();

  return (
    <>
      <button type="button" onClick={() => navigate(target)}>
        Navigate to linked return
      </button>
      <ReturnsPage />
    </>
  );
}

function renderReturnsNavigationHarness(target: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/returns']}>
        <ReturnsNavigationHarness target={target} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReturnsPage control center', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a', 'demo-vendor-b'],
      vendorDetails: [
        { vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' },
        { vendorId: 'demo-vendor-b', vendorName: 'Demo Vendor B' },
      ],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    listReturnsMock.mockReset();
    getReturnMock.mockReset();
  });

  it('renders filters and table frame before return data hydrates', async () => {
    const returnsResult = deferred<ReturnSummary[]>();
    listReturnsMock.mockReturnValue(returnsResult.promise);

    const { container } = renderReturnsPage();

    expect(screen.getByRole('heading', { name: /return requests/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search returns by order, return #, customer or SKU...')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Order' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Returned items' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Return status' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'SKU' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
    expect(container.querySelector('.op-skeleton-row')).not.toBeNull();
    expect(screen.queryByText('Returns unavailable')).not.toBeInTheDocument();

    await act(async () => {
      returnsResult.resolve([]);
      await returnsResult.promise;
    });
  });

  it('renders missing vendor context as a terminal state instead of skeleton rows', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: [],
      vendorDetails: [],
      canSwitchVendors: true,
      defaultVendorId: '',
    });

    const { container } = renderReturnsPage();

    expect(await screen.findByText('Select vendor')).toBeInTheDocument();
    expect(screen.getByText('No vendor context available. Choose a vendor context before loading vendor-scoped returns.')).toBeInTheDocument();
    expect(container.querySelector('.op-skeleton-row')).toBeNull();
    expect(listReturnsMock).not.toHaveBeenCalled();
  });

  it('renders waiting vendor context as diagnostic UI instead of stale skeleton rows', async () => {
    clearToken();

    const { container } = renderReturnsPage();

    expect(await screen.findByText('Waiting for vendor context')).toBeInTheDocument();
    expect(screen.getByText('Returns will load after the authenticated vendor scope is ready.')).toBeInTheDocument();
    expect(container.querySelector('.op-skeleton-row')).toBeNull();
    expect(listReturnsMock).not.toHaveBeenCalled();
  });

  it('renders an error state for failed enabled return queries', async () => {
    listReturnsMock.mockRejectedValue(new Error('Returns API unavailable.'));

    renderReturnsPage();

    expect(await screen.findByText('Returns unavailable')).toBeInTheDocument();
    expect(screen.getByText('Returns API unavailable.')).toBeInTheDocument();
    expect(listReturnsMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' }));
  });

  it('renders pending return requests separately from processed refunds', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn), toSummary(processedRefund)]);
    getReturnMock.mockImplementation(async (returnId) => (returnId === processedRefund.id ? processedRefund : pendingReturn));

    renderReturnsPage();

    expect(await screen.findByRole('heading', { name: /return requests/i })).toBeInTheDocument();
    expect(listReturnsMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' }));
    expect((await screen.findAllByText('Return requested')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Wireless label printer').length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: 'Wireless label printer product image' })).toHaveAttribute(
      'src',
      'https://cdn.example.com/wireless-label-printer.png',
    );
    expect(screen.getAllByText(/SKU-A-1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 item returned').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refunded').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refund pending').length).toBeGreaterThan(0);
    expect(screen.queryByText('Included in payout calculations')).not.toBeInTheDocument();
    expect(screen.queryByText('Refund amount')).not.toBeInTheDocument();
    expect(screen.queryByText(/Return item1 item/)).not.toBeInTheDocument();
    expect(screen.queryByText('1 item')).not.toBeInTheDocument();
  });

  it('renders multiple returned items in the table row and keeps the full sidebar list', async () => {
    const multiItemReturn: ReturnDetail = {
      ...pendingReturn,
      id: 'RET-A-MULTI-1097',
      sourceShopifyOrderNumber: 1097,
      refundedSkus: ['JX1275-L', 'SKU-MULTI-2'],
      refundedItems: [
        {
          ...pendingReturn.refundedItems[0],
          id: 'line-multi-1',
          sku: 'JX1275-L',
          name: 'Running shoe',
          variantTitle: 'Black / 42',
        },
        {
          ...pendingReturn.refundedItems[0],
          id: 'line-multi-2',
          sku: 'SKU-MULTI-2',
          name: 'Training sock',
          variantTitle: 'White / M',
        },
      ],
    };
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(multiItemReturn),
        refundedItemCount: 2,
      } as ReturnSummary,
    ]);
    getReturnMock.mockResolvedValue(multiItemReturn);

    const { container } = renderReturnsPage();
    const table = within(container.querySelector('.returns-op-table') as HTMLElement);

    expect(await table.findByText('#1097')).toBeInTheDocument();
    expect(table.getByText('2 items returned')).toBeInTheDocument();
    const firstTitleLine = table.getByText('Running shoe / Black / 42');
    expect(firstTitleLine).toBeInTheDocument();
    expect(firstTitleLine).not.toHaveTextContent('JX1275-L');
    expect(table.getByText('SKU: JX1275-L')).toBeInTheDocument();
    expect(table.getByText('Training sock / White / M')).toBeInTheDocument();
    expect(table.getByText('SKU: SKU-MULTI-2')).toBeInTheDocument();

    const returnedItemsSection = (await screen.findByRole('heading', { name: 'Returned items' })).closest('.op-panel-section');
    expect(returnedItemsSection).not.toBeNull();
    const sidebar = within(returnedItemsSection as HTMLElement);
    expect(sidebar.getByText('Running shoe')).toBeInTheDocument();
    expect(sidebar.getByText('Training sock')).toBeInTheDocument();
  });

  it('summarizes additional returned items after the first two table previews', async () => {
    const threeItemReturn: ReturnDetail = {
      ...pendingReturn,
      id: 'RET-A-MULTI-1098',
      sourceShopifyOrderNumber: 1098,
      refundedSkus: ['SKU-MORE-1', 'SKU-MORE-2', 'SKU-MORE-3'],
      refundedItems: [
        {
          ...pendingReturn.refundedItems[0],
          id: 'line-more-1',
          sku: 'SKU-MORE-1',
          name: 'First returned item',
          variantTitle: 'Black',
        },
        {
          ...pendingReturn.refundedItems[0],
          id: 'line-more-2',
          sku: 'SKU-MORE-2',
          name: 'Second returned item',
          variantTitle: 'White',
        },
        {
          ...pendingReturn.refundedItems[0],
          id: 'line-more-3',
          sku: 'SKU-MORE-3',
          name: 'Third returned item',
          variantTitle: 'Blue',
        },
      ],
    };
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(threeItemReturn),
        refundedItemCount: 3,
      } as ReturnSummary,
    ]);
    getReturnMock.mockResolvedValue(threeItemReturn);

    const { container } = renderReturnsPage();
    const table = within(container.querySelector('.returns-op-table') as HTMLElement);

    expect(await table.findByText('#1098')).toBeInTheDocument();
    expect(table.getByText('3 items returned')).toBeInTheDocument();
    expect(table.getByText('First returned item / Black')).toBeInTheDocument();
    expect(table.getByText('Second returned item / White')).toBeInTheDocument();
    expect(table.getByText('+1 more items')).toBeInTheDocument();
    expect(table.queryByText('Third returned item')).not.toBeInTheDocument();
  });

  it('uses workflow query params to open pending return review and allows reset', async () => {
    listReturnsMock.mockResolvedValue([
      toSummary(pendingReturn),
      toSummary(receivedNeedsActionReturn),
      toSummary(processedRefund),
      toSummary(closedRefundedReturnRequest),
    ]);
    getReturnMock.mockImplementation(async (returnId) => {
      if (returnId === processedRefund.id) return processedRefund;
      if (returnId === closedRefundedReturnRequest.id) return closedRefundedReturnRequest;
      if (returnId === receivedNeedsActionReturn.id) return receivedNeedsActionReturn;
      return pendingReturn;
    });

    renderReturnsPage(['/returns?workflow=pending-review']);

    const workflowTabs = await screen.findByLabelText('Returns workflow tabs');
    expect(within(workflowTabs).getByRole('button', { name: /Needs Action/i })).toHaveClass('is-active');
    expect((await screen.findAllByText('Wireless label printer')).length).toBeGreaterThan(0);
    expect(await screen.findByText('#1072')).toBeInTheDocument();
    expect(screen.queryByText('#1001')).not.toBeInTheDocument();
    expect(screen.queryByText('Barcode gateway license')).not.toBeInTheDocument();
    expect(screen.queryByText('#1098')).not.toBeInTheDocument();

    await userEvent.click(within(workflowTabs).getByRole('button', { name: /^All/i }));

    expect(await screen.findByText(/Barcode gateway license/)).toBeInTheDocument();
    expect(await screen.findByText('#1098')).toBeInTheDocument();
  });

  it('renders an honest empty state for empty return workflow queues', async () => {
    listReturnsMock.mockResolvedValue([toSummary(processedRefund), toSummary(closedRefundedReturnRequest)]);
    getReturnMock.mockResolvedValue(processedRefund);

    renderReturnsPage(['/returns?workflow=pending-review']);

    expect(await screen.findByText('No received returns need action')).toBeInTheDocument();
    expect(screen.getByText('Received returns that still need approval, rejection, or processing will appear here.')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Returns workflow tabs')).getByRole('button', { name: /Needs Action/i })).toHaveClass('is-active');
    expect(screen.getByText('No return selected')).toBeInTheDocument();
    expect(screen.queryByLabelText('Workflow action guidance')).not.toBeInTheDocument();
  });

  it('separates pre-arrival requested returns from received returns needing action', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn), toSummary(receivedNeedsActionReturn)]);
    getReturnMock.mockImplementation(async (returnId) => (returnId === receivedNeedsActionReturn.id ? receivedNeedsActionReturn : pendingReturn));

    renderReturnsPage();

    const workflowTabs = await screen.findByLabelText('Returns workflow tabs');
    expect(await screen.findByText('#1001')).toBeInTheDocument();
    expect(await screen.findByText('#1072')).toBeInTheDocument();
    await waitFor(() => expect(within(workflowTabs).getByRole('button', { name: /Requested/i })).toHaveTextContent('1'));
    expect(within(workflowTabs).getByRole('button', { name: /Needs Action/i })).toHaveTextContent('1');

    await userEvent.click(within(workflowTabs).getByRole('button', { name: /Requested/i }));
    expect(await screen.findByText('#1001')).toBeInTheDocument();
    expect(screen.queryByText('#1072')).not.toBeInTheDocument();

    await userEvent.click(within(workflowTabs).getByRole('button', { name: /Needs Action/i }));
    expect(await screen.findByText('#1072')).toBeInTheDocument();
    expect(screen.queryByText('#1001')).not.toBeInTheDocument();
  });

  it('shows closed refunded Shopify return requests in the refunded filter, not pending review', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn), toSummary(receivedNeedsActionReturn), toSummary(closedRefundedReturnRequest)]);
    getReturnMock.mockImplementation(async (returnId) =>
      returnId === closedRefundedReturnRequest.id
        ? closedRefundedReturnRequest
        : returnId === receivedNeedsActionReturn.id
          ? receivedNeedsActionReturn
          : pendingReturn,
    );

    renderReturnsPage();

    expect(await screen.findByText('#1098')).toBeInTheDocument();

    const workflowTabs = screen.getByLabelText('Returns workflow tabs');
    await userEvent.click(within(workflowTabs).getByRole('button', { name: /Needs Action/i }));
    expect((await screen.findAllByText('Wireless label printer')).length).toBeGreaterThan(0);
    expect(await screen.findByText('#1072')).toBeInTheDocument();
    expect(screen.queryByText('#1001')).not.toBeInTheDocument();
    expect(screen.queryByText('#1098')).not.toBeInTheDocument();

    await userEvent.click(within(workflowTabs).getByRole('button', { name: /Refunded/i }));
    expect(await screen.findByText('#1098')).toBeInTheDocument();
    expect(screen.queryByText('#1001')).not.toBeInTheDocument();
  });

  it('projects closed refunded returns as completed in the right rail with no review action', async () => {
    listReturnsMock.mockResolvedValue([toSummary(closedRefundedReturnRequest)]);
    getReturnMock.mockResolvedValue(closedRefundedReturnRequest);

    renderReturnsPage();

    expect(await screen.findByText('#1098')).toBeInTheDocument();
    expect(screen.getAllByText('Closed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refunded').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent('Return completed');
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent('Refund is complete. No vendor action is required.');
    expect(screen.queryByRole('link', { name: 'Review return' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contact support' })).toBeInTheDocument();

    const timeline = screen.getByRole('heading', { name: 'Timeline' }).closest('.op-panel-section');
    expect(timeline).toBeTruthy();
    expect(within(timeline as HTMLElement).getByText('Return requested')).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText('Received by vendor')).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText('Approved by vendor')).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText('Refund processed')).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText('Closed')).toBeInTheDocument();

    const workflowTabs = screen.getByLabelText('Returns workflow tabs');
    expect(within(workflowTabs).getByRole('button', { name: /Needs Action/i })).toHaveTextContent('0');
    expect(within(workflowTabs).getByRole('button', { name: /Refunded/i })).toHaveTextContent('1');
    expect(within(workflowTabs).getByRole('button', { name: /^All/i })).toHaveTextContent('1');
  });

  it('projects refunded returns without vendor review as completed in the right rail with no review action', async () => {
    listReturnsMock.mockResolvedValue([toSummary(refundedUnreviewedReturnRequest)]);
    getReturnMock.mockResolvedValue(refundedUnreviewedReturnRequest);

    renderReturnsPage();

    expect(await screen.findByText('#1096')).toBeInTheDocument();
    expect(screen.getAllByText('Refunded').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent('Return completed');
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent('Refund is complete. No vendor action is required.');
    expect(screen.queryByRole('link', { name: 'Review return' })).not.toBeInTheDocument();

    const timeline = screen.getByRole('heading', { name: 'Timeline' }).closest('.op-panel-section');
    expect(timeline).toBeTruthy();
    expect(within(timeline as HTMLElement).getByText('Refund processed')).toBeInTheDocument();
  });

  it('renders the returned item thumbnail fallback when no image URL is available', async () => {
    const returnWithoutImage: ReturnDetail = {
      ...pendingReturn,
      refundedItems: [
        {
          ...pendingReturn.refundedItems[0],
          imageUrl: null,
        },
      ],
    };
    listReturnsMock.mockResolvedValue([toSummary(returnWithoutImage)]);
    getReturnMock.mockResolvedValue(returnWithoutImage);

    const { container } = renderReturnsPage();

    expect((await screen.findAllByText('Wireless label printer')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('img', { name: 'Wireless label printer product image' })).not.toBeInTheDocument();
    expect(container.querySelector('.order-item-thumb-fallback')).toHaveTextContent('WL');
  });

  it('renders returned item card content in the sidebar layout', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn)]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    const returnedItemsSection = (await screen.findByRole('heading', { name: 'Returned items' })).closest('.op-panel-section');
    expect(returnedItemsSection).not.toBeNull();
    const sidebar = within(returnedItemsSection as HTMLElement);
    const title = sidebar.getByText('Wireless label printer');
    const itemCard = title.closest('.return-detail-item');

    expect(itemCard).not.toBeNull();
    expect(within(itemCard as HTMLElement).getByRole('img', { name: 'Wireless label printer product image' })).toHaveAttribute(
      'src',
      'https://cdn.example.com/wireless-label-printer.png',
    );
    expect(within(itemCard as HTMLElement).getByText(/SKU SKU-A-1/)).toBeInTheDocument();
    expect(within(itemCard as HTMLElement).getByText('Qty 1')).toBeInTheDocument();
    expect(within(itemCard as HTMLElement).getByText('$0.00')).toBeInTheDocument();
  });

  it('renders selected drawer item details from the scoped return detail endpoint', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn), toSummary(processedRefund)]);
    getReturnMock.mockImplementation(async (returnId) => (returnId === processedRefund.id ? processedRefund : pendingReturn));

    renderReturnsPage();

    expect((await screen.findAllByText('Wireless label printer')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByText('#1002')[0]);

    expect((await screen.findAllByText('Barcode gateway license')).length).toBeGreaterThan(0);
    expect(getReturnMock).toHaveBeenCalledWith(processedRefund.id, expect.objectContaining({ vendorId: 'demo-vendor-a' }));
    expect(screen.getAllByText(/Standard/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refunded').length).toBeGreaterThan(0);
    expect(screen.queryByText('Included in payout calculations')).not.toBeInTheDocument();
    expect(screen.queryByText(/webhook/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/backend/i)).not.toBeInTheDocument();
  });

  it('selects the return requested by query parameter instead of the first row', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn), toSummary(processedRefund)]);
    getReturnMock.mockImplementation(async (returnId) => (returnId === processedRefund.id ? processedRefund : pendingReturn));

    renderReturnsPage([`/returns?refundId=${encodeURIComponent(processedRefund.sourceShopifyRefundId ?? '')}`]);

    await waitFor(() =>
      expect(getReturnMock).toHaveBeenCalledWith(processedRefund.id, expect.objectContaining({ vendorId: 'demo-vendor-a' })),
    );
    expect(getReturnMock).not.toHaveBeenCalledWith(pendingReturn.id, expect.objectContaining({ vendorId: 'demo-vendor-a' }));
  });

  it('selects a return by Shopify refund numeric tail', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn), toSummary(processedRefund)]);
    getReturnMock.mockImplementation(async (returnId) => (returnId === processedRefund.id ? processedRefund : pendingReturn));

    renderReturnsPage(['/returns?refundId=5002']);

    await waitFor(() =>
      expect(getReturnMock).toHaveBeenCalledWith(processedRefund.id, expect.objectContaining({ vendorId: 'demo-vendor-a' })),
    );
    expect(getReturnMock).not.toHaveBeenCalledWith(pendingReturn.id, expect.objectContaining({ vendorId: 'demo-vendor-a' }));
  });

  it('selects a return by Shopify return numeric tail', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn), toSummary(processedRefund)]);
    getReturnMock.mockImplementation(async (returnId) => (returnId === processedRefund.id ? processedRefund : pendingReturn));

    renderReturnsPage(['/returns?shopifyReturnId=9001']);

    await waitFor(() =>
      expect(getReturnMock).toHaveBeenCalledWith(pendingReturn.id, expect.objectContaining({ vendorId: 'demo-vendor-a' })),
    );
    expect(getReturnMock).not.toHaveBeenCalledWith(processedRefund.id, expect.objectContaining({ vendorId: 'demo-vendor-a' }));
  });

  it('clears stale selected return state when a linked query target changes', async () => {
    const user = userEvent.setup();
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn), toSummary(processedRefund)]);
    getReturnMock.mockImplementation(async (returnId) => (returnId === processedRefund.id ? processedRefund : pendingReturn));

    renderReturnsNavigationHarness('/returns?refundId=5002');

    expect((await screen.findAllByText('Wireless label printer')).length).toBeGreaterThan(0);
    await user.click(screen.getAllByText('#1001')[0]);
    getReturnMock.mockClear();

    await user.click(screen.getByRole('button', { name: 'Navigate to linked return' }));

    await waitFor(() =>
      expect(getReturnMock).toHaveBeenCalledWith(processedRefund.id, expect.objectContaining({ vendorId: 'demo-vendor-a' })),
    );
    expect(getReturnMock).not.toHaveBeenCalledWith(pendingReturn.id, expect.objectContaining({ vendorId: 'demo-vendor-a' }));
  });

  it('does not select the first return when a linked query target is unavailable', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn)]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage(['/returns?refundId=missing-refund']);

    expect(await screen.findByText('Linked return unavailable')).toBeInTheDocument();
    expect(getReturnMock).not.toHaveBeenCalled();
  });

  it('preserves vendor-scoped visibility in mock mode data', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn)]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect((await screen.findAllByText('#1001')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText(otherVendorReturn.customer)).not.toBeInTheDocument());
  });

  it('surfaces vendor-friendly review context for attention states', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn)]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect((await screen.findAllByText('Awaiting review')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent('Review return');
    expect(screen.getAllByText('Review return').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Contact support').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('İncele return for order #1001').length).toBeGreaterThan(0);
  });

  it('keeps approved returns without refunds in the active refund-monitoring flow', async () => {
    listReturnsMock.mockResolvedValue([toSummary(approvedRefundPendingReturn)]);
    getReturnMock.mockResolvedValue(approvedRefundPendingReturn);

    renderReturnsPage();

    expect(await screen.findByText('#1099')).toBeInTheDocument();
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent('Monitor refund progress');
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent('Keep return evidence current while admin refund handling continues.');
    expect(screen.getByRole('link', { name: 'Review return' })).toBeInTheDocument();
  });

  it('counts awaiting review returns as actionable review work', async () => {
    listReturnsMock.mockResolvedValue([toSummary(awaitingReviewReturn), toSummary(processedRefund)]);
    getReturnMock.mockImplementation(async (returnId) => (returnId === awaitingReviewReturn.id ? awaitingReviewReturn : processedRefund));

    renderReturnsPage();

    expect((await screen.findAllByText('Awaiting Review')).length).toBeGreaterThan(0);
    const workflowTabs = screen.getByLabelText('Returns workflow tabs');
    expect(within(workflowTabs).getByRole('button', { name: /Needs Action/i })).toHaveTextContent('1');
  });

  it('resolves table item names from nested row product data without selecting the row', async () => {
    listReturnsMock.mockResolvedValue([toSummary(nestedProductReturn)]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect(await screen.findByText(/Nested product trainer/)).toBeInTheDocument();
    expect(screen.getByText('SKU: SKU-NESTED')).toBeInTheDocument();
    expect(screen.queryByText('Return item')).not.toBeInTheDocument();
  });

  it('uses variant title before SKU when the item name is only the SKU', async () => {
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(pendingReturn),
        refundedSkus: ['DJ1196-002-40,5'],
        refundedItems: [
          {
            ...pendingReturn.refundedItems[0],
            sku: 'DJ1196-002-40,5',
            name: 'DJ1196-002-40,5',
            variantTitle: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5',
          },
        ],
      },
    ]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect(await screen.findByText(/Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı/)).toBeInTheDocument();
    expect(screen.getByText('SKU: DJ1196-002-40,5')).toBeInTheDocument();
    expect(screen.queryByText('Return item')).not.toBeInTheDocument();
  });

  it('uses list row order line title for unselected rows instead of selected detail', async () => {
    const summaryOnlyReturn: ReturnSummary = {
      ...toSummary(pendingReturn),
      refundedSkus: ['DJ1196-002-40,5'],
      refundedItems: [
        {
          ...pendingReturn.refundedItems[0],
          sku: 'DJ1196-002-40,5',
          name: 'DJ1196-002-40,5',
          variantTitle: 'Return item',
          orderLineItemTitle: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5',
        },
      ],
    } as ReturnSummary;
    const detailedReturn: ReturnDetail = {
      ...pendingReturn,
      refundedSkus: ['DJ1196-002-40,5'],
      refundedItems: [
        {
          ...pendingReturn.refundedItems[0],
          sku: 'DJ1196-002-40,5',
          name: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5',
          variantTitle: 'Siyah / 40,5',
        },
      ],
      items: [
        {
          ...pendingReturn.refundedItems[0],
          sku: 'DJ1196-002-40,5',
          name: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5',
          variantTitle: 'Siyah / 40,5',
        },
      ],
    };
    listReturnsMock.mockResolvedValue([summaryOnlyReturn]);
    getReturnMock.mockResolvedValue({
      ...detailedReturn,
      refundedItems: [
        {
          ...detailedReturn.refundedItems[0],
          name: 'Detail title should not be required',
        },
      ],
    });

    renderReturnsPage();

    expect(await screen.findByText(/Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı/)).toBeInTheDocument();
    expect(screen.getByText('SKU: DJ1196-002-40,5')).toBeInTheDocument();
    expect(screen.queryByText('Return item')).not.toBeInTheDocument();
  });

  it('renders summary item title without depending on selected detail data', async () => {
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(pendingReturn),
        itemTitle: 'Nike Court Vision Kadın Krem Günlük Ayakkabı',
        displayTitle: 'Nike Court Vision Kadın Krem Günlük Ayakkabı',
        variantTitle: 'Krem / 36.5',
        refundedSkus: ['DJ1196-002-40,5'],
        refundedItems: undefined,
      },
    ]);
    getReturnMock.mockResolvedValue({
      ...pendingReturn,
      refundedItems: [
        {
          ...pendingReturn.refundedItems[0],
          sku: 'DJ1196-002-40,5',
          name: 'Detail title should not be required',
          variantTitle: 'Krem / 36.5',
        },
      ],
    });

    renderReturnsPage();

    expect(await screen.findByText('Nike Court Vision Kadın Krem Günlük Ayakkabı / Krem / 36.5')).toBeInTheDocument();
    expect(screen.getAllByText(/DJ1196-002-40,5/).length).toBeGreaterThan(0);
    expect(screen.getByText('1 item returned')).toBeInTheDocument();
    expect(screen.queryByText('Return item')).not.toBeInTheDocument();
  });

  it('renders the same list item title as the returned item detail source for order 1026', async () => {
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(pendingReturn),
        sourceShopifyOrderNumber: '#1026',
        itemTitle: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
        displayTitle: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
        variantTitle: null,
        refundedSkus: ['SWOOSH-WHITE-S'],
        refundedItems: [
          {
            ...pendingReturn.refundedItems[0],
            sku: 'SWOOSH-WHITE-S',
            name: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
            variantTitle: 'Details pending',
          },
        ],
      },
    ]);
    getReturnMock.mockResolvedValue({
      ...pendingReturn,
      sourceShopifyOrderNumber: '#1026',
      refundedItems: [
        {
          ...pendingReturn.refundedItems[0],
          sku: 'SWOOSH-WHITE-S',
          name: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
          variantTitle: 'Details pending',
        },
      ],
    });

    renderReturnsPage();

    expect((await screen.findAllByText('Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Details pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Default')).not.toBeInTheDocument();
  });

  it('does not render Shopify Default placeholders as the item title', async () => {
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(pendingReturn),
        displayTitle: 'Default',
        itemTitle: 'Default Title',
        variantTitle: 'Default',
        refundedSkus: ['DJ1196-002-40,5'],
        refundedItems: [
          {
            ...pendingReturn.refundedItems[0],
            sku: 'DJ1196-002-40,5',
            name: 'Default',
            variantTitle: 'Default Title',
          },
        ],
      },
    ]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect((await screen.findAllByText('DJ1196-002-40,5')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Default')).not.toBeInTheDocument();
    expect(screen.queryByText('Default Title')).not.toBeInTheDocument();
  });

  it('does not concatenate numeric product ids under the item title', async () => {
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(pendingReturn),
        refundedItems: [
          {
            ...pendingReturn.refundedItems[0],
            sku: 'DJ1196-002-40,5',
            name: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı',
            variantTitle: '1234567890123',
          },
        ],
      },
    ]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect(await screen.findByText('Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı')).toBeInTheDocument();
    expect(screen.queryByText('1234567890123')).not.toBeInTheDocument();
  });

  it('falls back to SKU in the table only when a returned item title is missing', async () => {
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(pendingReturn),
        refundedSkus: ['SKU-ONLY'],
        refundedItems: [
          {
            ...pendingReturn.refundedItems[0],
            sku: 'SKU-ONLY',
            name: 'Return item',
            variantTitle: 'Return item',
          },
        ],
      },
    ]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect((await screen.findAllByText('SKU-ONLY')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Return item')).not.toBeInTheDocument();
  });

  it('uses Unknown item only when no title or SKU exists', async () => {
    const unknownReturn: ReturnDetail = {
      ...pendingReturn,
      refundedSkus: [],
      refundedItems: [
        {
          ...pendingReturn.refundedItems[0],
          sku: 'UNKNOWN-SKU',
          name: 'Return item',
          variantTitle: 'Return item',
        },
      ],
      items: [],
    };
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(unknownReturn),
      },
    ]);
    getReturnMock.mockResolvedValue(unknownReturn);

    renderReturnsPage();

    expect((await screen.findAllByText('Unknown item')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Return item')).not.toBeInTheDocument();
  });

  it('renders customer return shipment tracking when Shopify provides it', async () => {
    const returnWithTracking: ReturnDetail = {
      ...pendingReturn,
      returnCarrierName: 'Yurtiçi Kargo',
      returnTrackingNumber: 'returnkargo-123',
      returnTrackingUrl: 'https://tracking.example/returnkargo-123',
    };
    listReturnsMock.mockResolvedValue([toSummary(returnWithTracking)]);
    getReturnMock.mockResolvedValue(returnWithTracking);

    renderReturnsPage();

    expect(await screen.findByText('Return shipment')).toBeInTheDocument();
    expect(screen.getByText('Yurtiçi Kargo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'returnkargo-123' })).toHaveAttribute(
      'href',
      'https://tracking.example/returnkargo-123',
    );
  });

  it('hides the return shipment card when tracking is unavailable', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn)]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    await screen.findAllByRole('heading', { name: /return requests/i });
    expect(screen.queryByText('Return shipment')).not.toBeInTheDocument();
  });
});
