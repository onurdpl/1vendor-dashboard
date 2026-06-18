import { apiClient } from '../../lib/api-client';

export type SettlementApprovalStatus = 'draft' | 'approved' | 'cancelled';

export type DatabaseHealthResponse = {
  ok?: boolean;
  status?: string;
  environment?: string;
  databaseSource?: {
    databaseHost?: string | null;
    databaseName?: string | null;
    databaseSourceLabel?: string | null;
    duplicateDatabaseUrlDefinitionsDetected?: boolean;
    warnings?: string[];
  };
  financeAuditMetadata?: {
    environment?: string;
    databaseHost?: string | null;
    databaseName?: string | null;
    schemaReady?: boolean;
    databaseSourceLabel?: string | null;
    warnings?: string[];
  };
};

export type SettlementApprovalLine = {
  id?: string;
  financeLedgerEntryId: string;
  lineType: 'SALE' | 'REFUND' | string;
  amountMinor: number;
  commissionMinor: number;
  commissionVatMinor: number;
  payableImpactMinor: number;
  sourceSnapshotJson?: unknown;
  storedSettlementStatus?: string | null;
  derivedSettlementStatus?: string;
  payoutStatus?: string | null;
  eligibilityDecision?: 'included' | 'excluded';
  eligibilityReason?: string;
  refundDetected?: boolean;
  refundCount?: number;
  fulfillmentEvidencePresent?: boolean;
  shippingEvidencePresent?: boolean;
};

export type SettlementApprovalPreview = {
  ok: true;
  writesPerformed: false;
  vendorId: string;
  periodStart: string | null;
  periodEnd: string | null;
  candidateScope: 'vendor_wide' | 'date_range' | 'selected_orders' | 'selected_allocations';
  candidateSelectionSummary: {
    requestedOrders: string[];
    matchedOrders: string[];
    unmatchedOrders: string[];
    requestedAllocations: string[];
    matchedAllocations: string[];
    unmatchedAllocations: string[];
    candidateRowCount: number;
  };
  selectedOrderDiagnostics?: Array<{
    requestedIdentifier: string;
    matched: boolean;
    matchedOrderNumber: string | null;
    matchedShopifyOrderId: string | null;
    financeLedgerEntryId: string | null;
    candidateIncluded: boolean;
    excludedReason: string | null;
    lockedApprovalId: string | null;
    lockedApprovalStatus: string | null;
    currentSettlementStatus: string | null;
    derivedSettlementStatus: string | null;
  }>;
  summary: {
    grossSalesMinor: number;
    refundTotalMinor: number;
    commissionMinor: number;
    commissionVatMinor: number;
    netPayableMinor: number;
    currency: string;
    eligibleRowCount: number;
    excludedActiveApprovalRowCount: number;
    detectedCommissionRates: number[];
    detectedCommissionVatRates: number[];
    detectedShippingModes: string[];
    detectedFinancialProfileSnapshotIds: string[];
    mixedCommissionRate: boolean;
    mixedCommissionVatRate: boolean;
    mixedShippingMode: boolean;
    candidateQualityWarnings: string[];
  };
  lines: SettlementApprovalLine[];
};

export type SettlementApproval = {
  ok: true;
  writesPerformed: boolean;
  id: string;
  createdAt: string;
  vendorId: string;
  status: SettlementApprovalStatus;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  grossSalesMinor: number;
  refundTotalMinor: number;
  commissionMinor: number;
  commissionVatMinor: number;
  netPayableMinor: number;
  approvedBy: string | null;
  approvedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  notes: string | null;
  sourceSnapshotJson: unknown;
  lines: SettlementApprovalLine[];
};

export type SettlementApprovalSummary = {
  id: string;
  createdAt: string;
  vendorId: string;
  status: SettlementApprovalStatus;
  currency: string;
  grossSalesMinor: number;
  netPayableMinor: number;
  approvedAt: string | null;
  lineCount: number;
};

export type SettlementApprovalListResponse = {
  ok: true;
  writesPerformed: false;
  vendorId: string;
  approvals: SettlementApprovalSummary[];
};

export type SettlementApprovalAudit = {
  approvalId: string;
  status: SettlementApprovalStatus;
  totals: {
    grossSalesMinor: number;
    refundTotalMinor: number;
    commissionMinor: number;
    commissionVatMinor: number;
    netPayableMinor: number;
    currency: string;
  };
  lines: Array<{
    financeLedgerEntryId: string;
    storedSettlementStatus: string | null;
    derivedSettlementStatus: string;
    payoutStatus: string | null;
    eligibilityDecision: 'included' | 'excluded';
    eligibilityReason: string;
  }>;
};

export type SettlementLogoCommissionInvoicePreview = {
  ok: boolean;
  writesPerformed: false;
  settlementApprovalId: string;
  readiness: {
    canCreateLogoInvoiceLater: boolean;
    blockers: string[];
    warnings: string[];
    billingSnapshotPresent: boolean;
    billingSnapshotSource: 'settlement_approval' | null;
  };
  amounts: {
    commissionAmount: number;
    commissionVatAmount: number;
    expectedGrossInvoiceAmount: number;
    currency: string;
    taxRate: number | null;
    vatIncluded: false;
  };
  vendorBillingReadiness: {
    complete: boolean;
    missingFields: string[];
    logoCustomerCodePresent: boolean;
    logoCustomerIdPresent: boolean;
    logoEinvoiceEligible: boolean | null;
    billingSnapshotPresent: boolean;
    billingSnapshotSource: 'settlement_approval' | null;
  };
  vatRateSource: 'settlement_line_snapshots' | 'blocked_mixed_or_missing';
  detectedVatRates: number[];
  configuredVendorCommissionVatPercent: number | null;
  executionSnapshotGuard: {
    ok: boolean;
    blockers: string[];
    warnings: string[];
    snapshotCompleteness: {
      settlementApprovalFound: boolean;
      settlementApprovalStatus: string | null;
      lineCount: number;
      executionLineCount: number;
      [key: string]: unknown;
    };
    detectedCommissionRates: number[];
    detectedCommissionVatRates: number[];
    detectedShippingModes: string[];
    requiredSnapshotsPresent: boolean;
  };
  immutableRequestSnapshot: {
    status: 'READY' | 'BLOCKED';
    payloadBuilderVersion: string;
    blockers: string[];
    warnings: string[];
    requestSnapshotPresent: boolean;
  };
  logoPayloadPreview: Record<string, unknown> | null;
};

export type SettlementCommissionInvoiceRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  settlementApprovalId: string;
  vendorId: string;
  provider: string;
  status: 'pending' | 'created' | 'failed' | 'cancelled' | 'unknown' | string;
  providerInvoiceId: string | null;
  providerUuid: string | null;
  providerEttn: string | null;
  invoiceNo: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  failedAt: string | null;
  unknownReason?: string | null;
  unknownAt?: string | null;
  reconciliationStatus?: string | null;
  reconciliationEvidenceSnapshot?: SettlementCommissionInvoiceSnapshotMetadata;
  reconciledAt?: string | null;
  reconciledBy?: string | null;
  retryCount: number;
  lastRetriedAt: string | null;
  cancelledAt: string | null;
  requestSnapshot: SettlementCommissionInvoiceRequestSnapshotMetadata;
  responseSnapshot: SettlementCommissionInvoiceSnapshotMetadata;
  documentSnapshot: SettlementCommissionInvoiceSnapshotMetadata;
};

export type SettlementCommissionInvoiceSnapshotMetadata = {
  present: boolean;
  type: string;
  topLevelKeys: string[];
  approximateSizeBytes: number;
};

export type SettlementCommissionInvoiceRequestSnapshotMetadata = SettlementCommissionInvoiceSnapshotMetadata & {
  requestSnapshotPresent: boolean;
  payloadBuilderVersion: string | null;
  requestBuiltAt: string | null;
  snapshotSource: 'immutable_settlement_truth' | null;
};

export type SettlementCommissionInvoiceRecordsResponse = {
  ok: true;
  writesPerformed: false;
  settlementApprovalId: string;
  records: SettlementCommissionInvoiceRecord[];
};

export type PersistSettlementLogoCommissionInvoiceRequestSnapshotResponse = {
  ok: boolean;
  writesPerformed: boolean;
  settlementApprovalId: string;
  provider: string;
  status: 'pending' | 'blocked';
  blockers: string[];
  warnings: string[];
  record: SettlementCommissionInvoiceRecord | null;
  requestSnapshot: SettlementCommissionInvoiceRequestSnapshotMetadata | null;
};

export type SettlementCommissionInvoiceDiagnostics = {
  ok: true;
  writesPerformed: false;
  record: {
    id: string;
    settlementApprovalId: string;
    vendorId: string;
    provider: string;
    status: string;
    retryCount: number;
      environmentGuard: {
        allowed: boolean;
        environment: 'test' | 'production' | null;
        expectedTenantConfigured: boolean;
        actualTenantPresent: boolean;
        tenantValidationStatus: 'skipped' | 'passed' | 'blocked_missing_actual' | 'blocked_mismatch';
        tenantValidation: {
          expectedTenantConfigured: boolean;
          expectedTenantIdPresent: boolean;
          expectedTenantId: string | null;
          actualTenantPresent: boolean;
          actualTenantIdPresent: boolean;
          actualTenantId: string | null;
          tenantValidationStatus: 'skipped' | 'passed' | 'blocked_missing_actual' | 'blocked_mismatch';
          status: 'skipped' | 'passed' | 'blocked_missing_actual' | 'blocked_mismatch';
        };
        blockers: string[];
        warnings: string[];
      } | null;
    executionContract: {
      ok: boolean;
      writesPerformed: false;
      settlementCommissionInvoiceId: string;
      status: 'READY' | 'BLOCKED';
      recordStatus: string | null;
      requestSnapshotPresent: boolean;
      payloadPresent: boolean;
      snapshotSource: 'immutable_settlement_truth' | null;
      payloadBuilderVersion: string | null;
      requestBuiltAt: string | null;
      blockers: string[];
    };
    providerIdentifiers: {
      providerInvoiceId: string | null;
      providerUuid: string | null;
      providerEttn: string | null;
      invoiceNo: string | null;
    };
    timestamps: Record<string, string | null>;
    snapshots: {
      request: SettlementCommissionInvoiceRequestSnapshotMetadata;
      response: SettlementCommissionInvoiceSnapshotMetadata;
      document: SettlementCommissionInvoiceSnapshotMetadata;
    };
    failure: {
      failureCode: string | null;
      failureMessage: string | null;
    };
    unknown: {
      reason: string | null;
      unknownAt: string | null;
      reconciliationState: string | null;
      reconciledAt: string | null;
      reconciledBy: string | null;
      reconciliationEvidence: SettlementCommissionInvoiceSnapshotMetadata;
    };
  };
};

export type ExecuteSettlementLogoCommissionInvoiceCreateResponse = {
  ok: boolean;
  writesPerformed: boolean;
  externalApiCallAttempted: boolean;
  settlementCommissionInvoiceId: string;
  status: 'blocked' | 'created' | 'failed' | 'unknown' | string;
  blockers: string[];
  warnings: string[];
  environmentGuard: SettlementCommissionInvoiceDiagnostics['record']['environmentGuard'] | null;
  record: SettlementCommissionInvoiceRecord | null;
  providerResult: {
    httpStatus: number | null;
    invoiceId: string | null;
    uuid: string | null;
    ettn: string | null;
    invoiceNo: string | null;
  } | null;
};

export type SettlementApprovalPreviewInput = {
  vendorId: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  candidateScope?: 'vendor_wide' | 'date_range' | 'selected_orders' | 'selected_allocations';
  selectedOrderIds?: string[];
  selectedShopifyOrderIds?: string[];
  selectedAllocationIds?: string[];
};

export type SettlementApprovalCreateInput = SettlementApprovalPreviewInput & {
  notes?: string | null;
};

export function getDatabaseHealth() {
  return apiClient.get<DatabaseHealthResponse>('/health/db', { skipVendorContext: true });
}

export function previewSettlementApproval(input: SettlementApprovalPreviewInput) {
  return apiClient.post<SettlementApprovalPreview>('/admin/finance/settlement-approvals/preview', input);
}

export function createSettlementApprovalDraft(input: SettlementApprovalCreateInput) {
  return apiClient.post<SettlementApproval>('/admin/finance/settlement-approvals', input);
}

export function listSettlementApprovals(vendorId: string) {
  return apiClient.get<SettlementApprovalListResponse>(
    `/admin/finance/settlement-approvals?vendorId=${encodeURIComponent(vendorId)}`,
  );
}

export function getSettlementApproval(id: string) {
  return apiClient.get<SettlementApproval>(`/admin/finance/settlement-approvals/${encodeURIComponent(id)}`);
}

export function approveSettlementApproval(id: string) {
  return apiClient.post<SettlementApproval>(`/admin/finance/settlement-approvals/${encodeURIComponent(id)}/approve`, {});
}

export function cancelSettlementApproval(id: string) {
  return apiClient.post<SettlementApproval>(`/admin/finance/settlement-approvals/${encodeURIComponent(id)}/cancel`, {});
}

export function getSettlementApprovalAudit(id: string) {
  return apiClient.get<SettlementApprovalAudit>(`/admin/finance/settlement-approvals/${encodeURIComponent(id)}/audit`);
}

export function previewSettlementLogoCommissionInvoice(id: string) {
  return apiClient.post<SettlementLogoCommissionInvoicePreview>(
    `/admin/finance/settlement-approvals/${encodeURIComponent(id)}/logo-commission-invoice-preview`,
    {},
  );
}

export function persistSettlementLogoCommissionInvoiceRequestSnapshot(id: string) {
  return apiClient.post<PersistSettlementLogoCommissionInvoiceRequestSnapshotResponse>(
    `/admin/finance/settlement-approvals/${encodeURIComponent(id)}/logo-commission-invoice-request-snapshot`,
    {},
  );
}

export function getSettlementCommissionInvoiceRecords(id: string) {
  return apiClient.get<SettlementCommissionInvoiceRecordsResponse>(
    `/admin/finance/settlement-approvals/${encodeURIComponent(id)}/commission-invoice-records`,
  );
}

export function getSettlementCommissionInvoiceDiagnostics(id: string) {
  return apiClient.get<SettlementCommissionInvoiceDiagnostics>(
    `/admin/finance/commission-invoices/${encodeURIComponent(id)}`,
  );
}

export function executeSettlementLogoCommissionInvoiceCreate(
  id: string,
  input: { confirmLogoCreate: true },
) {
  return apiClient.post<ExecuteSettlementLogoCommissionInvoiceCreateResponse>(
    `/admin/finance/commission-invoices/${encodeURIComponent(id)}/logo-isbasi/create`,
    input,
  );
}
