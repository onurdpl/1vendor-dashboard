import {
  InvoiceExecutionProvider,
  InvoiceExecutionStatus,
  Prisma,
  type FinanceLedgerEntry,
  type InvoiceExecution,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';
import { createInvoiceProviderAdapter, type InvoiceProviderAdapter } from './invoice-provider.adapter.js';
import type {
  CreateInvoiceExecutionDto,
  InvoiceExecutionDto,
  InvoiceExecutionPreviewDto,
  InvoiceExecutionProviderDto,
  InvoiceExecutionResponseSummaryDto,
  PreviewInvoiceExecutionDto,
} from './invoice-execution.types.js';

type FinanceLedgerForInvoice = FinanceLedgerEntry & {
  vendorAllocation: {
    id: string;
    sourceShopifyOrderId: string;
    sourceShopifyOrderNumber: string;
    assignedVendorId: string;
    order: {
      sourceShopifyOrderId: string;
      sourceShopifyOrderNumber: string;
      customerName: string | null;
      customerEmail: string | null;
      lineItems: Array<{
        sourceLineItemId: string;
        sku: string | null;
        title: string | null;
        quantity: number;
        unitPrice: unknown;
      }>;
    };
    lineItems: Array<{
      quantity: number;
      lineAmount: unknown;
      shopifyOrderLineItem: {
        sourceLineItemId: string;
        sku: string | null;
        title: string | null;
        quantity: number;
        unitPrice: unknown;
      };
    }>;
  } | null;
};

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function mapProvider(provider: InvoiceExecutionProvider | string): InvoiceExecutionProviderDto {
  return provider.trim().toLowerCase() as InvoiceExecutionProviderDto;
}

function normalizeProvider(provider?: InvoiceExecutionProviderDto): InvoiceExecutionProvider {
  const normalized = (provider ?? 'bizimhesap').trim().toLowerCase();
  if (normalized === 'bizimhesap') {
    return InvoiceExecutionProvider.BIZIMHESAP;
  }
  if (normalized === 'parasut') {
    return InvoiceExecutionProvider.PARASUT;
  }
  if (normalized === 'birfatura') {
    return InvoiceExecutionProvider.BIRFATURA;
  }

  throw new Error('Unsupported invoice provider.');
}

function mapStatus(status: InvoiceExecutionStatus | string) {
  return status.trim().toLowerCase() as InvoiceExecutionDto['status'];
}

function mapEffectiveInvoiceStatus(execution: {
  status: InvoiceExecutionStatus | string;
  providerInvoiceGuid: string | null;
  providerPdfUrl: string | null;
}) {
  if (
    String(execution.status).trim().toUpperCase() === InvoiceExecutionStatus.CREATED &&
    !execution.providerInvoiceGuid &&
    !execution.providerPdfUrl
  ) {
    return 'unknown' as const;
  }

  return mapStatus(execution.status);
}

function isRetryableInvoiceExecution(execution: {
  status: InvoiceExecutionStatus | string;
  providerInvoiceGuid: string | null;
  providerPdfUrl: string | null;
}) {
  const normalizedStatus = String(execution.status).trim().toUpperCase();
  return (
    normalizedStatus === InvoiceExecutionStatus.FAILED ||
    normalizedStatus === InvoiceExecutionStatus.UNKNOWN ||
    (normalizedStatus === InvoiceExecutionStatus.CREATED && !execution.providerInvoiceGuid && !execution.providerPdfUrl)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectNestedKeys(value: unknown, prefix = '', keys = new Set<string>()) {
  if (!isRecord(value)) {
    return keys;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    keys.add(nextKey);
    if (isRecord(child)) {
      collectNestedKeys(child, nextKey, keys);
    }
  }

  return keys;
}

function normalizeResponseKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function readNestedResponseString(value: unknown, keys: string[], visited = new Set<unknown>()): string | null {
  if (!isRecord(value)) {
    return null;
  }

  if (visited.has(value)) {
    return null;
  }
  visited.add(value);

  const normalizedKeys = new Set(keys.map(normalizeResponseKey));
  for (const [key, child] of Object.entries(value)) {
    if (normalizedKeys.has(normalizeResponseKey(key)) && typeof child === 'string' && child.trim()) {
      return child.trim();
    }
  }

  for (const child of Object.values(value)) {
    const nested = readNestedResponseString(child, keys, visited);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function truncateProviderError(value: string | null) {
  if (!value) {
    return null;
  }

  return value.length > 220 ? `${value.slice(0, 217)}...` : value;
}

export function mapInvoiceExecution(execution: InvoiceExecution): InvoiceExecutionDto {
  return {
    id: execution.id,
    financeLedgerEntryId: execution.financeLedgerEntryId,
    provider: mapProvider(execution.provider),
    providerInvoiceGuid: execution.providerInvoiceGuid,
    providerInvoiceNo: execution.providerInvoiceNo,
    providerPdfUrl: execution.providerPdfUrl,
    status: mapEffectiveInvoiceStatus(execution),
    requestSnapshot: execution.requestSnapshot,
    responseSnapshot: execution.responseSnapshot,
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
  };
}

function buildInvoiceExecutionId(provider: InvoiceExecutionProvider, financeLedgerEntryId: string) {
  return `invoice-${provider.toLowerCase()}-${financeLedgerEntryId}`;
}

function hasConfiguredBizimHesapUrl(env: AppEnv) {
  return Boolean(env.BIZIMHESAP_ADD_INVOICE_URL || env.BIZIMHESAP_BASE_URL);
}

function buildBizimHesapAddInvoiceSnapshot(entry: FinanceLedgerForInvoice) {
  const allocation = entry.vendorAllocation;
  const order = allocation?.order;
  const lineItems = allocation?.lineItems.length
    ? allocation.lineItems.map((lineItem) => ({
        ShopifyLineItemId: lineItem.shopifyOrderLineItem.sourceLineItemId,
        StockCode: lineItem.shopifyOrderLineItem.sku ?? undefined,
        ProductName: lineItem.shopifyOrderLineItem.title ?? 'Shopify order item',
        Quantity: lineItem.quantity,
        UnitPrice: toNumber(lineItem.shopifyOrderLineItem.unitPrice),
        LineAmount: toNumber(lineItem.lineAmount),
      }))
    : [
        {
          ProductName: entry.description ?? `Shopify order #${allocation?.sourceShopifyOrderNumber ?? entry.id}`,
          Quantity: 1,
          UnitPrice: toNumber(entry.amount),
          LineAmount: toNumber(entry.amount),
        },
      ];

  return {
    AddInvoice: {
      Customer: {
        Name: order?.customerName ?? 'Shopify customer',
        Email: order?.customerEmail ?? undefined,
      },
      Invoice: {
        Date: entry.createdAt.toISOString(),
        Currency: 'TRY',
        Description: entry.description ?? 'Merchant-of-record Shopify sale invoice',
        Notes: 'Generated from immutable finance ledger snapshot.',
      },
      Lines: lineItems,
      References: {
        FinanceLedgerEntryId: entry.id,
        VendorAllocationId: allocation?.id ?? null,
        VendorId: entry.vendorId,
        ShopifyOrderId: allocation?.sourceShopifyOrderId ?? order?.sourceShopifyOrderId ?? null,
        ShopifyOrderNumber: allocation?.sourceShopifyOrderNumber ?? order?.sourceShopifyOrderNumber ?? null,
      },
    },
  };
}

async function getInvoiceableLedgerEntry(financeLedgerEntryId: string, vendorId?: string | null): Promise<FinanceLedgerForInvoice> {
  const entry = await prisma.financeLedgerEntry.findUnique({
    where: {
      id: financeLedgerEntryId,
    },
    include: {
      vendorAllocation: {
        include: {
          order: {
            include: {
              lineItems: true,
            },
          },
          lineItems: {
            include: {
              shopifyOrderLineItem: true,
            },
          },
        },
      },
    },
  });

  if (!entry) {
    throw new Error('Finance ledger row could not be found.');
  }
  if (vendorId && entry.vendorId !== vendorId) {
    throw new Error('Finance ledger row does not belong to the selected vendor.');
  }
  if (entry.entryType.trim().toLowerCase() !== 'sale') {
    throw new Error('Only sale ledger rows are eligible for customer invoice execution.');
  }
  if (!entry.vendorAllocation) {
    throw new Error('Invoice execution requires a linked vendor allocation.');
  }

  return entry;
}

async function executeProviderCall(input: {
  executionId: string;
  entry: FinanceLedgerForInvoice;
  provider: InvoiceExecutionProvider;
  requestSnapshot: Record<string, unknown>;
  adapter: InvoiceProviderAdapter;
}) {
  try {
    const result = await input.adapter.createInvoice({
      financeLedgerEntryId: input.entry.id,
      requestSnapshot: input.requestSnapshot,
    });
    const providerSucceeded = Boolean(result.providerInvoiceGuid || result.providerPdfUrl);
    const updated = await prisma.invoiceExecution.update({
      where: {
        id: input.executionId,
      },
      data: {
        status: providerSucceeded ? InvoiceExecutionStatus.CREATED : InvoiceExecutionStatus.UNKNOWN,
        providerInvoiceGuid: result.providerInvoiceGuid,
        providerInvoiceNo: result.providerInvoiceNo ?? null,
        providerPdfUrl: result.providerPdfUrl ?? null,
        responseSnapshot: providerSucceeded
          ? (result.responseSnapshot as Prisma.InputJsonValue)
          : ({
              ...result.responseSnapshot,
              error: 'BizimHesap AddInvoice returned HTTP success without provider GUID or PDF URL.',
            } as Prisma.InputJsonValue),
      },
    });

    return mapInvoiceExecution(updated);
  } catch (error) {
    const failed = await prisma.invoiceExecution.update({
      where: {
        id: input.executionId,
      },
      data: {
        status: InvoiceExecutionStatus.FAILED,
        responseSnapshot: {
          error: error instanceof Error ? error.message : 'Invoice provider execution failed.',
          provider: input.provider,
        },
      },
    });

    return mapInvoiceExecution(failed);
  }
}

export async function createInvoiceExecution(
  input: CreateInvoiceExecutionDto,
  options: {
    env: AppEnv;
    vendorId?: string | null;
    adapter?: InvoiceProviderAdapter;
  },
): Promise<InvoiceExecutionDto> {
  if (!input.financeLedgerEntryId) {
    throw new Error('financeLedgerEntryId is required.');
  }

  const provider = normalizeProvider(input.provider);
  if (provider !== InvoiceExecutionProvider.BIZIMHESAP) {
    throw new Error('Only BizimHesap invoice execution is implemented in Phase 20A.');
  }
  const existing = await prisma.invoiceExecution.findUnique({
    where: {
      financeLedgerEntryId_provider: {
        financeLedgerEntryId: input.financeLedgerEntryId,
        provider,
      },
    },
  });
  if (existing) {
    throw new Error(
      existing.status === InvoiceExecutionStatus.FAILED
        ? 'Invoice execution already failed for this ledger row. Use retry.'
        : 'Invoice execution already exists for this ledger row.',
    );
  }

  const entry = await getInvoiceableLedgerEntry(input.financeLedgerEntryId, options.vendorId);
  const requestSnapshot = buildBizimHesapAddInvoiceSnapshot(entry);
  const executionId = buildInvoiceExecutionId(provider, entry.id);
  await prisma.invoiceExecution.create({
    data: {
      id: executionId,
      financeLedgerEntryId: entry.id,
      provider,
      status: InvoiceExecutionStatus.PENDING,
      requestSnapshot: requestSnapshot as Prisma.InputJsonValue,
    },
  });

  return executeProviderCall({
    executionId,
    entry,
    provider,
    requestSnapshot,
    adapter: options.adapter ?? createInvoiceProviderAdapter(options.env),
  });
}

export async function previewInvoiceExecutionPayload(
  input: PreviewInvoiceExecutionDto,
  options: {
    env: AppEnv;
    vendorId?: string | null;
  },
): Promise<InvoiceExecutionPreviewDto> {
  if (!input.financeLedgerEntryId) {
    throw new Error('financeLedgerEntryId is required.');
  }

  const provider = normalizeProvider(input.provider);
  if (provider !== InvoiceExecutionProvider.BIZIMHESAP) {
    throw new Error('Only BizimHesap invoice preview is implemented.');
  }

  const entry = await getInvoiceableLedgerEntry(input.financeLedgerEntryId, options.vendorId);
  const requestSnapshot = buildBizimHesapAddInvoiceSnapshot(entry);

  return {
    provider: mapProvider(provider),
    dryRun: true,
    executionEnabled: options.env.INVOICE_EXECUTION_ENABLED,
    providerEnabled: options.env.BIZIMHESAP_ENABLED,
    providerConfigured: Boolean(options.env.BIZIMHESAP_FIRM_ID && options.env.BIZIMHESAP_API_KEY && hasConfiguredBizimHesapUrl(options.env)),
    configuration: {
      firmIdConfigured: Boolean(options.env.BIZIMHESAP_FIRM_ID),
      apiKeyConfigured: Boolean(options.env.BIZIMHESAP_API_KEY),
      baseUrlConfigured: Boolean(options.env.BIZIMHESAP_BASE_URL),
      addInvoiceUrlConfigured: Boolean(options.env.BIZIMHESAP_ADD_INVOICE_URL),
    },
    requestSnapshot,
  };
}

export async function retryInvoiceExecution(
  invoiceExecutionId: string,
  options: {
    env: AppEnv;
    adapter?: InvoiceProviderAdapter;
  },
): Promise<InvoiceExecutionDto> {
  const execution = await prisma.invoiceExecution.findUnique({
    where: {
      id: invoiceExecutionId,
    },
    include: {
      financeLedgerEntry: {
        include: {
          vendorAllocation: {
            include: {
              order: {
                include: {
                  lineItems: true,
                },
              },
              lineItems: {
                include: {
                  shopifyOrderLineItem: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!execution) {
    throw new Error('Invoice execution could not be found.');
  }
  if (!isRetryableInvoiceExecution(execution)) {
    throw new Error('Only failed or unknown invoice executions can be retried.');
  }
  const entry = execution.financeLedgerEntry as FinanceLedgerForInvoice;
  const requestSnapshot = buildBizimHesapAddInvoiceSnapshot(entry);
  await prisma.invoiceExecution.update({
    where: {
      id: execution.id,
    },
    data: {
      status: InvoiceExecutionStatus.PENDING,
      requestSnapshot: requestSnapshot as Prisma.InputJsonValue,
      responseSnapshot: Prisma.JsonNull,
    },
  });

  return executeProviderCall({
    executionId: execution.id,
    entry,
    provider: execution.provider,
    requestSnapshot,
    adapter: options.adapter ?? createInvoiceProviderAdapter(options.env),
  });
}

export async function getInvoiceExecutionResponseSummary(invoiceExecutionId: string): Promise<InvoiceExecutionResponseSummaryDto> {
  const execution = await prisma.invoiceExecution.findUnique({
    where: {
      id: invoiceExecutionId,
    },
  });

  if (!execution) {
    throw new Error('Invoice execution could not be found.');
  }

  const responseSnapshot = isRecord(execution.responseSnapshot) ? execution.responseSnapshot : null;
  const body = responseSnapshot && 'body' in responseSnapshot ? responseSnapshot.body : null;
  const bodyKeys = Array.isArray(responseSnapshot?.bodyKeys)
    ? responseSnapshot.bodyKeys.filter((key): key is string => typeof key === 'string')
    : isRecord(body)
      ? Object.keys(body).sort()
      : [];

  return {
    id: execution.id,
    provider: mapProvider(execution.provider),
    status: mapEffectiveInvoiceStatus(execution),
    providerInvoiceGuidPresent: Boolean(execution.providerInvoiceGuid),
    providerInvoiceNoPresent: Boolean(execution.providerInvoiceNo),
    providerPdfUrlPresent: Boolean(execution.providerPdfUrl),
    response: responseSnapshot
      ? {
          httpStatus: typeof responseSnapshot.status === 'number' ? responseSnapshot.status : null,
          ok: typeof responseSnapshot.ok === 'boolean' ? responseSnapshot.ok : null,
          contentType: typeof responseSnapshot.contentType === 'string' ? responseSnapshot.contentType : null,
          parsedBodyType: typeof responseSnapshot.parsedBodyType === 'string' ? responseSnapshot.parsedBodyType : null,
          bodyKeys,
          nestedBodyKeys: [...collectNestedKeys(body)].sort(),
          providerError: truncateProviderError(
            readNestedResponseString(body, ['error', 'Error', 'errorMessage', 'ErrorMessage', 'message', 'Message']),
          ),
          parsedGuidPresent: Boolean(
            readNestedResponseString(body, ['providerInvoiceGuid', 'invoiceGuid', 'InvoiceGuid', 'Guid', 'guid', 'id']),
          ),
          parsedPdfUrlPresent: Boolean(
            readNestedResponseString(body, ['providerPdfUrl', 'pdfUrl', 'PdfUrl', 'PDFUrl', 'invoicePdfUrl', 'url']),
          ),
        }
      : null,
  };
}
