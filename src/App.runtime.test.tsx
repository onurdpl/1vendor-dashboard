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

  it('renders the public Paratika payment return placeholder route', async () => {
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

    const { default: App } = await import('./App');

    render(
      <MemoryRouter
        initialEntries={[
          '/payments/paratika/return?responseCode=99&merchantPaymentId=SPORGYM-SHOPIFY-order-100&token=secret-session-token&cardNumber=4111111111111111',
        ]}
      >
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('Payment return received. Verification pending.')).toBeInTheDocument();
    expect(screen.getByText(/No payment, Shopify order, settlement, or payout state has been changed/i)).toBeInTheDocument();
    expect(screen.getByText('Received status')).toBeInTheDocument();
    expect(screen.getByText('99')).toBeInTheDocument();
    expect(screen.getByText('Reference')).toBeInTheDocument();
    expect(screen.getByText('SPORGYM-SHOPIFY-order-100')).toBeInTheDocument();
    expect(screen.queryByText('secret-session-token')).not.toBeInTheDocument();
    expect(screen.queryByText('4111111111111111')).not.toBeInTheDocument();
  });

  it('runs the Paratika hosted payment probe from the admin order page', async () => {
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
    }));
    vi.doMock('./lib/appReadiness', () => ({
      useAppReadiness: () => ({ ready: true }),
    }));
    const getAdminShopifyOrderBreakdown = vi.fn().mockResolvedValue({
      sourceShopifyOrderId: '7693738639697',
      sourceShopifyOrderNumber: '#1069',
      customer: 'Shopify Customer',
      createdAt: '2026-06-02T12:00:00.000Z',
      allocations: [
        {
          originalVendorId: 'sporjinal',
          assignedVendorId: 'sporjinal',
          vendorId: 'sporjinal',
          vendorName: 'Sporjinal',
          allocationOrderId: 'alloc-sporjinal-7693738639697',
          status: 'Pending',
          allocationStatus: 'active',
          reassignmentRequired: false,
          reassignmentCandidateVendorIds: [],
          assignmentHistory: [],
          fulfillmentActionState: 'awaiting_shipment',
          fulfillmentActionAvailable: true,
          fulfillmentStatus: 'Pending',
          shippingStatus: 'Awaiting Shipment',
          allocationTotal: 'TRY 1,000.00',
          lineItems: [
            {
              id: 'line-1',
              sku: 'SKU-1',
              variantTitle: '42',
              name: 'Test product',
              quantity: 1,
              price: 'TRY 1,000.00',
              fulfillmentStatus: 'Pending',
              shippingStatus: 'Awaiting Shipment',
            },
          ],
          refundedItems: [],
          refundTotal: 'TRY 0.00',
        },
      ],
    });
    const createParatikaHostedPaymentLink = vi.fn().mockResolvedValue({
      ok: true,
      writesPerformed: true,
      provider: 'PARATIKA',
      mode: 'sessiontoken_live_probe',
      action: 'SESSIONTOKEN',
      paymentReference: 'SPORGYM-SHOPIFY-7693738639697',
      responseCode: '00',
      responseMsg: 'Approved',
      hostedPaymentUrl: 'https://entegrasyon.paratika.com.tr/payment/secret-session-token',
      externalApiCallAttempted: true,
      cardDataIncluded: false,
    });
    vi.doMock('./features/orders/api', async () => {
      const actual = await vi.importActual<typeof import('./features/orders/api')>('./features/orders/api');
      return {
        ...actual,
        getAdminShopifyOrderBreakdown,
        createParatikaHostedPaymentLink,
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

    const action = await screen.findByRole('button', { name: 'Create Paratika hosted payment link' });
    await userEvent.click(action);

    await waitFor(() => expect(createParatikaHostedPaymentLink).toHaveBeenCalledWith('7693738639697'));
    const link = await screen.findByRole('link', { name: 'Open Paratika payment page' });
    expect(link).toHaveAttribute('href', 'https://entegrasyon.paratika.com.tr/payment/secret-session-token');
    expect(screen.getByText('00')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('No payment state changed')).toBeInTheDocument();
    expect(screen.queryByText('secret-session-token')).not.toBeInTheDocument();
  });

  it('shows a safe error when the Paratika hosted payment probe fails', async () => {
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
    }));
    vi.doMock('./lib/appReadiness', () => ({
      useAppReadiness: () => ({ ready: true }),
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
          allocations: [],
        }),
        createParatikaHostedPaymentLink: vi.fn().mockRejectedValue(
          new Error('Paratika failed with sessionToken=secret-session-token merchantPassword=secret-password'),
        ),
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

    await userEvent.click(await screen.findByRole('button', { name: 'Create Paratika hosted payment link' }));

    expect(await screen.findByText('Paratika failed with sessionToken=[redacted] merchantPassword=[redacted]')).toBeInTheDocument();
    expect(screen.queryByText('secret-session-token')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-password')).not.toBeInTheDocument();
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
        createParatikaHostedPaymentLink: vi.fn(),
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
        createParatikaHostedPaymentLink: vi.fn(),
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
        createParatikaHostedPaymentLink: vi.fn(),
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
});
