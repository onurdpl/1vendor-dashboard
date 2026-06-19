import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { setCurrentUser, setCurrentVendorId, setToken } from '../lib/auth';
import { AdminSettlementApprovalsPage } from './AdminSettlementApprovalsPage';
import {
  approveSettlementApproval,
  cancelSettlementApproval,
  createSettlementApprovalDraft,
  executeSettlementLogoCommissionInvoiceCreate,
  getDatabaseHealth,
  getSettlementApproval,
  getSettlementApprovalAudit,
  getSettlementCommissionInvoiceDiagnostics,
  getSettlementCommissionInvoiceRecords,
  listSettlementApprovals,
  persistSettlementLogoCommissionInvoiceRequestSnapshot,
  previewLogoOutgoingInvoiceSync,
  previewSettlementApproval,
  previewSettlementLogoCommissionInvoice,
  type SettlementApproval,
  type SettlementApprovalAudit,
  type SettlementApprovalListResponse,
  type SettlementApprovalPreview,
  type SettlementCommissionInvoiceDiagnostics,
  type SettlementCommissionInvoiceRecordsResponse,
  type LogoOutgoingInvoiceSyncPreview,
  type SettlementLogoCommissionInvoicePreview,
} from '../features/finance/settlementApprovalsApi';

vi.mock('../features/finance/settlementApprovalsApi', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/settlementApprovalsApi')>(
    '../features/finance/settlementApprovalsApi',
  );
  return {
    ...actual,
    getDatabaseHealth: vi.fn(),
    previewSettlementApproval: vi.fn(),
    createSettlementApprovalDraft: vi.fn(),
    persistSettlementLogoCommissionInvoiceRequestSnapshot: vi.fn(),
    executeSettlementLogoCommissionInvoiceCreate: vi.fn(),
    getSettlementApproval: vi.fn(),
    approveSettlementApproval: vi.fn(),
    cancelSettlementApproval: vi.fn(),
    getSettlementApprovalAudit: vi.fn(),
    previewSettlementLogoCommissionInvoice: vi.fn(),
    getSettlementCommissionInvoiceRecords: vi.fn(),
    getSettlementCommissionInvoiceDiagnostics: vi.fn(),
    previewLogoOutgoingInvoiceSync: vi.fn(),
    listSettlementApprovals: vi.fn(),
  };
});

const getDatabaseHealthMock = vi.mocked(getDatabaseHealth);
const previewSettlementApprovalMock = vi.mocked(previewSettlementApproval);
const createSettlementApprovalDraftMock = vi.mocked(createSettlementApprovalDraft);
const persistSettlementLogoCommissionInvoiceRequestSnapshotMock = vi.mocked(persistSettlementLogoCommissionInvoiceRequestSnapshot);
const executeSettlementLogoCommissionInvoiceCreateMock = vi.mocked(executeSettlementLogoCommissionInvoiceCreate);
const getSettlementApprovalMock = vi.mocked(getSettlementApproval);
const approveSettlementApprovalMock = vi.mocked(approveSettlementApproval);
const cancelSettlementApprovalMock = vi.mocked(cancelSettlementApproval);
const getSettlementApprovalAuditMock = vi.mocked(getSettlementApprovalAudit);
const previewSettlementLogoCommissionInvoiceMock = vi.mocked(previewSettlementLogoCommissionInvoice);
const getSettlementCommissionInvoiceRecordsMock = vi.mocked(getSettlementCommissionInvoiceRecords);
const getSettlementCommissionInvoiceDiagnosticsMock = vi.mocked(getSettlementCommissionInvoiceDiagnostics);
const previewLogoOutgoingInvoiceSyncMock = vi.mocked(previewLogoOutgoingInvoiceSync);
const listSettlementApprovalsMock = vi.mocked(listSettlementApprovals);

const previewResponse: SettlementApprovalPreview = {
  ok: true,
  writesPerformed: false,
  vendorId: 'yalispor',
  periodStart: null,
  periodEnd: null,
  candidateScope: 'vendor_wide',
  candidateSelectionSummary: {
    requestedOrders: [],
    matchedOrders: [],
    unmatchedOrders: [],
    requestedAllocations: [],
    matchedAllocations: [],
    unmatchedAllocations: [],
    candidateRowCount: 2,
  },
  summary: {
    grossSalesMinor: 120000,
    refundTotalMinor: 10000,
    commissionMinor: 12000,
    commissionVatMinor: 2400,
    netPayableMinor: 95600,
    currency: 'TRY',
    eligibleRowCount: 2,
    excludedActiveApprovalRowCount: 0,
    detectedCommissionRates: [10],
    detectedCommissionVatRates: [20],
    detectedShippingModes: ['DISABLED'],
    detectedFinancialProfileSnapshotIds: ['profile-current'],
    mixedCommissionRate: false,
    mixedCommissionVatRate: false,
    mixedShippingMode: false,
    candidateQualityWarnings: ['Vendor-wide preview can include historical or test rows.'],
  },
  lines: [
    {
      financeLedgerEntryId: 'fle-sale-1',
      lineType: 'SALE',
      amountMinor: 120000,
      commissionMinor: 12000,
      commissionVatMinor: 2400,
      payableImpactMinor: 105600,
      sourceSnapshotJson: {},
      eligibilityDecision: 'included',
      eligibilityReason: 'Derived payable because fulfillment evidence exists.',
    },
  ],
};

const lockedRowsPreviewResponse: SettlementApprovalPreview = {
  ...previewResponse,
  summary: {
    ...previewResponse.summary,
    grossSalesMinor: 0,
    refundTotalMinor: 0,
    commissionMinor: 0,
    commissionVatMinor: 0,
    netPayableMinor: 0,
    eligibleRowCount: 0,
    excludedActiveApprovalRowCount: 12,
  },
  lines: [],
};

const mixedVatPreviewResponse: SettlementApprovalPreview = {
  ...previewResponse,
  summary: {
    ...previewResponse.summary,
    detectedCommissionVatRates: [18, 20],
    mixedCommissionVatRate: true,
    candidateQualityWarnings: [
      'Candidate rows include mixed commission VAT rates. Logo readiness will block mixed VAT settlements.',
    ],
  },
};

const mixedShippingPreviewResponse: SettlementApprovalPreview = {
  ...previewResponse,
  summary: {
    ...previewResponse.summary,
    detectedShippingModes: ['DISABLED', 'FIXED'],
    detectedFinancialProfileSnapshotIds: ['profile-current'],
    mixedShippingMode: true,
    candidateQualityWarnings: ['Candidate rows include mixed shipping modes.'],
  },
};

const selectedOrderPreviewResponse: SettlementApprovalPreview = {
  ...previewResponse,
  candidateScope: 'selected_orders',
  candidateSelectionSummary: {
    requestedOrders: ['#1074'],
    matchedOrders: ['#1074'],
    unmatchedOrders: [],
    requestedAllocations: [],
    matchedAllocations: [],
    unmatchedAllocations: [],
    candidateRowCount: 1,
  },
  summary: {
    ...previewResponse.summary,
    eligibleRowCount: 1,
    detectedCommissionVatRates: [20],
    detectedShippingModes: ['EXTERNAL_PROVIDER'],
    detectedFinancialProfileSnapshotIds: ['profile-current'],
    mixedCommissionVatRate: false,
    mixedShippingMode: false,
    candidateQualityWarnings: [],
  },
  selectedOrderDiagnostics: [
    {
      requestedIdentifier: '#1074',
      matched: true,
      matchedOrderNumber: '#1074',
      matchedShopifyOrderId: 'shopify-order-1074',
      financeLedgerEntryId: 'fle-sale-1',
      candidateIncluded: true,
      excludedReason: null,
      lockedApprovalId: null,
      lockedApprovalStatus: null,
      currentSettlementStatus: 'PAYABLE',
      derivedSettlementStatus: 'payable',
    },
  ],
};

const unmatchedSelectedOrderPreviewResponse: SettlementApprovalPreview = {
  ...previewResponse,
  candidateScope: 'selected_orders',
  candidateSelectionSummary: {
    requestedOrders: ['#1074'],
    matchedOrders: [],
    unmatchedOrders: ['#1074'],
    requestedAllocations: [],
    matchedAllocations: [],
    unmatchedAllocations: [],
    candidateRowCount: 0,
  },
  summary: {
    ...previewResponse.summary,
    grossSalesMinor: 0,
    refundTotalMinor: 0,
    commissionMinor: 0,
    commissionVatMinor: 0,
    netPayableMinor: 0,
    eligibleRowCount: 0,
    excludedActiveApprovalRowCount: 0,
    detectedCommissionRates: [],
    detectedCommissionVatRates: [],
    detectedShippingModes: [],
    detectedFinancialProfileSnapshotIds: [],
    candidateQualityWarnings: [],
  },
  lines: [],
  selectedOrderDiagnostics: [
    {
      requestedIdentifier: '#1074',
      matched: false,
      matchedOrderNumber: null,
      matchedShopifyOrderId: null,
      financeLedgerEntryId: null,
      candidateIncluded: false,
      excludedReason: 'No finance ledger row matched this selected order.',
      lockedApprovalId: null,
      lockedApprovalStatus: null,
      currentSettlementStatus: null,
      derivedSettlementStatus: null,
    },
  ],
};

const ineligibleSelectedOrderPreviewResponse: SettlementApprovalPreview = {
  ...unmatchedSelectedOrderPreviewResponse,
  candidateSelectionSummary: {
    ...unmatchedSelectedOrderPreviewResponse.candidateSelectionSummary,
    matchedOrders: ['#1074'],
    unmatchedOrders: [],
    candidateRowCount: 1,
  },
  selectedOrderDiagnostics: [
    {
      requestedIdentifier: '#1074',
      matched: true,
      matchedOrderNumber: '#1074',
      matchedShopifyOrderId: 'shopify-order-1074',
      financeLedgerEntryId: 'fle-sale-1074',
      candidateIncluded: false,
      excludedReason: 'Excluded because row is not payable or partially refunded.',
      lockedApprovalId: null,
      lockedApprovalStatus: null,
      currentSettlementStatus: 'ACCRUING',
      derivedSettlementStatus: 'accruing',
    },
  ],
};

const settlementDelaySelectedOrderPreviewResponse: SettlementApprovalPreview = {
  ...ineligibleSelectedOrderPreviewResponse,
  candidateSelectionSummary: {
    ...ineligibleSelectedOrderPreviewResponse.candidateSelectionSummary,
    requestedOrders: ['#1081'],
    matchedOrders: ['#1081'],
  },
  selectedOrderDiagnostics: [
    {
      requestedIdentifier: '#1081',
      matched: true,
      matchedOrderNumber: '#1081',
      matchedShopifyOrderId: 'shopify-order-1081',
      financeLedgerEntryId: 'fle-sale-1081',
      candidateIncluded: false,
      excludedReason: 'Settlement delay period has not elapsed',
      lockedApprovalId: null,
      lockedApprovalStatus: null,
      currentSettlementStatus: 'ACCRUING',
      derivedSettlementStatus: 'accruing',
    },
  ],
};

const multiReasonExcludedPreviewResponse: SettlementApprovalPreview = {
  ...previewResponse,
  candidateScope: 'selected_orders',
  candidateSelectionSummary: {
    requestedOrders: ['#1081', '#1082'],
    matchedOrders: ['#1081', '#1082'],
    unmatchedOrders: [],
    requestedAllocations: [],
    matchedAllocations: [],
    unmatchedAllocations: [],
    candidateRowCount: 2,
  },
  summary: {
    ...previewResponse.summary,
    grossSalesMinor: 0,
    refundTotalMinor: 0,
    commissionMinor: 0,
    commissionVatMinor: 0,
    netPayableMinor: 0,
    eligibleRowCount: 0,
    excludedActiveApprovalRowCount: 1,
    detectedCommissionRates: [],
    detectedCommissionVatRates: [],
    detectedShippingModes: [],
    detectedFinancialProfileSnapshotIds: [],
    candidateQualityWarnings: [],
  },
  lines: [],
  selectedOrderDiagnostics: [
    {
      requestedIdentifier: '#1081',
      matched: true,
      matchedOrderNumber: '#1081',
      matchedShopifyOrderId: 'shopify-order-1081',
      financeLedgerEntryId: 'fle-sale-1081',
      candidateIncluded: false,
      excludedReason: 'Settlement delay period has not elapsed',
      lockedApprovalId: null,
      lockedApprovalStatus: null,
      currentSettlementStatus: 'ACCRUING',
      derivedSettlementStatus: 'accruing',
    },
    {
      requestedIdentifier: '#1082',
      matched: true,
      matchedOrderNumber: '#1082',
      matchedShopifyOrderId: 'shopify-order-1082',
      financeLedgerEntryId: 'fle-sale-1082',
      candidateIncluded: false,
      excludedReason: 'Row already belongs to an active settlement approval.',
      lockedApprovalId: 'approval-locked-1082',
      lockedApprovalStatus: 'APPROVED',
      currentSettlementStatus: 'PAYABLE',
      derivedSettlementStatus: 'payable',
    },
  ],
};

const lockedSelectedOrderPreviewResponse: SettlementApprovalPreview = {
  ...ineligibleSelectedOrderPreviewResponse,
  summary: {
    ...ineligibleSelectedOrderPreviewResponse.summary,
    excludedActiveApprovalRowCount: 1,
  },
  selectedOrderDiagnostics: [
    {
      requestedIdentifier: '#1074',
      matched: true,
      matchedOrderNumber: '#1074',
      matchedShopifyOrderId: 'shopify-order-1074',
      financeLedgerEntryId: 'fle-sale-1074',
      candidateIncluded: false,
      excludedReason: 'Excluded because row already belongs to active settlement approval.',
      lockedApprovalId: 'approval-locked-1074',
      lockedApprovalStatus: 'APPROVED',
      currentSettlementStatus: 'PAYABLE',
      derivedSettlementStatus: 'payable',
    },
  ],
};

const selectedAllocationPreviewResponse: SettlementApprovalPreview = {
  ...previewResponse,
  candidateScope: 'selected_allocations',
  candidateSelectionSummary: {
    requestedOrders: [],
    matchedOrders: [],
    unmatchedOrders: [],
    requestedAllocations: ['alloc-1074'],
    matchedAllocations: ['alloc-1074'],
    unmatchedAllocations: ['alloc-missing'],
    candidateRowCount: 1,
  },
  summary: {
    ...previewResponse.summary,
    eligibleRowCount: 1,
    candidateQualityWarnings: [],
  },
};

const draftApproval: SettlementApproval = {
  ok: true,
  writesPerformed: true,
  id: 'approval-1',
  createdAt: '2026-06-10T09:00:00.000Z',
  vendorId: 'yalispor',
  status: 'draft',
  periodStart: null,
  periodEnd: null,
  currency: 'TRY',
  grossSalesMinor: 120000,
  refundTotalMinor: 10000,
  commissionMinor: 12000,
  commissionVatMinor: 2400,
  netPayableMinor: 95600,
  approvedBy: null,
  approvedAt: null,
  cancelledBy: null,
  cancelledAt: null,
  notes: 'Admin settlement approval draft',
  sourceSnapshotJson: { eligibleRowCount: 2 },
  lines: previewResponse.lines,
};

const draftApprovalWithTwoLines: SettlementApproval = {
  ...draftApproval,
  id: 'approval-1',
  grossSalesMinor: 759800,
  refundTotalMinor: 0,
  commissionMinor: 103940,
  commissionVatMinor: 20788,
  netPayableMinor: 623036,
  sourceSnapshotJson: {
    eligibleRowCount: 2,
    candidateScope: 'vendor_wide',
  },
  lines: [
    {
      id: 'line-1081-a',
      financeLedgerEntryId: 'fle-sale-1081-a',
      lineType: 'SALE',
      amountMinor: 379900,
      commissionMinor: 51970,
      commissionVatMinor: 10394,
      payableImpactMinor: 311518,
      sourceSnapshotJson: {
        financeLedgerEntryId: 'fle-sale-1081-a',
        vendorAllocationId: 'alloc-yalispor-1081-a',
        sourceShopifyOrderId: 'shopify-order-1081',
        sourceShopifyOrderNumber: '#1081',
        settlementStatus: 'ACCRUING',
        resolvedSettlementStatus: 'PAYABLE',
      },
      storedSettlementStatus: 'ACCRUING',
      derivedSettlementStatus: 'PAYABLE',
      eligibilityDecision: 'included',
      eligibilityReason: 'Derived payable because fulfillment evidence exists.',
    },
    {
      id: 'line-1081-b',
      financeLedgerEntryId: 'fle-sale-1081-b',
      lineType: 'SALE',
      amountMinor: 379900,
      commissionMinor: 51970,
      commissionVatMinor: 10394,
      payableImpactMinor: 311518,
      sourceSnapshotJson: {
        financeLedgerEntryId: 'fle-sale-1081-b',
        vendorAllocationId: 'alloc-yalispor-1081-b',
        sourceShopifyOrderId: 'shopify-order-1081',
        sourceShopifyOrderNumber: '#1081',
        settlementStatus: 'ACCRUING',
        resolvedSettlementStatus: 'PAYABLE',
      },
      storedSettlementStatus: 'ACCRUING',
      derivedSettlementStatus: 'PAYABLE',
      eligibilityDecision: 'included',
      eligibilityReason: 'Derived payable because fulfillment evidence exists.',
    },
  ],
};

const approvedApproval: SettlementApproval = {
  ...draftApproval,
  status: 'approved',
  approvedBy: 'admin-user',
  approvedAt: '2026-06-10T10:00:00.000Z',
};

const cancelledApproval: SettlementApproval = {
  ...approvedApproval,
  status: 'cancelled',
  cancelledBy: 'admin-user',
  cancelledAt: '2026-06-10T10:05:00.000Z',
};

const recentApprovalsResponse: SettlementApprovalListResponse = {
  ok: true,
  writesPerformed: false,
  vendorId: 'yalispor',
  approvals: [
    {
      id: 'approval-2',
      createdAt: '2026-06-10T11:00:00.000Z',
      vendorId: 'yalispor',
      status: 'approved',
      currency: 'TRY',
      grossSalesMinor: 220000,
      netPayableMinor: 180000,
      approvedAt: '2026-06-10T12:00:00.000Z',
      lineCount: 3,
    },
    {
      id: 'approval-1',
      createdAt: '2026-06-10T09:00:00.000Z',
      vendorId: 'yalispor',
      status: 'draft',
      currency: 'TRY',
      grossSalesMinor: 759800,
      netPayableMinor: 623036,
      approvedAt: null,
      lineCount: 2,
    },
  ],
};

const selectedRecentApproval: SettlementApproval = {
  ...approvedApproval,
  id: 'approval-2',
  createdAt: '2026-06-10T11:00:00.000Z',
  grossSalesMinor: 220000,
  netPayableMinor: 180000,
};

const auditResponse: SettlementApprovalAudit = {
  approvalId: 'approval-1',
  status: 'draft',
  totals: {
    grossSalesMinor: 120000,
    refundTotalMinor: 10000,
    commissionMinor: 12000,
    commissionVatMinor: 2400,
    netPayableMinor: 95600,
    currency: 'TRY',
  },
  lines: [
    {
      financeLedgerEntryId: 'fle-sale-1',
      storedSettlementStatus: 'ACCRUING',
      derivedSettlementStatus: 'PAYABLE',
      payoutStatus: 'pending',
      eligibilityDecision: 'included',
      eligibilityReason: 'Derived payable because fulfillment evidence exists.',
    },
  ],
};

const logoPreviewResponse: SettlementLogoCommissionInvoicePreview = {
  ok: false,
  writesPerformed: false,
  settlementApprovalId: 'approval-1',
  readiness: {
    canCreateLogoInvoiceLater: false,
    blockers: ['Vendor must have logoIsbasiCustomerCode before Logo invoice creation.'],
    warnings: ['Read-only preview only. No Logo invoice is created.'],
    billingSnapshotPresent: true,
    billingSnapshotSource: 'settlement_approval',
  },
  amounts: {
    commissionAmount: 120,
    commissionVatAmount: 24,
    expectedGrossInvoiceAmount: 144,
    currency: 'TRY',
    taxRate: 20,
    vatIncluded: false,
  },
  vendorBillingReadiness: {
    complete: false,
    missingFields: ['taxNumber'],
    logoCustomerCodePresent: false,
    logoCustomerIdPresent: false,
    logoEinvoiceEligible: null,
    billingSnapshotPresent: true,
    billingSnapshotSource: 'settlement_approval',
  },
  vatRateSource: 'settlement_line_snapshots',
  detectedVatRates: [20],
  configuredVendorCommissionVatPercent: null,
  executionSnapshotGuard: {
    ok: true,
    blockers: [],
    warnings: [],
    snapshotCompleteness: {
      settlementApprovalFound: true,
      settlementApprovalStatus: 'APPROVED',
      lineCount: 1,
      executionLineCount: 1,
      commissionPercentSnapshot: {
        present: true,
        missingLineIds: [],
        resolvedFromLedgerLineIds: [],
      },
      commissionVatPercentSnapshot: {
        present: true,
        missingLineIds: [],
        resolvedFromLedgerLineIds: [],
      },
    },
    detectedCommissionRates: [10],
    detectedCommissionVatRates: [20],
    detectedShippingModes: ['disabled'],
    requiredSnapshotsPresent: true,
  },
  immutableRequestSnapshot: {
    status: 'BLOCKED',
    payloadBuilderVersion: 'settlement-logo-request-v1',
    blockers: ['Vendor must have logoIsbasiCustomerCode before Logo invoice creation.'],
    warnings: [],
    requestSnapshotPresent: false,
  },
  logoPayloadPreview: {
    salesInvoiceDetails: [
      {
        productDetail: {
          itemCode: 'SPORGYM-COMMISSION',
          itemType: 2,
        },
      },
    ],
  },
};

const readyLogoPreviewResponse: SettlementLogoCommissionInvoicePreview = {
  ...logoPreviewResponse,
  ok: true,
  readiness: {
    canCreateLogoInvoiceLater: true,
    blockers: [],
    warnings: ['Read-only preview only. No Logo invoice is created.'],
    billingSnapshotPresent: true,
    billingSnapshotSource: 'settlement_approval',
  },
  vendorBillingReadiness: {
    complete: true,
    missingFields: [],
    logoCustomerCodePresent: true,
    logoCustomerIdPresent: true,
    logoEinvoiceEligible: true,
    billingSnapshotPresent: true,
    billingSnapshotSource: 'settlement_approval',
  },
  immutableRequestSnapshot: {
    status: 'READY',
    payloadBuilderVersion: 'settlement-logo-request-v1',
    blockers: [],
    warnings: [],
    requestSnapshotPresent: true,
  },
};

const invoiceRecordsResponse: SettlementCommissionInvoiceRecordsResponse = {
  ok: true,
  writesPerformed: false,
  settlementApprovalId: 'approval-1',
  records: [
    {
      id: 'invoice-record-1',
      createdAt: '2026-06-10T10:01:00.000Z',
      updatedAt: '2026-06-10T10:01:00.000Z',
      settlementApprovalId: 'approval-1',
      vendorId: 'yalispor',
      provider: 'logo_isbasi',
      status: 'pending',
      providerInvoiceId: null,
      providerUuid: null,
      providerEttn: null,
      invoiceNo: null,
      failureCode: null,
      failureMessage: null,
      failedAt: null,
      retryCount: 0,
      lastRetriedAt: null,
      cancelledAt: null,
      requestSnapshot: {
        present: false,
        type: 'null',
        topLevelKeys: [],
        approximateSizeBytes: 0,
        requestSnapshotPresent: false,
        payloadBuilderVersion: null,
        requestBuiltAt: null,
        snapshotSource: null,
      },
      responseSnapshot: {
        present: false,
        type: 'null',
        topLevelKeys: [],
        approximateSizeBytes: 0,
      },
      documentSnapshot: {
        present: false,
        type: 'null',
        topLevelKeys: [],
        approximateSizeBytes: 0,
      },
    },
  ],
};

const createdInvoiceRecordMissingNumber = {
  ...invoiceRecordsResponse.records[0],
  id: 'created-record',
  settlementApprovalId: 'approval-2',
  status: 'created',
  providerInvoiceId: 'logo-invoice-1',
  providerUuid: '82691C7B-28D6-4E30-95C9-C0658E90F090',
  providerEttn: null,
  invoiceNo: null,
  requestSnapshot: {
    ...invoiceRecordsResponse.records[0].requestSnapshot,
    requestSnapshotPresent: true,
    snapshotSource: 'immutable_settlement_truth' as const,
    payloadBuilderVersion: 'settlement-logo-request-v1',
  },
  responseSnapshot: {
    present: true,
    type: 'object',
    topLevelKeys: ['action', 'body', 'capturedAt', 'identifiers', 'ok', 'provider'],
    approximateSizeBytes: 512,
  },
};

const createdInvoiceRecordsResponse: SettlementCommissionInvoiceRecordsResponse = {
  ok: true,
  writesPerformed: false,
  settlementApprovalId: 'approval-2',
  records: [createdInvoiceRecordMissingNumber],
};

const outgoingInvoiceSyncPreviewResponse: LogoOutgoingInvoiceSyncPreview = {
  ok: true,
  writesPerformed: false,
  blockers: [],
  warnings: [],
	  record: {
	    id: 'created-record',
	    status: 'CREATED',
	    providerUuid: '82691C7B-28D6-4E30-95C9-C0658E90F090',
	    invoiceNo: null,
	    providerInvoiceId: 'logo-invoice-1',
	    providerEttn: null,
	    expectedInvoiceTotalMinor: 12050,
	  },
	  search: {
	    dateStart: '2026-06-05T10:01:00.000Z',
	    dateEnd: '2026-06-20T00:00:00.000Z',
	    pagesChecked: 1,
	    totalProviderCount: 1,
	    matched: true,
	    ambiguity: false,
	  },
	  matchedInvoice: {
	    id: '750',
	    uuid: '82691C7B-28D6-4E30-95C9-C0658E90F090',
	    uuId: '82691C7B-28D6-4E30-95C9-C0658E90F090',
	    invoiceId: 'einvoice-row-1',
	    salesInvoiceId: '12345',
	    invoiceNumber: null,
	    invoiceNo: null,
	    documentNumber: null,
	    number: null,
	    date: '2026-06-12T12:00:00',
	    issueDate: '2026-06-12T12:00:00',
	    amount: 120.5,
	    total: 120.5,
	    currency: 'TRY',
	    status: "Henüz GİB'e Gönderilmedi",
	    statusCode: 10,
	    eType: 'EARSIV',
	    eGovermentType: 'EARSIV',
	    eGovermentTypeDesc: 'E-Arşiv',
	    connectStatusDescription: 'Provider waiting',
	    connectStatusCode: 20,
	    accountingStatusSummary: {},
	    customerDisplayName: 'Yali Spor',
	  },
	  candidateInvoices: [
	    {
	      id: '750',
	      uuid: 'some-other-uuid',
	      uuId: 'some-other-uuid',
	      invoiceId: 'einvoice-row-1',
	      salesInvoiceId: '750',
	      date: '2026-06-12T12:00:00',
	      issueDate: '2026-06-12T12:00:00',
	      amount: 120.5,
	      total: 120.5,
	      currency: 'TRY',
	      status: "Henüz GİB'e Gönderilmedi",
	      statusCode: 10,
	      eType: 'EARSIV',
	      eGovermentType: 'EARSIV',
	      eGovermentTypeDesc: 'E-Arşiv',
	      type: '7',
	      customerDisplayName: 'Yali Spor',
	      matchSignals: {
	        providerInvoiceIdEqualsId: false,
	        salesInvoiceIdEqualsProviderInvoiceId: true,
	        invoiceIdEqualsProviderInvoiceId: false,
	        providerUuidEqualsUuid: false,
	        providerUuidEqualsUuId: false,
	        invoiceNumberPresent: false,
	        amountNearRecordTotal: false,
	      },
	    },
  ],
  providerFieldsObserved: ['amount', 'currency', 'invoiceId', 'issueDate', 'salesInvoiceId', 'status', 'statusCode', 'uuId'],
  mappedFields: {
	    providerUuid: '82691C7B-28D6-4E30-95C9-C0658E90F090',
	    providerInvoiceId: '12345',
	    providerEttn: '82691C7B-28D6-4E30-95C9-C0658E90F090',
	    gibStatus: null,
	    gibStatusCode: null,
    documentStatus: 'Provider waiting',
    documentStatusCode: 20,
    documentType: 'EARSIV',
    invoiceDate: '2026-06-12T12:00:00',
    invoiceTotalMinor: 12050,
    invoiceCurrency: 'TRY',
    invoiceNoCandidate: null,
    invoiceNumberAvailable: false,
    invoiceNumberSource: 'unknown',
    invoiceNumberRecoveryPossible: true,
  },
};

const createRequestSnapshotResponse = {
  ok: true,
  writesPerformed: true,
  settlementApprovalId: 'approval-1',
  provider: 'logo_isbasi',
  status: 'pending' as const,
  blockers: [],
  warnings: [],
  record: {
    ...invoiceRecordsResponse.records[0],
    requestSnapshot: {
      present: true,
      type: 'object',
      topLevelKeys: [
        'executionSnapshotGuard',
        'logoPayload',
        'payloadBuilderVersion',
        'provider',
        'requestBuiltAt',
        'settlementApprovalId',
        'settlementApprovalSnapshot',
        'settlementBillingSnapshot',
        'settlementLineSnapshotSummary',
        'vendorId',
      ],
      approximateSizeBytes: 4096,
      requestSnapshotPresent: true,
      payloadBuilderVersion: 'settlement-logo-request-v1',
      requestBuiltAt: '2026-06-12T10:00:00.000Z',
      snapshotSource: 'immutable_settlement_truth' as const,
    },
  },
  requestSnapshot: {
    present: true,
    type: 'object',
    topLevelKeys: [
      'executionSnapshotGuard',
      'logoPayload',
      'payloadBuilderVersion',
      'provider',
      'requestBuiltAt',
      'settlementApprovalId',
      'settlementApprovalSnapshot',
      'settlementBillingSnapshot',
      'settlementLineSnapshotSummary',
      'vendorId',
    ],
    approximateSizeBytes: 4096,
    requestSnapshotPresent: true,
    payloadBuilderVersion: 'settlement-logo-request-v1',
    requestBuiltAt: '2026-06-12T10:00:00.000Z',
    snapshotSource: 'immutable_settlement_truth' as const,
  },
};

const activeInvoiceBlockerMessage =
  'SettlementApproval already has an active LOGO_ISBASI commission invoice record (invoice-record-1, PENDING).';

const activeInvoiceBlockerRequestSnapshotResponse = {
  ok: false,
  writesPerformed: false,
  settlementApprovalId: 'approval-1',
  provider: 'logo_isbasi',
  status: 'blocked' as const,
  blockers: [activeInvoiceBlockerMessage],
  warnings: [],
  record: null,
  requestSnapshot: null,
};

const diagnosticsResponse: SettlementCommissionInvoiceDiagnostics = {
  ok: true,
  writesPerformed: false,
  record: {
    id: 'invoice-record-1',
    settlementApprovalId: 'approval-1',
    vendorId: 'yalispor',
    provider: 'logo_isbasi',
    status: 'pending',
    retryCount: 0,
    environmentGuard: {
      allowed: false,
      environment: null,
      expectedTenantConfigured: false,
      actualTenantPresent: false,
      tenantValidationStatus: 'skipped',
      tenantValidation: {
        expectedTenantConfigured: false,
        expectedTenantIdPresent: false,
        expectedTenantId: null,
        actualTenantPresent: false,
        actualTenantIdPresent: false,
        actualTenantId: null,
        tenantValidationStatus: 'skipped',
        status: 'skipped',
      },
      blockers: ['LOGO_ISBASI_CREATE_ENABLED must be true before Logo invoice execution.'],
      warnings: ['Tenant validation skipped because LOGO_ISBASI_EXPECTED_TENANT_ID is not configured.'],
    },
    executionContract: {
      ok: true,
      writesPerformed: false,
      settlementCommissionInvoiceId: 'invoice-record-1',
      status: 'READY',
      recordStatus: 'PENDING',
      requestSnapshotPresent: true,
      payloadPresent: true,
      snapshotSource: 'immutable_settlement_truth',
      payloadBuilderVersion: 'settlement-logo-request-v1',
      requestBuiltAt: '2026-06-12T10:00:00.000Z',
      blockers: [],
    },
    providerIdentifiers: {
      providerInvoiceId: null,
      providerUuid: null,
      providerEttn: null,
      invoiceNo: null,
    },
    timestamps: {
      createdAt: '2026-06-10T10:01:00.000Z',
      updatedAt: '2026-06-10T10:01:00.000Z',
      failedAt: null,
      lastRetriedAt: null,
      cancelledAt: null,
      documentFetchedAt: null,
    },
    snapshots: {
      request: {
        present: true,
        type: 'object',
        topLevelKeys: ['payload'],
        approximateSizeBytes: 20,
        requestSnapshotPresent: true,
        payloadBuilderVersion: 'settlement-logo-request-v1',
        requestBuiltAt: '2026-06-12T10:00:00.000Z',
        snapshotSource: 'immutable_settlement_truth',
      },
      response: {
        present: false,
        type: 'null',
        topLevelKeys: [],
        approximateSizeBytes: 0,
      },
      document: {
        present: false,
        type: 'null',
        topLevelKeys: [],
        approximateSizeBytes: 0,
      },
    },
    failure: {
      failureCode: null,
      failureMessage: null,
    },
    unknown: {
      reason: null,
      unknownAt: null,
      reconciliationState: null,
      reconciledAt: null,
      reconciledBy: null,
      reconciliationEvidence: {
        present: false,
        type: 'null',
        topLevelKeys: [],
        approximateSizeBytes: 0,
      },
    },
  },
};

const allowedDiagnosticsResponse: SettlementCommissionInvoiceDiagnostics = {
  ...diagnosticsResponse,
  record: {
    ...diagnosticsResponse.record,
    environmentGuard: {
      allowed: true,
      environment: 'test',
      expectedTenantConfigured: true,
      actualTenantPresent: true,
      tenantValidationStatus: 'passed',
      tenantValidation: {
        expectedTenantConfigured: true,
        expectedTenantIdPresent: true,
        expectedTenantId: 'tenant-1',
        actualTenantPresent: true,
        actualTenantIdPresent: true,
        actualTenantId: 'tenant-1',
        tenantValidationStatus: 'passed',
        status: 'passed',
      },
      blockers: [],
      warnings: [],
    },
    executionContract: {
      ...diagnosticsResponse.record.executionContract,
      ok: true,
      status: 'READY',
      blockers: [],
    },
  },
};

const createdDiagnosticsResponse: SettlementCommissionInvoiceDiagnostics = {
  ...allowedDiagnosticsResponse,
  record: {
    ...allowedDiagnosticsResponse.record,
    id: 'created-record',
    settlementApprovalId: 'approval-2',
    status: 'created',
    providerIdentifiers: {
      providerInvoiceId: 'logo-invoice-1',
      providerUuid: '82691C7B-28D6-4E30-95C9-C0658E90F090',
      providerEttn: null,
      invoiceNo: null,
    },
    executionContract: {
      ...allowedDiagnosticsResponse.record.executionContract,
      ok: false,
      status: 'BLOCKED',
      recordStatus: 'CREATED',
      blockers: [
        'SettlementCommissionInvoice status must be PENDING or FAILED before Logo execution. Current status: CREATED.',
      ],
    },
    snapshots: {
      ...allowedDiagnosticsResponse.record.snapshots,
      response: {
        present: true,
        type: 'object',
        topLevelKeys: ['action', 'body', 'capturedAt', 'identifiers', 'ok', 'provider'],
        approximateSizeBytes: 512,
      },
    },
  },
};

const createdLogoInvoiceResponse = {
  ok: true,
  writesPerformed: true,
  externalApiCallAttempted: true,
  settlementCommissionInvoiceId: 'invoice-record-1',
  status: 'created',
  blockers: [],
  warnings: [],
  environmentGuard: allowedDiagnosticsResponse.record.environmentGuard,
	  record: {
	    ...createRequestSnapshotResponse.record,
	    status: 'created' as const,
	    providerInvoiceId: 'logo-invoice-1',
	    providerUuid: 'logo-uuid-1',
	    providerEttn: 'logo-ettn-1',
	    invoiceNo: 'REE2026000000068',
	    reconciliationStatus: 'matched',
	    reconciliationEvidence: {
	      reconciliationStatus: 'matched',
	      matched: true,
	      invoiceNo: 'REE2026000000068',
	      invoiceDate: '2026-06-18T17:45:00',
	      invoiceTotalMinor: 136764,
	      invoiceCurrency: 'TL',
	      gibStatus: '0',
	      gibStatusCode: null,
	      documentStatus: null,
	      documentStatusCode: null,
	      documentType: 'SALES_INVOICE',
	      warnings: [],
	    },
	  },
  providerResult: {
    httpStatus: 200,
    invoiceId: 'logo-invoice-1',
    uuid: 'logo-uuid-1',
    ettn: 'logo-ettn-1',
	    invoiceNo: 'ABC202600001',
	  },
	  reconciliation: {
	    attempted: true,
	    status: 'matched',
	    matched: true,
	    invoiceNo: 'REE2026000000068',
	    invoiceDate: '2026-06-18T17:45:00',
	    invoiceTotalMinor: 136764,
	    invoiceCurrency: 'TL',
	    warnings: [],
	  },
	};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/finance/settlement-approvals']}>
      <AdminSettlementApprovalsPage />
    </MemoryRouter>,
  );
}

describe('Finance Settlement approval admin UI', () => {
  beforeEach(() => {
    cleanup();
    vi.resetAllMocks();
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['yalispor'],
      vendorDetails: [{ vendorId: 'yalispor', vendorName: 'Yalispor' }],
      canSwitchVendors: true,
      defaultVendorId: 'yalispor',
    });
    setCurrentVendorId('yalispor');
    getDatabaseHealthMock.mockResolvedValue({
      ok: true,
      environment: 'test',
      financeAuditMetadata: {
        environment: 'test',
        databaseHost: 'localhost',
        databaseName: 'vendor_dashboard_dev',
        schemaReady: true,
        databaseSourceLabel: 'local',
        warnings: [],
      },
      databaseSource: {
        duplicateDatabaseUrlDefinitionsDetected: false,
        warnings: [],
      },
    });
    previewSettlementApprovalMock.mockResolvedValue(previewResponse);
    createSettlementApprovalDraftMock.mockResolvedValue(draftApproval);
    getSettlementApprovalMock.mockResolvedValue(draftApproval);
    approveSettlementApprovalMock.mockResolvedValue(approvedApproval);
    cancelSettlementApprovalMock.mockResolvedValue(cancelledApproval);
    getSettlementApprovalAuditMock.mockResolvedValue(auditResponse);
    previewSettlementLogoCommissionInvoiceMock.mockResolvedValue(logoPreviewResponse);
    persistSettlementLogoCommissionInvoiceRequestSnapshotMock.mockResolvedValue(createRequestSnapshotResponse);
    executeSettlementLogoCommissionInvoiceCreateMock.mockResolvedValue(createdLogoInvoiceResponse);
    getSettlementCommissionInvoiceRecordsMock.mockResolvedValue(invoiceRecordsResponse);
    getSettlementCommissionInvoiceDiagnosticsMock.mockResolvedValue(diagnosticsResponse);
    previewLogoOutgoingInvoiceSyncMock.mockResolvedValue(outgoingInvoiceSyncPreviewResponse);
    listSettlementApprovalsMock.mockResolvedValue(recentApprovalsResponse);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the settlement workspace shell and advanced database details', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Settlement Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Candidate source' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Current Candidate Preview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Audit' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Logo Readiness' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Commission Invoice Records' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Next: Preview settlement candidates.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview Settlement' })).toBeInTheDocument();
    expect(screen.getByText('Preview not generated yet.')).toBeInTheDocument();
    expect(screen.queryByText('Candidate Quality')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Selected settlement rows' })).not.toBeInTheDocument();
    expect(screen.queryByText('TRY 0.00')).not.toBeInTheDocument();
    expect(screen.getByText('Candidate Selected')).toBeInTheDocument();
    expect(screen.getByText('Invoice Records')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/vendor_dashboard_dev/i)).toBeInTheDocument());
  });

  it('renders recent approvals and opens an approval without manual id copy paste', async () => {
    getSettlementApprovalMock.mockResolvedValueOnce(selectedRecentApproval);
    renderPage();

    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('yalispor'));
    expect(screen.getByRole('heading', { name: 'Recent approvals' })).toBeInTheDocument();
    expect(screen.queryByText('approval-2')).not.toBeInTheDocument();
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);

    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('approval-2'));
    expect(screen.getByLabelText(/Approval id/i)).toHaveValue('approval-2');
    expect(screen.getAllByText('Open in workspace').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Loaded Approval Snapshot' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Current Candidate Preview' })).not.toBeInTheDocument();
    expect(screen.queryByText('Candidate Quality')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load Audit' })).toBeEnabled();
    expect(screen.getByText('Next: Load Audit Snapshot.')).toBeInTheDocument();
  });

  it('opening an approval with a created invoice record hydrates terminal invoice state', async () => {
    getSettlementApprovalMock.mockResolvedValueOnce(selectedRecentApproval);
    getSettlementCommissionInvoiceRecordsMock.mockResolvedValueOnce(createdInvoiceRecordsResponse);
    getSettlementCommissionInvoiceDiagnosticsMock.mockResolvedValueOnce(createdDiagnosticsResponse);
    renderPage();

    await waitFor(() => expect(listSettlementApprovalsMock).toHaveBeenCalledWith('yalispor'));
    const openButtons = await screen.findAllByRole('button', { name: 'Open' });
    await userEvent.click(openButtons[0]);

    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('approval-2'));
    await waitFor(() => expect(getSettlementCommissionInvoiceRecordsMock).toHaveBeenCalledWith('approval-2'));
    expect(screen.getByRole('tab', { name: 'Commission Invoice Records' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Logo commission invoice was created.')).toBeInTheDocument();
    expect(screen.getAllByText('82691C7B-28D6-4E30-95C9-C0658E90F090').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Invoice number not returned yet; provider UUID is available for reconciliation.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Create Logo Invoice' })).not.toBeInTheDocument();
    expect(screen.getByText('Logo commission invoice has been created. Review created invoice record.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review created invoice record' })).toBeEnabled();

    const invoicePanel = screen.getByText('created-record').closest('.settlement-tab-panel') ?? document.body;
    await userEvent.click(within(invoicePanel as HTMLElement).getByRole('button', { name: /Read diagnostics \(read-only\)/i }));

    await waitFor(() => expect(getSettlementCommissionInvoiceDiagnosticsMock).toHaveBeenCalledWith('created-record'));
    expect(screen.getAllByText('Not executable because invoice is already CREATED.').length).toBeGreaterThan(0);
    expect(screen.getByText('Execution complete')).toBeInTheDocument();
    expect(screen.queryByText('Execution contract blockers')).not.toBeInTheDocument();
  });

  it('previews Logo sales invoice sync for a created record without writing data', async () => {
    getSettlementApprovalMock.mockResolvedValueOnce(selectedRecentApproval);
    getSettlementCommissionInvoiceRecordsMock.mockResolvedValueOnce(createdInvoiceRecordsResponse);
    renderPage();

    const openButtons = await screen.findAllByRole('button', { name: 'Open' });
    await userEvent.click(openButtons[0]);

    await waitFor(() => expect(getSettlementCommissionInvoiceRecordsMock).toHaveBeenCalledWith('approval-2'));
    const invoicePanel = screen.getByText('created-record').closest('.settlement-tab-panel') ?? document.body;
    await userEvent.click(within(invoicePanel as HTMLElement).getByRole('button', { name: 'Preview Logo sales invoice sync' }));

    await waitFor(() => expect(previewLogoOutgoingInvoiceSyncMock).toHaveBeenCalledWith('created-record'));
    expect(screen.getByText('Logo sales invoice sync preview loaded. No data was written.')).toBeInTheDocument();
    expect(screen.getByText('Sync preview created-record')).toBeInTheDocument();
    expect(screen.getAllByText('82691C7B-28D6-4E30-95C9-C0658E90F090').length).toBeGreaterThan(0);
    expect(screen.getByText('Provider waiting')).toBeInTheDocument();
    expect(screen.getAllByText('UNKNOWN').length).toBeGreaterThan(0);
    expect(screen.getByText('Invoice number is UNKNOWN.')).toBeInTheDocument();
    expect(screen.getByText('Logo sales invoice list did not return invoiceNumber, invoiceNo, documentNumber, or number for this match.')).toBeInTheDocument();
    expect(screen.getByText('Candidate sales invoices')).toBeInTheDocument();
    expect(screen.getByText(/salesInvoiceId 750/)).toBeInTheDocument();
    expect(screen.getByText(/sales id match yes/)).toBeInTheDocument();
  });

  it('opening an approved approval replaces an existing preview panel', async () => {
    getSettlementApprovalMock.mockResolvedValueOnce(selectedRecentApproval);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));
    await waitFor(() => expect(screen.getByText('Candidate Quality')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Current Candidate Preview' })).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);

    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('approval-2'));
    expect(screen.getByRole('heading', { name: 'Loaded Approval Snapshot' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Selected settlement rows' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Current Candidate Preview' })).not.toBeInTheDocument();
    expect(screen.queryByText('Candidate Quality')).not.toBeInTheDocument();
  });

  it('opens a draft approval with snapshot totals and lines after an empty preview', async () => {
    previewSettlementApprovalMock.mockResolvedValueOnce(lockedRowsPreviewResponse);
    getSettlementApprovalMock.mockResolvedValueOnce(draftApprovalWithTwoLines);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));
    await waitFor(() => expect(screen.getByText('No eligible rows remain because rows are already locked in an active settlement approval.')).toBeInTheDocument());
    expect(screen.getAllByText('EMPTY').length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByRole('button', { name: 'Open' })[1]);

    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));
    expect(screen.getByLabelText(/Approval id/i)).toHaveValue('approval-1');

    const executiveSummary = screen.getByLabelText('Settlement executive summary');
    expect(within(executiveSummary).getByText('SNAPSHOT')).toBeInTheDocument();
    expect(within(executiveSummary).getByText('TRY 7,598.00')).toBeInTheDocument();
    expect(within(executiveSummary).getByText('TRY 6,230.36')).toBeInTheDocument();
    expect(within(executiveSummary).queryByText('EMPTY')).not.toBeInTheDocument();
    expect(screen.queryByText('No eligible rows remain because rows are already locked in an active settlement approval.')).not.toBeInTheDocument();

    expect(screen.getByLabelText('Settlement workspace layout')).toHaveClass('is-loaded-approval-layout');
    expect(screen.getByRole('heading', { name: 'Loaded Approval Snapshot' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Current Candidate Preview' })).not.toBeInTheDocument();
    expect(screen.queryByText('Candidate Quality')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Selected settlement rows' })).toBeInTheDocument();
    expect(screen.getByLabelText('Selected settlement rows')).toHaveClass('settlement-approval-lines-list');
    expect(screen.getAllByText('#1081').length).toBeGreaterThan(0);
    expect(screen.getByText('fle-sale-1081-a')).toBeInTheDocument();
    expect(screen.getByText('alloc-yalispor-1081-a')).toBeInTheDocument();
    expect(screen.getAllByText('TRY 3,115.18').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Approve Settlement' })).toBeEnabled();
  });

  it('loads settlement preview totals and sample lines', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));

    await waitFor(() => expect(previewSettlementApprovalMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      candidateScope: 'vendor_wide',
      periodStart: null,
      periodEnd: null,
      selectedOrderIds: [],
      selectedShopifyOrderIds: [],
      selectedAllocationIds: [],
    }));
    expect(screen.getAllByText(/1,200\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vendor-wide preview can include historical or test rows.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('profile-current').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Current Candidate Preview' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Loaded Approval Snapshot' })).not.toBeInTheDocument();
    expect(screen.getByText('Candidate Quality')).toBeInTheDocument();
    expect(screen.getAllByText('CLEAN').length).toBeGreaterThan(0);
    expect(screen.getByText('Candidate snapshots are uniform for VAT, shipping mode, and financial profile group.')).toBeInTheDocument();
    expect(screen.getByText('Next: Create Draft.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Draft' })).toBeEnabled();
    expect(screen.getByText('Preview Reviewed')).toBeInTheDocument();
  });

  it('renders warning candidate quality for mixed shipping modes', async () => {
    previewSettlementApprovalMock.mockResolvedValue(mixedShippingPreviewResponse);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));

    await waitFor(() => expect(screen.getByText('Candidate Quality')).toBeInTheDocument());
    expect(screen.getAllByText('WARNING').length).toBeGreaterThan(0);
    expect(screen.getByText('Multiple shipping modes require review before settlement approval.')).toBeInTheDocument();
    expect(screen.getAllByText('DISABLED, FIXED').length).toBeGreaterThan(0);
    expect(screen.getByText('Next: Create Draft.')).toBeInTheDocument();
  });

  it('sends period filters to preview and draft creation', async () => {
    renderPage();

    await userEvent.click(screen.getByLabelText(/Period/i));
    await userEvent.type(screen.getByLabelText(/Period start/i), '2026-06-01');
    await userEvent.type(screen.getByLabelText(/Period end/i), '2026-06-30');
    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));

    await waitFor(() => expect(previewSettlementApprovalMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      candidateScope: 'date_range',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      selectedOrderIds: [],
      selectedShopifyOrderIds: [],
      selectedAllocationIds: [],
    }));
    expect(screen.getAllByText('Start 2026-06-01').length).toBeGreaterThan(0);
    expect(screen.getAllByText('End 2026-06-30').length).toBeGreaterThan(0);

    await userEvent.click(await screen.findByRole('button', { name: 'Create Draft' }));
    await waitFor(() => expect(createSettlementApprovalDraftMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      candidateScope: 'date_range',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      selectedOrderIds: [],
      selectedShopifyOrderIds: [],
      selectedAllocationIds: [],
      notes: 'Admin settlement approval draft',
    }));
  });

  it('sends selected order identifiers and renders selected candidate quality', async () => {
    previewSettlementApprovalMock.mockResolvedValue(selectedOrderPreviewResponse);
    renderPage();

    await userEvent.click(screen.getByLabelText(/Orders/i));
    await userEvent.type(screen.getByLabelText(/Order numbers/i), '#1074');
    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));

    await waitFor(() => expect(previewSettlementApprovalMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      candidateScope: 'selected_orders',
      periodStart: null,
      periodEnd: null,
      selectedOrderIds: ['#1074'],
      selectedShopifyOrderIds: [],
      selectedAllocationIds: [],
    }));
    expect(screen.getAllByText('Orders').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Order #1074').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Candidate Rows').length).toBeGreaterThan(0);
    expect(screen.getAllByText('EXTERNAL_PROVIDER').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CLEAN').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'Create Draft' }));
    await waitFor(() => expect(createSettlementApprovalDraftMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      candidateScope: 'selected_orders',
      periodStart: null,
      periodEnd: null,
      selectedOrderIds: ['#1074'],
      selectedShopifyOrderIds: [],
      selectedAllocationIds: [],
      notes: 'Admin settlement approval draft',
    }));
  });

  it('shows selected-order no-match diagnostics without marking quality clean', async () => {
    previewSettlementApprovalMock.mockResolvedValue(unmatchedSelectedOrderPreviewResponse);
    renderPage();

    await userEvent.click(screen.getByLabelText(/Orders/i));
    await userEvent.type(screen.getByLabelText(/Order numbers/i), '#1074');
    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));

    await waitFor(() => expect(screen.getByText('Selected Order Diagnostics')).toBeInTheDocument());
    expect(screen.getByText('No finance ledger row matched this selected order.')).toBeInTheDocument();
    expect(screen.getAllByText('NO MATCH').length).toBeGreaterThan(0);
    expect(screen.queryByText('Candidate snapshots are uniform for VAT, shipping mode, and financial profile group.')).not.toBeInTheDocument();
    expect(screen.queryByText('CLEAN')).not.toBeInTheDocument();
    expect(screen.getAllByText('TRY 0.00').length).toBeGreaterThan(0);
  });

  it('shows selected-order matched but ineligible diagnostics', async () => {
    previewSettlementApprovalMock.mockResolvedValue(ineligibleSelectedOrderPreviewResponse);
    renderPage();

    await userEvent.click(screen.getByLabelText(/Orders/i));
    await userEvent.type(screen.getByLabelText(/Order numbers/i), '#1074');
    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));

    await waitFor(() => expect(screen.getByText('Selected Order Diagnostics')).toBeInTheDocument());
    expect(screen.getByText('Excluded because row is not payable or partially refunded.')).toBeInTheDocument();
    expect(screen.getByText('fle-sale-1074')).toBeInTheDocument();
    expect(screen.getAllByText('EMPTY').length).toBeGreaterThan(0);
    expect(screen.queryByText('CLEAN')).not.toBeInTheDocument();
  });

  it('surfaces the selected-order exclusion reason when draft creation has no eligible rows', async () => {
    previewSettlementApprovalMock.mockResolvedValue(settlementDelaySelectedOrderPreviewResponse);
    createSettlementApprovalDraftMock.mockRejectedValue(new Error('No eligible settlement rows are available for approval.'));
    renderPage();

    await userEvent.click(screen.getByLabelText(/Orders/i));
    await userEvent.type(screen.getByLabelText(/Order numbers/i), '#1081');
    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));
    await waitFor(() => expect(screen.getByText('Settlement delay period has not elapsed')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Create Draft' }));

    await waitFor(() => expect(createSettlementApprovalDraftMock).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Settlement approval cannot be created.' })).toBeInTheDocument();
    expect(screen.getByText('Order #1081 is not yet eligible.')).toBeInTheDocument();
    expect(screen.getAllByText('Current status').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ACCRUING').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Derived status').length).toBeGreaterThan(0);
    expect(screen.getAllByText('accruing').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Settlement delay period has not elapsed').length).toBeGreaterThan(0);
    expect(screen.queryByText('Finance action failed')).not.toBeInTheDocument();
  });

  it('summarizes multiple draft exclusion reasons compactly', async () => {
    previewSettlementApprovalMock.mockResolvedValue(multiReasonExcludedPreviewResponse);
    createSettlementApprovalDraftMock.mockRejectedValue(new Error('No eligible settlement rows are available for approval.'));
    renderPage();

    await userEvent.click(screen.getByLabelText(/Orders/i));
    await userEvent.type(screen.getByLabelText(/Order numbers/i), '#1081, #1082');
    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));

    await waitFor(() => expect(screen.getByText('Selected Order Diagnostics')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Create Draft' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Settlement approval cannot be created.' })).toBeInTheDocument());
    expect(screen.getByText('2 settlement rows were excluded.')).toBeInTheDocument();
    expect(screen.getByText('Reasons')).toBeInTheDocument();
    expect(screen.getAllByText('Settlement delay period has not elapsed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Row already belongs to an active settlement approval.').length).toBeGreaterThan(0);
  });

  it('keeps the generic draft failure fallback when no diagnostic reason exists', async () => {
    previewSettlementApprovalMock.mockResolvedValue({
      ...unmatchedSelectedOrderPreviewResponse,
      selectedOrderDiagnostics: [],
    });
    createSettlementApprovalDraftMock.mockRejectedValue(new Error('No eligible settlement rows are available for approval.'));
    renderPage();

    await userEvent.click(screen.getByLabelText(/Orders/i));
    await userEvent.type(screen.getByLabelText(/Order numbers/i), '#1081');
    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create Draft' }));

    await waitFor(() => expect(screen.getByText('Finance action failed')).toBeInTheDocument());
    expect(screen.getByText('No eligible settlement rows are available for approval.')).toBeInTheDocument();
  });

  it('shows selected-order locked approval diagnostics and opens the linked approval', async () => {
    getSettlementApprovalMock.mockResolvedValueOnce({
      ...selectedRecentApproval,
      id: 'approval-locked-1074',
      status: 'approved',
    });
    previewSettlementApprovalMock.mockResolvedValue(lockedSelectedOrderPreviewResponse);
    renderPage();

    await userEvent.click(screen.getByLabelText(/Orders/i));
    await userEvent.type(screen.getByLabelText(/Order numbers/i), '#1074');
    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));

    await waitFor(() => expect(screen.getByText('Selected Order Diagnostics')).toBeInTheDocument());
    expect(screen.getByText('Excluded because row already belongs to active settlement approval.')).toBeInTheDocument();
    expect(screen.getByText('approval-locked-1074')).toBeInTheDocument();

    const diagnosticsPanel = screen.getByText('Selected Order Diagnostics').closest('section') ?? document.body;
    await userEvent.click(within(diagnosticsPanel as HTMLElement).getByRole('button', { name: 'Open' }));

    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('approval-locked-1074'));
    expect(screen.getByLabelText(/Approval id/i)).toHaveValue('approval-locked-1074');
  });

  it('sends selected allocation identifiers and renders unmatched allocation feedback', async () => {
    previewSettlementApprovalMock.mockResolvedValue(selectedAllocationPreviewResponse);
    renderPage();

    await userEvent.click(screen.getByLabelText(/Allocations/i));
    await userEvent.type(screen.getByLabelText(/Allocation ids/i), 'alloc-1074, alloc-missing');
    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));

    await waitFor(() => expect(previewSettlementApprovalMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      candidateScope: 'selected_allocations',
      periodStart: null,
      periodEnd: null,
      selectedOrderIds: [],
      selectedShopifyOrderIds: [],
      selectedAllocationIds: ['alloc-1074', 'alloc-missing'],
    }));
    expect(screen.getAllByText('Allocations').length).toBeGreaterThan(0);
    expect(screen.getByText('Allocation alloc-1074')).toBeInTheDocument();
    expect(screen.getByText('Allocation alloc-missing')).toBeInTheDocument();
  });

  it('calls draft, approve, cancel, and fetch routes through the approval controls', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create Draft' }));

    await waitFor(() => expect(createSettlementApprovalDraftMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      candidateScope: 'vendor_wide',
      periodStart: null,
      periodEnd: null,
      selectedOrderIds: [],
      selectedShopifyOrderIds: [],
      selectedAllocationIds: [],
      notes: 'Admin settlement approval draft',
    }));

    await userEvent.click(screen.getByRole('button', { name: 'Approve Settlement' }));
    await waitFor(() => expect(approveSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));

    const approvalInput = screen.getByLabelText(/Approval id/i);
    await userEvent.clear(approvalInput);
    await userEvent.type(approvalInput, 'approval-1');
    await userEvent.click(screen.getByRole('button', { name: /Fetch approval detail \(read-only\)/i }));
    await waitFor(() => expect(getSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));

    await userEvent.click(screen.getByRole('button', { name: /Cancel DRAFT\/APPROVED \(writes local DB\)/i }));
    await waitFor(() => expect(cancelSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));
  });

  it('renders audit eligibility reason and Logo readiness blockers and warnings', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create Draft' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve Settlement' }));
    await waitFor(() => expect(approveSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));
    await userEvent.click(screen.getByRole('button', { name: 'Load Audit' }));
    await waitFor(() => expect(screen.getByText('Derived payable because fulfillment evidence exists.')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Audit' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Next: Run Logo Readiness.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Run Logo Readiness' }));
    await waitFor(() => expect(screen.getByText('Vendor must have logoIsbasiCustomerCode before Logo invoice creation.')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Logo Readiness' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Read-only preview only. No Logo invoice is created.')).toBeInTheDocument();
    expect(screen.getByText('Immutable request snapshot')).toBeInTheDocument();
    expect(screen.getByText('settlement-logo-request-v1')).toBeInTheDocument();
    expect(screen.getByText('Immutable request snapshot: Vendor must have logoIsbasiCustomerCode before Logo invoice creation.')).toBeInTheDocument();
    expect(screen.getByText('Execution snapshot guard')).toBeInTheDocument();
    expect(screen.getAllByText('Pass').length).toBeGreaterThan(0);
    expect(screen.getByText('disabled')).toBeInTheDocument();
    expect(screen.getByText('SPORGYM-COMMISSION')).toBeInTheDocument();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  });

  it('renders active commission invoice warning and diagnostics metadata', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create Draft' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve Settlement' }));
    await userEvent.click(screen.getByRole('button', { name: 'Load Audit' }));
    await waitFor(() => expect(getSettlementApprovalAuditMock).toHaveBeenCalledWith('approval-1'));
    await userEvent.click(screen.getByRole('button', { name: 'Run Logo Readiness' }));
    await waitFor(() => expect(previewSettlementLogoCommissionInvoiceMock).toHaveBeenCalledWith('approval-1'));
    await userEvent.click(screen.getByRole('button', { name: 'Load Commission Invoice Records' }));

    await waitFor(() => expect(screen.getByText('Active commission invoice record exists.')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Commission Invoice Records' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('invoice-record-1')).toBeInTheDocument();

    const invoicePanel = screen.getByText('invoice-record-1').closest('.settlement-tab-panel') ?? document.body;
    await userEvent.click(within(invoicePanel as HTMLElement).getByRole('button', { name: /Read diagnostics \(read-only\)/i }));
    await waitFor(() => expect(getSettlementCommissionInvoiceDiagnosticsMock).toHaveBeenCalledWith('invoice-record-1'));
    expect(screen.getByText('Diagnostics invoice-record-1')).toBeInTheDocument();
    expect(screen.getByText(/Present · object/i)).toBeInTheDocument();
  });

  it('stores immutable Logo request snapshot as a pending local record from readiness', async () => {
    previewSettlementLogoCommissionInvoiceMock.mockResolvedValue(readyLogoPreviewResponse);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create Draft' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve Settlement' }));
    await userEvent.click(screen.getByRole('button', { name: 'Load Audit' }));
    await waitFor(() => expect(getSettlementApprovalAuditMock).toHaveBeenCalledWith('approval-1'));
    await userEvent.click(screen.getByRole('button', { name: 'Run Logo Readiness' }));

    await waitFor(() => expect(screen.getByText('Next: Store Immutable Request Snapshot.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Store Request Snapshot' })).toBeEnabled();
    expect(screen.getByText('Missing Snapshot')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Store Request Snapshot' }));

    await waitFor(() =>
      expect(persistSettlementLogoCommissionInvoiceRequestSnapshotMock).toHaveBeenCalledWith('approval-1'),
    );
    expect(screen.getByText('Immutable request snapshot stored as a pending local record. No Logo call was made.')).toBeInTheDocument();
    expect(screen.getByText('Request Snapshot Stored')).toBeInTheDocument();
    expect(screen.getAllByText('settlement-logo-request-v1').length).toBeGreaterThan(0);
    expect(screen.getByText('immutable_settlement_truth')).toBeInTheDocument();
  });

  it('hydrates commission invoice records after an active invoice blocker', async () => {
    previewSettlementLogoCommissionInvoiceMock.mockResolvedValue(readyLogoPreviewResponse);
    persistSettlementLogoCommissionInvoiceRequestSnapshotMock.mockResolvedValue(activeInvoiceBlockerRequestSnapshotResponse);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create Draft' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve Settlement' }));
    await userEvent.click(screen.getByRole('button', { name: 'Load Audit' }));
    await waitFor(() => expect(getSettlementApprovalAuditMock).toHaveBeenCalledWith('approval-1'));
    await userEvent.click(screen.getByRole('button', { name: 'Run Logo Readiness' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Store Request Snapshot' })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: 'Store Request Snapshot' }));

    await waitFor(() =>
      expect(persistSettlementLogoCommissionInvoiceRequestSnapshotMock).toHaveBeenCalledWith('approval-1'),
    );
    await waitFor(() => expect(getSettlementCommissionInvoiceRecordsMock).toHaveBeenCalledWith('approval-1'));
    expect(screen.getByText(activeInvoiceBlockerMessage)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Commission Invoice Records' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('invoice-record-1')).toBeInTheDocument();
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.queryByText('No invoice records loaded yet.')).not.toBeInTheDocument();
  });

  it('preserves active invoice blocker when record hydration fails', async () => {
    previewSettlementLogoCommissionInvoiceMock.mockResolvedValue(readyLogoPreviewResponse);
    persistSettlementLogoCommissionInvoiceRequestSnapshotMock.mockResolvedValue(activeInvoiceBlockerRequestSnapshotResponse);
    getSettlementCommissionInvoiceRecordsMock.mockRejectedValueOnce(new Error('Records endpoint unavailable.'));
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create Draft' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve Settlement' }));
    await userEvent.click(screen.getByRole('button', { name: 'Load Audit' }));
    await waitFor(() => expect(getSettlementApprovalAuditMock).toHaveBeenCalledWith('approval-1'));
    await userEvent.click(screen.getByRole('button', { name: 'Run Logo Readiness' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Store Request Snapshot' })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: 'Store Request Snapshot' }));

    await waitFor(() => expect(getSettlementCommissionInvoiceRecordsMock).toHaveBeenCalledWith('approval-1'));
    expect(screen.getByText(activeInvoiceBlockerMessage)).toBeInTheDocument();
    expect(screen.getByText('Could not load existing invoice records.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Commission Invoice Records' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No invoice records loaded yet.')).toBeInTheDocument();
  });

  it('disables Logo create when environment guard diagnostics are blocked', async () => {
    previewSettlementLogoCommissionInvoiceMock.mockResolvedValue(readyLogoPreviewResponse);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create Draft' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve Settlement' }));
    await userEvent.click(screen.getByRole('button', { name: 'Load Audit' }));
    await waitFor(() => expect(getSettlementApprovalAuditMock).toHaveBeenCalledWith('approval-1'));
    await userEvent.click(screen.getByRole('button', { name: 'Run Logo Readiness' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Store Request Snapshot' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Store Request Snapshot' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Commission Invoice Records' }));

    expect(screen.getByRole('button', { name: 'Create Logo Invoice' })).toBeDisabled();
    expect(screen.getByText('Read diagnostics before Logo create.')).toBeInTheDocument();

    const invoicePanel = screen.getByText('invoice-record-1').closest('.settlement-tab-panel') ?? document.body;
    await userEvent.click(within(invoicePanel as HTMLElement).getByRole('button', { name: /Read diagnostics \(read-only\)/i }));

    await waitFor(() =>
      expect(
        screen.getAllByText('LOGO_ISBASI_CREATE_ENABLED must be true before Logo invoice execution.').length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getByRole('button', { name: 'Create Logo Invoice' })).toBeDisabled();
    expect(executeSettlementLogoCommissionInvoiceCreateMock).not.toHaveBeenCalled();
  });

  it('requires confirmation before creating a Logo invoice and refreshes records and diagnostics after success', async () => {
    previewSettlementLogoCommissionInvoiceMock.mockResolvedValue(readyLogoPreviewResponse);
    getSettlementCommissionInvoiceDiagnosticsMock.mockResolvedValue(allowedDiagnosticsResponse);
    getSettlementCommissionInvoiceRecordsMock.mockResolvedValue({
      ...invoiceRecordsResponse,
      records: [createdLogoInvoiceResponse.record],
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create Draft' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve Settlement' }));
    await userEvent.click(screen.getByRole('button', { name: 'Load Audit' }));
    await waitFor(() => expect(getSettlementApprovalAuditMock).toHaveBeenCalledWith('approval-1'));
    await userEvent.click(screen.getByRole('button', { name: 'Run Logo Readiness' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Store Request Snapshot' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Store Request Snapshot' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Commission Invoice Records' }));

    const invoicePanel = screen.getByText('invoice-record-1').closest('.settlement-tab-panel') ?? document.body;
    await userEvent.click(within(invoicePanel as HTMLElement).getByRole('button', { name: /Read diagnostics \(read-only\)/i }));
    await waitFor(() => expect(getSettlementCommissionInvoiceDiagnosticsMock).toHaveBeenCalledWith('invoice-record-1'));

    const createButton = screen.getByRole('button', { name: 'Create Logo Invoice' });
    expect(createButton).toBeDisabled();
    await userEvent.click(screen.getByLabelText('I understand this will call Logo İşbaşı and may create a real invoice.'));
    expect(createButton).toBeEnabled();

    await userEvent.click(createButton);

    await waitFor(() =>
      expect(executeSettlementLogoCommissionInvoiceCreateMock).toHaveBeenCalledWith('invoice-record-1', {
        confirmLogoCreate: true,
      }),
    );
    await waitFor(() => expect(getSettlementCommissionInvoiceRecordsMock).toHaveBeenCalledWith('approval-1'));
    expect(getSettlementCommissionInvoiceDiagnosticsMock).toHaveBeenCalledWith('invoice-record-1');
	    expect(screen.getByText('Logo invoice created: REE2026000000068.')).toBeInTheDocument();
	    expect(screen.getByText('REE2026000000068')).toBeInTheDocument();
	    expect(screen.getByText(/Reconciliation Matched/i)).toBeInTheDocument();
	    expect(screen.getByText(/Invoice date/)).toBeInTheDocument();
	    expect(screen.getByText(/Invoice total/)).toBeInTheDocument();
  });

  it('does not show Logo create for UNKNOWN or CREATED records', async () => {
    getSettlementCommissionInvoiceRecordsMock.mockResolvedValue({
      ...invoiceRecordsResponse,
      records: [
        {
          ...createRequestSnapshotResponse.record,
          id: 'unknown-record',
          status: 'unknown',
          unknownReason: 'Reconciliation required.',
          unknownAt: '2026-06-12T10:06:00.000Z',
        },
        {
          ...createRequestSnapshotResponse.record,
          id: 'created-record',
          status: 'created',
          invoiceNo: 'ABC202600001',
        },
      ],
    });
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create Draft' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve Settlement' }));
    await userEvent.click(screen.getByRole('button', { name: 'Load Audit' }));
    await waitFor(() => expect(getSettlementApprovalAuditMock).toHaveBeenCalledWith('approval-1'));
    await userEvent.click(screen.getByRole('button', { name: 'Run Logo Readiness' }));
    await userEvent.click(screen.getByRole('button', { name: 'Load Commission Invoice Records' }));

    await waitFor(() => expect(screen.getByText('unknown-record')).toBeInTheDocument());
    expect(screen.getByText('created-record')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Logo Invoice' })).not.toBeInTheDocument();
    expect(screen.getByText('Invoice already created.')).toBeInTheDocument();
    expect(screen.getAllByText('Not available').length).toBeGreaterThanOrEqual(1);
  });

  it('keeps approval workflow context after a zero-eligible preview with active locked rows', async () => {
    previewSettlementApprovalMock
      .mockResolvedValueOnce(previewResponse)
      .mockResolvedValueOnce(lockedRowsPreviewResponse);

    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create Draft' }));
    await waitFor(() => expect(screen.getByLabelText(/Approval id/i)).toHaveValue('approval-1'));
    await userEvent.click(screen.getByRole('button', { name: 'Approve Settlement' }));
    await waitFor(() => expect(approveSettlementApprovalMock).toHaveBeenCalledWith('approval-1'));

    await userEvent.click(screen.getByRole('button', { name: 'Load Audit' }));
    await waitFor(() => expect(screen.getByText('Derived payable because fulfillment evidence exists.')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Run Logo Readiness' }));
    await waitFor(() => expect(screen.getByText('Vendor must have logoIsbasiCustomerCode before Logo invoice creation.')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Load Commission Invoice Records' }));
    await waitFor(() => expect(screen.getByText('invoice-record-1')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));

    await waitFor(() => expect(previewSettlementApprovalMock).toHaveBeenCalledTimes(2));
    const executiveSummary = screen.getByLabelText('Settlement executive summary');
    expect(within(executiveSummary).getByText('SNAPSHOT')).toBeInTheDocument();
    expect(within(executiveSummary).getByText('TRY 1,200.00')).toBeInTheDocument();
    expect(within(executiveSummary).getByText('TRY 956.00')).toBeInTheDocument();
    expect(within(executiveSummary).queryByText('EMPTY')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Loaded Approval Snapshot' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Current Candidate Preview' })).not.toBeInTheDocument();
    expect(screen.queryByText('Candidate Quality')).not.toBeInTheDocument();
    expect(screen.queryByText('No eligible rows remain because rows are already locked in an active settlement approval.')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Approval id/i)).toHaveValue('approval-1');
    await userEvent.click(screen.getByRole('tab', { name: 'Audit' }));
    expect(screen.getByText('Derived payable because fulfillment evidence exists.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Logo Readiness' }));
    expect(screen.getByText('Vendor must have logoIsbasiCustomerCode before Logo invoice creation.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Commission Invoice Records' }));
    expect(screen.getByText('invoice-record-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fetch approval detail \(read-only\)/i })).toBeEnabled();
  });

  it('requires acknowledgement before creating a mixed VAT draft', async () => {
    previewSettlementApprovalMock.mockResolvedValue(mixedVatPreviewResponse);
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Preview Settlement' }));

    await waitFor(() => expect(
      screen.getAllByText('Candidate rows include mixed commission VAT rates. Logo readiness will block mixed VAT settlements.').length,
    ).toBeGreaterThan(0));
    expect(screen.getAllByText('BLOCKED').length).toBeGreaterThan(0);
    expect(screen.getByText('Mixed VAT rates prevent Logo commission invoice readiness.')).toBeInTheDocument();
    expect(screen.getByText('Mixed VAT acknowledgement required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Draft' })).toBeDisabled();

    await userEvent.click(screen.getByLabelText(/I acknowledge this candidate is BLOCKED for Logo readiness/i));
    expect(screen.getByRole('button', { name: 'Create Draft' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Create Draft' }));
    await waitFor(() => expect(createSettlementApprovalDraftMock).toHaveBeenCalledWith({
      vendorId: 'yalispor',
      candidateScope: 'vendor_wide',
      periodStart: null,
      periodEnd: null,
      selectedOrderIds: [],
      selectedShopifyOrderIds: [],
      selectedAllocationIds: [],
      notes: 'Admin settlement approval draft',
    }));
  });

  it('does not reference legacy or test Logo create routes in the settlement approval UI files', () => {
    const pageSource = readFileSync('src/pages/AdminSettlementApprovalsPage.tsx', 'utf8');
    const apiSource = readFileSync('src/features/finance/settlementApprovalsApi.ts', 'utf8');

    expect(`${pageSource}\n${apiSource}`).not.toMatch(/test-create-invoice|create-invoice/i);
  });
});
