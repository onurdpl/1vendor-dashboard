import { InvoiceExecutionProvider, InvoiceExecutionStatus } from '@prisma/client';
import type {
  InvoiceExecutionProviderDto,
  InvoiceExecutionStatusDto,
  InvoiceProviderCapabilitiesDto,
  InvoiceVisibilityDto,
} from './invoice-execution.types.js';

export function mapInvoiceProvider(provider: InvoiceExecutionProvider | string): InvoiceExecutionProviderDto {
  return provider.trim().toLowerCase() as InvoiceExecutionProviderDto;
}

export function getInvoiceProviderCapabilities(
  provider: InvoiceExecutionProvider | InvoiceExecutionProviderDto | string,
): InvoiceProviderCapabilitiesDto {
  const normalized = mapInvoiceProvider(String(provider));

  if (normalized === 'bizimhesap') {
    return {
      supportsDraftSubmission: true,
      supportsFinalInvoiceVisibility: false,
      supportsPdfLink: true,
      supportsStatusSync: false,
      note: 'BizimHesap AddInvoice is treated as accounting draft/sync visibility; finalized invoice authority is reconciled separately.',
    };
  }

  return {
    supportsDraftSubmission: false,
    supportsFinalInvoiceVisibility: false,
    supportsPdfLink: false,
    supportsStatusSync: false,
    note: 'Provider capability metadata is reserved for a future accounting visibility adapter.',
  };
}

export function deriveEffectiveInvoiceStatus(execution: {
  status: InvoiceExecutionStatus | InvoiceExecutionStatusDto | string;
  providerInvoiceGuid?: string | null;
  providerPdfUrl?: string | null;
}): InvoiceExecutionStatusDto {
  if (
    String(execution.status).trim().toUpperCase() === InvoiceExecutionStatus.CREATED &&
    !execution.providerInvoiceGuid &&
    !execution.providerPdfUrl
  ) {
    return 'unknown';
  }

  return String(execution.status).trim().toLowerCase() as InvoiceExecutionStatusDto;
}

export function deriveInvoiceVisibility(execution: {
  provider: InvoiceExecutionProvider | InvoiceExecutionProviderDto | string;
  status: InvoiceExecutionStatus | InvoiceExecutionStatusDto | string;
  providerInvoiceGuid?: string | null;
  providerInvoiceNo?: string | null;
  providerPdfUrl?: string | null;
}): InvoiceVisibilityDto {
  const provider = mapInvoiceProvider(String(execution.provider));
  const providerCapabilities = getInvoiceProviderCapabilities(provider);
  const status = deriveEffectiveInvoiceStatus(execution);
  const hasGuid = Boolean(execution.providerInvoiceGuid);
  const hasInvoiceNo = Boolean(execution.providerInvoiceNo);
  const hasPdf = Boolean(execution.providerPdfUrl);

  if (status === 'pending') {
    return {
      visibilityStatus: 'accounting_sync_pending',
      visibilityLabel: 'Accounting sync pending',
      reconciliationState: 'accounting_sync_pending',
      finalInvoiceState: 'visibility_unknown',
      syncSemantics: providerCapabilities.supportsDraftSubmission ? 'draft_accounting_sync' : 'none',
      providerCapabilities,
    };
  }

  if (status === 'failed') {
    return {
      visibilityStatus: 'provider_failed',
      visibilityLabel: 'Accounting sync issue',
      reconciliationState: 'provider_failed',
      finalInvoiceState: 'failed',
      syncSemantics: providerCapabilities.supportsDraftSubmission ? 'draft_accounting_sync' : 'none',
      providerCapabilities,
    };
  }

  if (status === 'cancelled') {
    return {
      visibilityStatus: 'cancelled',
      visibilityLabel: 'Accounting sync cancelled',
      reconciliationState: 'cancelled',
      finalInvoiceState: 'cancelled',
      syncSemantics: providerCapabilities.supportsDraftSubmission ? 'draft_accounting_sync' : 'none',
      providerCapabilities,
    };
  }

  if (status === 'unknown') {
    return {
      visibilityStatus: 'invoice_visibility_incomplete',
      visibilityLabel: 'Invoice visibility incomplete',
      reconciliationState: 'invoice_visibility_incomplete',
      finalInvoiceState: 'visibility_unknown',
      syncSemantics: providerCapabilities.supportsDraftSubmission ? 'draft_accounting_sync' : 'none',
      providerCapabilities,
    };
  }

  if (hasPdf || hasInvoiceNo) {
    return {
      visibilityStatus: 'invoice_linked',
      visibilityLabel: providerCapabilities.supportsFinalInvoiceVisibility
        ? 'Final invoice visible'
        : 'Accounting visibility linked',
      reconciliationState: 'invoice_linked',
      finalInvoiceState: providerCapabilities.supportsFinalInvoiceVisibility ? 'finalized_visible' : 'draft_or_synced',
      syncSemantics: providerCapabilities.supportsFinalInvoiceVisibility
        ? 'final_invoice_visibility'
        : 'draft_accounting_sync',
      providerCapabilities,
    };
  }

  if (hasGuid) {
    return {
      visibilityStatus: 'accounting_synced',
      visibilityLabel: 'Accounting sync recorded',
      reconciliationState: 'invoice_visibility_incomplete',
      finalInvoiceState: 'draft_or_synced',
      syncSemantics: providerCapabilities.supportsDraftSubmission ? 'draft_accounting_sync' : 'none',
      providerCapabilities,
    };
  }

  return {
    visibilityStatus: 'invoice_visibility_incomplete',
    visibilityLabel: 'Invoice visibility incomplete',
    reconciliationState: 'invoice_visibility_incomplete',
    finalInvoiceState: 'visibility_unknown',
    syncSemantics: providerCapabilities.supportsDraftSubmission ? 'draft_accounting_sync' : 'none',
    providerCapabilities,
  };
}
