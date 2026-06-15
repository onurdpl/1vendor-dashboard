import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VendorProfilePage } from './VendorProfilePage';
import { ApiError } from '../lib/api/errors';
import type {
  LogoIsbasiCommissionInvoicePreviewInput,
  LogoIsbasiCommissionInvoicePreviewResult,
  LogoIsbasiFirmBindResult,
  LogoIsbasiFirmMatchResult,
  LogoIsbasiFirmsDiscoveryResult,
  LogoIsbasiIncomingEinvoiceListProbeResult,
  LogoIsbasiLoginProbeResult,
  LogoIsbasiTestInvoiceCreateResult,
  SupportTicket,
  VendorBillingProfile,
  VendorBillingProfileInput,
  VendorFinancialProfile,
  VendorShippingConfig,
} from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';

const getVendorShippingConfigMock = vi.fn<() => Promise<VendorShippingConfig>>();
const getFinanceProfileMock = vi.fn<() => Promise<VendorFinancialProfile>>();
const updateVendorFinancialProfileMock = vi.fn<
  (
    vendorId: string,
    input: {
      commissionPercent: number;
      commissionVatPercent: number;
      deductShippingEnabled: boolean;
      shippingMode: VendorFinancialProfile['shippingMode'];
      fixedShippingFee: number | null;
      settlementDelayDays: number;
    },
  ) => Promise<VendorFinancialProfile>
>();
const getFinanceDashboardMock = vi.fn();
const getVendorBillingProfileMock = vi.fn<() => Promise<VendorBillingProfile | null>>();
const updateVendorBillingProfileMock = vi.fn<(vendorId: string, input: VendorBillingProfileInput) => Promise<VendorBillingProfile>>();
const probeLogoIsbasiLoginMock = vi.fn<() => Promise<LogoIsbasiLoginProbeResult>>();
const discoverLogoIsbasiFirmsMock = vi.fn<() => Promise<LogoIsbasiFirmsDiscoveryResult>>();
const discoverLogoIsbasiIncomingEinvoicesMock = vi.fn<() => Promise<LogoIsbasiIncomingEinvoiceListProbeResult>>();
const createLogoIsbasiTestInvoiceMock = vi.fn<(vendorId: string) => Promise<LogoIsbasiTestInvoiceCreateResult>>();
const matchVendorLogoIsbasiFirmMock = vi.fn<(vendorId: string) => Promise<LogoIsbasiFirmMatchResult>>();
const bindVendorLogoIsbasiFirmMock = vi.fn<(vendorId: string) => Promise<LogoIsbasiFirmBindResult>>();
const previewLogoIsbasiCommissionInvoiceMock = vi.fn<
  (vendorId: string, input: LogoIsbasiCommissionInvoicePreviewInput) => Promise<LogoIsbasiCommissionInvoicePreviewResult>
>();
const listVendorSupportTicketsMock = vi.fn<() => Promise<SupportTicket[]>>();
const listAdminSupportTicketsMock = vi.fn<() => Promise<SupportTicket[]>>();
const createSupportTicketMock = vi.fn();

vi.mock('../features/orders/api', async () => {
  const actual = await vi.importActual<typeof import('../features/orders/api')>('../features/orders/api');
  return {
    ...actual,
    getVendorShippingConfig: () => getVendorShippingConfigMock(),
  };
});

vi.mock('../features/finance/api', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/api')>('../features/finance/api');
  return {
    ...actual,
    getFinanceDashboard: () => getFinanceDashboardMock(),
    getFinanceProfile: () => getFinanceProfileMock(),
    updateVendorFinancialProfile: (
      vendorId: string,
      input: {
        commissionPercent: number;
        commissionVatPercent: number;
        deductShippingEnabled: boolean;
        shippingMode: VendorFinancialProfile['shippingMode'];
        fixedShippingFee: number | null;
        settlementDelayDays: number;
      },
    ) => updateVendorFinancialProfileMock(vendorId, input),
  };
});

vi.mock('../features/vendors/api', async () => {
  const actual = await vi.importActual<typeof import('../features/vendors/api')>('../features/vendors/api');
  return {
    ...actual,
    getVendorBillingProfile: () => getVendorBillingProfileMock(),
    updateVendorBillingProfile: (vendorId: string, input: VendorBillingProfileInput) =>
      updateVendorBillingProfileMock(vendorId, input),
    probeLogoIsbasiLogin: () => probeLogoIsbasiLoginMock(),
    discoverLogoIsbasiFirms: () => discoverLogoIsbasiFirmsMock(),
    discoverLogoIsbasiIncomingEinvoices: () => discoverLogoIsbasiIncomingEinvoicesMock(),
    createLogoIsbasiTestInvoice: (vendorId: string) => createLogoIsbasiTestInvoiceMock(vendorId),
    matchVendorLogoIsbasiFirm: (vendorId: string) => matchVendorLogoIsbasiFirmMock(vendorId),
    bindVendorLogoIsbasiFirm: (vendorId: string) => bindVendorLogoIsbasiFirmMock(vendorId),
    previewLogoIsbasiCommissionInvoice: (vendorId: string, input: LogoIsbasiCommissionInvoicePreviewInput) =>
      previewLogoIsbasiCommissionInvoiceMock(vendorId, input),
  };
});

vi.mock('../features/support/api', async () => {
  const actual = await vi.importActual<typeof import('../features/support/api')>('../features/support/api');
  return {
    ...actual,
    createSupportTicket: (...args: unknown[]) => createSupportTicketMock(...args),
    listAdminSupportTickets: () => listAdminSupportTicketsMock(),
    listVendorSupportTickets: () => listVendorSupportTicketsMock(),
  };
});

const shippingConfig: VendorShippingConfig = {
  vendorId: 'demo-vendor-a',
  preferredProvider: 'navlungo',
  shippingEnabled: true,
  defaultDesi: '3.00',
  cargoIntegrationId: '2547',
  defaultWarehouseId: '55574',
  shippingVatPercent: '18.00',
  source: 'configured',
  updatedAt: '2026-05-20T10:00:00Z',
  warehouses: [
    {
      id: 'warehouse-demo-a',
      vendorId: 'demo-vendor-a',
      provider: 'navlungo',
      warehouseId: '55574',
      name: 'Main warehouse',
      address: 'Istanbul warehouse',
      isDefault: true,
    },
  ],
  providerMetadata: {
    navlungoSenderAddressId: '55574',
    navlungoSenderCity: 'Mugla',
    navlungoSenderDistrict: 'Fethiye',
    navlungoReturnRecipientAddressId: '55578',
    navlungoReturnRecipientCity: 'Konya',
    navlungoReturnRecipientDistrict: 'Selcuklu',
  },
};

const financeProfile: VendorFinancialProfile = {
  vendorId: 'demo-vendor-a',
  commissionPercent: '12.50',
  commissionVatPercent: '20.00',
  deductShippingEnabled: true,
  shippingMode: 'external_provider',
  fixedShippingFee: null,
  settlementDelayDays: 21,
  active: true,
  source: 'configured',
};

const billingProfile: VendorBillingProfile = {
  id: 'billing-demo-vendor-a',
  vendorId: 'demo-vendor-a',
  legalCompanyName: 'Demo Vendor A Ltd.',
  taxNumber: '1111111111',
  taxOffice: 'Kadikoy',
  billingAddress: 'Billing Street 1, Istanbul',
  billingCity: 'Istanbul',
  billingDistrict: 'Atasehir',
  iban: 'TR000000000000000000000000',
  authorizedPerson: 'Demo Authorized Person',
  billingEmail: 'billing@example.test',
  billingPhone: '+905551112233',
  legalEntityType: 'limited_company',
  logoIsbasiCustomerCode: 'LOGO-CODE-1',
  logoIsbasiCustomerId: 'LOGO-ID-1',
  logoIsbasiEinvoiceEligible: true,
  logoIsbasiLastCheckedAt: '2026-06-07T10:00:00Z',
  createdAt: '2026-06-05T10:00:00Z',
  updatedAt: '2026-06-05T10:00:00Z',
};

function supportTicket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: 'support-profile-1',
    createdAt: '2026-05-20T10:00:00Z',
    updatedAt: '2026-05-20T10:00:00Z',
    createdByUserId: 'vendor-user',
    createdByRole: 'vendor',
    vendorId: 'demo-vendor-a',
    vendorName: 'Demo Vendor A',
    subject: 'Vendor profile settings correction',
    message: 'Please review settings.',
    priority: 'normal',
    status: 'OPEN',
    category: 'OTHER',
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
    contextType: 'general',
    contextId: 'demo-vendor-a',
    contextSummary: {
      route: 'vendor_profile_settings',
      path: '/vendor/profile',
      status: 'correction_requested',
    },
    resolvedAt: null,
    closedAt: null,
    ...overrides,
  };
}

function renderVendorProfilePage(initialEntries = ['/vendor/profile']) {
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
        <Routes>
          <Route path="/vendor/profile" element={<VendorProfilePage />} />
          <Route path="/orders" element={<div>Orders queue route</div>} />
          <Route path="/returns" element={<div>Returns queue route</div>} />
          <Route path="/finance" element={<div>Finance route</div>} />
          <Route path="/automation" element={<div>Automation route</div>} />
          <Route path="/support" element={<div>Support workspace route</div>} />
          <Route path="/support/:ticketId" element={<div>Vendor support detail route</div>} />
          <Route path="/admin/support/:ticketId" element={<div>Admin support detail route</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openLogoDiagnostics(section: HTMLElement) {
  await userEvent.click(await within(section).findByText('Logo diagnostics'));
}

describe('VendorProfilePage', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'vendor-a@demo.com',
      name: 'Vendor A User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorShippingConfigMock.mockReset();
    getVendorShippingConfigMock.mockResolvedValue(shippingConfig);
    getFinanceDashboardMock.mockReset();
    getFinanceDashboardMock.mockResolvedValue({ profile: financeProfile });
    getFinanceProfileMock.mockReset();
    getFinanceProfileMock.mockResolvedValue(financeProfile);
    updateVendorFinancialProfileMock.mockReset();
    updateVendorFinancialProfileMock.mockImplementation((vendorId, input) =>
      Promise.resolve({
        vendorId,
        commissionPercent: input.commissionPercent.toFixed(2),
        commissionVatPercent: input.commissionVatPercent.toFixed(2),
        deductShippingEnabled: input.deductShippingEnabled,
        shippingMode: input.shippingMode,
        fixedShippingFee: input.fixedShippingFee === null ? null : input.fixedShippingFee.toFixed(2),
        settlementDelayDays: input.settlementDelayDays,
        active: true,
        source: 'configured',
      }),
    );
    getVendorBillingProfileMock.mockReset();
    getVendorBillingProfileMock.mockResolvedValue(null);
    updateVendorBillingProfileMock.mockReset();
    updateVendorBillingProfileMock.mockImplementation((vendorId, input) =>
      Promise.resolve({
        ...billingProfile,
        ...input,
        id: `billing-${vendorId}`,
        vendorId,
        updatedAt: '2026-06-07T12:00:00Z',
      }),
    );
    probeLogoIsbasiLoginMock.mockReset();
    probeLogoIsbasiLoginMock.mockResolvedValue({
      ok: true,
      provider: 'LOGO_ISBASI',
      mode: 'login_probe',
      writesPerformed: false,
      externalApiCallAttempted: true,
      httpStatus: 200,
      login: {
        code: '200',
        message: 'Login succeeded.',
        responseKeys: ['data', 'ok'],
        accessTokenPresent: true,
        tenantIdPresent: true,
        userIdPresent: false,
        userEmailPresent: false,
        userNamePresent: false,
        tokenPreview: 'abcdef...1234',
      },
    });
    discoverLogoIsbasiFirmsMock.mockReset();
    discoverLogoIsbasiFirmsMock.mockResolvedValue({
      ok: true,
      success: true,
      provider: 'LOGO_ISBASI',
      mode: 'firms_discovery',
      writesPerformed: false,
      externalApiCallAttempted: true,
      httpStatus: 200,
      count: 1,
      sampleFirms: [
        {
          id: 'firm-1',
          code: 'CARI-1',
          name: 'Demo Vendor A Ltd.',
          firmType: 'customer',
          taxNumberMasked: '11******11',
          eInvoiceResponsible: true,
          eArchiveResponsible: false,
        },
      ],
    });
    discoverLogoIsbasiIncomingEinvoicesMock.mockReset();
    discoverLogoIsbasiIncomingEinvoicesMock.mockResolvedValue({
      ok: true,
      success: true,
      provider: 'LOGO_ISBASI',
      mode: 'incoming_einvoice_discovery',
      writesPerformed: false,
      externalApiCallAttempted: true,
      httpStatus: 200,
      count: 1,
      responseKeys: ['data'],
      sampleInvoices: [
        {
          invoiceId: 'incoming-1',
          uuId: 'uuid-1',
          type: '1',
          typeDesc: 'e-Fatura',
          issueDate: '2026-06-08',
          amount: '240.00',
          currency: 'TL',
          supplier: 'Incoming Supplier Ltd.',
          supplierTcknVknMasked: '12******90',
          invoiceType: 'SATIS',
          status: 'received',
          statusCode: '100',
          eGovermentType: '1',
          eGovermentTypeDesc: 'e-Fatura',
        },
      ],
    });
    createLogoIsbasiTestInvoiceMock.mockReset();
    createLogoIsbasiTestInvoiceMock.mockResolvedValue({
      ok: true,
      success: true,
      provider: 'LOGO_ISBASI',
      mode: 'test_invoice_create',
      writesPerformed: true,
      externalApiCallAttempted: true,
      vendorId: 'demo-vendor-a',
      httpStatus: 200,
      upstreamStatus: 200,
      responseKeys: ['data'],
      invoiceId: 'logo-test-invoice-1',
      uuid: 'logo-test-uuid-1',
      ettn: 'logo-test-ettn-1',
      requestPayload: {
        invoiceId: 0,
        customer: {
          code: 'CUST001',
          tcknVkn: '11******11',
          isPerson: false,
        },
        shippingAddress: {
          title: 'Demo Vendor A Ltd.',
          name: 'Demo Vendor A Ltd.',
          address: 'Billing address 1',
          city: 'Istanbul',
          district: 'Kadikoy',
          emailAddress: 'billing@demo.test',
          phone: '+905551112233',
        },
        currency: 'TL',
        description: 'SPORGYM TEST KOMİSYON FATURASI',
        eGovernmentInvoice: {
          eGovernmentType: 0,
          invoiceTypeForEinvoice: 2,
          eInvoiceProfile: 1,
        },
        eArchivePortalInvoice: {
          eGovernmentType: 0,
          dispatchIncluded: false,
        },
        salesInvoiceDetails: [
          {
            quantity: 1,
            taxRate: 20,
            price: 1,
          },
        ],
      },
      responseBody: {
        data: {
          invoiceId: 'logo-test-invoice-1',
          uuid: 'logo-test-uuid-1',
          ettn: 'logo-test-ettn-1',
        },
      },
    });
    matchVendorLogoIsbasiFirmMock.mockReset();
    matchVendorLogoIsbasiFirmMock.mockResolvedValue({
      ok: true,
      success: true,
      provider: 'LOGO_ISBASI',
      mode: 'firm_match_probe',
      writesPerformed: false,
      externalApiCallAttempted: true,
      vendorId: 'demo-vendor-a',
      billingProfilePresent: true,
      searchedBy: {
        logoIsbasiCustomerCodePresent: true,
        taxNumberOrTcknPresent: true,
        legalCompanyNamePresent: true,
      },
      count: 1,
      matchStatus: 'exact_match',
      matchMethod: 'taxNumberOrTckn',
      exactMatch: {
        id: 'firm-1',
        code: 'CARI-1',
        name: 'Demo Vendor A Ltd.',
        firmType: 'customer',
        taxNumberMasked: '11******11',
        eInvoiceResponsible: true,
        eArchiveResponsible: false,
      },
      possibleMatches: [],
      warnings: [],
    });
    bindVendorLogoIsbasiFirmMock.mockReset();
    bindVendorLogoIsbasiFirmMock.mockResolvedValue({
      ok: true,
      success: true,
      provider: 'LOGO_ISBASI',
      mode: 'firm_bind_probe',
      writesPerformed: true,
      externalApiCallAttempted: true,
      vendorId: 'demo-vendor-a',
      matchStatus: 'exact_match',
      matchMethod: 'logoIsbasiCustomerCode',
      logoIsbasiCustomerCode: 'CUST005',
      logoIsbasiCustomerId: 'firm-5',
      logoIsbasiEinvoiceEligible: true,
      logoIsbasiLastCheckedAt: '2026-06-08T10:00:00.000Z',
      previousBinding: {
        logoIsbasiCustomerCode: 'CUST001',
        logoIsbasiCustomerId: 'firm-1',
      },
      newBinding: {
        logoIsbasiCustomerCode: 'CUST005',
        logoIsbasiCustomerId: 'firm-5',
      },
      matchedFirm: {
        name: 'ABC Teknoloji Ltd. Sti.',
        code: 'CUST005',
        taxNumberMasked: '22******22',
      },
    });
    previewLogoIsbasiCommissionInvoiceMock.mockReset();
    previewLogoIsbasiCommissionInvoiceMock.mockResolvedValue({
      ok: true,
      provider: 'LOGO_ISBASI',
      mode: 'commission_invoice_preview',
      writesPerformed: false,
      externalApiCallAttempted: false,
      payload: {
        invoiceId: 0,
        customer: {
          name: 'Demo Vendor A Ltd.',
          tcknVkn: '11******11',
          isPerson: false,
        },
        shippingAddress: {
          title: 'Demo Vendor A Ltd.',
          name: 'Demo Vendor A Ltd.',
          address: 'Billing address 1',
          city: 'Istanbul',
          district: 'Kadikoy',
          emailAddress: 'billing@demo.test',
          phone: '+905551112233',
        },
        currency: 'TL',
        description: 'Pazaryeri komisyon hizmet bedeli',
        eGovernmentInvoice: {
          eGovernmentType: 0,
          invoiceTypeForEinvoice: 2,
          eInvoiceProfile: 1,
        },
        eArchivePortalInvoice: {
          eGovernmentType: 0,
          dispatchIncluded: false,
        },
        salesInvoiceDetails: [
          {
            quantity: 1,
            taxRate: 20,
            price: 100,
            productDetail: {
              itemType: 2,
              name: 'Sporgym Pazaryeri Komisyon Hizmeti',
              vat: 20,
            },
          },
        ],
      },
      warnings: [],
    });
    listVendorSupportTicketsMock.mockReset();
    listVendorSupportTicketsMock.mockResolvedValue([]);
    listAdminSupportTicketsMock.mockReset();
    listAdminSupportTicketsMock.mockResolvedValue([]);
    createSupportTicketMock.mockReset();
  });

  it('renders a read-only marketplace vendor profile summary from existing config', async () => {
    renderVendorProfilePage();

    expect(await screen.findByRole('heading', { name: 'Demo Vendor A' })).toBeInTheDocument();
    expect(screen.getByText('Marketplace seller workspace')).toBeInTheDocument();
    expect(screen.getByText('Read-only vendor view')).toBeInTheDocument();
    expect(screen.getByText('Active workspace')).toBeInTheDocument();
    expect(screen.getByText('Legal name')).toBeInTheDocument();
    expect(screen.getAllByText('Not modeled yet').length).toBeGreaterThan(0);
    expect(await screen.findByText('12.50%')).toBeInTheDocument();
    expect(screen.getByText('External provider cost')).toBeInTheDocument();
    expect(screen.getAllByText('Navlungo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('55574').length).toBeGreaterThan(0);
    expect(screen.getByText('55578')).toBeInTheDocument();
    expect(screen.getByText('Mugla / Fethiye')).toBeInTheDocument();
    expect(screen.getByText('Konya / Selcuklu')).toBeInTheDocument();
    expect(screen.getByText('Forward warehouse')).toBeInTheDocument();
    expect(screen.getByText('Return destination')).toBeInTheDocument();
    expect(screen.getByLabelText('Vendor operational readiness')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shipping ready' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Returns ready' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Finance visibility ready' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Support channel active' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workflow access ready' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Automation visibility ready' })).toBeInTheDocument();
    expect(screen.getAllByText('Shipping enabled').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Provider configured').length).toBeGreaterThan(0);
    expect(screen.getByText('Warehouse configured')).toBeInTheDocument();
    expect(screen.getByText('Finance readiness means estimate visibility only, not payout or accounting execution.')).toBeInTheDocument();
    expect(screen.getByText('Integration status')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Finance Policy' })).toBeInTheDocument();
    expect(screen.getByText('Finance policy applies to future ledger rows only. Existing ledger rows and approved settlements keep their saved snapshots.')).toBeInTheDocument();
    expect(screen.getByText('Commission %')).toBeInTheDocument();
    expect(screen.getByText('Commission VAT %')).toBeInTheDocument();
    expect(screen.getByText('Deduct shipping after fulfillment')).toBeInTheDocument();
    expect(screen.getAllByText('Finance policy configured').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Billing source configured').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Logo binding configured').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Shipping configured').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Billing / Legal Profile' })).toBeInTheDocument();
    expect(screen.getByText('Seller legal billing identity used later as the billing source for Sporgym commission invoices.')).toBeInTheDocument();
    expect(screen.getAllByText('Admin-managed').length).toBeGreaterThan(0);
    expect(screen.getByText('Not available in vendor view')).toBeInTheDocument();
    expect(screen.queryByText(/Paraşüt contact source/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Paraşüt/i)).not.toBeInTheDocument();
    expect(getVendorBillingProfileMock).not.toHaveBeenCalled();
    expect(getFinanceProfileMock).toHaveBeenCalled();
    expect(getFinanceDashboardMock).not.toHaveBeenCalled();
    expect(screen.getByText('Shopify workspace')).toBeInTheDocument();
    expect(screen.getAllByText('Provider configuration status').length).toBeGreaterThan(0);
    expect(screen.getByText('Fields not modeled yet')).toBeInTheDocument();
    expect(screen.queryByText('Legal entity name, tax office, and tax identity')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit finance policy' })).not.toBeInTheDocument();
  });

  it('renders readiness states from missing config truth without fake ready states', async () => {
    getVendorShippingConfigMock.mockResolvedValue({
      ...shippingConfig,
      shippingEnabled: false,
      preferredProvider: 'navlungo',
      defaultWarehouseId: null,
      warehouses: [],
      providerMetadata: {},
      source: 'default',
    });
    getFinanceProfileMock.mockResolvedValue({
      ...financeProfile,
      active: false,
      source: 'default',
    });

    renderVendorProfilePage();

    const shippingHeading = await screen.findByRole('heading', { name: 'Shipping ready' });
    const shippingCard = shippingHeading.closest('article');
    expect(shippingCard).not.toBeNull();
    await waitFor(() =>
      expect(within(shippingCard!).getAllByText('Requires configuration review').length).toBeGreaterThan(0),
    );
    expect(within(shippingCard!).queryByText('Ready')).not.toBeInTheDocument();
    expect(within(shippingCard!).getByText('Enable shipping before shipment workflows can rely on this vendor setup.')).toBeInTheDocument();
    expect(within(shippingCard!).getByText('Review the provider metadata before treating shipping as ready.')).toBeInTheDocument();
    expect(within(shippingCard!).getByText('Configure a warehouse or sender address for shipment work.')).toBeInTheDocument();

    const returnsHeading = screen.getByRole('heading', { name: 'Returns ready' });
    const returnsCard = returnsHeading.closest('article');
    expect(returnsCard).not.toBeNull();
    expect(within(returnsCard!).getByText('Review the return recipient destination before return workflows rely on it.')).toBeInTheDocument();

    const financeHeading = screen.getByRole('heading', { name: 'Finance visibility ready' });
    const financeCard = financeHeading.closest('article');
    expect(financeCard).not.toBeNull();
    expect(within(financeCard!).getByText('Finance policy requires verification before treating finance visibility as ready.')).toBeInTheDocument();
  });

  it('renders readiness guidance links to existing workflow routes', async () => {
    renderVendorProfilePage();

    await screen.findByRole('heading', { name: 'Operational readiness' });
    expect(screen.getByRole('button', { name: 'Open shipping workflow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open returns review' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open settlement preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open support workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open orders queue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open automation queue' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open settlement preview' }));

    expect(await screen.findByText('Finance route')).toBeInTheDocument();
  });

  it('creates a vendor profile correction support ticket with safe context', async () => {
    const createdTicket = supportTicket({ id: 'support-created' });
    createSupportTicketMock.mockResolvedValue(createdTicket);

    renderVendorProfilePage();

    const contactButtons = await screen.findAllByRole('button', { name: 'Request profile correction' });
    await waitFor(() => expect(contactButtons[0]).not.toBeDisabled());
    await userEvent.click(contactButtons[0]);

    await waitFor(() =>
      expect(createSupportTicketMock).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'OTHER',
          contextType: 'general',
          contextId: 'demo-vendor-a',
          contextSnapshot: expect.objectContaining({
            route: 'vendor_profile_settings',
            path: '/vendor/profile',
            vendorId: 'demo-vendor-a',
            shippingProvider: 'navlungo',
            returnRecipientConfigured: true,
          }),
        }),
      ),
    );
    expect(await screen.findByText('Vendor support detail route')).toBeInTheDocument();
  });

  it('opens an existing profile correction ticket instead of creating a duplicate', async () => {
    listVendorSupportTicketsMock.mockResolvedValue([supportTicket({ id: 'support-existing' })]);

    renderVendorProfilePage();

    const supportButtons = await screen.findAllByRole('button', { name: 'Open correction ticket' });
    await waitFor(() => expect(supportButtons[0]).not.toBeDisabled());
    await userEvent.click(supportButtons[0]);

    expect(await screen.findByText('Vendor support detail route')).toBeInTheDocument();
    expect(createSupportTicketMock).not.toHaveBeenCalled();
  });

  it('shows admin-owned profile badges without rendering a broad editor before billing edit is opened', async () => {
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
    listAdminSupportTicketsMock.mockResolvedValue([supportTicket({ id: 'admin-profile-ticket' })]);

    renderVendorProfilePage();

    expect(await screen.findByText('Admin view')).toBeInTheDocument();
    expect(screen.getByText('Admin-owned configuration')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();

    const supportButtons = await screen.findAllByRole('button', { name: 'Open correction ticket' });
    await waitFor(() => expect(supportButtons[0]).not.toBeDisabled());
    await userEvent.click(supportButtons[0]);
    expect(await screen.findByText('Admin support detail route')).toBeInTheDocument();
    expect(createSupportTicketMock).not.toHaveBeenCalled();
  });

  it('renders admin billing profile values read-only with an edit action when configured', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue(billingProfile);

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();
    expect((await screen.findAllByText('Demo Vendor A Ltd.')).length).toBeGreaterThan(0);
    expect(screen.getByText('1111111111')).toBeInTheDocument();
    expect(screen.getByText('Kadikoy')).toBeInTheDocument();
    expect(screen.getByText('Billing Street 1, Istanbul')).toBeInTheDocument();
    expect(screen.getByText('Istanbul')).toBeInTheDocument();
    expect(screen.getByText('limited_company')).toBeInTheDocument();
    expect(screen.getAllByText('LOGO-CODE-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('LOGO-ID-1').length).toBeGreaterThan(0);
    expect(screen.getByText('billing@example.test')).toBeInTheDocument();
    expect(within(billingSection!).getByText('Yes')).toBeInTheDocument();
    expect(within(billingSection!).getByText('Commission invoice billing source')).toBeInTheDocument();
    expect(within(billingSection!).getAllByText('Configured').length).toBeGreaterThan(0);
    expect(within(billingSection!).getByRole('button', { name: 'Edit billing profile' })).toBeInTheDocument();
    const logoDiagnostics = within(billingSection!).getByText('Logo diagnostics').closest('details');
    expect(logoDiagnostics).not.toBeNull();
    expect(logoDiagnostics).not.toHaveAttribute('open');
    expect(within(billingSection!).queryByText(/Paraşüt/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save billing/i })).not.toBeInTheDocument();
    expect(within(billingSection!).queryByLabelText('Logo İşbaşı customer code')).not.toBeInTheDocument();
  });

  it('renders and saves admin Finance Policy controls through the existing finance profile API', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue(billingProfile);
    updateVendorFinancialProfileMock.mockImplementation((vendorId, input) =>
      Promise.resolve({
        vendorId,
        commissionPercent: input.commissionPercent.toFixed(2),
        commissionVatPercent: input.commissionVatPercent.toFixed(2),
        deductShippingEnabled: input.deductShippingEnabled,
        shippingMode: input.shippingMode,
        fixedShippingFee: input.fixedShippingFee === null ? null : input.fixedShippingFee.toFixed(2),
        settlementDelayDays: input.settlementDelayDays,
        active: true,
        source: 'configured',
      }),
    );

    renderVendorProfilePage();

    const financeHeading = await screen.findByRole('heading', { name: 'Finance Policy' });
    const financeSection = financeHeading.closest('section');
    expect(financeSection).not.toBeNull();
    expect(await within(financeSection!).findByText('Finance policy applies to future ledger rows only. Existing ledger rows and approved settlements keep their saved snapshots.')).toBeInTheDocument();
    expect(await within(financeSection!).findByText('12.50%')).toBeInTheDocument();
    expect(within(financeSection!).getByText('20.00%')).toBeInTheDocument();
    expect(within(financeSection!).getByRole('button', { name: 'Edit finance policy' })).toBeInTheDocument();

    await userEvent.click(within(financeSection!).getByRole('button', { name: 'Edit finance policy' }));

    expect(within(financeSection!).getByRole('heading', { name: 'Finance Policy edit' })).toBeInTheDocument();
    expect(within(financeSection!).getByLabelText('Commission %')).toHaveValue(12.5);
    expect(within(financeSection!).getByLabelText('Commission VAT %')).toHaveValue(20);
    expect(within(financeSection!).getByLabelText('Shipping deduction mode')).toHaveValue('external_provider');
    expect(within(financeSection!).getByLabelText('Settlement delay days')).toHaveValue(21);
    expect(within(financeSection!).getByLabelText(/Deduct shipping after fulfillment/i)).toBeChecked();

    await userEvent.clear(within(financeSection!).getByLabelText('Commission %'));
    await userEvent.type(within(financeSection!).getByLabelText('Commission %'), '13.75');
    await userEvent.clear(within(financeSection!).getByLabelText('Settlement delay days'));
    await userEvent.type(within(financeSection!).getByLabelText('Settlement delay days'), '14');
    await userEvent.selectOptions(within(financeSection!).getByLabelText('Shipping deduction mode'), 'fixed');
    await userEvent.type(within(financeSection!).getByLabelText('Fixed shipping fee'), '25');
    await userEvent.click(within(financeSection!).getByRole('button', { name: 'Save finance policy' }));

    await waitFor(() =>
      expect(updateVendorFinancialProfileMock).toHaveBeenCalledWith('demo-vendor-a', {
        commissionPercent: 13.75,
        commissionVatPercent: 20,
        deductShippingEnabled: true,
        shippingMode: 'fixed',
        fixedShippingFee: 25,
        settlementDelayDays: 14,
      }),
    );
    expect(await within(financeSection!).findByText('13.75%')).toBeInTheDocument();
    expect(within(financeSection!).getByText('25.00')).toBeInTheDocument();
    expect(within(financeSection!).getByText('14 days')).toBeInTheDocument();
    expect(createLogoIsbasiTestInvoiceMock).not.toHaveBeenCalled();
    expect(within(financeSection!).queryByRole('button', { name: 'Save finance policy' })).not.toBeInTheDocument();
  }, 10000);

  it('shows Logo binding as needing match when customer code exists without a customer id', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue({
      ...billingProfile,
      logoIsbasiCustomerCode: 'YSKOD1',
      logoIsbasiCustomerId: null,
      logoIsbasiEinvoiceEligible: null,
      logoIsbasiLastCheckedAt: null,
    });

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();
    await openLogoDiagnostics(billingSection as HTMLElement);
    const bindingHeading = await within(billingSection!).findByText('Current Logo Binding');
    const bindingPanel = bindingHeading.closest('.vendor-profile-logo-result');
    expect(bindingPanel).not.toBeNull();
    expect(within(bindingPanel as HTMLElement).getByText('Binding status')).toBeInTheDocument();
    expect(within(bindingPanel as HTMLElement).getByText('Needs match/rebind')).toBeInTheDocument();
    expect(within(bindingPanel as HTMLElement).getByText('YSKOD1')).toBeInTheDocument();
  });

  it('opens the admin billing profile edit form and validates required fields', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue(billingProfile);

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();

    await waitFor(() =>
      expect(within(billingSection!).getByRole('button', { name: 'Edit billing profile' })).toBeInTheDocument(),
    );
    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Edit billing profile' }));

    expect(within(billingSection!).getByRole('heading', { name: 'Billing / Legal Profile edit' })).toBeInTheDocument();
    expect(within(billingSection!).getByLabelText('Legal company name')).toHaveValue('Demo Vendor A Ltd.');
    expect(within(billingSection!).getByLabelText('Tax number / TCKN')).toHaveValue('1111111111');
    expect(within(billingSection!).getByLabelText('Billing city')).toHaveValue('Istanbul');
    expect(within(billingSection!).queryByLabelText('Logo İşbaşı customer id')).not.toBeInTheDocument();

    await userEvent.clear(within(billingSection!).getByLabelText('Billing email'));
    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Save billing profile' }));

    expect(await within(billingSection!).findByRole('alert')).toHaveTextContent('Billing email is required for commission invoices.');
    expect(updateVendorBillingProfileMock).not.toHaveBeenCalled();
  });

  it('saves edited admin billing profile fields through the existing API', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue(billingProfile);
    updateVendorBillingProfileMock.mockImplementation((vendorId, input) =>
      Promise.resolve({
        ...billingProfile,
        ...input,
        vendorId,
        legalCompanyName: input.legalCompanyName,
        taxNumber: input.taxNumber,
        taxOffice: input.taxOffice,
        billingAddress: input.billingAddress,
        billingCity: input.billingCity ?? null,
        billingDistrict: input.billingDistrict ?? null,
        billingEmail: input.billingEmail ?? null,
        logoIsbasiCustomerCode: input.logoIsbasiCustomerCode ?? null,
        logoIsbasiCustomerId: billingProfile.logoIsbasiCustomerId,
        logoIsbasiEinvoiceEligible: billingProfile.logoIsbasiEinvoiceEligible,
        logoIsbasiLastCheckedAt: billingProfile.logoIsbasiLastCheckedAt,
        updatedAt: '2026-06-07T12:00:00Z',
      }),
    );

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();

    await waitFor(() =>
      expect(within(billingSection!).getByRole('button', { name: 'Edit billing profile' })).toBeInTheDocument(),
    );
    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Edit billing profile' }));
    expect(within(billingSection!).getByLabelText('Logo İşbaşı customer code')).toBeInTheDocument();
    expect(within(billingSection!).queryByLabelText('Logo İşbaşı customer id')).not.toBeInTheDocument();
    expect(within(billingSection!).queryByLabelText('Logo İşbaşı e-invoice eligible')).not.toBeInTheDocument();
    expect(within(billingSection!).queryByLabelText('Logo İşbaşı last checked')).not.toBeInTheDocument();
    await userEvent.clear(within(billingSection!).getByLabelText('Legal company name'));
    await userEvent.type(within(billingSection!).getByLabelText('Legal company name'), 'Updated Vendor Legal A.S.');
    await userEvent.clear(within(billingSection!).getByLabelText('Tax number / TCKN'));
    await userEvent.type(within(billingSection!).getByLabelText('Tax number / TCKN'), '2222222222');
    await userEvent.clear(within(billingSection!).getByLabelText('Billing city'));
    await userEvent.type(within(billingSection!).getByLabelText('Billing city'), 'Izmir');
    await userEvent.clear(within(billingSection!).getByLabelText('Billing district'));
    await userEvent.type(within(billingSection!).getByLabelText('Billing district'), 'Konak');
    await userEvent.clear(within(billingSection!).getByLabelText('Billing email'));
    await userEvent.type(within(billingSection!).getByLabelText('Billing email'), 'updated-billing@example.test');
    await userEvent.clear(within(billingSection!).getByLabelText('Logo İşbaşı customer code'));
    await userEvent.type(within(billingSection!).getByLabelText('Logo İşbaşı customer code'), 'CUST001');

    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Save billing profile' }));

    await waitFor(() =>
      expect(updateVendorBillingProfileMock).toHaveBeenCalledWith(
        'demo-vendor-a',
        expect.objectContaining({
          legalCompanyName: 'Updated Vendor Legal A.S.',
          taxNumber: '2222222222',
          taxOffice: 'Kadikoy',
          billingAddress: 'Billing Street 1, Istanbul',
          billingCity: 'Izmir',
          billingDistrict: 'Konak',
          billingEmail: 'updated-billing@example.test',
          legalEntityType: 'limited_company',
          logoIsbasiCustomerCode: 'CUST001',
        }),
      ),
    );
    const savedInput = updateVendorBillingProfileMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(savedInput).not.toHaveProperty('logoIsbasiCustomerId');
    expect(savedInput).not.toHaveProperty('logoIsbasiEinvoiceEligible');
    expect(savedInput).not.toHaveProperty('logoIsbasiLastCheckedAt');
    expect(await within(billingSection!).findByText('Updated Vendor Legal A.S.')).toBeInTheDocument();
    expect(within(billingSection!).getByText('2222222222')).toBeInTheDocument();
    expect(within(billingSection!).getByText('Izmir')).toBeInTheDocument();
    expect(within(billingSection!).getByText('Konak')).toBeInTheDocument();
    expect(within(billingSection!).getByText('updated-billing@example.test')).toBeInTheDocument();
    expect(within(billingSection!).getAllByText('CUST001').length).toBeGreaterThan(0);
    expect(within(billingSection!).queryByRole('heading', { name: 'Billing / Legal Profile edit' })).not.toBeInTheDocument();
  }, 10000);

  it('shows current Logo binding and allows a rebind through diagnostics', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue({
      ...billingProfile,
      logoIsbasiCustomerCode: 'CUST001',
      logoIsbasiCustomerId: 'firm-1',
      logoIsbasiLastCheckedAt: '2026-06-07T10:00:00Z',
    });
    bindVendorLogoIsbasiFirmMock.mockResolvedValue({
      ok: true,
      success: true,
      provider: 'LOGO_ISBASI',
      mode: 'firm_bind_probe',
      writesPerformed: true,
      externalApiCallAttempted: true,
      vendorId: 'demo-vendor-a',
      matchStatus: 'exact_match',
      matchMethod: 'logoIsbasiCustomerCode',
      logoIsbasiCustomerCode: 'CUST005',
      logoIsbasiCustomerId: 'firm-5',
      logoIsbasiEinvoiceEligible: true,
      logoIsbasiLastCheckedAt: '2026-06-08T10:00:00.000Z',
      previousBinding: {
        logoIsbasiCustomerCode: 'CUST001',
        logoIsbasiCustomerId: 'firm-1',
      },
      newBinding: {
        logoIsbasiCustomerCode: 'CUST005',
        logoIsbasiCustomerId: 'firm-5',
      },
      matchedFirm: {
        name: 'ABC Teknoloji Ltd. Sti.',
        code: 'CUST005',
        taxNumberMasked: '22******22',
      },
    });

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();
    await openLogoDiagnostics(billingSection as HTMLElement);

    expect(await within(billingSection!).findByText('Current Logo Binding')).toBeInTheDocument();
    expect(within(billingSection!).getAllByText('CUST001').length).toBeGreaterThan(0);
    expect(within(billingSection!).getAllByText('firm-1').length).toBeGreaterThan(0);
    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Rebind Logo Firm' }));

    await waitFor(() => expect(bindVendorLogoIsbasiFirmMock).toHaveBeenCalledWith('demo-vendor-a'));
    expect(await within(billingSection!).findByText('Logo firm bind result')).toBeInTheDocument();
    expect(within(billingSection!).getByText('logoIsbasiCustomerCode')).toBeInTheDocument();
    expect(within(billingSection!).getByText('Previous binding')).toBeInTheDocument();
    expect(within(billingSection!).getAllByText('CUST001').length).toBeGreaterThan(0);
    expect(within(billingSection!).getByText('New binding')).toBeInTheDocument();
    expect(within(billingSection!).getAllByText('CUST005').length).toBeGreaterThan(0);
    expect(within(billingSection!).getByText('ABC Teknoloji Ltd. Sti.')).toBeInTheDocument();
    expect(within(billingSection!).getByText(/tax 22\*\*\*\*\*\*22/)).toBeInTheDocument();
    expect(within(billingSection!).getAllByText('firm-5').length).toBeGreaterThan(0);
  });

  it('runs the Logo İşbaşı login probe and displays sanitized fields only', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue(billingProfile);

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();
    await openLogoDiagnostics(billingSection as HTMLElement);

    await waitFor(() =>
      expect(within(billingSection!).getByRole('button', { name: 'Test Logo Login' })).toBeInTheDocument(),
    );
    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Test Logo Login' }));

    await waitFor(() => expect(probeLogoIsbasiLoginMock).toHaveBeenCalled());
    expect(await within(billingSection!).findByText('Logo login diagnostics result')).toBeInTheDocument();
    expect(within(billingSection!).getByText('Status')).toBeInTheDocument();
    expect(within(billingSection!).getByText('Success')).toBeInTheDocument();
    expect(within(billingSection!).getByText('HTTP status')).toBeInTheDocument();
    expect(within(billingSection!).getAllByText('200').length).toBeGreaterThan(0);
    expect(within(billingSection!).getByText('Login succeeded.')).toBeInTheDocument();
    expect(within(billingSection!).getByText('accessTokenPresent')).toBeInTheDocument();
    expect(within(billingSection!).getAllByText('Yes').length).toBeGreaterThan(0);
    expect(within(billingSection!).getByText('responseKeys')).toBeInTheDocument();
    expect(within(billingSection!).getByText('data, ok')).toBeInTheDocument();
    expect(within(billingSection!).getByText('tokenPreview')).toBeInTheDocument();
    expect(within(billingSection!).getByText('abcdef...1234')).toBeInTheDocument();
    expect(within(billingSection!).queryByText(/full-secret-token/)).not.toBeInTheDocument();
    expect(within(billingSection!).queryByText(/api-key-secret|password-secret|integration-user@example/i)).not.toBeInTheDocument();
  });

  it('renders a persistent Logo login failure panel with missing env names only', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue(billingProfile);
    probeLogoIsbasiLoginMock.mockRejectedValue(
      new ApiError('Backend request failed.', 'server', {
        status: 422,
        details: {
          ok: false,
          provider: 'LOGO_ISBASI',
          mode: 'login_probe',
          writesPerformed: false,
          externalApiCallAttempted: false,
          httpStatus: 422,
          errorCode: 'LOGO_ISBASI_ENV_MISSING',
          message: 'Required Logo İşbaşı environment variables are missing.',
          missingEnv: ['LOGO_ISBASI_API_KEY', 'LOGO_ISBASI_PASSWORD'],
        },
      }),
    );

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();
    await openLogoDiagnostics(billingSection as HTMLElement);

    await waitFor(() =>
      expect(within(billingSection!).getByRole('button', { name: 'Test Logo Login' })).toBeInTheDocument(),
    );
    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Test Logo Login' }));

    expect(await within(billingSection!).findByText('Logo login diagnostics result')).toBeInTheDocument();
    expect(within(billingSection!).getByText('Failed')).toBeInTheDocument();
    expect(within(billingSection!).getByText('LOGO_ISBASI_ENV_MISSING')).toBeInTheDocument();
    expect(within(billingSection!).getByText('Required Logo İşbaşı environment variables are missing.')).toBeInTheDocument();
    expect(within(billingSection!).getByText('LOGO_ISBASI_API_KEY, LOGO_ISBASI_PASSWORD')).toBeInTheDocument();
    expect(within(billingSection!).queryByText(/api-key-secret|password-secret|integration-user@example|full-secret-token/i)).not.toBeInTheDocument();
  });

  it('renders non-2xx Logo backend JSON errors instead of a transient-only message', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue(billingProfile);
    probeLogoIsbasiLoginMock.mockRejectedValue(
      new ApiError('Backend request failed.', 'server', {
        status: 502,
        details: {
          ok: false,
          provider: 'LOGO_ISBASI',
          mode: 'login_probe',
          writesPerformed: false,
          externalApiCallAttempted: true,
          httpStatus: 401,
          errorCode: 'LOGO_ISBASI_UPSTREAM_NON_2XX',
          message: 'Logo İşbaşı login request failed.',
          login: {
            responseKeys: ['code', 'message'],
            accessTokenPresent: false,
            tenantIdPresent: false,
            userIdPresent: false,
            userEmailPresent: false,
            userNamePresent: false,
            code: '401',
            message: 'Invalid integration credentials.',
          },
        },
      }),
    );

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();
    await openLogoDiagnostics(billingSection as HTMLElement);

    await waitFor(() =>
      expect(within(billingSection!).getByRole('button', { name: 'Test Logo Login' })).toBeInTheDocument(),
    );
    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Test Logo Login' }));

    expect(await within(billingSection!).findByText('LOGO_ISBASI_UPSTREAM_NON_2XX')).toBeInTheDocument();
    expect(within(billingSection!).getByText('Invalid integration credentials.')).toBeInTheDocument();
    expect(within(billingSection!).getAllByText('401').length).toBeGreaterThan(0);
    expect(within(billingSection!).getByText('code, message')).toBeInTheDocument();
  });

  it('discovers Logo firms and displays sanitized samples only', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue(billingProfile);

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();
    await openLogoDiagnostics(billingSection as HTMLElement);

    await waitFor(() =>
      expect(within(billingSection!).getByRole('button', { name: 'Discover Logo Firms' })).toBeInTheDocument(),
    );
    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Discover Logo Firms' }));

    await waitFor(() => expect(discoverLogoIsbasiFirmsMock).toHaveBeenCalled());
    expect(await within(billingSection!).findByText('Logo firms discovery result')).toBeInTheDocument();
    expect(within(billingSection!).getByText('Firm count')).toBeInTheDocument();
    const firmSamples = within(billingSection!).getByLabelText('Logo firm samples');
    expect(within(firmSamples).getByText('Demo Vendor A Ltd.')).toBeInTheDocument();
    expect(within(firmSamples).getByText(/tax 11\*\*\*\*\*\*11/)).toBeInTheDocument();
    expect(within(firmSamples).queryByText('1111111111')).not.toBeInTheDocument();
    expect(within(firmSamples).queryByText(/api-key-secret|password-secret|full-secret-token/i)).not.toBeInTheDocument();
  });

  it('discovers incoming Logo e-invoices and displays sanitized samples only', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue(billingProfile);

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();
    await openLogoDiagnostics(billingSection as HTMLElement);

    await waitFor(() =>
      expect(within(billingSection!).getByRole('button', { name: 'Discover Incoming E-Invoices' })).toBeInTheDocument(),
    );
    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Discover Incoming E-Invoices' }));

    await waitFor(() => expect(discoverLogoIsbasiIncomingEinvoicesMock).toHaveBeenCalled());
    expect(await within(billingSection!).findByText('Logo incoming e-invoices discovery result')).toBeInTheDocument();
    expect(within(billingSection!).getByText('responseKeys')).toBeInTheDocument();
    const invoiceSamples = within(billingSection!).getByLabelText('Logo incoming e-invoice samples');
    expect(within(invoiceSamples).getByText('Incoming Supplier Ltd.')).toBeInTheDocument();
    expect(within(invoiceSamples).getByText(/supplier tax 12\*\*\*\*\*\*90/)).toBeInTheDocument();
    expect(within(invoiceSamples).queryByText('1234567890')).not.toBeInTheDocument();
    expect(within(invoiceSamples).queryByText(/api-key-secret|password-secret|full-secret-token/i)).not.toBeInTheDocument();
  });

  it('requires acknowledgement before creating a Logo test invoice and renders sanitized result', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue(billingProfile);

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();
    await openLogoDiagnostics(billingSection as HTMLElement);

    await waitFor(() =>
      expect(within(billingSection!).getByRole('button', { name: 'Create TEST Invoice' })).toBeInTheDocument(),
    );
    const createButton = within(billingSection!).getByRole('button', { name: 'Create TEST Invoice' });
    expect(createButton).toBeDisabled();
    expect(within(billingSection!).getByText('This section contains read-only Logo probes plus the existing test-invoice tool. It is not a settlement invoice execution flow.')).toBeInTheDocument();

    await userEvent.click(within(billingSection!).getByLabelText('I understand this creates a test invoice.'));
    expect(createButton).toBeEnabled();
    await userEvent.click(createButton);

    await waitFor(() => expect(createLogoIsbasiTestInvoiceMock).toHaveBeenCalledWith('demo-vendor-a'));
    expect(await within(billingSection!).findByText('Logo TEST invoice creation result')).toBeInTheDocument();
    const testInvoicePanel = within(billingSection!).getByText('Logo TEST invoice creation result')
      .closest('.vendor-profile-logo-result');
    expect(testInvoicePanel).not.toBeNull();
    expect(within(testInvoicePanel as HTMLElement).getByText('logo-test-invoice-1')).toBeInTheDocument();
    expect(within(testInvoicePanel as HTMLElement).getByText('logo-test-uuid-1')).toBeInTheDocument();
    expect(within(testInvoicePanel as HTMLElement).getByText('logo-test-ettn-1')).toBeInTheDocument();
    expect(within(testInvoicePanel as HTMLElement).getByText(/11\*\*\*\*\*\*11/)).toBeInTheDocument();
    expect(within(testInvoicePanel as HTMLElement).queryByText('1111111111')).not.toBeInTheDocument();
    expect(within(testInvoicePanel as HTMLElement).queryByText(/api-key-secret|password-secret|full-secret-token/i)).not.toBeInTheDocument();
  });

  it('matches the selected vendor to a Logo firm without saving anything', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue(billingProfile);
    matchVendorLogoIsbasiFirmMock.mockResolvedValue({
      ok: true,
      success: true,
      provider: 'LOGO_ISBASI',
      mode: 'firm_match_probe',
      writesPerformed: false,
      externalApiCallAttempted: true,
      vendorId: 'demo-vendor-a',
      billingProfilePresent: true,
      searchedBy: {
        logoIsbasiCustomerCodePresent: true,
        taxNumberOrTcknPresent: true,
        legalCompanyNamePresent: true,
      },
      count: 2,
      matchStatus: 'exact_match',
      matchMethod: 'logoIsbasiCustomerCode',
      exactMatch: {
        id: 'firm-1',
        code: 'CUST001',
        name: 'Demo Vendor A Ltd.',
        firmType: 'customer',
        taxNumberMasked: '11******11',
        eInvoiceResponsible: true,
        eArchiveResponsible: false,
      },
      possibleMatches: [],
      warnings: [],
    });

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();
    await openLogoDiagnostics(billingSection as HTMLElement);

    await waitFor(() =>
      expect(within(billingSection!).getByRole('button', { name: 'Match Vendor To Logo Firm' })).toBeInTheDocument(),
    );
    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Match Vendor To Logo Firm' }));

    await waitFor(() => expect(matchVendorLogoIsbasiFirmMock).toHaveBeenCalledWith('demo-vendor-a'));
    expect(await within(billingSection!).findByText('Logo vendor firm match result')).toBeInTheDocument();
    expect(within(billingSection!).getByText('exact_match')).toBeInTheDocument();
    expect(within(billingSection!).getByText('logoIsbasiCustomerCode')).toBeInTheDocument();
    expect(within(billingSection!).getByText('Exact match')).toBeInTheDocument();
    const exactMatchCard = within(billingSection!).getByText('Exact match').closest('.vendor-profile-logo-match-card');
    expect(exactMatchCard).not.toBeNull();
    expect(within(exactMatchCard as HTMLElement).getByText('Demo Vendor A Ltd.')).toBeInTheDocument();
    expect(within(exactMatchCard as HTMLElement).getByText(/code CUST001/)).toBeInTheDocument();
    expect(within(exactMatchCard as HTMLElement).getByText(/tax 11\*\*\*\*\*\*11/)).toBeInTheDocument();
    expect(updateVendorBillingProfileMock).not.toHaveBeenCalled();
    expect(within(exactMatchCard as HTMLElement).queryByText('1111111111')).not.toBeInTheDocument();
  });

  it('opens the Logo commission e-Fatura preview form and validates required amount', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue(billingProfile);

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();
    await openLogoDiagnostics(billingSection as HTMLElement);

    await waitFor(() =>
      expect(within(billingSection!).getByRole('button', { name: 'Preview Commission e-Fatura' })).toBeInTheDocument(),
    );
    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Preview Commission e-Fatura' }));

    expect(within(billingSection!).getByRole('heading', { name: 'Commission e-Fatura dry-run preview' })).toBeInTheDocument();
    expect(within(billingSection!).getByLabelText('VAT rate')).toHaveValue(20);
    expect(within(billingSection!).getByLabelText('Currency')).toHaveValue('TL');
    expect(within(billingSection!).getByLabelText('Description')).toHaveValue('Pazaryeri komisyon hizmet bedeli');

    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Generate preview' }));

    expect(await within(billingSection!).findByRole('alert')).toHaveTextContent('Commission amount is required.');
    expect(previewLogoIsbasiCommissionInvoiceMock).not.toHaveBeenCalled();
    expect(within(billingSection!).queryByRole('button', { name: 'Create invoice' })).not.toBeInTheDocument();
    expect(within(billingSection!).queryByRole('button', { name: /send invoice/i })).not.toBeInTheDocument();
  });

  it('displays the sanitized Logo commission e-Fatura preview payload', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue(billingProfile);

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();
    await openLogoDiagnostics(billingSection as HTMLElement);

    await waitFor(() =>
      expect(within(billingSection!).getByRole('button', { name: 'Preview Commission e-Fatura' })).toBeInTheDocument(),
    );
    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Preview Commission e-Fatura' }));
    await userEvent.type(within(billingSection!).getByLabelText('Commission amount'), '100');
    await userEvent.type(within(billingSection!).getByLabelText('Source period'), '2026-06');
    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Generate preview' }));

    await waitFor(() =>
      expect(previewLogoIsbasiCommissionInvoiceMock).toHaveBeenCalledWith(
        'demo-vendor-a',
        expect.objectContaining({
          commissionAmount: '100',
          vatRate: '20',
          currency: 'TL',
          description: 'Pazaryeri komisyon hizmet bedeli',
          sourcePeriod: '2026-06',
        }),
      ),
    );
    expect(await within(billingSection!).findByText('Commission e-Fatura sanitized preview')).toBeInTheDocument();
    expect(within(billingSection!).getByText(/"invoiceId": 0/)).toBeInTheDocument();
    expect(within(billingSection!).getByText(/"itemType": 2/)).toBeInTheDocument();
    expect(within(billingSection!).getByText(/11\*\*\*\*\*\*11/)).toBeInTheDocument();
    expect(within(billingSection!).queryByRole('button', { name: 'Create invoice' })).not.toBeInTheDocument();
    expect(within(billingSection!).queryByRole('button', { name: /send invoice/i })).not.toBeInTheDocument();
  });

  it('shows Logo commission preview validation errors when billing profile is incomplete', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorBillingProfileMock.mockResolvedValue({ ...billingProfile, billingCity: null });
    previewLogoIsbasiCommissionInvoiceMock.mockRejectedValue(
      new Error('Vendor billing profile is missing required fields: billingCity.'),
    );

    renderVendorProfilePage();

    const billingHeading = await screen.findByRole('heading', { name: 'Billing / Legal Profile' });
    const billingSection = billingHeading.closest('section');
    expect(billingSection).not.toBeNull();
    await openLogoDiagnostics(billingSection as HTMLElement);

    await waitFor(() =>
      expect(within(billingSection!).getByRole('button', { name: 'Preview Commission e-Fatura' })).toBeInTheDocument(),
    );
    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Preview Commission e-Fatura' }));
    await userEvent.type(within(billingSection!).getByLabelText('Commission amount'), '100');
    await userEvent.click(within(billingSection!).getByRole('button', { name: 'Generate preview' }));

    expect(await within(billingSection!).findByRole('alert')).toHaveTextContent(
      'Vendor billing profile is missing required fields: billingCity.',
    );
    expect(within(billingSection!).queryByText('Commission e-Fatura sanitized preview')).not.toBeInTheDocument();
  });
});
