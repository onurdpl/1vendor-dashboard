import type { AppEnv } from '../../config/env.js';

export type InvoiceProviderCreateInput = {
  financeLedgerEntryId: string;
  requestSnapshot: Record<string, unknown>;
};

export type InvoiceProviderCreateResult = {
  providerInvoiceGuid: string | null;
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

function normalizeProviderKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function listObjectKeys(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }

  return Object.keys(payload).sort();
}

function readProviderStringDeep(payload: unknown, keys: string[], visited = new Set<unknown>()): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (visited.has(payload)) {
    return null;
  }
  visited.add(payload);

  const normalizedKeys = new Set(keys.map(normalizeProviderKey));
  if (!Array.isArray(payload)) {
    for (const [key, value] of Object.entries(payload)) {
      if (normalizedKeys.has(normalizeProviderKey(key)) && typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }

  const childValues = Array.isArray(payload) ? payload : Object.values(payload);
  for (const child of childValues) {
    const nested = readProviderStringDeep(child, keys, visited);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function readXmlishValue(payload: string, keys: string[]) {
  for (const key of keys) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = payload.match(new RegExp(`<${escapedKey}>\\s*([^<]+?)\\s*</${escapedKey}>`, 'i'));
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }

  return null;
}

function readProviderResponseField(payload: unknown, responseText: string, keys: string[]) {
  return readProviderString(payload, keys) ?? readProviderStringDeep(payload, keys) ?? readXmlishValue(responseText, keys);
}

function getResponseBodyType(payload: unknown) {
  if (Array.isArray(payload)) {
    return 'array';
  }
  if (payload === null) {
    return 'null';
  }
  return typeof payload;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function resolveBizimHesapAddInvoiceUrl(env: AppEnv) {
  const configuredUrl =
    env.BIZIMHESAP_ADD_INVOICE_URL ??
    (env.BIZIMHESAP_BASE_URL ? `${trimTrailingSlash(env.BIZIMHESAP_BASE_URL)}/AddInvoice` : undefined);

  if (!configuredUrl) {
    return undefined;
  }

  if (!env.BIZIMHESAP_FIRM_ID || !env.BIZIMHESAP_API_KEY) {
    return configuredUrl;
  }

  const url = new URL(configuredUrl);
  if (!url.searchParams.has('FirmId')) {
    url.searchParams.set('FirmId', env.BIZIMHESAP_FIRM_ID);
  }
  if (!url.searchParams.has('ApiKey')) {
    url.searchParams.set('ApiKey', env.BIZIMHESAP_API_KEY);
  }

  return url.toString();
}

export class BizimHesapAdapter implements InvoiceProviderAdapter {
  provider = 'BIZIMHESAP' as const;

  constructor(private readonly env: AppEnv) {}

  async createInvoice(input: InvoiceProviderCreateInput): Promise<InvoiceProviderCreateResult> {
    if (!this.env.INVOICE_EXECUTION_ENABLED || !this.env.BIZIMHESAP_ENABLED) {
      throw new Error('Invoice execution is disabled by configuration.');
    }
    const addInvoiceUrl = resolveBizimHesapAddInvoiceUrl(this.env);
    if (!addInvoiceUrl || !this.env.BIZIMHESAP_FIRM_ID || !this.env.BIZIMHESAP_API_KEY) {
      throw new Error('BizimHesap invoice execution is not configured.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.env.BIZIMHESAP_ACCESS_TOKEN) {
      headers.Authorization = `Bearer ${this.env.BIZIMHESAP_ACCESS_TOKEN}`;
    }

    const response = await fetch(addInvoiceUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(input.requestSnapshot),
    });
    const responseText = await response.text();
    const contentType = response.headers.get('content-type');
    let responseSnapshot: Record<string, unknown> = {
      status: response.status,
      ok: response.ok,
      contentType,
      parsedBodyType: 'text',
      bodyKeys: [],
      body: responseText,
    };
    let parsedBody: unknown = responseText;

    try {
      const json = responseText ? JSON.parse(responseText) : {};
      parsedBody = json;
      if (json && typeof json === 'object') {
        responseSnapshot = {
          status: response.status,
          ok: response.ok,
          contentType,
          parsedBodyType: getResponseBodyType(json),
          bodyKeys: listObjectKeys(json),
          body: json,
        };
      }
    } catch {
      const guid = readXmlishValue(responseText, ['providerInvoiceGuid', 'invoiceGuid', 'InvoiceGuid', 'Guid', 'guid', 'id']);
      const url = readXmlishValue(responseText, ['providerPdfUrl', 'pdfUrl', 'PdfUrl', 'PDFUrl', 'invoicePdfUrl', 'url']);
      if (guid || url) {
        const xmlBody = {
          guid,
          url,
        };
        parsedBody = xmlBody;
        responseSnapshot = {
          status: response.status,
          ok: response.ok,
          contentType,
          parsedBodyType: 'xml',
          bodyKeys: Object.keys(xmlBody).filter((key) => Boolean(xmlBody[key as keyof typeof xmlBody])),
          body: parsedBody,
        };
      }
    }

    if (!response.ok) {
      throw new Error(`BizimHesap AddInvoice failed with HTTP ${response.status}.`);
    }

    const body = parsedBody;
    const providerInvoiceGuid =
      readProviderResponseField(body, responseText, ['providerInvoiceGuid', 'invoiceGuid', 'InvoiceGuid', 'Guid', 'guid', 'id']);
    const providerInvoiceNo = readProviderResponseField(body, responseText, [
      'providerInvoiceNo',
      'invoiceNo',
      'InvoiceNo',
      'InvoiceNumber',
      'No',
      'number',
    ]);
    const providerPdfUrl = readProviderResponseField(body, responseText, [
      'providerPdfUrl',
      'pdfUrl',
      'PdfUrl',
      'PDFUrl',
      'invoicePdfUrl',
      'url',
    ]);

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
