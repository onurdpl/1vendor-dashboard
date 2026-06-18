export type InvoiceExecutionProviderDto = 'bizimhesap' | 'parasut';
export type InvoiceExecutionStatusDto = 'pending' | 'created' | 'failed' | 'cancelled' | 'unknown';

export type InvoiceVisibilityStatusDto =
  | 'invoice_missing'
  | 'accounting_sync_pending'
  | 'accounting_synced'
  | 'invoice_linked'
  | 'invoice_visibility_incomplete'
  | 'provider_failed'
  | 'cancelled';

export type InvoiceReconciliationStateDto =
  | 'invoice_missing'
  | 'invoice_pending'
  | 'accounting_sync_pending'
  | 'invoice_linked'
  | 'invoice_visibility_incomplete'
  | 'provider_failed'
  | 'cancelled';

export type InvoiceFinalInvoiceStateDto =
  | 'not_requested'
  | 'draft_or_synced'
  | 'finalized_visible'
  | 'visibility_unknown'
  | 'failed'
  | 'cancelled';

export type InvoiceSyncSemanticsDto = 'none' | 'draft_accounting_sync' | 'final_invoice_visibility';

export type InvoiceProviderCapabilitiesDto = {
  supportsDraftSubmission: boolean;
  supportsFinalInvoiceVisibility: boolean;
  supportsPdfLink: boolean;
  supportsStatusSync: boolean;
  note: string;
};

export type InvoiceVisibilityDto = {
  visibilityStatus: InvoiceVisibilityStatusDto;
  visibilityLabel: string;
  reconciliationState: InvoiceReconciliationStateDto;
  finalInvoiceState: InvoiceFinalInvoiceStateDto;
  syncSemantics: InvoiceSyncSemanticsDto;
  providerCapabilities: InvoiceProviderCapabilitiesDto;
};

export type InvoiceExecutionDto = {
  id: string;
  financeLedgerEntryId: string;
  provider: InvoiceExecutionProviderDto;
  providerInvoiceGuid: string | null;
  providerInvoiceNo: string | null;
  providerPdfUrl: string | null;
  status: InvoiceExecutionStatusDto;
  visibilityStatus: InvoiceVisibilityStatusDto;
  visibilityLabel: string;
  reconciliationState: InvoiceReconciliationStateDto;
  finalInvoiceState: InvoiceFinalInvoiceStateDto;
  syncSemantics: InvoiceSyncSemanticsDto;
  providerCapabilities: InvoiceProviderCapabilitiesDto;
  requestSnapshot: unknown;
  responseSnapshot: unknown;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceExecutionResponseSummaryDto = {
  id: string;
  provider: InvoiceExecutionProviderDto;
  status: InvoiceExecutionStatusDto;
  providerInvoiceGuidPresent: boolean;
  providerInvoiceNoPresent: boolean;
  providerPdfUrlPresent: boolean;
  response: {
    httpStatus: number | null;
    ok: boolean | null;
    contentType: string | null;
    parsedBodyType: string | null;
    bodyKeys: string[];
    nestedBodyKeys: string[];
    providerError: string | null;
    parsedGuidPresent: boolean;
    parsedPdfUrlPresent: boolean;
  } | null;
};

export type CreateInvoiceExecutionDto = {
  financeLedgerEntryId: string;
  provider?: InvoiceExecutionProviderDto;
};

export type PreviewInvoiceExecutionDto = {
  financeLedgerEntryId: string;
  provider?: InvoiceExecutionProviderDto;
};

export type InvoiceExecutionPreviewDto = {
  provider: InvoiceExecutionProviderDto;
  dryRun: true;
  executionEnabled: boolean;
  providerEnabled: boolean;
  providerConfigured: boolean;
  legacyRuntimeDisabled: boolean;
  disabledReason: string | null;
  configuration: {
    firmIdConfigured: boolean;
    apiKeyConfigured: boolean;
    baseUrlConfigured: boolean;
    addInvoiceUrlConfigured: boolean;
  };
  requestSnapshot: unknown;
};

export type RetryInvoiceExecutionDto = {
  provider?: InvoiceExecutionProviderDto;
};
