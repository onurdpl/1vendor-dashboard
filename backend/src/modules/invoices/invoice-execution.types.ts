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

export type CreateInvoiceExecutionDto = {
  financeLedgerEntryId: string;
  provider?: InvoiceExecutionProviderDto;
};

export type RetryInvoiceExecutionDto = {
  provider?: InvoiceExecutionProviderDto;
};

