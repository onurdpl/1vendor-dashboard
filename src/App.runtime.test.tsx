import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('App startup runtime safety', () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('renders a safe startup error when runtime configuration is invalid', async () => {
    vi.doMock('./config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
        apiBaseUrl: 'http://127.0.0.1:4000',
        apiBaseOrigin: 'http://127.0.0.1:4000',
        appEnvironment: 'production',
        appVersion: '0.1.0',
        buildTimestamp: null,
        gitCommit: null,
        startupIssues: ['Real API mode requires VITE_API_BASE_URL.'],
      },
    }));

    const { default: App } = await import('./App');

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('Runtime configuration needs attention')).toBeInTheDocument();
    expect(screen.getByText('Real API mode requires VITE_API_BASE_URL.')).toBeInTheDocument();
  });

  it('submits an admin economic transfer from the blocked allocation modal', async () => {
    vi.doMock('./config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
        apiBaseUrl: 'https://vendor-dashboard-backend-398h.onrender.com',
        apiBaseOrigin: 'https://vendor-dashboard-backend-398h.onrender.com',
        appEnvironment: 'production',
        appVersion: '0.1.0',
        buildTimestamp: null,
        gitCommit: null,
        startupIssues: [],
      },
    }));
    vi.doMock('./lib/RequireAuth', () => ({
      RequireAuth: () => <Outlet />,
    }));
    vi.doMock('./components/RequirePermission', () => ({
      RequirePermission: ({ children }: { children: ReactNode }) => <>{children}</>,
    }));
    vi.doMock('./components/AppShell', () => ({
      AppShell: () => <Outlet />,
      AdminShell: () => <Outlet />,
      VendorShell: () => <Outlet />,
    }));
    vi.doMock('./lib/appReadiness', () => ({
      useAppReadiness: () => ({
        ready: true,
        currentUser: {
          role: 'admin',
          vendorDetails: [
            { vendorId: 'vendor-a', vendorName: 'Vendor A' },
            { vendorId: 'vendor-b', vendorName: 'Vendor B' },
          ],
        },
      }),
    }));
    const blockedBreakdown = {
      sourceShopifyOrderId: '7693738639697',
      sourceShopifyOrderNumber: '#1069',
      customer: 'Shopify Customer',
      createdAt: '2026-06-02T12:00:00.000Z',
      allocations: [
        {
          originalVendorId: 'vendor-a',
          assignedVendorId: 'vendor-a',
          vendorId: 'vendor-a',
          vendorName: 'Vendor A',
          allocationOrderId: 'alloc-vendor-a-7693738639697',
          status: 'On Hold',
          allocationStatus: 'vendor_blocked',
          cancellationReason: 'out_of_stock',
          reassignmentRequired: true,
          reassignmentCandidateVendorIds: [],
          assignmentHistory: [],
          fulfillmentActionState: 'awaiting_shipment',
          fulfillmentActionAvailable: false,
          fulfillmentStatus: 'Pending',
          shippingStatus: 'Awaiting Shipment',
          allocationTotal: 'TRY 1,000.00',
          lineItems: [],
          refundedItems: [],
          refundTotal: 'TRY 0.00',
          returnRecordCount: 0,
          financeIntegrityAlerts: [],
        },
      ],
    };
    const transferAdminAllocationEconomics = vi.fn().mockResolvedValue({
      ok: true,
      transfer: {
        transferId: 'transfer-1',
        fromVendorId: 'vendor-a',
        toVendorId: 'vendor-b',
        sourceLedgerId: 'fin-vendor-a-sale-1001',
        targetLedgerId: 'fin-vendor-b-sale-1001',
        allocationId: 'alloc-vendor-a-7693738639697',
        status: 'COMPLETED',
      },
      order: {
        ...blockedBreakdown,
        allocations: [
          {
            ...blockedBreakdown.allocations[0],
            assignedVendorId: 'vendor-b',
            vendorId: 'vendor-b',
            vendorName: 'Vendor B',
            allocationStatus: 'active',
            reassignmentRequired: false,
            cancellationReason: undefined,
            transferSummary: {
              id: 'transfer-1',
              status: 'COMPLETED',
              fromVendorId: 'vendor-a',
              toVendorId: 'vendor-b',
              reason: 'Vendor A is out of stock and Vendor B accepted captured economics.',
              completedAt: '2026-06-02T12:30:00.000Z',
              adminActorUserId: 'admin-1',
            },
          },
        ],
      },
    });
    vi.doMock('./features/orders/api', async () => {
      const actual = await vi.importActual<typeof import('./features/orders/api')>('./features/orders/api');
      return {
        ...actual,
        getAdminShopifyOrderBreakdown: vi.fn().mockResolvedValue(blockedBreakdown),
        transferAdminAllocationEconomics,
      };
    });
    const { default: App } = await import('./App');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/admin/orders/7693738639697']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Transfer economics' }));
    const dialog = screen.getByRole('dialog', { name: 'Transfer economics' });
    const submit = within(dialog).getByRole('button', { name: 'Transfer economics' });
    expect(submit).toBeDisabled();

    await userEvent.selectOptions(within(dialog).getByLabelText('Replacement vendor'), 'vendor-b');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Vendor A is out of stock and Vendor B accepted captured economics.');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Replacement vendor confirmed it can fulfill this order.' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /keeps the original customer-paid price/i }));
    expect(submit).toBeEnabled();

    await userEvent.click(submit);

    await waitFor(() => expect(transferAdminAllocationEconomics).toHaveBeenCalledWith('7693738639697', 'alloc-vendor-a-7693738639697', {
      toVendorId: 'vendor-b',
      reason: 'Vendor A is out of stock and Vendor B accepted captured economics.',
      confirmTransfer: true,
    }));
    expect(await screen.findByText('Allocation economics transferred to the replacement vendor.')).toBeInTheDocument();
    const transferSummary = await screen.findByLabelText('Economic transfer summary');
    expect(within(transferSummary).getByText('Economics transferred')).toBeInTheDocument();
    expect(within(transferSummary).getByText('vendor-a')).toBeInTheDocument();
    expect(within(transferSummary).getByText('vendor-b')).toBeInTheDocument();
    expect(within(transferSummary).getAllByText('Completed').length).toBeGreaterThan(0);
    expect(within(transferSummary).getByText('Vendor A is out of stock and Vendor B accepted captured economics.')).toBeInTheDocument();
    expect(within(transferSummary).getByText(/Jun 2, 2026/)).toBeInTheDocument();
    expect(within(transferSummary).getByText('admin-1')).toBeInTheDocument();
  });

  it('submits a cancel refund review request from the blocked allocation modal', async () => {
    vi.doMock('./config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
        apiBaseUrl: 'https://vendor-dashboard-backend-398h.onrender.com',
        apiBaseOrigin: 'https://vendor-dashboard-backend-398h.onrender.com',
        appEnvironment: 'production',
        appVersion: '0.1.0',
        buildTimestamp: null,
        gitCommit: null,
        startupIssues: [],
      },
    }));
    vi.doMock('./lib/RequireAuth', () => ({
      RequireAuth: () => <Outlet />,
    }));
    vi.doMock('./components/RequirePermission', () => ({
      RequirePermission: ({ children }: { children: ReactNode }) => <>{children}</>,
    }));
    vi.doMock('./components/AppShell', () => ({
      AppShell: () => <Outlet />,
      AdminShell: () => <Outlet />,
      VendorShell: () => <Outlet />,
    }));
    vi.doMock('./lib/appReadiness', () => ({
      useAppReadiness: () => ({
        ready: true,
        currentUser: {
          role: 'admin',
          vendorDetails: [
            { vendorId: 'vendor-a', vendorName: 'Vendor A' },
            { vendorId: 'vendor-b', vendorName: 'Vendor B' },
          ],
        },
      }),
    }));
    const blockedBreakdown = {
      sourceShopifyOrderId: '7693738639697',
      sourceShopifyOrderNumber: '#1069',
      customer: 'Shopify Customer',
      createdAt: '2026-06-02T12:00:00.000Z',
      allocations: [
        {
          originalVendorId: 'vendor-a',
          assignedVendorId: 'vendor-a',
          vendorId: 'vendor-a',
          vendorName: 'Vendor A',
          allocationOrderId: 'alloc-vendor-a-7693738639697',
          status: 'On Hold',
          allocationStatus: 'vendor_blocked',
          cancellationReason: 'out_of_stock',
          reassignmentRequired: true,
          reassignmentCandidateVendorIds: [],
          assignmentHistory: [],
          fulfillmentActionState: 'awaiting_shipment',
          fulfillmentActionAvailable: false,
          fulfillmentStatus: 'Pending',
          shippingStatus: 'Awaiting Shipment',
          allocationTotal: 'TRY 1,000.00',
          lineItems: [],
          refundedItems: [],
          refundTotal: 'TRY 0.00',
          returnRecordCount: 0,
          financeIntegrityAlerts: [],
          transferSummary: null,
          cancelRefundReview: null,
        },
      ],
    };
    const requestAdminCancelRefundReview = vi.fn().mockResolvedValue({
      ...blockedBreakdown,
      allocations: [
        {
          ...blockedBreakdown.allocations[0],
          cancelRefundReview: {
            status: 'PENDING_REVIEW',
            reason: 'OUT_OF_STOCK',
            note: 'No replacement vendor available. Customer will be contacted.',
            requestedAt: '2026-06-02T12:30:00.000Z',
            requestedByUserId: 'admin-1',
          },
        },
      ],
    });
    vi.doMock('./features/orders/api', async () => {
      const actual = await vi.importActual<typeof import('./features/orders/api')>('./features/orders/api');
      return {
        ...actual,
        getAdminShopifyOrderBreakdown: vi.fn().mockResolvedValue(blockedBreakdown),
        transferAdminAllocationEconomics: vi.fn(),
        requestAdminCancelRefundReview,
      };
    });
    const { default: App } = await import('./App');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/admin/orders/7693738639697']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel / Refund Review' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel / Refund Review' });
    const submit = within(dialog).getByRole('button', { name: 'Start review' });
    expect(submit).toBeDisabled();

    await userEvent.selectOptions(within(dialog).getByLabelText('Reason'), 'OUT_OF_STOCK');
    await userEvent.type(within(dialog).getByLabelText('Review note'), 'No replacement vendor available. Customer will be contacted.');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /does not refund the customer or cancel the Shopify order/i }));
    expect(submit).toBeEnabled();

    await userEvent.click(submit);

    await waitFor(() => expect(requestAdminCancelRefundReview).toHaveBeenCalledWith('7693738639697', 'alloc-vendor-a-7693738639697', {
      reason: 'OUT_OF_STOCK',
      note: 'No replacement vendor available. Customer will be contacted.',
      confirmReview: true,
    }));
    expect(await screen.findByText('Allocation moved to cancel/refund review. Shopify and refund state were not changed.')).toBeInTheDocument();
    const reviewSummary = await screen.findByLabelText('Cancel refund review summary');
    expect(within(reviewSummary).getByText('Cancel / Refund Review Pending')).toBeInTheDocument();
    expect(within(reviewSummary).getAllByText('OUT_OF_STOCK').length).toBeGreaterThan(0);
    expect(within(reviewSummary).getByText('No replacement vendor available. Customer will be contacted.')).toBeInTheDocument();
    expect(within(reviewSummary).getByText(/Jun 2, 2026/)).toBeInTheDocument();
    expect(within(reviewSummary).getByText('admin-1')).toBeInTheDocument();
  });

  it('does not show economic transfer action for non-blocked allocations', async () => {
    vi.doMock('./config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
        apiBaseUrl: 'https://vendor-dashboard-backend-398h.onrender.com',
        apiBaseOrigin: 'https://vendor-dashboard-backend-398h.onrender.com',
        appEnvironment: 'production',
        appVersion: '0.1.0',
        buildTimestamp: null,
        gitCommit: null,
        startupIssues: [],
      },
    }));
    vi.doMock('./lib/RequireAuth', () => ({
      RequireAuth: () => <Outlet />,
    }));
    vi.doMock('./components/RequirePermission', () => ({
      RequirePermission: ({ children }: { children: ReactNode }) => <>{children}</>,
    }));
    vi.doMock('./components/AppShell', () => ({
      AppShell: () => <Outlet />,
      AdminShell: () => <Outlet />,
      VendorShell: () => <Outlet />,
    }));
    vi.doMock('./lib/appReadiness', () => ({
      useAppReadiness: () => ({
        ready: true,
        currentUser: {
          role: 'admin',
          vendorDetails: [
            { vendorId: 'vendor-a', vendorName: 'Vendor A' },
            { vendorId: 'vendor-b', vendorName: 'Vendor B' },
          ],
        },
      }),
    }));
    vi.doMock('./features/orders/api', async () => {
      const actual = await vi.importActual<typeof import('./features/orders/api')>('./features/orders/api');
      return {
        ...actual,
        getAdminShopifyOrderBreakdown: vi.fn().mockResolvedValue({
          sourceShopifyOrderId: '7693738639697',
          sourceShopifyOrderNumber: '#1069',
          customer: 'Shopify Customer',
          createdAt: '2026-06-02T12:00:00.000Z',
          allocations: [
            {
              originalVendorId: 'vendor-a',
              assignedVendorId: 'vendor-a',
              vendorId: 'vendor-a',
              vendorName: 'Vendor A',
              allocationOrderId: 'alloc-vendor-a-7693738639697',
              status: 'Processing',
              allocationStatus: 'active',
              reassignmentRequired: false,
              reassignmentCandidateVendorIds: [],
              assignmentHistory: [],
              fulfillmentActionState: 'awaiting_shipment',
              fulfillmentActionAvailable: true,
              fulfillmentStatus: 'Pending',
              shippingStatus: 'Awaiting Shipment',
              allocationTotal: 'TRY 1,000.00',
              lineItems: [],
              refundedItems: [],
              refundTotal: 'TRY 0.00',
              returnRecordCount: 0,
              financeIntegrityAlerts: [],
            },
          ],
        }),
        transferAdminAllocationEconomics: vi.fn(),
      };
    });
    const { default: App } = await import('./App');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/admin/orders/7693738639697']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('Vendor A');
    expect(screen.queryByRole('button', { name: 'Transfer economics' })).not.toBeInTheDocument();
  });

  it('shows refunded allocations as operationally closed on the admin order page', async () => {
    vi.doMock('./config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
        apiBaseUrl: 'https://vendor-dashboard-backend-398h.onrender.com',
        apiBaseOrigin: 'https://vendor-dashboard-backend-398h.onrender.com',
        appEnvironment: 'production',
        appVersion: '0.1.0',
        buildTimestamp: null,
        gitCommit: null,
        startupIssues: [],
      },
    }));
    vi.doMock('./lib/RequireAuth', () => ({
      RequireAuth: () => <Outlet />,
    }));
    vi.doMock('./components/RequirePermission', () => ({
      RequirePermission: ({ children }: { children: ReactNode }) => <>{children}</>,
    }));
    vi.doMock('./components/AppShell', () => ({
      AppShell: () => <Outlet />,
      AdminShell: () => <Outlet />,
      VendorShell: () => <Outlet />,
    }));
    vi.doMock('./lib/appReadiness', () => ({
      useAppReadiness: () => ({
        ready: true,
        currentUser: {
          role: 'admin',
          vendorDetails: [
            { vendorId: 'vendor-a', vendorName: 'Vendor A' },
            { vendorId: 'vendor-b', vendorName: 'Vendor B' },
          ],
        },
      }),
    }));
    vi.doMock('./features/orders/api', async () => {
      const actual = await vi.importActual<typeof import('./features/orders/api')>('./features/orders/api');
      return {
        ...actual,
        getAdminShopifyOrderBreakdown: vi.fn().mockResolvedValue({
          sourceShopifyOrderId: '7693738639697',
          sourceShopifyOrderNumber: '#1069',
          customer: 'Shopify Customer',
          financialStatus: 'refunded',
          customerRefundCompletion: {
            status: 'VERIFIED_FULL_CUSTOMER_REFUND',
            reasonCode: 'canonical_full_customer_refund_verified',
            displayFinancialStatus: 'REFUNDED',
            currency: 'TRY',
            totalReceivedAmount: '1000.00',
            totalRefundedAmount: '1000.00',
            netPaymentAmount: '0.00',
            totalOutstandingAmount: '0.00',
            totalRefundedShippingAmount: '0.00',
          },
          refundWebhookStatus: 'PROCESSED',
          createdAt: '2026-06-02T12:00:00.000Z',
          allocations: [
            {
              originalVendorId: 'vendor-a',
              assignedVendorId: 'vendor-a',
              vendorId: 'vendor-a',
              vendorName: 'Vendor A',
              allocationOrderId: 'alloc-vendor-a-7693738639697',
              status: 'On Hold',
              allocationStatus: 'vendor_blocked',
              cancellationReason: 'out_of_stock',
              reassignmentRequired: true,
              reassignmentCandidateVendorIds: [],
              assignmentHistory: [
                {
                  action: 'vendor_blocked',
                  fromVendorId: 'vendor-a',
                  toVendorId: 'vendor-a',
                  reason: 'OUT_OF_STOCK: No inventory',
                  actorName: 'Vendor User',
                  actorRole: 'vendor',
                  createdAt: '2026-06-02T12:05:00.000Z',
                },
              ],
              fulfillmentActionState: 'awaiting_shipment',
              fulfillmentActionAvailable: false,
              fulfillmentStatus: 'Pending',
              shippingStatus: 'Awaiting Shipment',
              allocationTotal: 'TRY 1,000.00',
              lineItems: [
                {
                  id: 'line-1',
                  sku: 'SKU-REFUNDED',
                  variantTitle: '42',
                  name: 'Refunded product',
                  quantity: 1,
                  price: 'TRY 1,000.00',
                  fulfillmentStatus: 'Pending',
                  shippingStatus: 'Awaiting Shipment',
                },
              ],
              refundedItems: [
                {
                  id: 'refund-line-1',
                  originalVendorId: 'vendor-a',
                  assignedVendorId: 'vendor-a',
                  vendorId: 'vendor-a',
                  sku: 'SKU-REFUNDED',
                  variantTitle: 'Refund gid://shopify/Refund/1',
                  name: 'Refunded product',
                  quantity: 1,
                  condition: 'New',
                  refundAmount: 'TRY 1,000.00',
                },
              ],
              refundTotal: 'TRY 1,000.00',
              returnRecordCount: 0,
              financeIntegrityAlerts: [],
              transferSummary: null,
              cancelRefundReview: {
                status: 'RESOLVED',
                reason: 'OUT_OF_STOCK',
                note: 'No replacement vendor available.',
                requestedAt: '2026-06-02T12:10:00.000Z',
                requestedByUserId: 'admin-1',
              },
              outboundRefundAttemptSummary: {
                id: 'attempt-1',
                status: 'RESOLVED',
                restockType: 'CANCEL',
                refundShipping: false,
                notifyCustomer: true,
                shopifyRefundId: 'gid://shopify/Refund/1',
                previewedAt: '2026-06-02T12:12:00.000Z',
                requestedAt: '2026-06-02T12:12:00.000Z',
                submittedAt: '2026-06-02T12:13:00.000Z',
                resolvedAt: '2026-06-02T12:14:00.000Z',
                failedAt: null,
                failureReason: null,
                postRefundFulfillmentCheckStatus: 'passed',
                postRefundFulfillmentCheckMessage:
                  'Refunded line items are no longer fulfillable in active Shopify fulfillment orders.',
              },
            },
          ],
        }),
        transferAdminAllocationEconomics: vi.fn(),
        returnAdminBlockedAllocationToVendor: vi.fn(),
        requestAdminCancelRefundReview: vi.fn(),
      };
    });
    const { default: App } = await import('./App');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/admin/orders/7693738639697']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect((await screen.findAllByText('Refund completed')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refunded').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fulfillment not required').length).toBeGreaterThan(0);
    expect(screen.getByText('Historical Context')).toBeInTheDocument();
    expect(screen.getAllByText('Vendor blocked').length).toBeGreaterThan(0);
    expect(screen.getByText('Shopify refund processed successfully. This allocation is operationally closed and fulfillment is no longer required.')).toBeInTheDocument();
    expect(screen.getByText('Latest order refund webhook')).toBeInTheDocument();
    expect(screen.getByText('Processed')).toBeInTheDocument();
    expect(screen.getByText('gid://shopify/Refund/1')).toBeInTheDocument();
    expect(screen.getAllByText('SKU-REFUNDED').length).toBeGreaterThan(0);
    expect(screen.getByText('Refund submitted to Shopify')).toBeInTheDocument();
    expect(screen.getAllByText('Refund resolution recorded').length).toBeGreaterThan(0);
    expect(screen.getByText('Post-check Passed')).toBeInTheDocument();
    expect(screen.queryByText('No refunded items in this vendor allocation.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Transfer economics' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return to vendor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview Shopify refund' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refund in Shopify' })).not.toBeInTheDocument();
  });
});
