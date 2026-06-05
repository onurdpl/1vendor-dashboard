import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
});
