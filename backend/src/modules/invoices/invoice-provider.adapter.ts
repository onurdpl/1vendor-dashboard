import type { AppEnv } from '../../config/env.js';

export type InvoiceProviderCreateInput = {
  financeLedgerEntryId: string;
  requestSnapshot: Record<string, unknown>;
};

export type InvoiceProviderCreateResult = {
  providerInvoiceGuid: string;
  providerInvoiceNo?: string | null;
  providerPdfUrl?: string | null;
  responseSnapshot: Record<string, unknown>;
};

export interface InvoiceProviderAdapter {
  provider: 'BIZIMHESAP' | 'PARASUT' | 'BIRFATURA';
  createInvoice(input: InvoiceProviderCreateInput): Promise<InvoiceProviderCreateResult>;
  cancelInvoice(providerInvoiceGuid: string): Promise<Record<string, unknown>>;
  getInvoiceStatus(providerInvoiceGuid: string): Promise<Record<string, unknown>>;
  getInvoicePdfUrl(providerInvoiceGuid: string): Promise<string | null>;
}

function readProviderString(payload: unknown, keys: string[]) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  for (const key of keys) {
    const value = Reflect.get(payload, key);
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return null;
}

export class BizimHesapAdapter implements InvoiceProviderAdapter {
  provider = 'BIZIMHESAP' as const;

  constructor(private readonly env: AppEnv) {}

  async createInvoice(input: InvoiceProviderCreateInput): Promise<InvoiceProviderCreateResult> {
    if (!this.env.INVOICE_EXECUTION_ENABLED) {
      throw new Error('Invoice execution is disabled by configuration.');
    }
    if (!this.env.BIZIMHESAP_ADD_INVOICE_URL || !this.env.BIZIMHESAP_ACCESS_TOKEN) {
      throw new Error('BizimHesap invoice execution is not configured.');
    }

    const response = await fetch(this.env.BIZIMHESAP_ADD_INVOICE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.BIZIMHESAP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.requestSnapshot),
    });
    const responseText = await response.text();
    let responseSnapshot: Record<string, unknown> = {
      status: response.status,
      ok: response.ok,
      body: responseText,
    };

    try {
      const json = responseText ? JSON.parse(responseText) : {};
      if (json && typeof json === 'object') {
        responseSnapshot = {
          status: response.status,
          ok: response.ok,
          body: json,
        };
      }
    } catch {
      // Keep the text response snapshot.
    }

    if (!response.ok) {
      throw new Error(`BizimHesap AddInvoice failed with HTTP ${response.status}.`);
    }

    const body = responseSnapshot.body;
    const providerInvoiceGuid =
      readProviderString(body, ['providerInvoiceGuid', 'invoiceGuid', 'InvoiceGuid', 'Guid', 'guid', 'id']) ??
      `bizimhesap-${input.financeLedgerEntryId}`;
    const providerInvoiceNo = readProviderString(body, ['providerInvoiceNo', 'invoiceNo', 'InvoiceNo', 'No', 'number']);
    const providerPdfUrl = readProviderString(body, ['providerPdfUrl', 'pdfUrl', 'PdfUrl', 'PDFUrl', 'invoicePdfUrl']);

    return {
      providerInvoiceGuid,
      providerInvoiceNo,
      providerPdfUrl,
      responseSnapshot,
    };
  }

  async cancelInvoice(): Promise<Record<string, unknown>> {
    throw new Error('BizimHesap invoice cancellation is not implemented in Phase 20A.');
  }

  async getInvoiceStatus(): Promise<Record<string, unknown>> {
    throw new Error('BizimHesap invoice status polling is not implemented in Phase 20A.');
  }

  async getInvoicePdfUrl(): Promise<string | null> {
    throw new Error('BizimHesap invoice PDF polling is not implemented in Phase 20A.');
  }
}

export function createInvoiceProviderAdapter(env: AppEnv): InvoiceProviderAdapter {
  if (env.INVOICE_PROVIDER === 'bizimhesap') {
    return new BizimHesapAdapter(env);
  }

  return new BizimHesapAdapter(env);
}

