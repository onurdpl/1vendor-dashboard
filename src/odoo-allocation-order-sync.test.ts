import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorAllocation: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { syncOdooSaleOrderForAllocation } = await import('../backend/src/integrations/odoo/odooAllocationOrderSync.service.js');

const logger = {
  log: vi.fn(),
  error: vi.fn(),
};

describe('Odoo allocation sale.order sync', () => {
  beforeEach(() => {
    prismaMock.vendorAllocation.findUnique.mockReset();
    prismaMock.vendorAllocation.update.mockReset();
    logger.log.mockReset();
    logger.error.mockReset();
  });

  it('skips without touching storage when Odoo sync is disabled', async () => {
    const result = await syncOdooSaleOrderForAllocation('alloc-1', {
      env: {
        ODOO_ENABLED: 'false',
        ODOO_DRY_RUN: 'false',
      },
      logger,
    });

    expect(result).toEqual({ status: 'disabled', allocationId: 'alloc-1' });
    expect(prismaMock.vendorAllocation.findUnique).not.toHaveBeenCalled();
  });

  it('uses local Odoo sale.order fields for idempotency', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce({
      id: 'alloc-1',
      odooSaleOrderId: '42',
      odooSaleOrderName: 'SO042',
    });

    const result = await syncOdooSaleOrderForAllocation('alloc-1', {
      env: {
        ODOO_ENABLED: 'true',
        ODOO_DRY_RUN: 'false',
        ODOO_URL: 'https://odoo.example.test',
        ODOO_DB: 'sporgym',
        ODOO_USERNAME: 'integration@example.test',
        ODOO_API_KEY: 'secret',
        ODOO_SALE_ORDER_PARTNER_ID: '1',
        ODOO_VENDOR_PARTNER_MAP: 'sporjinal:11,yalispor:12',
      },
      logger,
    });

    expect(result).toEqual({
      status: 'skipped_existing',
      allocationId: 'alloc-1',
      odooSaleOrderId: '42',
      odooSaleOrderName: 'SO042',
    });
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('fails closed when no configured Odoo partner is available', async () => {
    const result = await syncOdooSaleOrderForAllocation('alloc-1', {
      env: {
        ODOO_ENABLED: 'true',
        ODOO_DRY_RUN: 'false',
        ODOO_URL: 'https://odoo.example.test',
        ODOO_DB: 'sporgym',
        ODOO_USERNAME: 'integration@example.test',
        ODOO_API_KEY: 'secret',
      },
      logger,
    });

    expect(result).toMatchObject({
      status: 'failed',
      allocationId: 'alloc-1',
    });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ODOO_SALE_ORDER_PARTNER_ID or ODOO_SALE_ORDER_PARTNER_NAME'));
    expect(prismaMock.vendorAllocation.findUnique).not.toHaveBeenCalled();
  });

  it('sets x_vendor_id from the configured vendor partner map', async () => {
    const allocation = buildAllocation({ assignedVendorId: 'yalispor' });
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce(allocation);
    prismaMock.vendorAllocation.update.mockResolvedValueOnce({});

    const fetchMock = buildOdooFetchMock();
    const result = await syncOdooSaleOrderForAllocation('alloc-1', {
      env: liveEnv(),
      logger,
      fetchImpl: fetchMock,
    });

    expect(result).toEqual({
      status: 'synced',
      allocationId: 'alloc-1',
      odooSaleOrderId: '43',
      odooSaleOrderName: 'SO043',
    });
    expect(fetchMock.createdSaleOrderValues).toMatchObject({
      x_vendor_id: 12,
      picking_policy: 'direct',
      client_order_ref: 'sporgym-allocation:alloc-1',
    });
    expect(fetchMock.createdSaleOrderValues?.order_line).toEqual([
      [
        0,
        0,
        expect.objectContaining({
          product_id: 21,
        }),
      ],
    ]);
    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith({
      where: { id: 'alloc-1' },
      data: expect.objectContaining({
        odooSaleOrderId: '43',
        odooSaleOrderName: 'SO043',
      }),
    });
  });

  it('fails closed when the allocation vendor is not mapped', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce(buildAllocation({ assignedVendorId: 'unknown-vendor' }));
    const fetchMock = buildOdooFetchMock();

    const result = await syncOdooSaleOrderForAllocation('alloc-1', {
      env: liveEnv(),
      logger,
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({
      status: 'failed',
      allocationId: 'alloc-1',
    });
    expect(result).toHaveProperty('error', 'No Odoo vendor portal partner mapping configured for vendor unknown-vendor.');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('fails before create when x_vendor_id is missing in Odoo fields', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce(buildAllocation({ assignedVendorId: 'sporjinal' }));
    const fetchMock = buildOdooFetchMock({ saleOrderFields: {} });

    const result = await syncOdooSaleOrderForAllocation('alloc-1', {
      env: liveEnv(),
      logger,
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({
      status: 'failed',
      allocationId: 'alloc-1',
    });
    expect(result).toHaveProperty(
      'error',
      'sale.order.x_vendor_id does not exist in Odoo; vendor portal mapping was not written.',
    );
    expect(fetchMock.createdSaleOrderValues).toBeNull();
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('includes the standard Odoo picking_policy when Odoo requires delivery policy', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce(buildAllocation({ assignedVendorId: 'sporjinal' }));
    prismaMock.vendorAllocation.update.mockResolvedValueOnce({});
    const fetchMock = buildOdooFetchMock({
      saleOrderFields: {
        x_vendor_id: { type: 'many2one', readonly: false },
        picking_policy: { type: 'selection', required: true, readonly: false },
      },
    });

    const result = await syncOdooSaleOrderForAllocation('alloc-1', {
      env: liveEnv(),
      logger,
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({
      status: 'synced',
      allocationId: 'alloc-1',
    });
    expect(fetchMock.createdSaleOrderValues).toMatchObject({
      picking_policy: 'direct',
    });
  });

  it('reuses an existing Odoo product by SKU/default_code', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce(buildAllocation({ assignedVendorId: 'sporjinal' }));
    prismaMock.vendorAllocation.update.mockResolvedValueOnce({});
    const fetchMock = buildOdooFetchMock({
      existingProducts: [{ id: 77, name: 'Existing SKU product', default_code: 'SKU-1' }],
    });

    const result = await syncOdooSaleOrderForAllocation('alloc-1', {
      env: liveEnv(),
      logger,
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({
      status: 'synced',
      allocationId: 'alloc-1',
    });
    expect(fetchMock.createdProductValues).toEqual([]);
    expect(fetchMock.createdSaleOrderValues?.order_line).toEqual([
      [
        0,
        0,
        expect.objectContaining({
          product_id: 77,
          name: expect.stringContaining('SKU: SKU-1'),
        }),
      ],
    ]);
  });

  it('fails closed when an allocation line is missing SKU', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce(buildAllocation({ sku: ' ' }));
    const fetchMock = buildOdooFetchMock();

    const result = await syncOdooSaleOrderForAllocation('alloc-1', {
      env: liveEnv(),
      logger,
      fetchImpl: fetchMock,
    });

    expect(result).toEqual({
      status: 'failed',
      allocationId: 'alloc-1',
      error: 'Vendor allocation alloc-1 line item line-1 is missing Shopify SKU; Odoo product sync failed closed.',
    });
    expect(fetchMock.createdProductValues).toEqual([]);
    expect(fetchMock.createdSaleOrderValues).toBeNull();
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('creates a minimal Odoo product when SKU is missing from Odoo', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce(buildAllocation({ assignedVendorId: 'sporjinal' }));
    prismaMock.vendorAllocation.update.mockResolvedValueOnce({});
    const fetchMock = buildOdooFetchMock({ existingProducts: [] });

    const result = await syncOdooSaleOrderForAllocation('alloc-1', {
      env: liveEnv(),
      logger,
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({
      status: 'synced',
      allocationId: 'alloc-1',
    });
    expect(fetchMock.createdProductValues).toEqual([
      expect.objectContaining({
        name: 'Mapped product',
        default_code: 'SKU-1',
        list_price: 10.5,
        sale_ok: true,
        type: 'consu',
        uom_id: 3,
        uom_po_id: 3,
        taxes_id: [[6, 0, [4]]],
      }),
    ]);
    expect(fetchMock.createdSaleOrderValues?.order_line).toEqual([
      [
        0,
        0,
        expect.objectContaining({
          product_id: 88,
        }),
      ],
    ]);
  });

  it('does not overwrite an existing Odoo product', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce(buildAllocation({ assignedVendorId: 'sporjinal' }));
    prismaMock.vendorAllocation.update.mockResolvedValueOnce({});
    const fetchMock = buildOdooFetchMock({
      existingProducts: [{ id: 44, name: 'Do not overwrite', default_code: 'SKU-1' }],
    });

    await syncOdooSaleOrderForAllocation('alloc-1', {
      env: liveEnv(),
      logger,
      fetchImpl: fetchMock,
    });

    expect(fetchMock.createdProductValues).toEqual([]);
    expect(fetchMock.productWriteCalls).toBe(0);
    expect(fetchMock.createdSaleOrderValues?.order_line).toEqual([
      [
        0,
        0,
        expect.objectContaining({
          product_id: 44,
        }),
      ],
    ]);
  });

  it('keeps Odoo idempotency before resolving products', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce(buildAllocation({ assignedVendorId: 'sporjinal' }));
    prismaMock.vendorAllocation.update.mockResolvedValueOnce({});
    const fetchMock = buildOdooFetchMock({
      existingSaleOrders: [{ id: 55, name: 'SO055' }],
      existingProducts: [],
    });

    const result = await syncOdooSaleOrderForAllocation('alloc-1', {
      env: liveEnv(),
      logger,
      fetchImpl: fetchMock,
    });

    expect(result).toEqual({
      status: 'synced',
      allocationId: 'alloc-1',
      odooSaleOrderId: '55',
      odooSaleOrderName: 'SO055',
    });
    expect(fetchMock.productSearchCalls).toBe(0);
    expect(fetchMock.createdProductValues).toEqual([]);
    expect(fetchMock.createdSaleOrderValues).toBeNull();
  });
});

function liveEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    ODOO_ENABLED: 'true',
    ODOO_DRY_RUN: 'false',
    ODOO_URL: 'https://odoo.example.test',
    ODOO_DB: 'sporgym',
    ODOO_USERNAME: 'integration@example.test',
    ODOO_API_KEY: 'secret',
    ODOO_SALE_ORDER_PARTNER_ID: '1',
    ODOO_VENDOR_PARTNER_MAP: 'sporjinal:11,yalispor:12',
    ...overrides,
  };
}

function buildAllocation(overrides: { assignedVendorId?: string; odooSaleOrderId?: string | null; sku?: string | null } = {}) {
  const assignedVendorId = overrides.assignedVendorId ?? 'yalispor';
  return {
    id: 'alloc-1',
    sourceShopifyOrderId: 'order-local-1',
    sourceShopifyOrderNumber: '#1001',
    assignedVendorId,
    odooSaleOrderId: overrides.odooSaleOrderId ?? null,
    odooSaleOrderName: null,
    assignedVendor: {
      id: assignedVendorId,
      name: assignedVendorId,
    },
    order: {
      id: 'order-local-1',
      sourceShopifyOrderId: '1001',
      customerName: 'Customer One',
    },
    lineItems: [
      {
        id: 'line-1',
        quantity: 2,
        shopifyOrderLineItem: {
          sourceLineItemId: 'shopify-line-1',
          sku: overrides.sku ?? 'SKU-1',
          title: 'Mapped product',
          unitPrice: '10.50',
        },
      },
    ],
  };
}

function buildOdooFetchMock(
  options: {
    saleOrderFields?: Record<string, { required?: boolean; readonly?: boolean; type?: string; string?: string }>;
    existingSaleOrders?: Array<Record<string, unknown>>;
    existingProducts?: Array<Record<string, unknown>>;
  } = {},
) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as {
      id: number;
      params?: {
        service?: string;
        method?: string;
        args?: unknown[];
      };
    };
    const service = payload.params?.service;
    const args = payload.params?.args ?? [];
    const model = args[3];
    const method = args[4];
    const methodArgs = args[5] as unknown[] | undefined;

    if (service === 'common' && payload.params?.method === 'authenticate') {
      return jsonRpcResponse(payload.id, 7);
    }

    if (model === 'res.partner' && method === 'read') {
      return jsonRpcResponse(payload.id, [{ id: 1, name: 'Sporgym Partner' }]);
    }

    if (model === 'res.company' && method === 'search_read') {
      return jsonRpcResponse(payload.id, [{ id: 2, name: 'Sporgym Company' }]);
    }

    if (model === 'sale.order' && method === 'search_read') {
      return jsonRpcResponse(payload.id, options.existingSaleOrders ?? []);
    }

    if (model === 'sale.order' && method === 'fields_get') {
      return jsonRpcResponse(payload.id, options.saleOrderFields ?? { x_vendor_id: { type: 'many2one', readonly: false } });
    }

    if (model === 'sale.order.line' && method === 'fields_get') {
      return jsonRpcResponse(payload.id, {});
    }

    if (model === 'product.product' && method === 'search_read') {
      fetchMock.productSearchCalls += 1;
      return jsonRpcResponse(payload.id, options.existingProducts ?? [{ id: 21, name: 'Existing SKU product', default_code: 'SKU-1' }]);
    }

    if (model === 'product.product' && method === 'fields_get') {
      return jsonRpcResponse(payload.id, {
        name: { type: 'char', required: true, readonly: false },
        default_code: { type: 'char', readonly: false },
        list_price: { type: 'float', readonly: false },
        sale_ok: { type: 'boolean', readonly: false },
        type: { type: 'selection', required: true, readonly: false, selection: [['consu', 'Consumable'], ['product', 'Storable Product']] },
        uom_id: { type: 'many2one', required: true, readonly: false },
        uom_po_id: { type: 'many2one', required: true, readonly: false },
        taxes_id: { type: 'many2many', readonly: false },
      });
    }

    if (model === 'uom.uom' && method === 'search_read') {
      return jsonRpcResponse(payload.id, [{ id: 3, name: 'Units' }]);
    }

    if (model === 'account.tax' && method === 'search_read') {
      return jsonRpcResponse(payload.id, [{ id: 4, name: 'VAT 20%' }]);
    }

    if (model === 'product.product' && method === 'create') {
      fetchMock.createdProductValues.push((methodArgs ?? [])[0] as Record<string, unknown>);
      return jsonRpcResponse(payload.id, 88);
    }

    if (model === 'product.product' && method === 'write') {
      fetchMock.productWriteCalls += 1;
      return jsonRpcResponse(payload.id, true);
    }

    if (model === 'sale.order' && method === 'create') {
      fetchMock.createdSaleOrderValues = (methodArgs ?? [])[0] as Record<string, unknown>;
      return jsonRpcResponse(payload.id, 43);
    }

    if (model === 'sale.order' && method === 'read') {
      return jsonRpcResponse(payload.id, [{ id: 43, name: 'SO043', state: 'draft' }]);
    }

    throw new Error(`Unexpected Odoo call ${String(model)}.${String(method)}`);
  }) as ReturnType<typeof vi.fn> & {
    createdSaleOrderValues: Record<string, unknown> | null;
    createdProductValues: Array<Record<string, unknown>>;
    productSearchCalls: number;
    productWriteCalls: number;
  };

  fetchMock.createdSaleOrderValues = null;
  fetchMock.createdProductValues = [];
  fetchMock.productSearchCalls = 0;
  fetchMock.productWriteCalls = 0;
  return fetchMock;
}

function jsonRpcResponse(id: number, result: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}
