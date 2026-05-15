import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  financeLedgerEntry: {
    findUnique: vi.fn(),
  },
  invoiceExecution: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  createInvoiceExecution,
  getInvoiceExecutionResponseSummary,
  mapInvoiceExecution,
  previewInvoiceExecutionPayload,
  retryInvoiceExecution,
} = await import(
  '../backend/src/modules/invoices/invoice-execution.service.js'
);
const { BizimHesapAdapter } = await import('../backend/src/modules/invoices/invoice-provider.adapter.js');

const env = {
  NODE_ENV: 'test' as const,
  PORT: 4000,
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/vendor_dashboard_dev',
  CORS_ORIGIN: ['http://localhost:5173'],
  JWT_SECRET: 'test',
  JWT_EXPIRES_IN: '12h',
  SHOPIFY_WEBHOOK_SECRET: 'test',
  SHOPIFY_API_VERSION: '2026-01',
  SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 25,
  SCHEDULED_RECONCILIATION_ENABLED: false,
  SCHEDULED_RECONCILIATION_EXECUTE_DUE: false,
  SCHEDULED_RECONCILIATION_INTERVAL_MS: 1800000,
  SCHEDULED_RECONCILIATION_COOLDOWN_MS: 1800000,
  SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT: 25,
  EMAIL_NOTIFICATIONS_ENABLED: false,
  EMAIL_PROVIDER: 'noop' as const,
  EMAIL_ADMIN_RECIPIENTS: [],
  INVOICE_EXECUTION_ENABLED: true,
  INVOICE_PROVIDER: 'bizimhesap' as const,
  BIZIMHESAP_ENABLED: true,
  BIZIMHESAP_FIRM_ID: 'test-firm',
  BIZIMHESAP_API_KEY: 'test-api-key',
  BIZIMHESAP_BASE_URL: 'https://provider.example',
};

function buildLedgerEntry() {
  return {
    id: 'fin-sporjinal-sale-7616544244049',
    vendorAllocationId: 'alloc-1',
    vendorId: 'sporjinal',
    entryType: 'sale',
    amount: 3399,
    payoutStatus: 'PENDING',
    description: 'Sale ledger for Shopify order #1021',
    commissionPercentSnapshot: 10,
    commissionVatPercentSnapshot: 18,
    deductShippingEnabledSnapshot: false,
    shippingModeSnapshot: 'DISABLED',
    fixedShippingFeeSnapshot: null,
    shippingCostSnapshot: null,
    shippingVatAmountSnapshot: null,
    shippingCostSourceSnapshot: null,
    shippingCostProviderSnapshot: null,
    shippingCostIdSnapshot: null,
    financialProfileIdSnapshot: 'profile-sporjinal',
    settlementStatus: 'PAYABLE',
    settlementEligibleAt: null,
    accruedAt: null,
    payableAt: null,
    settledAt: null,
    settlementHoldReason: null,
    createdAt: new Date('2026-05-14T08:00:00.000Z'),
    updatedAt: new Date('2026-05-14T08:00:00.000Z'),
    vendorAllocation: {
      id: 'alloc-1',
      sourceShopifyOrderId: '7616544244049',
      sourceShopifyOrderNumber: '1021',
      assignedVendorId: 'sporjinal',
      order: {
        sourceShopifyOrderId: '7616544244049',
        sourceShopifyOrderNumber: '1021',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        lineItems: [],
      },
      lineItems: [
        {
          quantity: 1,
          lineAmount: 3399,
          shopifyOrderLineItem: {
            sourceLineItemId: 'line-1',
            sku: 'SKU-1',
            title: 'Running Shoe',
            quantity: 1,
            unitPrice: 3399,
          },
        },
      ],
    },
  };
}

function buildExecution(input: Partial<{ status: string; providerInvoiceGuid: string | null }> = {}) {
  return {
    id: 'invoice-bizimhesap-fin-sporjinal-sale-7616544244049',
    financeLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
    provider: 'BIZIMHESAP',
    providerInvoiceGuid: 'providerInvoiceGuid' in input ? input.providerInvoiceGuid ?? null : 'BH-GUID-1',
    providerInvoiceNo: 'BH-1001',
    providerPdfUrl: 'https://provider.example/invoice.pdf',
    status: input.status ?? 'CREATED',
    requestSnapshot: {},
    responseSnapshot: {},
    createdAt: new Date('2026-05-14T08:00:00.000Z'),
    updatedAt: new Date('2026-05-14T08:01:00.000Z'),
  };
}

function buildFetchResponse(body: unknown, contentType = 'application/json') {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (key: string) => (key.toLowerCase() === 'content-type' ? contentType : null),
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('invoice execution foundation', () => {
  const adapter = {
    provider: 'BIZIMHESAP' as const,
    createInvoice: vi.fn(),
    cancelInvoice: vi.fn(),
    getInvoiceStatus: vi.fn(),
    getInvoicePdfUrl: vi.fn(),
  };

  beforeEach(() => {
    prismaMock.financeLedgerEntry.findUnique.mockReset();
    prismaMock.invoiceExecution.findUnique.mockReset();
    prismaMock.invoiceExecution.create.mockReset();
    prismaMock.invoiceExecution.update.mockReset();
    adapter.createInvoice.mockReset();

    prismaMock.invoiceExecution.findUnique.mockResolvedValue(null);
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue(buildLedgerEntry());
    prismaMock.invoiceExecution.create.mockResolvedValue(buildExecution({ status: 'PENDING', providerInvoiceGuid: null }));
    prismaMock.invoiceExecution.update.mockImplementation(async ({ data }) => ({
      ...buildExecution(),
      ...data,
      updatedAt: new Date('2026-05-14T08:02:00.000Z'),
    }));
    adapter.createInvoice.mockResolvedValue({
      providerInvoiceGuid: 'BH-GUID-1',
      providerInvoiceNo: 'BH-1001',
      providerPdfUrl: 'https://provider.example/invoice.pdf',
      responseSnapshot: {
        ok: true,
        body: {
          Guid: 'BH-GUID-1',
          InvoiceNo: 'BH-1001',
          PdfUrl: 'https://provider.example/invoice.pdf',
        },
      },
    });
  });

  it('creates invoice execution from a sale ledger row and persists provider identifiers', async () => {
    const execution = await createInvoiceExecution(
      {
        financeLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
        provider: 'bizimhesap',
      },
      {
        env,
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(prismaMock.invoiceExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'invoice-bizimhesap-fin-sporjinal-sale-7616544244049',
          financeLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
          provider: 'BIZIMHESAP',
          status: 'PENDING',
          requestSnapshot: expect.objectContaining({
            AddInvoice: expect.objectContaining({
              References: expect.objectContaining({
                FinanceLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
                ShopifyOrderNumber: '1021',
              }),
            }),
          }),
        }),
      }),
    );
    expect(adapter.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        financeLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
      }),
    );
    expect(prismaMock.invoiceExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CREATED',
          providerInvoiceGuid: 'BH-GUID-1',
          providerInvoiceNo: 'BH-1001',
          providerPdfUrl: 'https://provider.example/invoice.pdf',
        }),
      }),
    );
    expect(execution).toMatchObject({
      provider: 'bizimhesap',
      status: 'created',
      providerInvoiceGuid: 'BH-GUID-1',
      providerPdfUrl: 'https://provider.example/invoice.pdf',
    });
  });

  it('previews BizimHesap invoice payload without creating an execution or exposing secrets', async () => {
    const preview = await previewInvoiceExecutionPayload(
      {
        financeLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
        provider: 'bizimhesap',
      },
      {
        env,
        vendorId: 'sporjinal',
      },
    );

    expect(preview).toMatchObject({
      provider: 'bizimhesap',
      dryRun: true,
      executionEnabled: true,
      providerEnabled: true,
      providerConfigured: true,
      configuration: {
        firmIdConfigured: true,
        apiKeyConfigured: true,
        baseUrlConfigured: true,
      },
    });
    expect(preview.requestSnapshot).toEqual(
      expect.objectContaining({
        AddInvoice: expect.objectContaining({
          Customer: expect.objectContaining({
            Name: 'Test Customer',
          }),
          Lines: [
            expect.objectContaining({
              ProductName: 'Running Shoe',
              LineAmount: 3399,
            }),
          ],
          References: expect.objectContaining({
            FinanceLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
            ShopifyOrderNumber: '1021',
          }),
        }),
      }),
    );
    expect(JSON.stringify(preview)).not.toContain('test-api-key');
    expect(JSON.stringify(preview)).not.toContain('test-firm');
    expect(prismaMock.invoiceExecution.create).not.toHaveBeenCalled();
    expect(adapter.createInvoice).not.toHaveBeenCalled();
  });

  it('prevents duplicate invoice execution for the same ledger row and provider', async () => {
    prismaMock.invoiceExecution.findUnique.mockResolvedValueOnce(buildExecution());

    await expect(
      createInvoiceExecution(
        {
          financeLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
          provider: 'bizimhesap',
        },
        {
          env,
          vendorId: 'sporjinal',
          adapter,
        },
      ),
    ).rejects.toThrow('Invoice execution already exists');
    expect(adapter.createInvoice).not.toHaveBeenCalled();
  });

  it('records provider failures without mutating the finance ledger linkage', async () => {
    adapter.createInvoice.mockRejectedValueOnce(new Error('Provider unavailable'));

    const execution = await createInvoiceExecution(
      {
        financeLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
        provider: 'bizimhesap',
      },
      {
        env,
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(prismaMock.invoiceExecution.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: 'invoice-bizimhesap-fin-sporjinal-sale-7616544244049',
        },
        data: expect.objectContaining({
          status: 'FAILED',
          responseSnapshot: expect.objectContaining({
            error: 'Provider unavailable',
          }),
        }),
      }),
    );
    expect(execution.status).toBe('failed');
  });

  it('does not mark provider HTTP success as created when guid and PDF URL are missing', async () => {
    adapter.createInvoice.mockResolvedValueOnce({
      providerInvoiceGuid: null,
      providerInvoiceNo: null,
      providerPdfUrl: null,
      responseSnapshot: {
        status: 200,
        ok: true,
        contentType: 'application/json',
        parsedBodyType: 'object',
        bodyKeys: ['eInvoiceNo', 'error', 'guid', 'url'],
        body: {
          eInvoiceNo: '',
          error: '',
          guid: '',
          url: '',
        },
      },
    });

    const execution = await createInvoiceExecution(
      {
        financeLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
        provider: 'bizimhesap',
      },
      {
        env,
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(prismaMock.invoiceExecution.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'UNKNOWN',
          providerInvoiceGuid: null,
          providerPdfUrl: null,
          responseSnapshot: expect.objectContaining({
            error: 'BizimHesap AddInvoice returned HTTP success without provider GUID or PDF URL.',
          }),
        }),
      }),
    );
    expect(execution.status).toBe('unknown');
  });

  it('preserves vendor isolation during invoice creation', async () => {
    await expect(
      createInvoiceExecution(
        {
          financeLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
          provider: 'bizimhesap',
        },
        {
          env,
          vendorId: 'other-vendor',
          adapter,
        },
      ),
    ).rejects.toThrow('Finance ledger row does not belong to the selected vendor.');
    expect(adapter.createInvoice).not.toHaveBeenCalled();
  });

  it('retries failed invoice executions against the same execution row', async () => {
    prismaMock.invoiceExecution.findUnique.mockResolvedValueOnce({
      ...buildExecution({ status: 'FAILED', providerInvoiceGuid: null }),
      financeLedgerEntry: buildLedgerEntry(),
    });

    const execution = await retryInvoiceExecution('invoice-bizimhesap-fin-sporjinal-sale-7616544244049', {
      env,
      adapter,
    });

    expect(prismaMock.invoiceExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'invoice-bizimhesap-fin-sporjinal-sale-7616544244049',
        },
        data: expect.objectContaining({
          status: 'PENDING',
          responseSnapshot: expect.any(Object),
        }),
      }),
    );
    expect(execution.status).toBe('created');
  });

  it('allows retry for inconsistent created executions without provider identifiers', async () => {
    prismaMock.invoiceExecution.findUnique.mockResolvedValueOnce({
      ...buildExecution({ status: 'CREATED', providerInvoiceGuid: null }),
      providerPdfUrl: null,
      financeLedgerEntry: buildLedgerEntry(),
    });

    const execution = await retryInvoiceExecution('invoice-bizimhesap-fin-sporjinal-sale-7616544244049', {
      env,
      adapter,
    });

    expect(adapter.createInvoice).toHaveBeenCalledOnce();
    expect(execution.status).toBe('created');
  });

  it('passes BizimHesap FirmId and API key through the provider request without logging them in snapshots', async () => {
    const fetchMock = vi.fn().mockResolvedValue(buildFetchResponse({
      Guid: 'BH-GUID-2',
      InvoiceNo: 'BH-1002',
      PdfUrl: 'https://provider.example/invoice-2.pdf',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const liveAdapter = new BizimHesapAdapter(env);
    const result = await liveAdapter.createInvoice({
      financeLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
      requestSnapshot: {
        AddInvoice: {
          Customer: {
            Name: 'Test Customer',
          },
        },
      },
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe('/AddInvoice');
    expect(requestUrl.searchParams.get('FirmId')).toBe('test-firm');
    expect(requestUrl.searchParams.get('ApiKey')).toBe('test-api-key');
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: expect.not.stringContaining('test-api-key'),
      }),
    );
    expect(result).toMatchObject({
      providerInvoiceGuid: 'BH-GUID-2',
      providerInvoiceNo: 'BH-1002',
    });

    vi.unstubAllGlobals();
  });

  it('parses documented BizimHesap lowercase guid and url response fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(buildFetchResponse({
      guid: 'BH-GUID-LOWER',
      url: 'https://provider.example/lowercase.pdf',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const liveAdapter = new BizimHesapAdapter(env);
    const result = await liveAdapter.createInvoice({
      financeLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
      requestSnapshot: {
        AddInvoice: {
          Customer: {
            Name: 'Test Customer',
          },
        },
      },
    });

    expect(result).toMatchObject({
      providerInvoiceGuid: 'BH-GUID-LOWER',
      providerInvoiceNo: null,
      providerPdfUrl: 'https://provider.example/lowercase.pdf',
      responseSnapshot: expect.objectContaining({
        status: 200,
        ok: true,
        contentType: 'application/json',
        parsedBodyType: 'object',
        bodyKeys: ['guid', 'url'],
      }),
    });

    vi.unstubAllGlobals();
  });

  it('treats BizimHesap provider error bodies as failed provider execution', async () => {
    const fetchMock = vi.fn().mockResolvedValue(buildFetchResponse({
      eInvoiceNo: '',
      error: 'provider rejected invoice',
      guid: '',
      url: '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const liveAdapter = new BizimHesapAdapter(env);

    await expect(
      liveAdapter.createInvoice({
        financeLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
        requestSnapshot: {
          AddInvoice: {
            Customer: {
              Name: 'Test Customer',
            },
          },
        },
      }),
    ).rejects.toThrow('BizimHesap AddInvoice returned a provider error.');

    vi.unstubAllGlobals();
  });

  it('does not synthesize fallback provider GUIDs for missing provider identifiers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(buildFetchResponse({
      eInvoiceNo: '',
      error: '',
      guid: '',
      url: '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const liveAdapter = new BizimHesapAdapter(env);
    const result = await liveAdapter.createInvoice({
      financeLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
      requestSnapshot: {
        AddInvoice: {
          Customer: {
            Name: 'Test Customer',
          },
        },
      },
    });

    expect(result.providerInvoiceGuid).toBeNull();
    expect(result.providerPdfUrl).toBeNull();

    vi.unstubAllGlobals();
  });

  it('maps legacy created executions without provider identifiers as unknown for UI display', () => {
    const execution = mapInvoiceExecution({
      ...buildExecution({ status: 'CREATED', providerInvoiceGuid: null }),
      providerPdfUrl: null,
    });

    expect(execution.status).toBe('unknown');
  });

  it('parses nested BizimHesap provider response wrappers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(buildFetchResponse({
      AddInvoiceResult: {
        guid: 'BH-GUID-NESTED',
        url: 'https://provider.example/nested.pdf',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const liveAdapter = new BizimHesapAdapter(env);
    const result = await liveAdapter.createInvoice({
      financeLedgerEntryId: 'fin-sporjinal-sale-7616544244049',
      requestSnapshot: {
        AddInvoice: {
          Customer: {
            Name: 'Test Customer',
          },
        },
      },
    });

    expect(result).toMatchObject({
      providerInvoiceGuid: 'BH-GUID-NESTED',
      providerPdfUrl: 'https://provider.example/nested.pdf',
    });

    vi.unstubAllGlobals();
  });

  it('summarizes persisted provider response snapshots without raw values', async () => {
    prismaMock.invoiceExecution.findUnique.mockResolvedValueOnce({
      ...buildExecution({
        providerInvoiceGuid: 'BH-GUID-SUMMARY',
      }),
      providerInvoiceNo: null,
      providerPdfUrl: 'https://provider.example/invoice.pdf',
      responseSnapshot: {
        status: 200,
        ok: true,
        contentType: 'application/json',
        parsedBodyType: 'object',
        bodyKeys: ['guid', 'url'],
        body: {
          guid: 'BH-GUID-SUMMARY',
          url: 'https://provider.example/invoice.pdf',
        },
      },
    });

    const summary = await getInvoiceExecutionResponseSummary('invoice-bizimhesap-fin-sporjinal-sale-7616544244049');

    expect(summary).toEqual(
      expect.objectContaining({
        providerInvoiceGuidPresent: true,
        providerInvoiceNoPresent: false,
        providerPdfUrlPresent: true,
        response: expect.objectContaining({
          httpStatus: 200,
          ok: true,
          contentType: 'application/json',
          parsedBodyType: 'object',
          bodyKeys: ['guid', 'url'],
          nestedBodyKeys: ['guid', 'url'],
          providerError: null,
          parsedGuidPresent: true,
          parsedPdfUrlPresent: true,
        }),
      }),
    );
    expect(JSON.stringify(summary)).not.toContain('BH-GUID-SUMMARY');
    expect(JSON.stringify(summary)).not.toContain('invoice.pdf');
  });
});
