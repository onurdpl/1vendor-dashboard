export type InvoiceExecutionProviderDto = 'bizimhesap' | 'parasut' | 'birfatura';
export type InvoiceExecutionStatusDto = 'pending' | 'created' | 'failed' | 'cancelled' | 'unknown';

export type InvoiceExecutionDto = {
  id: string;
  financeLedgerEntryId: string;
  provider: InvoiceExecutionProviderDto;
  providerInvoiceGuid: string | null;
  providerInvoiceNo: string | null;
  providerPdfUrl: string | null;
  status: InvoiceExecutionStatusDto;
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
