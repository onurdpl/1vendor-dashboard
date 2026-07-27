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
  VendorIntegrationProviderManagement,
  VendorIntegrationTokenCreateInput,
  VendorIntegrationTokenCreateResult,
  VendorProfileAuditLog,
  VendorStatus,
  VendorShippingConfig,
} from '../lib/api/contracts';
import { getCurrentVendorContext, setCurrentUser, setCurrentVendorId, setToken } from '../lib/auth';

const getVendorShippingConfigMock = vi.fn<
  (options?: { vendorId?: string | null; signal?: AbortSignal }) => Promise<VendorShippingConfig>
>();
const getShippingProviderDiagnosticsMock = vi.fn();
const updateVendorShippingConfigMock = vi.fn();
const syncKargonomiWarehouseDetailsMock = vi.fn();
const getFinanceProfileMock = vi.fn<
  (options?: { vendorId?: string | null; signal?: AbortSignal }) => Promise<VendorFinancialProfile>
>();
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
      settlementFrequencyType: VendorFinancialProfile['settlementFrequencyType'];
      weeklySettlementDay: VendorFinancialProfile['weeklySettlementDay'];
      autoSettlementDraftEnabled: boolean;
      autoSettlementApproveEnabled: boolean;
      autoSettlementInvoiceEnabled: boolean;
    },
  ) => Promise<VendorFinancialProfile>
>();
const getFinanceDashboardMock = vi.fn();
const getVendorBillingProfileMock = vi.fn<(vendorId: string, options?: { signal?: AbortSignal }) => Promise<VendorBillingProfile | null>>();
const updateVendorBillingProfileMock = vi.fn<(vendorId: string, input: VendorBillingProfileInput) => Promise<VendorBillingProfile>>();
const getVendorStatusMock = vi.fn<(vendorId: string, options?: { signal?: AbortSignal }) => Promise<VendorStatus>>();
const updateVendorStatusMock = vi.fn<
  (vendorId: string, input: { status: 'active' | 'inactive'; reason?: string }) => Promise<VendorStatus>
>();
const listVendorProfileAuditLogsMock = vi.fn<
  (vendorId: string, options?: { signal?: AbortSignal; limit?: number }) => Promise<VendorProfileAuditLog[]>
>();
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
const createAdminVendorSupportTicketMock = vi.fn();
const vendorIntegrationProvidersMock = vi.fn<() => Promise<VendorIntegrationProviderManagement>>();
const createVendorIntegrationTokenMock = vi.fn<
  (input: VendorIntegrationTokenCreateInput) => Promise<VendorIntegrationTokenCreateResult>
>();

vi.mock('../features/orders/api', async () => {
  const actual = await vi.importActual<typeof import('../features/orders/api')>('../features/orders/api');
  return {
    ...actual,
    getVendorShippingConfig: (options?: { vendorId?: string | null; signal?: AbortSignal }) =>
      getVendorShippingConfigMock(options),
    getShippingProviderDiagnostics: (options?: { vendorId?: string | null; provider?: string | null; signal?: AbortSignal }) =>
      getShippingProviderDiagnosticsMock(options),
    updateVendorShippingConfig: (vendorId: string, input: unknown) => updateVendorShippingConfigMock(vendorId, input),
    syncKargonomiWarehouseDetails: (vendorId: string, warehouseId: string) =>
      syncKargonomiWarehouseDetailsMock(vendorId, warehouseId),
  };
});

vi.mock('../features/finance/api', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/api')>('../features/finance/api');
  return {
    ...actual,
    getFinanceDashboard: () => getFinanceDashboardMock(),
    getFinanceProfile: (options?: { vendorId?: string | null; signal?: AbortSignal }) => getFinanceProfileMock(options),
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
    getVendorBillingProfile: (vendorId: string, options?: { signal?: AbortSignal }) =>
      getVendorBillingProfileMock(vendorId, options),
    getVendorStatus: (vendorId: string, options?: { signal?: AbortSignal }) => getVendorStatusMock(vendorId, options),
    listVendorProfileAuditLogs: (vendorId: string, options?: { signal?: AbortSignal; limit?: number }) =>
      listVendorProfileAuditLogsMock(vendorId, options),
    updateVendorBillingProfile: (vendorId: string, input: VendorBillingProfileInput) =>
      updateVendorBillingProfileMock(vendorId, input),
    updateVendorStatus: (vendorId: string, input: { status: 'active' | 'inactive'; reason?: string }) =>
      updateVendorStatusMock(vendorId, input),
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
    createAdminVendorSupportTicket: (...args: unknown[]) => createAdminVendorSupportTicketMock(...args),
    createSupportTicket: (...args: unknown[]) => createSupportTicketMock(...args),
    listAdminSupportTickets: () => listAdminSupportTicketsMock(),
    listVendorSupportTickets: () => listVendorSupportTicketsMock(),
  };
});

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    vendorIntegration: {
      providers: () => vendorIntegrationProvidersMock(),
      createToken: (input: VendorIntegrationTokenCreateInput) => createVendorIntegrationTokenMock(input),
      revokeProviderToken: vi.fn(),
    },
  },
}));

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

const emptyVendorIntegrationProviders: VendorIntegrationProviderManagement = {
  generatedAt: '2026-06-02T12:00:00.000Z',
  providers: [],
};

const vendorIntegrationProviders: VendorIntegrationProviderManagement = {
  generatedAt: '2026-06-02T12:00:00.000Z',
  providers: [
    {
      clientId: 'client-demo-vendor-a',
      providerName: 'Demo ERP',
      vendorIdentifier: 'demo-vendor-a',
      scopes: ['orders:read', 'status:write', 'shipment:write', 'invoice:write'],
      enabled: true,
      revokedAt: null,
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-01T10:00:00.000Z',
      lastUsedAt: null,
      lastRequestAt: null,
      requestsLast24h: 0,
      rateLimitedLast24h: 0,
      authFailuresLast24h: null,
      recentAuditLogs: [],
    },
  ],
};

function shippingProviderDiagnostics() {
  return {
    provider: 'kargonomi',
    supportedProviders: ['kargonomi'],
    executionReady: true,
    sandboxModeEnabled: false,
    shippingExecutionEnabled: true,
    providerSelected: true,
    providerEnabled: true,
    webhookIngestEnabled: false,
    baseUrlConfigured: true,
    apiKeyConfigured: true,
    cargoIntegrationIdConfigured: false,
    warehouseIdConfigured: true,
    defaultDesiConfigured: true,
    packageTypeUsed: 'box',
    notificationUrlConfigured: false,
    webhookRouteImplemented: true,
    receiverAddressAvailability: 'confirmed_required',
    dummyKargoSupport: 'not_implemented',
    statusSyncSupport: 'not_implemented',
    missing: [],
    deprecatedEnvFallbacks: [],
    warnings: [],
  };
}

const financeProfile: VendorFinancialProfile = {
  vendorId: 'demo-vendor-a',
  commissionPercent: '12.50',
  commissionVatPercent: '20.00',
  deductShippingEnabled: true,
  shippingMode: 'external_provider',
  fixedShippingFee: null,
  settlementDelayDays: 21,
  settlementFrequencyType: 'WEEKLY',
  weeklySettlementDay: 'WEDNESDAY',
  autoSettlementDraftEnabled: false,
  autoSettlementApproveEnabled: false,
  autoSettlementInvoiceEnabled: false,
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

const activeVendorStatus: VendorStatus = {
  vendorId: 'demo-vendor-a',
  vendorName: 'Demo Vendor A',
  status: 'active',
  restricted: false,
  restrictionReason: null,
  changedByUserId: null,
  changedByEmail: null,
  changedAt: null,
};

const profileAuditLogs: VendorProfileAuditLog[] = [
  {
    id: 'audit-finance-1',
    vendorId: 'demo-vendor-a',
    section: 'finance_policy',
    fieldName: 'commissionVatPercent',
    oldValue: '18.00',
    newValue: '20.00',
    changedByUserId: 'admin-user-1',
    changedByEmail: 'admin@example.test',
    changedAt: '2026-06-12T09:00:00Z',
    reason: null,
    snapshotImpact: 'FUTURE_LEDGER_ROWS_ONLY',
    source: 'admin_finance_policy_update',
  },
  {
    id: 'audit-billing-1',
    vendorId: 'demo-vendor-a',
    section: 'billing_legal_profile',
    fieldName: 'legalCompanyName',
    oldValue: 'Old Demo Ltd.',
    newValue: 'Demo Vendor A Ltd.',
    changedByUserId: 'admin-user-1',
    changedByEmail: 'admin@example.test',
    changedAt: '2026-06-11T09:00:00Z',
    reason: null,
    snapshotImpact: 'FUTURE_SETTLEMENT_APPROVALS_ONLY',
    source: 'admin_billing_profile_update',
  },
  {
    id: 'audit-logo-1',
    vendorId: 'demo-vendor-a',
    section: 'logo_binding',
    fieldName: 'logoIsbasiCustomerId',
    oldValue: null,
    newValue: 'LOGO-ID-1',
    changedByUserId: 'admin-user-1',
    changedByEmail: 'admin@example.test',
    changedAt: '2026-06-10T09:00:00Z',
    reason: null,
    snapshotImpact: 'PROVIDER_REBIND_REQUIRED',
    source: 'logo_isbasi_firm_bind',
  },
  {
    id: 'audit-shipping-1',
    vendorId: 'demo-vendor-a',
    section: 'shipping_operations',
    fieldName: 'defaultWarehouseId',
    oldValue: null,
    newValue: '55574',
    changedByUserId: 'admin-user-1',
    changedByEmail: 'admin@example.test',
    changedAt: '2026-06-09T09:00:00Z',
    reason: null,
    snapshotImpact: 'FUTURE_SHIPMENTS_AND_RETURNS_ONLY',
    source: 'admin_shipping_config_update',
  },
];

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
          <Route path="/admin/vendors/:vendorId" element={<VendorProfilePage />} />
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

const ADMIN_VENDOR_PROFILE_SECTION_IDS = [
  'vendor-profile-overview',
  'vendor-profile-account',
  'vendor-profile-billing-legal',
  'vendor-profile-finance',
  'vendor-profile-shipping-returns',
  'vendor-profile-integrations',
  'vendor-profile-diagnostics',
  'vendor-profile-audit-history',
  'vendor-profile-support',
] as const;

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
    getShippingProviderDiagnosticsMock.mockReset();
    getShippingProviderDiagnosticsMock.mockResolvedValue(shippingProviderDiagnostics());
    updateVendorShippingConfigMock.mockReset();
    updateVendorShippingConfigMock.mockImplementation((vendorId: string, input: Partial<VendorShippingConfig>) =>
      Promise.resolve({
        ...shippingConfig,
        ...input,
        vendorId,
        preferredProvider: input.preferredProvider ?? 'kargonomi',
        defaultDesi: String(input.defaultDesi ?? shippingConfig.defaultDesi),
        shippingVatPercent: String(input.shippingVatPercent ?? shippingConfig.shippingVatPercent),
        updatedAt: '2026-06-30T12:30:00Z',
      }),
    );
    syncKargonomiWarehouseDetailsMock.mockReset();
    syncKargonomiWarehouseDetailsMock.mockResolvedValue({
      ok: true,
      provider: 'KARGONOMI',
      mode: 'warehouse_detail_sync',
      vendorId: 'demo-vendor-a',
      warehouseId: '55574',
      writesPerformed: true,
      warehouse: {
        contactNamePresent: true,
        phonePresent: true,
        addressPresent: true,
        stateIdPresent: true,
        cityIdPresent: true,
      },
      syncedConfig: shippingConfig,
    });
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
        settlementFrequencyType: input.settlementFrequencyType,
        weeklySettlementDay: input.weeklySettlementDay,
        autoSettlementDraftEnabled: input.autoSettlementDraftEnabled,
        autoSettlementApproveEnabled: input.autoSettlementApproveEnabled,
        autoSettlementInvoiceEnabled: input.autoSettlementInvoiceEnabled,
        active: true,
        source: 'configured',
      }),
    );
    getVendorBillingProfileMock.mockReset();
    getVendorBillingProfileMock.mockResolvedValue(null);
    getVendorStatusMock.mockReset();
    getVendorStatusMock.mockResolvedValue(activeVendorStatus);
    updateVendorStatusMock.mockReset();
    updateVendorStatusMock.mockImplementation((vendorId, input) =>
      Promise.resolve({
        ...activeVendorStatus,
        vendorId,
        status: input.status,
        restricted: input.status !== 'active',
        restrictionReason: input.reason ?? null,
        changedByUserId: 'admin-user-1',
        changedByEmail: 'admin@demo.com',
        changedAt: '2026-06-30T12:00:00Z',
      }),
    );
    listVendorProfileAuditLogsMock.mockReset();
    listVendorProfileAuditLogsMock.mockResolvedValue(profileAuditLogs);
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
    createAdminVendorSupportTicketMock.mockReset();
    vendorIntegrationProvidersMock.mockReset();
    vendorIntegrationProvidersMock.mockResolvedValue(emptyVendorIntegrationProviders);
    createVendorIntegrationTokenMock.mockReset();
    createVendorIntegrationTokenMock.mockResolvedValue({
      clientId: 'client-demo-vendor-a',
      vendorIdentifier: 'demo-vendor-a',
      providerName: 'Demo ERP',
      scopes: ['orders:read', 'status:write', 'shipment:write', 'invoice:write'],
      token: 'spg_vi_plaintext_once',
      tokenWarning: 'Sensitive: this plaintext token is shown only once. Store it securely.',
    });
  });

  it('renders a simplified vendor settings workspace from existing config', async () => {
    renderVendorProfilePage();

    expect(await screen.findByRole('heading', { name: 'Demo Vendor A' })).toBeInTheDocument();
    expect(screen.getByText('Marketplace Seller Workspace')).toBeInTheDocument();
    expect(screen.getByText('Read-only vendor view')).toBeInTheDocument();
    expect(screen.getByText('Active workspace')).toBeInTheDocument();

    const accountHeading = screen.getByRole('heading', { name: 'My Account' });
    const accountSection = accountHeading.closest('section');
    expect(accountSection).not.toBeNull();
    expect(within(accountSection!).getByText('Display name')).toBeInTheDocument();
    expect(within(accountSection!).getByText('Demo Vendor A')).toBeInTheDocument();
    expect(within(accountSection!).getByText('Signed-in email')).toBeInTheDocument();
    expect(within(accountSection!).getByText('vendor-a@demo.com')).toBeInTheDocument();
    expect(within(accountSection!).getByText('Vendor ID')).toBeInTheDocument();
    expect(within(accountSection!).getByText('demo-vendor-a')).toBeInTheDocument();
    expect(within(accountSection!).getByText('Account Status')).toBeInTheDocument();
    expect(within(accountSection!).getByText('Active')).toBeInTheDocument();
    expect(within(accountSection!).getByText('Correction Ticket Status')).toBeInTheDocument();
    expect(within(accountSection!).getByText('No correction ticket open')).toBeInTheDocument();

    const managedHeading = screen.getByRole('heading', { name: 'Marketplace Managed Settings' });
    const managedSection = managedHeading.closest('section');
    expect(managedSection).not.toBeNull();
    expect(within(managedSection!).getByText('These settings are managed by the Marketplace. If something needs to change, open a correction ticket.')).toBeInTheDocument();
    expect(within(managedSection!).getByText('Shipping')).toBeInTheDocument();
    expect(within(managedSection!).getByText('Returns')).toBeInTheDocument();
    expect(within(managedSection!).getByText('Finance Policy')).toBeInTheDocument();
    expect(within(managedSection!).getByText('Warehouse')).toBeInTheDocument();
    expect(within(managedSection!).getByText('Billing')).toBeInTheDocument();
    expect(within(managedSection!).getByText('Integrations')).toBeInTheDocument();
    expect(within(managedSection!).getAllByText('Managed by Marketplace').length).toBe(6);
    await waitFor(() => expect(within(managedSection!).getAllByText('Configured').length).toBeGreaterThanOrEqual(4));

    expect(screen.getByRole('heading', { name: 'Request Changes' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Open correction ticket' })).toHaveLength(1);

    expect(screen.queryByText('Review the seller identity, finance policy, shipping operations, and return destination currently managed for this store. Marketplace-owned fields are read-only here.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Operational readiness' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Shipping ready' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Returns ready' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Finance visibility ready' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Support channel active' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Workflow access ready' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Automation visibility ready' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Billing / Legal Profile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Finance Policy' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Shipping operations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Warehouse and returns' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Integration status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Additional seller profile fields' })).not.toBeInTheDocument();
    expect(screen.queryByText('Commission %')).not.toBeInTheDocument();
    expect(screen.queryByText('Commission VAT %')).not.toBeInTheDocument();
    expect(screen.queryByText('Deduct shipping after fulfillment')).not.toBeInTheDocument();
    expect(screen.queryByText('Provider configuration status')).not.toBeInTheDocument();
    expect(screen.queryByText('Default warehouse')).not.toBeInTheDocument();
    expect(screen.queryByText('Forward warehouse')).not.toBeInTheDocument();
    expect(screen.queryByText(/Paraşüt contact source/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Paraşüt/i)).not.toBeInTheDocument();
    expect(getVendorBillingProfileMock).not.toHaveBeenCalled();
    expect(getFinanceProfileMock).toHaveBeenCalled();
    expect(getFinanceDashboardMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Legal entity name, tax office, and tax identity')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit finance policy' })).not.toBeInTheDocument();
  });

  it('shows restricted vendor workspace state without an active workspace badge', async () => {
    setCurrentUser({
      email: 'vendor-a@demo.com',
      name: 'Vendor A User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [
        {
          vendorId: 'demo-vendor-a',
          vendorName: 'Demo Vendor A',
          status: 'inactive',
          restrictionReason: 'Operational review',
          restrictionChangedByUserId: 'admin-user-1',
          restrictionChangedAt: '2026-07-02T10:00:00Z',
        },
      ],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });

    renderVendorProfilePage();

    expect(await screen.findByRole('heading', { name: 'Demo Vendor A' })).toBeInTheDocument();
    expect(screen.getByText('Read-only vendor view')).toBeInTheDocument();
    expect(screen.getAllByText('Restricted account').length).toBeGreaterThan(0);
    expect(within(screen.getByLabelText('Vendor workspace summary')).getByText('Operational review')).toBeInTheDocument();
    expect(screen.queryByText('Active workspace')).not.toBeInTheDocument();
    const accountSection = screen.getByRole('heading', { name: 'My Account' }).closest('section');
    expect(accountSection).not.toBeNull();
    expect(within(accountSection!).getByText('Restriction Status')).toBeInTheDocument();
    expect(within(accountSection!).getByText('Operational review')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Request Changes' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Open correction ticket' })).toHaveLength(1);
  });

  it('shows marketplace-managed settings status without rendering readiness cards', async () => {
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

    const managedHeading = await screen.findByRole('heading', { name: 'Marketplace Managed Settings' });
    const managedSection = managedHeading.closest('section');
    expect(managedSection).not.toBeNull();
    expect(within(managedSection!).getByText('Shipping')).toBeInTheDocument();
    expect(within(managedSection!).getByText('Returns')).toBeInTheDocument();
    expect(within(managedSection!).getByText('Finance Policy')).toBeInTheDocument();
    await waitFor(() => expect(within(managedSection!).getAllByText('Needs review').length).toBeGreaterThanOrEqual(3));
    expect(screen.queryByRole('heading', { name: 'Operational readiness' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Shipping ready' })).not.toBeInTheDocument();
  });

  it('creates a vendor profile correction support ticket with safe context', async () => {
    const createdTicket = supportTicket({ id: 'support-created' });
    createSupportTicketMock.mockResolvedValue(createdTicket);

    renderVendorProfilePage();

    const contactButtons = await screen.findAllByRole('button', { name: 'Open correction ticket' });
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

    await waitFor(() => expect(screen.getAllByText('Correction ticket open').length).toBeGreaterThan(0));
    const supportButtons = await screen.findAllByRole('button', { name: 'Open correction ticket' });
    await waitFor(() => expect(supportButtons[0]).not.toBeDisabled());
    await userEvent.click(supportButtons[0]);

    expect(await screen.findByText('Vendor support detail route')).toBeInTheDocument();
    expect(createSupportTicketMock).not.toHaveBeenCalled();
  });

  it('hides safe cleanup placeholders without rendering a broad editor before billing edit is opened', async () => {
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
    expect(await screen.findByRole('heading', { name: 'Store identity' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Finance Policy' })).toBeInTheDocument();
    expect(screen.queryByText('Store contact')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admin note' })).not.toBeInTheDocument();
    expect(screen.queryByText('Admin-owned configuration')).not.toBeInTheDocument();
    expect(screen.queryByText(/not executed in Phase 4A/)).not.toBeInTheDocument();
    expect(screen.getByText('Seller of record')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Additional seller profile fields' })).toBeInTheDocument();
    expect(screen.getByText('Fields not modeled yet')).toBeInTheDocument();
    const readiness = screen.getByLabelText('Vendor operational readiness');
    expect(within(readiness).getByLabelText('Automation visibility ready: Requires configuration review')).toBeInTheDocument();
    expect(within(readiness).getByText('Automation visibility exists, but this profile does not model vendor-specific automation readiness.')).toBeInTheDocument();
    expect(within(readiness).queryByText('Alerts visible')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save billing profile' })).not.toBeInTheDocument();

    const supportButtons = await screen.findAllByRole('button', { name: 'Open correction ticket' });
    await waitFor(() => expect(supportButtons[0]).not.toBeDisabled());
    await userEvent.click(supportButtons[0]);
    expect(await screen.findByText('Admin support detail route')).toBeInTheDocument();
    expect(createSupportTicketMock).not.toHaveBeenCalled();
  });

  it('loads the requested vendor on the admin vendor profile route', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorShippingConfigMock.mockResolvedValue({ ...shippingConfig, vendorId: 'created-vendor' });
    getFinanceProfileMock.mockResolvedValue({ ...financeProfile, vendorId: 'created-vendor' });
    getVendorBillingProfileMock.mockResolvedValue({ ...billingProfile, vendorId: 'created-vendor' });
    getVendorStatusMock.mockResolvedValue({
      ...activeVendorStatus,
      vendorId: 'created-vendor',
      vendorName: 'Created Vendor',
    });
    listVendorProfileAuditLogsMock.mockResolvedValue([]);

    renderVendorProfilePage(['/admin/vendors/created-vendor']);

    expect(await screen.findByRole('heading', { name: 'Created Vendor' })).toBeInTheDocument();
    expect(screen.getByText('Vendor ID: created-vendor')).toBeInTheDocument();
    expect(screen.getByText('Route-scoped vendor profile')).toBeInTheDocument();
    expect(screen.getByText('Admin view')).toBeInTheDocument();
    expect(screen.getByText('Integration token missing')).toBeInTheDocument();
    expect(screen.getAllByText('created-vendor').length).toBeGreaterThan(0);
    const shell = screen.getByTestId('vendor-profile-shell');
    expect(within(shell).getByRole('button', { name: 'Request profile correction' })).toBeInTheDocument();
    expect(within(shell).getAllByRole('button', { name: 'Request profile correction' })).toHaveLength(1);
    expect(within(screen.getByLabelText('Vendor workspace summary')).queryAllByText('Ready')).toHaveLength(0);
    const sectionNavigation = screen.getByRole('navigation', { name: 'Vendor profile sections' });
    for (const label of [
      'Overview',
      'Account',
      'Billing & Legal',
      'Finance',
      'Shipping & Returns',
      'Integrations',
      'Diagnostics',
      'Audit History',
      'Support',
    ]) {
      expect(within(sectionNavigation).getByRole('link', { name: label })).toBeInTheDocument();
    }
    await waitFor(() => {
      for (const targetId of ADMIN_VENDOR_PROFILE_SECTION_IDS) {
        expect(document.querySelectorAll(`#${targetId}`)).toHaveLength(1);
      }
    });
    expect(within(sectionNavigation).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '#vendor-profile-overview');
    expect(within(sectionNavigation).getByRole('link', { name: 'Support' })).toHaveAttribute('href', '#vendor-profile-support');
    expect(screen.queryByRole('heading', { name: 'Demo Vendor A' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Operational readiness' })).toBeInTheDocument();
    expect(screen.getByText('Compact view of whether this vendor is operationally ready, based only on currently loaded configuration and workflow visibility.')).toBeInTheDocument();
    const readiness = screen.getByLabelText('Vendor operational readiness');
    expect(within(readiness).getAllByRole('article')).toHaveLength(6);
    expect(within(readiness).getByLabelText('Shipping ready: Ready')).toBeInTheDocument();
    expect(within(readiness).getByRole('button', { name: 'Open shipping workflow' })).toBeInTheDocument();
    expect(within(readiness).getByRole('button', { name: 'Open returns review' })).toBeInTheDocument();
    expect(within(readiness).getByRole('button', { name: 'Open settlement preview' })).toBeInTheDocument();
    expect(within(readiness).queryByText('Shipping enabled')).not.toBeInTheDocument();
    expect(within(readiness).queryByText('Provider configured')).not.toBeInTheDocument();
    expect(within(readiness).queryByText('Warehouse configured')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Store identity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vendor account status' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Billing / Legal Profile' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Finance Policy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shipping operations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Integration status' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vendor Configuration History' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Support and correction workflow' })).toBeInTheDocument();
    await waitFor(() =>
      expect(getVendorShippingConfigMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'created-vendor' })),
    );
    expect(getFinanceProfileMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'created-vendor' }));
    expect(getVendorBillingProfileMock).toHaveBeenCalledWith('created-vendor', expect.any(Object));
    expect(getVendorStatusMock).toHaveBeenCalledWith('created-vendor', expect.any(Object));
    expect(listVendorProfileAuditLogsMock).toHaveBeenCalledWith('created-vendor', expect.objectContaining({ limit: 50 }));
    expect(await screen.findByLabelText('Shipping provider configuration editor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save shipping config' })).toBeInTheDocument();
    await waitFor(() =>
      expect(getShippingProviderDiagnosticsMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'created-vendor' })),
    );
  });

  it('renders shipping operations as a state-driven operator workflow', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorShippingConfigMock.mockResolvedValue({
      ...shippingConfig,
      preferredProvider: 'kargonomi',
      cargoIntegrationId: null,
      defaultWarehouseId: '112668',
      providerMetadata: {
        kargonomiShippingProviderId: '5',
        kargonomiBuyerStateId: '34',
        kargonomiBuyerCityId: '828',
      },
      warehouses: [
        {
          id: 'warehouse-kargonomi',
          vendorId: 'demo-vendor-a',
          provider: 'kargonomi',
          warehouseId: '112668',
          name: 'Default warehouse',
          address: 'Izmir warehouse',
          isDefault: true,
          syncStatus: {
            contactNamePresent: true,
            phonePresent: true,
            addressPresent: true,
            stateIdPresent: true,
            cityIdPresent: true,
            stateName: 'İzmir',
            cityName: 'Bornova',
            syncedAt: '2026-06-08T12:42:00.000Z',
            lookupStatus: 'synced',
            lookupError: null,
          },
        },
      ],
    });

    renderVendorProfilePage(['/admin/vendors/demo-vendor-a']);

    await screen.findByText('Edit Shipping Configuration');
    const shippingHeading = screen.getByRole('heading', { name: 'Shipping operations' });
    const shippingSection = shippingHeading.closest('section');
    expect(shippingSection).not.toBeNull();
    expect(within(shippingSection!).getByRole('heading', { name: 'Shipping health' })).toBeInTheDocument();
    expect(within(shippingSection!).getByText('Shipment creation can use this vendor configuration.')).toBeInTheDocument();
    expect(within(shippingSection!).getByRole('heading', { name: 'Current configuration' })).toBeInTheDocument();
    expect(within(shippingSection!).getByText('Current provider configuration')).toBeInTheDocument();
    expect(within(shippingSection!).getByText('Edit Shipping Configuration')).toBeInTheDocument();
    expect(within(shippingSection!).getByText('Warehouse synchronization')).toBeInTheDocument();
    expect(within(shippingSection!).getByText('Warehouse synchronization is ready.')).toBeInTheDocument();
    expect(within(shippingSection!).getByText('Diagnostics')).toBeInTheDocument();
    expect(within(shippingSection!).getByRole('button', { name: 'Save shipping config' })).toBeInTheDocument();
    expect(within(shippingSection!).getByRole('button', { name: 'Sync Kargonomi warehouse details' })).toBeInTheDocument();
    expect(screen.queryByText('Provider configuration')).not.toBeInTheDocument();
  });

  it('keeps route vendor data authoritative when the selected workspace vendor changes', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['yalispor', 'demo-vendor-b'],
      vendorDetails: [
        { vendorId: 'yalispor', vendorName: 'Yalı Spor' },
        { vendorId: 'demo-vendor-b', vendorName: 'Demo Vendor B' },
      ],
      canSwitchVendors: true,
      defaultVendorId: 'yalispor',
    });
    setCurrentVendorId('demo-vendor-b');
    getVendorShippingConfigMock.mockResolvedValue({ ...shippingConfig, vendorId: 'sporborsa' });
    getFinanceProfileMock.mockResolvedValue({ ...financeProfile, vendorId: 'sporborsa' });
    getVendorBillingProfileMock.mockResolvedValue({ ...billingProfile, vendorId: 'sporborsa' });
    getVendorStatusMock.mockResolvedValue({
      ...activeVendorStatus,
      vendorId: 'sporborsa',
      vendorName: 'Sporborsa',
    });
    listVendorProfileAuditLogsMock.mockResolvedValue([]);

    renderVendorProfilePage(['/admin/vendors/sporborsa']);

    expect(await screen.findByRole('heading', { name: 'Sporborsa' })).toBeInTheDocument();
    expect(screen.getByText('Vendor ID: sporborsa')).toBeInTheDocument();
    expect(screen.getByText('Route-scoped vendor profile')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Demo Vendor B' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(getVendorShippingConfigMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'sporborsa' })),
    );
    expect(getFinanceProfileMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'sporborsa' }));
    expect(getVendorBillingProfileMock).toHaveBeenCalledWith('sporborsa', expect.any(Object));
    expect(getVendorStatusMock).toHaveBeenCalledWith('sporborsa', expect.any(Object));
    expect(getCurrentVendorContext().vendorId).toBe('demo-vendor-b');
  });

  it('creates admin route correction tickets with the route vendor context override', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['yalispor', 'demo-vendor-b'],
      vendorDetails: [
        { vendorId: 'yalispor', vendorName: 'Yalı Spor' },
        { vendorId: 'demo-vendor-b', vendorName: 'Demo Vendor B' },
      ],
      canSwitchVendors: true,
      defaultVendorId: 'yalispor',
    });
    setCurrentVendorId('yalispor');
    getVendorShippingConfigMock.mockResolvedValue({ ...shippingConfig, vendorId: 'sporborsa' });
    getFinanceProfileMock.mockResolvedValue({ ...financeProfile, vendorId: 'sporborsa' });
    getVendorBillingProfileMock.mockResolvedValue({ ...billingProfile, vendorId: 'sporborsa' });
    getVendorStatusMock.mockResolvedValue({
      ...activeVendorStatus,
      vendorId: 'sporborsa',
      vendorName: 'Sporborsa',
    });
    listVendorProfileAuditLogsMock.mockResolvedValue([]);
    createAdminVendorSupportTicketMock.mockResolvedValue(supportTicket({
      id: 'support-sporborsa',
      vendorId: 'sporborsa',
      vendorName: 'Sporborsa',
      contextId: 'sporborsa',
    }));

    renderVendorProfilePage(['/admin/vendors/sporborsa']);

    const contactButton = await screen.findByRole('button', { name: 'Request profile correction' });
    await waitFor(() => expect(contactButton).not.toBeDisabled());
    await user.click(contactButton);

    await waitFor(() =>
      expect(createAdminVendorSupportTicketMock).toHaveBeenCalledWith(
        'sporborsa',
        expect.objectContaining({
          contextId: 'sporborsa',
          contextSnapshot: expect.objectContaining({
            path: '/admin/vendors/sporborsa',
            vendorId: 'sporborsa',
            vendorName: 'Sporborsa',
          }),
        }),
      ),
    );
    expect(createSupportTicketMock).not.toHaveBeenCalled();
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
  });

  it('shows integration token onboarding controls to admins on the vendor-specific profile route', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    vendorIntegrationProvidersMock.mockResolvedValueOnce(vendorIntegrationProviders);

    renderVendorProfilePage(['/admin/vendors/demo-vendor-a']);

    expect(await screen.findByText('Healthy workspace')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Vendor workspace summary')).queryAllByText('Ready')).toHaveLength(0);
    const integrationHeading = await screen.findByRole('heading', { name: 'Integration status' });
    const integrationSection = integrationHeading.closest('section');
    expect(integrationSection).not.toBeNull();
    expect(within(integrationSection!).getByText('Vendor Integration API')).toBeInTheDocument();
    expect(await within(integrationSection!).findByText('client-demo-vendor-a')).toBeInTheDocument();
    expect(within(integrationSection!).getByText('Active')).toBeInTheDocument();
    expect(within(integrationSection!).getByRole('button', { name: 'Create Integration Token' })).toBeInTheDocument();
    expect(vendorIntegrationProvidersMock).toHaveBeenCalled();
  });

  it('creates an onboarding token for a restricted vendor and only displays the plaintext once', async () => {
    const user = userEvent.setup();
    const clipboardWriteMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteMock,
      },
    });
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorShippingConfigMock.mockResolvedValue({ ...shippingConfig, vendorId: 'created-vendor' });
    getFinanceProfileMock.mockResolvedValue({ ...financeProfile, vendorId: 'created-vendor' });
    getVendorBillingProfileMock.mockResolvedValue({ ...billingProfile, vendorId: 'created-vendor' });
    getVendorStatusMock.mockResolvedValue({
      ...activeVendorStatus,
      vendorId: 'created-vendor',
      vendorName: 'Created Vendor',
      status: 'inactive',
      restricted: true,
      restrictionReason: 'Operational review',
    });
    createVendorIntegrationTokenMock.mockResolvedValueOnce({
      clientId: 'client-created-vendor',
      vendorIdentifier: 'created-vendor',
      providerName: 'Onboarding ERP',
      scopes: ['orders:read', 'status:write', 'shipment:write', 'invoice:write'],
      token: 'spg_vi_created_once',
      tokenWarning: 'Sensitive: this plaintext token is shown only once. Store it securely.',
    });
    const storageSetSpy = vi.spyOn(Storage.prototype, 'setItem');

    renderVendorProfilePage(['/admin/vendors/created-vendor']);

    const integrationHeading = await screen.findByRole('heading', { name: 'Integration status' });
    const integrationSection = integrationHeading.closest('section');
    expect(integrationSection).not.toBeNull();
    await user.type(within(integrationSection!).getByLabelText('Provider name'), '  Onboarding ERP  ');
    await user.click(within(integrationSection!).getByRole('button', { name: 'Create Integration Token' }));

    await waitFor(() =>
      expect(createVendorIntegrationTokenMock).toHaveBeenCalledWith({
        vendorIdentifier: 'created-vendor',
        providerName: 'Onboarding ERP',
        scopes: ['orders:read', 'status:write', 'shipment:write', 'invoice:write'],
      }),
    );
    expect(await within(integrationSection!).findByText('Copy this token now. It will never be shown again.')).toBeInTheDocument();
    expect(within(integrationSection!).getAllByText('spg_vi_created_once')).toHaveLength(1);
    await user.click(within(integrationSection!).getByRole('button', { name: 'Copy' }));
    expect(clipboardWriteMock).toHaveBeenCalledWith('spg_vi_created_once');
    expect(await within(integrationSection!).findByText('Token copied.')).toBeInTheDocument();
    expect(JSON.stringify(storageSetSpy.mock.calls)).not.toContain('spg_vi_created_once');

    await user.click(within(integrationSection!).getByRole('button', { name: 'Done' }));
    expect(within(integrationSection!).queryByText('spg_vi_created_once')).not.toBeInTheDocument();
    storageSetSpy.mockRestore();
  });

  it('shows safe integration token creation errors without leaking token internals', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    createVendorIntegrationTokenMock.mockRejectedValueOnce(new Error('tokenHash leaked stack spg_vi_secret'));

    renderVendorProfilePage(['/admin/vendors/demo-vendor-a']);

    const integrationHeading = await screen.findByRole('heading', { name: 'Integration status' });
    const integrationSection = integrationHeading.closest('section');
    expect(integrationSection).not.toBeNull();
    await user.type(within(integrationSection!).getByLabelText('Provider name'), 'Demo ERP');
    await user.click(within(integrationSection!).getByRole('button', { name: 'Create Integration Token' }));

    expect(await within(integrationSection!).findByRole('alert')).toHaveTextContent(
      'Integration token could not be created. Please retry.',
    );
    expect(JSON.stringify(document.body.textContent)).not.toContain('tokenHash leaked stack');
    expect(JSON.stringify(document.body.textContent)).not.toContain('spg_vi_secret');
  });

  it('keeps vendor self-profile scoped to the current session vendor', async () => {
    renderVendorProfilePage(['/vendor/profile']);

    expect(await screen.findByRole('heading', { name: 'Demo Vendor A' })).toBeInTheDocument();
    expect(getVendorShippingConfigMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' }));
    expect(getFinanceProfileMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' }));
    expect(getVendorStatusMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Shipping provider configuration editor')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save shipping config' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Integration Token' })).not.toBeInTheDocument();
    expect(getShippingProviderDiagnosticsMock).not.toHaveBeenCalled();
    expect(updateVendorShippingConfigMock).not.toHaveBeenCalled();
    expect(vendorIntegrationProvidersMock).not.toHaveBeenCalled();
  });

  it('saves admin shipping setup for the requested route vendor', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorShippingConfigMock.mockResolvedValue({ ...shippingConfig, vendorId: 'created-vendor' });
    getFinanceProfileMock.mockResolvedValue({ ...financeProfile, vendorId: 'created-vendor' });
    getVendorBillingProfileMock.mockResolvedValue({ ...billingProfile, vendorId: 'created-vendor' });
    getVendorStatusMock.mockResolvedValue({
      ...activeVendorStatus,
      vendorId: 'created-vendor',
      vendorName: 'Created Vendor',
    });
    listVendorProfileAuditLogsMock.mockResolvedValue([]);

    renderVendorProfilePage(['/admin/vendors/created-vendor']);

    const warehouseInput = await screen.findByLabelText('Warehouse ID');
    await user.clear(warehouseInput);
    await user.type(warehouseInput, '55575');
    await user.click(screen.getByRole('button', { name: 'Save shipping config' }));

    await waitFor(() =>
      expect(updateVendorShippingConfigMock).toHaveBeenCalledWith(
        'created-vendor',
        expect.objectContaining({
          preferredProvider: 'kargonomi',
          defaultWarehouseId: '55575',
        }),
      ),
    );
    expect(await screen.findByText('Shipping provider configuration saved.')).toBeInTheDocument();
  });

  it('shows a safe shipping setup error when admin save fails', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorShippingConfigMock.mockResolvedValue({ ...shippingConfig, vendorId: 'created-vendor' });
    getFinanceProfileMock.mockResolvedValue({ ...financeProfile, vendorId: 'created-vendor' });
    getVendorBillingProfileMock.mockResolvedValue({ ...billingProfile, vendorId: 'created-vendor' });
    getVendorStatusMock.mockResolvedValue({
      ...activeVendorStatus,
      vendorId: 'created-vendor',
      vendorName: 'Created Vendor',
    });
    listVendorProfileAuditLogsMock.mockResolvedValue([]);
    updateVendorShippingConfigMock.mockRejectedValueOnce(new Error('Shipping configuration could not be saved.'));

    renderVendorProfilePage(['/admin/vendors/created-vendor']);

    expect(await screen.findByLabelText('Shipping provider configuration editor')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save shipping config' }));

    expect(await screen.findByText('Shipping configuration could not be saved.')).toBeInTheDocument();
  });

  it('lets admins edit shipping setup while a newly provisioned vendor is restricted', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorShippingConfigMock.mockResolvedValue({ ...shippingConfig, vendorId: 'created-vendor' });
    getFinanceProfileMock.mockResolvedValue({ ...financeProfile, vendorId: 'created-vendor' });
    getVendorBillingProfileMock.mockResolvedValue({ ...billingProfile, vendorId: 'created-vendor' });
    getVendorStatusMock.mockResolvedValue({
      ...activeVendorStatus,
      vendorId: 'created-vendor',
      vendorName: 'Created Vendor',
      status: 'inactive',
      restricted: true,
      restrictionReason: 'Operational review',
    });
    listVendorProfileAuditLogsMock.mockResolvedValue([]);

    renderVendorProfilePage(['/admin/vendors/created-vendor']);

    await waitFor(() => expect(screen.getAllByText('Operational review').length).toBeGreaterThan(0));
    const warehouseInput = await screen.findByLabelText('Warehouse ID');
    await user.clear(warehouseInput);
    await user.type(warehouseInput, '55576');
    await user.click(screen.getByRole('button', { name: 'Save shipping config' }));

    await waitFor(() =>
      expect(updateVendorShippingConfigMock).toHaveBeenCalledWith(
        'created-vendor',
        expect.objectContaining({
          defaultWarehouseId: '55576',
        }),
      ),
    );
  });

  it('rejects vendor users on the admin vendor profile route', async () => {
    renderVendorProfilePage(['/admin/vendors/created-vendor']);

    expect(await screen.findByText('Admin access required')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Created Vendor' })).not.toBeInTheDocument();
    expect(getVendorShippingConfigMock).not.toHaveBeenCalled();
    expect(getFinanceProfileMock).not.toHaveBeenCalled();
    expect(getVendorStatusMock).not.toHaveBeenCalled();
  });

  it('lets admins save active vendor status without a restriction reason', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });

    renderVendorProfilePage();

    const statusHeading = await screen.findByRole('heading', { name: 'Vendor account status' });
    const statusSection = statusHeading.closest('section');
    expect(statusSection).not.toBeNull();
    const reasonSelect = await within(statusSection!).findByLabelText('Status reason');
    expect(reasonSelect).toBeDisabled();
    expect(within(statusSection!).getAllByText('Not restricted').length).toBeGreaterThan(0);

    await user.click(within(statusSection!).getByRole('button', { name: 'Save vendor status' }));

    await waitFor(() =>
      expect(updateVendorStatusMock).toHaveBeenCalledWith('demo-vendor-a', {
        status: 'active',
      }),
    );
    expect(within(statusSection!).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('requires a status reason when admins restrict a vendor', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });

    renderVendorProfilePage();

    const statusHeading = await screen.findByRole('heading', { name: 'Vendor account status' });
    const statusSection = statusHeading.closest('section');
    expect(statusSection).not.toBeNull();

    await user.selectOptions(await within(statusSection!).findByLabelText('Status'), 'inactive');
    const reasonSelect = within(statusSection!).getByLabelText('Status reason');
    expect(reasonSelect).not.toBeDisabled();
    await user.click(within(statusSection!).getByRole('button', { name: 'Save vendor status' }));

    expect(await within(statusSection!).findByRole('alert')).toHaveTextContent('Status reason is required.');
    expect(updateVendorStatusMock).not.toHaveBeenCalled();
  });

  it('lets admins restrict a vendor with a persisted status reason', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });

    renderVendorProfilePage();

    const statusHeading = await screen.findByRole('heading', { name: 'Vendor account status' });
    const statusSection = statusHeading.closest('section');
    expect(statusSection).not.toBeNull();
    expect((await within(statusSection!).findAllByText('Active')).length).toBeGreaterThan(0);

    await user.selectOptions(within(statusSection!).getByLabelText('Status'), 'inactive');
    await user.selectOptions(within(statusSection!).getByLabelText('Status reason'), 'Operational review');
    await user.click(within(statusSection!).getByRole('button', { name: 'Save vendor status' }));

    await waitFor(() =>
      expect(updateVendorStatusMock).toHaveBeenCalledWith('demo-vendor-a', {
        status: 'inactive',
        reason: 'Operational review',
      }),
    );
    expect((await within(statusSection!).findAllByText('Restricted')).length).toBeGreaterThan(0);
    expect(within(statusSection!).getAllByText('Operational review').length).toBeGreaterThan(0);
    expect(within(statusSection!).getByText('admin@demo.com')).toBeInTheDocument();
  });

  it('reads current restriction state from vendor status while keeping audit history separate', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getVendorStatusMock.mockResolvedValue({
      ...activeVendorStatus,
      status: 'inactive',
      restricted: true,
      restrictionReason: 'Finance review',
      changedByUserId: 'admin-user-current',
      changedByEmail: null,
      changedAt: '2026-07-01T10:00:00Z',
    });
    listVendorProfileAuditLogsMock.mockResolvedValue([
      {
        id: 'audit-status-old',
        vendorId: 'demo-vendor-a',
        section: 'vendor_status',
        fieldName: 'status',
        oldValue: 'active',
        newValue: 'inactive',
        changedByUserId: 'admin-user-history',
        changedByEmail: 'admin-history@example.test',
        changedAt: '2026-06-01T10:00:00Z',
        reason: 'Operational review',
        snapshotImpact: 'UNKNOWN',
        source: 'admin_vendor_status_update',
      },
      ...profileAuditLogs,
    ]);

    renderVendorProfilePage();

    const statusHeading = await screen.findByRole('heading', { name: 'Vendor account status' });
    const statusSection = statusHeading.closest('section');
    expect(statusSection).not.toBeNull();
    await waitFor(() => expect(statusSection!.querySelector('.op-meta-group')).not.toBeNull());
    const statusSummary = statusSection!.querySelector('.op-meta-group');
    expect(await within(statusSummary as HTMLElement).findByText('Restricted')).toBeInTheDocument();
    expect(within(statusSummary as HTMLElement).getByText('Reason')).toBeInTheDocument();
    expect(await within(statusSummary as HTMLElement).findByText('Finance review')).toBeInTheDocument();
    expect(within(statusSummary as HTMLElement).getByText('admin-user-current')).toBeInTheDocument();
    expect(within(statusSummary as HTMLElement).getByText('Changed at')).toBeInTheDocument();
    expect(statusSummary).toHaveTextContent('2026');
    expect(within(statusSection!).getByLabelText('Status reason')).toHaveValue('Finance review');
    expect(within(statusSummary as HTMLElement).queryByText('No recorded change')).not.toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Vendor Configuration History' })).toBeInTheDocument();
    expect(screen.getByText('vendor_status · status')).toBeInTheDocument();
    expect(screen.getByText(/Reason: Operational review/)).toBeInTheDocument();
    expect(listVendorProfileAuditLogsMock).toHaveBeenCalled();
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

  it('renders vendor profile audit metadata and immutable history for admin users', async () => {
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

    expect(await screen.findByText('Finance Policy last changed')).toBeInTheDocument();
    expect(screen.getByText('Billing / Legal Profile last changed')).toBeInTheDocument();
    expect(screen.getByText('Logo Binding last changed')).toBeInTheDocument();
    expect(screen.getAllByText('Shipping Operations last changed').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Vendor Configuration History' })).toBeInTheDocument();
    expect(screen.getByText('Finance Policy · commissionVatPercent')).toBeInTheDocument();
    expect(screen.getByText('Old: 18.00')).toBeInTheDocument();
    expect(screen.getByText('New: 20.00')).toBeInTheDocument();
    expect(screen.getAllByText('Future ledger rows only').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Provider rebind required').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'View changes' }).length).toBeGreaterThan(0);
    expect(listVendorProfileAuditLogsMock).toHaveBeenCalled();
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
        settlementFrequencyType: input.settlementFrequencyType,
        weeklySettlementDay: input.weeklySettlementDay,
        autoSettlementDraftEnabled: input.autoSettlementDraftEnabled,
        autoSettlementApproveEnabled: input.autoSettlementApproveEnabled,
        autoSettlementInvoiceEnabled: input.autoSettlementInvoiceEnabled,
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
    expect(within(financeSection!).getByLabelText('Settlement frequency')).toHaveValue('WEEKLY');
    expect(within(financeSection!).getByLabelText('Weekly settlement day')).toHaveValue('WEDNESDAY');
    expect(within(financeSection!).queryByLabelText('Monthly settlement day')).not.toBeInTheDocument();
    expect(within(financeSection!).getByLabelText(/Deduct shipping after fulfillment/i)).toBeChecked();

    await userEvent.clear(within(financeSection!).getByLabelText('Commission %'));
    await userEvent.type(within(financeSection!).getByLabelText('Commission %'), '13.75');
    await userEvent.clear(within(financeSection!).getByLabelText('Settlement delay days'));
    await userEvent.type(within(financeSection!).getByLabelText('Settlement delay days'), '14');
    await userEvent.selectOptions(within(financeSection!).getByLabelText('Shipping deduction mode'), 'fixed');
    await userEvent.selectOptions(within(financeSection!).getByLabelText('Settlement frequency'), 'BIWEEKLY');
    await userEvent.selectOptions(within(financeSection!).getByLabelText('Weekly settlement day'), 'MONDAY');
    await userEvent.click(within(financeSection!).getByLabelText(/Enable scheduled draft creation/i));
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
        settlementFrequencyType: 'BIWEEKLY',
        weeklySettlementDay: 'MONDAY',
        autoSettlementDraftEnabled: true,
        autoSettlementApproveEnabled: false,
        autoSettlementInvoiceEnabled: false,
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

  it('does not expose the legacy Logo test invoice create action', async () => {
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
    expect(within(billingSection!).queryByRole('button', { name: 'Create TEST Invoice' })).not.toBeInTheDocument();
    expect(within(billingSection!).queryByLabelText('I understand this creates a test invoice.')).not.toBeInTheDocument();
    expect(within(billingSection!).getByText('This section contains read-only Logo probes. Settlement invoices are created only from the Settlement Workspace flow.')).toBeInTheDocument();
    expect(createLogoIsbasiTestInvoiceMock).not.toHaveBeenCalled();
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
