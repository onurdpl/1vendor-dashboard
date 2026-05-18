import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorAllocation: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  vendorShippingConfig: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  shipmentExecution: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  shipmentShippingCost: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  fulfillment: {
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  createShipmentExecution,
  getShippingProviderGateDiagnostics,
  getShippingProviderReadinessDiagnostics,
  ingestKargoEntegratorWebhook,
  inferShipmentDesi,
  previewShipmentExecution,
  retryDryRunShipmentExecution,
  retryFailedShipmentExecution,
} = await import(
  '../backend/src/modules/shipping/shipping-execution.service.js'
);
const { KargoEntegratorAdapter, ShippingProviderExecutionError } = await import('../backend/src/modules/shipping/shipping-provider.adapter.js');
const { registerShippingExecutionRoutes } = await import('../backend/src/modules/shipping/shipping-execution.routes.js');

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
  INVOICE_EXECUTION_ENABLED: false,
  INVOICE_PROVIDER: 'bizimhesap' as const,
  BIZIMHESAP_ENABLED: false,
  SHIPPING_EXECUTION_ENABLED: true,
  SHIPPING_SANDBOX_MODE: false,
  SHIPPING_PROVIDER: 'hepsijet' as const,
  KARGO_ENTEGRATOR_ENABLED: true,
  KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
  KARGO_ENTEGRATOR_BASE_URL: 'https://kargo.example',
  KARGO_ENTEGRATOR_API_KEY: 'test-kargo-key',
};

function buildAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-1',
    assignedVendorId: 'sporjinal',
    sourceShopifyOrderId: '7616544244049',
    sourceShopifyOrderNumber: '1027',
    allocationStatus: 'ACTIVE',
    cancellationReason: null,
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    fulfillment: null,
    order: {
      id: 'order-1',
      customerName: 'Test Customer',
      customerEmail: 'customer@example.com',
    },
    lineItems: [
      {
        quantity: 1,
        lineAmount: 4999,
        shopifyOrderLineItem: {
          title: 'Nike Air Max Alpha Trainer 6',
          sku: 'FQ1833-200-41',
        },
      },
    ],
    ...overrides,
  };
}

function buildShipmentExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shipment-hepsijet-alloc-1',
    allocationId: 'alloc-1',
    vendorId: 'sporjinal',
    sourceShopifyOrderId: '7616544244049',
    sourceShopifyOrderNumber: '1027',
    sourceShopifyFulfillmentId: null,
    provider: 'HEPSIJET',
    providerShipmentId: null,
    trackingNumber: null,
    trackingUrl: null,
    labelUrl: null,
    shipmentStatus: 'PENDING',
    desi: 3,
    cargoIntegrationId: null,
    warehouseId: null,
    shippingCost: null,
    shippingVat: null,
    currency: 'TRY',
    requestSnapshot: {},
    responseSnapshot: null,
    createdAt: new Date('2026-05-15T10:00:00.000Z'),
    updatedAt: new Date('2026-05-15T10:00:00.000Z'),
    ...overrides,
  };
}

function buildAdapter(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'HEPSIJET' as const,
    createShipment: vi.fn(),
    getShipmentStatus: vi.fn(),
    getTrackingInfo: vi.fn(),
    cancelShipment: vi.fn(),
    ...overrides,
  };
}

function mockProviderResponse(body: string, options: { status?: number; contentType?: string } = {}) {
  const status = options.status ?? 200;
  const contentType = options.contentType ?? 'application/json';
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    text: async () => body,
  } as Response;
}

describe('shipping execution foundation', () => {
  let storedExecution: ReturnType<typeof buildShipmentExecution>;

  beforeEach(() => {
    prismaMock.vendorAllocation.findUnique.mockReset();
    prismaMock.vendorAllocation.update.mockReset();
    prismaMock.vendorShippingConfig.findUnique.mockReset();
    prismaMock.vendorShippingConfig.upsert.mockReset();
    prismaMock.shipmentExecution.findUnique.mockReset();
    prismaMock.shipmentExecution.findFirst.mockReset();
    prismaMock.shipmentExecution.findMany.mockReset();
    prismaMock.shipmentExecution.create.mockReset();
    prismaMock.shipmentExecution.update.mockReset();
    prismaMock.shipmentShippingCost.findFirst.mockReset();
    prismaMock.shipmentShippingCost.upsert.mockReset();
    prismaMock.fulfillment.upsert.mockReset();
    prismaMock.$transaction.mockReset();

    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation());
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue(null);
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(null);
    storedExecution = buildShipmentExecution();
    prismaMock.shipmentExecution.create.mockImplementation(async ({ data }) => {
      storedExecution = buildShipmentExecution({
        ...data,
        createdAt: new Date('2026-05-15T10:00:00.000Z'),
        updatedAt: new Date('2026-05-15T10:00:00.000Z'),
      });
      return storedExecution;
    });
    prismaMock.shipmentExecution.update.mockImplementation(async ({ data }) => {
      storedExecution = buildShipmentExecution({
        ...storedExecution,
        ...data,
        updatedAt: new Date('2026-05-15T10:05:00.000Z'),
      });
      return storedExecution;
    });
    prismaMock.shipmentShippingCost.findFirst.mockResolvedValue(null);
    prismaMock.shipmentShippingCost.upsert.mockImplementation(async ({ create, update }) => ({
      ...create,
      ...update,
    }));
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
  });

  it('creates a shipment execution and links confirmed provider cost to finance shipping cost input', async () => {
    const adapter = buildAdapter();
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'hpj-1027',
      trackingNumber: 'TRK1027',
      trackingUrl: 'https://tracking.example/TRK1027',
      labelUrl: 'https://labels.example/TRK1027.pdf',
      shipmentStatus: 'created',
      shippingCost: 120,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true, bodyKeys: ['shipmentId', 'trackingNumber'] },
    });

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env,
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result).toMatchObject({
      allocationId: 'alloc-1',
      vendorId: 'sporjinal',
      provider: 'hepsijet',
      providerShipmentId: 'hpj-1027',
      trackingNumber: 'TRK1027',
      shipmentStatus: 'created',
      desi: '3.00',
      shippingCost: '120.00',
      shippingVat: '21.60',
      shippingCostLinked: true,
    });
    expect(prismaMock.vendorAllocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          carrier: 'hepsijet',
          shippingStatus: 'label_created',
          trackingNumber: 'TRK1027',
        }),
      }),
    );
    expect(prismaMock.shipmentShippingCost.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          vendorId: 'sporjinal',
          allocationId: 'alloc-1',
          providerName: 'hepsijet',
          providerReference: 'hpj-1027',
          shippingCost: 120,
          shippingVatAmount: 21.6,
          status: 'CONFIRMED',
          sourceType: 'EXTERNAL_PROVIDER',
        }),
      }),
    );
  });

  it('uses vendor-specific shipping config and default desi when product heuristics do not match', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'HEPSIJET',
      shippingEnabled: true,
      defaultDesi: 5,
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(
      buildAllocation({
        lineItems: [
          {
            quantity: 1,
            lineAmount: 999,
            shopifyOrderLineItem: {
              title: 'Gift card',
              sku: 'GIFT-1',
            },
          },
        ],
      }),
    );
    const adapter = buildAdapter();
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: null,
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'pending',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true, dryRun: true },
    });

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env,
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result).toMatchObject({
      provider: 'hepsijet',
      shipmentStatus: 'pending',
      desi: '5.00',
    });
    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'hepsijet',
        requestSnapshot: expect.objectContaining({
          desi: 5,
        }),
      }),
    );
  });

  it('uses Sporjinal Kargo Entegratör warehouse 1774 and cargo integration 2547', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'ke-1027',
      trackingNumber: 'KE1027',
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true, bodyKeys: ['id'] },
    });

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env,
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result).toMatchObject({
      provider: 'kargo_entegrator',
      cargoIntegrationId: '2547',
      warehouseId: '1774',
      providerShipmentId: 'ke-1027',
    });
    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'kargo_entegrator',
        requestSnapshot: expect.objectContaining({
          cargo_integration_id: 2547,
          warehouse_id: 1774,
          platform_id: '7616544244049',
          platform_d_id: '1027',
          payment_type: 'cash_money',
          payor_type: 'sender',
          kg: 3,
        }),
      }),
    );
  });

  it('uses Kargo cargo integration env fallback only when vendor config has no cargo integration id', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: null,
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'ke-1027',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true, bodyKeys: ['id'] },
    });

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env: {
          ...env,
          KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID: '2547',
          KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID_SOURCE: 'primary',
        },
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result).toMatchObject({
      provider: 'kargo_entegrator',
      cargoIntegrationId: '2547',
      warehouseId: '1774',
    });
    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSnapshot: expect.objectContaining({
          cargo_integration_id: 2547,
          platform_id: '7616544244049',
          platform_d_id: '1027',
          payment_type: 'cash_money',
          payor_type: 'sender',
          warehouse_id: 1774,
        }),
      }),
    );
  });

  it('blocks Kargo Entegratör shipment creation when warehouse config is missing', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: null,
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });

    await expect(
      createShipmentExecution(
        {
          allocationId: 'alloc-1',
        },
        {
          env,
          vendorId: 'sporjinal',
          adapter,
        },
      ),
    ).rejects.toThrow('Vendor shipping warehouse is not configured.');
    expect(adapter.createShipment).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
  });

  it('applies deterministic initial desi heuristics for shoes, bags, and apparel', () => {
    expect(inferShipmentDesi([{ title: 'Running shoes', sku: null }], 8)).toBe(3);
    expect(inferShipmentDesi([{ title: 'Leather bag', sku: null }], 8)).toBe(3);
    expect(inferShipmentDesi([{ title: 'Cotton apparel set', sku: null }], 8)).toBe(3);
    expect(inferShipmentDesi([{ title: 'Gift card', sku: 'GIFT-1' }], 8)).toBe(8);
  });

  it('returns the existing shipment execution without creating a duplicate', async () => {
    const existing = buildShipmentExecution({
      providerShipmentId: 'hpj-existing',
      trackingNumber: 'TRK-EXISTING',
      shipmentStatus: 'CREATED',
    });
    prismaMock.shipmentExecution.findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);
    prismaMock.shipmentShippingCost.findFirst.mockResolvedValueOnce({
      id: 'shipcost-existing',
    });
    const adapter = buildAdapter();

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env,
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result).toMatchObject({
      id: 'shipment-hepsijet-alloc-1',
      trackingNumber: 'TRK-EXISTING',
      shippingCostLinked: true,
    });
    expect(adapter.createShipment).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
  });

  it('does not call the provider again when an existing pending dry-run shipment is present', async () => {
    const existing = buildShipmentExecution({
      provider: 'KARGO_ENTEGRATOR',
      id: 'shipment-kargo_entegrator-alloc-1',
      shipmentStatus: 'PENDING',
      responseSnapshot: {
        ok: true,
        dryRun: true,
        provider: 'kargo_entegrator',
        reason: 'Kargo Entegratör shipment execution is disabled.',
        disabledGates: ['SHIPPING_EXECUTION_ENABLED'],
      },
    });
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValueOnce({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-kargo-1774',
          vendorId: 'sporjinal',
          configId: 'config-sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });
    prismaMock.shipmentExecution.findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'kargo_entegrator',
          SHIPPING_EXECUTION_ENABLED: true,
          KARGO_ENTEGRATOR_ENABLED: true,
        },
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result).toMatchObject({
      id: 'shipment-kargo_entegrator-alloc-1',
      shipmentStatus: 'pending',
      providerShipmentId: null,
    });
    expect(adapter.createShipment).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
  });

  it('retries an existing pending dry-run shipment once when current Kargo gates are enabled', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      shipmentStatus: 'PENDING',
      responseSnapshot: {
        ok: true,
        dryRun: true,
        provider: 'kargo_entegrator',
        reason: 'Kargo Entegratör shipment execution is disabled.',
        disabledGates: ['SHIPPING_EXECUTION_ENABLED'],
      },
    });
    storedExecution = existing;
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'ke-retry-1027',
      trackingNumber: 'KE-RETRY-1027',
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true, bodyKeys: ['id', 'trackingNumber'] },
    });

    const result = await retryDryRunShipmentExecution(existing.id, {
      env: {
        ...env,
        SHIPPING_PROVIDER: 'kargo_entegrator',
        SHIPPING_EXECUTION_ENABLED: true,
        KARGO_ENTEGRATOR_ENABLED: true,
      },
      actorRole: 'admin',
      notificationUrl: 'https://backend.example/webhooks/shipping/kargo-entegrator',
      adapter,
    });

    expect(result).toMatchObject({
      provider: 'kargo_entegrator',
      shipmentStatus: 'created',
      providerShipmentId: 'ke-retry-1027',
      trackingNumber: 'KE-RETRY-1027',
    });
    expect(adapter.createShipment).toHaveBeenCalledTimes(1);
    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'kargo_entegrator',
        requestSnapshot: expect.objectContaining({
          cargo_integration_id: 2547,
          warehouse_id: 1774,
          notification_url: 'https://backend.example/webhooks/shipping/kargo-entegrator',
        }),
      }),
    );
  });

  it('blocks dry-run retry when current Kargo gates are disabled', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      shipmentStatus: 'PENDING',
      responseSnapshot: {
        dryRun: true,
        disabledGates: ['SHIPPING_EXECUTION_ENABLED'],
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });

    await expect(
      retryDryRunShipmentExecution(existing.id, {
        env: {
          ...env,
          SHIPPING_PROVIDER: 'kargo_entegrator',
          SHIPPING_EXECUTION_ENABLED: false,
          KARGO_ENTEGRATOR_ENABLED: true,
        },
        actorRole: 'admin',
        adapter,
      }),
    ).rejects.toThrow('Shipping provider execution is not ready. Missing: SHIPPING_EXECUTION_ENABLED.');
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('does not retry shipment executions that already have provider identifiers', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      shipmentStatus: 'PENDING',
      providerShipmentId: 'ke-existing',
      responseSnapshot: {
        dryRun: true,
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });

    await expect(
      retryDryRunShipmentExecution(existing.id, {
        env,
        actorRole: 'admin',
        adapter,
      }),
    ).rejects.toThrow('provider shipment id');
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('does not retry shipment executions that already have tracking', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      shipmentStatus: 'PENDING',
      trackingNumber: 'KE-TRACKING',
      responseSnapshot: {
        dryRun: true,
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });

    await expect(
      retryDryRunShipmentExecution(existing.id, {
        env,
        actorRole: 'admin',
        adapter,
      }),
    ).rejects.toThrow('tracking');
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('blocks vendor users from dry-run shipment retry', async () => {
    await expect(
      retryDryRunShipmentExecution('shipment-kargo_entegrator-alloc-1', {
        env,
        actorRole: 'vendor',
      }),
    ).rejects.toThrow('Admin access required.');
    expect(prismaMock.shipmentExecution.findUnique).not.toHaveBeenCalled();
  });

  it('retries failed shipment executions without creating duplicates', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      shipmentStatus: 'FAILED',
      responseSnapshot: {
        timeline: [{ label: 'Provider validation failed', at: '2026-05-15T10:00:00.000Z', status: '422' }],
      },
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingDistrict: 'Kadikoy',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'ke-recovered-1027',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true, bodyKeys: ['data'] },
    });

    const result = await retryFailedShipmentExecution(existing.id, {
      env: {
        ...env,
        SHIPPING_PROVIDER: 'kargo_entegrator',
        SHIPPING_SANDBOX_MODE: true,
      },
      vendorId: 'sporjinal',
      notificationUrl: 'https://backend.example/webhooks/shipping/kargo-entegrator',
      adapter,
    });

    expect(result).toMatchObject({
      shipmentStatus: 'created',
      providerShipmentId: 'ke-recovered-1027',
    });
    expect(adapter.createShipment).toHaveBeenCalledTimes(1);
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: existing.id },
        data: expect.objectContaining({
          shipmentStatus: 'PENDING',
          responseSnapshot: expect.objectContaining({
            timeline: expect.arrayContaining([
              expect.objectContaining({
                label: 'Retry attempted',
                status: 'pending',
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it('blocks failed shipment recovery when provider identifiers already exist', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      shipmentStatus: 'FAILED',
      providerShipmentId: 'ke-existing',
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });

    await expect(
      retryFailedShipmentExecution(existing.id, {
        env,
        vendorId: 'sporjinal',
        adapter,
      }),
    ).rejects.toThrow('provider shipment id');
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('retries failed shipment executions in sandbox without forcing Dummy Kargo payloads', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      shipmentStatus: 'FAILED',
    });
    prismaMock.shipmentExecution.findUnique.mockResolvedValue(existing);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingDistrict: null,
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'ke-recovered-1027',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true },
    });

    await retryFailedShipmentExecution(existing.id, {
      env: {
        ...env,
        SHIPPING_PROVIDER: 'kargo_entegrator',
        SHIPPING_SANDBOX_MODE: true,
      },
      vendorId: 'sporjinal',
      customerOverrides: {
        district: 'Kadikoy',
      },
      adapter,
    });

    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSnapshot: expect.objectContaining({
          customer: expect.objectContaining({
            name: 'Test',
            surname: 'Customer',
            email: 'customer@example.com',
            phone: '905551112233',
          }),
          package_type: 'box',
          payment_type: 'cash_money',
          payor_type: 'sender',
          kg: 3,
        }),
      }),
    );
    const requestSnapshot = adapter.createShipment.mock.calls[0][0].requestSnapshot;
    expect(requestSnapshot).not.toHaveProperty('cargo_company');
  });

  it('preserves vendor isolation when creating shipments', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce(
      buildAllocation({
        assignedVendorId: 'other-vendor',
      }),
    );
    const adapter = buildAdapter();

    await expect(
      createShipmentExecution(
        {
          allocationId: 'alloc-1',
        },
        {
          env,
          vendorId: 'sporjinal',
          adapter,
        },
      ),
    ).rejects.toThrow('Allocation could not be found for the selected vendor.');
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
    expect(adapter.createShipment).not.toHaveBeenCalled();
  });

  it('marks provider failures safely without leaking provider internals', async () => {
    const adapter = buildAdapter();
    adapter.createShipment.mockRejectedValue(new Error('Hepsijet shipment execution failed with HTTP 500.'));

    const result = await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env,
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(result.shipmentStatus).toBe('failed');
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipmentStatus: 'FAILED',
          responseSnapshot: expect.objectContaining({
            error: 'Hepsijet shipment execution failed with HTTP 500.',
          }),
        }),
      }),
    );
  });

  it('records safe provider validation diagnostics and timeline events for shipment failures', async () => {
    const adapter = buildAdapter();
    adapter.createShipment.mockRejectedValue(
      new ShippingProviderExecutionError('Kargo Entegratör shipment execution failed with HTTP 422.', {
        status: 422,
        ok: false,
        contentType: 'application/json',
        parsedBodyType: 'object',
        bodyKeys: ['errors', 'message'],
        provider: 'kargo_entegrator',
        providerError: 'Validation failed.',
        providerValidationErrors: ['customer.district is required', 'warehouse_id is invalid'],
        requestId: 'ke-req-1',
        providerShipmentIdPresent: false,
        barcode: null,
        notificationUrlIncluded: true,
      }),
    );

    await createShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        env,
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipmentStatus: 'FAILED',
          responseSnapshot: expect.objectContaining({
            status: 422,
            providerError: 'Validation failed.',
            providerValidationErrors: ['customer.district is required', 'warehouse_id is invalid'],
            requestId: 'ke-req-1',
            notificationUrlIncluded: true,
            error: 'Kargo Entegratör shipment execution failed with HTTP 422.',
            timeline: expect.arrayContaining([
              expect.objectContaining({
                label: 'Provider validation failed',
                status: '422',
              }),
            ]),
          }),
        }),
      }),
    );
    expect(JSON.stringify(prismaMock.shipmentExecution.update.mock.calls)).not.toContain('test-kargo-key');
    expect(JSON.stringify(prismaMock.shipmentExecution.update.mock.calls)).not.toContain('Authorization');
  });

  it('diagnoses the global shipping execution gate separately from the Kargo provider gate', () => {
    const diagnostics = getShippingProviderGateDiagnostics({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: false,
      KARGO_ENTEGRATOR_ENABLED: true,
      KARGO_ENTEGRATOR_BASE_URL: 'https://app.kargoentegrator.com/api',
      KARGO_ENTEGRATOR_API_KEY: 'configured',
    });

    expect(diagnostics).toMatchObject({
      provider: 'kargo_entegrator',
      executionReady: false,
      shippingExecutionEnabled: false,
      providerSelected: true,
      providerEnabled: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      webhookRouteImplemented: true,
      packageTypeUsed: 'box',
      receiverAddressAvailability: 'confirmed_required',
      dummyKargoSupport: 'not_implemented',
      statusSyncSupport: 'not_implemented',
      missing: ['SHIPPING_EXECUTION_ENABLED'],
      deprecatedEnvFallbacks: [],
    });
  });

  it('reports vendor Kargo readiness booleans without exposing secrets or raw config values', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });

    const diagnostics = await getShippingProviderReadinessDiagnostics(
      {
        ...env,
        SHIPPING_PROVIDER: 'kargo_entegrator',
        SHIPPING_EXECUTION_ENABLED: true,
        KARGO_ENTEGRATOR_ENABLED: true,
        KARGO_ENTEGRATOR_BASE_URL: 'https://app.kargoentegrator.com/api',
        KARGO_ENTEGRATOR_API_KEY: 'configured-secret',
      },
      'kargo_entegrator',
      'sporjinal',
    );

    expect(diagnostics).toMatchObject({
      provider: 'kargo_entegrator',
      executionReady: true,
      sandboxModeEnabled: false,
      shippingExecutionEnabled: true,
      providerSelected: true,
      providerEnabled: true,
      webhookIngestEnabled: false,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      cargoIntegrationIdConfigured: true,
      warehouseIdConfigured: true,
      defaultDesiConfigured: true,
      packageTypeUsed: 'box',
      notificationUrlConfigured: false,
      webhookRouteImplemented: true,
      receiverAddressAvailability: 'confirmed_required',
      dummyKargoSupport: 'not_implemented',
      statusSyncSupport: 'not_implemented',
      missing: [],
    });
    expect(diagnostics.warnings).toEqual(
      expect.arrayContaining([
        'Kargo Entegratör webhook/status sync is not implemented.',
        'Live carrier execution is not enabled or verified.',
      ]),
    );
    expect(diagnostics.warnings).not.toEqual(expect.arrayContaining([
      'Kargo Entegratör create contract is not verified.',
      'Receiver address and phone requirements are unknown.',
    ]));
    expect(JSON.stringify(diagnostics)).not.toContain('configured-secret');
    expect(JSON.stringify(diagnostics)).not.toContain('2547');
    expect(JSON.stringify(diagnostics)).not.toContain('1774');
  });

  it('adds current Kargo readiness warnings to shipment previews without changing the payload', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        notificationUrl: 'https://backend.example/webhooks/shipping/kargo-entegrator',
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(preview.payload).toMatchObject({
      cargo_integration_id: 2547,
      warehouse_id: 1774,
      package_type: 'box',
      notification_url: 'https://backend.example/webhooks/shipping/kargo-entegrator',
    });
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        'Kargo Entegratör webhook/status sync is not implemented.',
        'Live carrier execution is not enabled or verified.',
      ]),
    );
    expect(preview.warnings).not.toEqual(expect.arrayContaining([
      'Kargo Entegratör create contract is not verified.',
      'Receiver address and phone requirements are unknown.',
    ]));
  });

  it('builds documented Dummy Kargo sandbox payload when required customer address fields exist', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: ' +90 555 111 22 33 ',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingDistrict: 'Kadikoy',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        carrierId: 'dummy',
        notificationUrl: 'https://backend.example/webhooks/shipping/kargo-entegrator',
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(preview.payload).toMatchObject({
      cargo_integration_id: 2547,
      warehouse_id: 1774,
      cargo_company: { id: 'dummy' },
      customer: {
        name: 'Test',
        surname: 'Customer',
        phone: '905551112233',
        email: 'customer@example.com',
        country: 'TR',
        postcode: '34000',
        city: 'Istanbul',
        district: 'Kadikoy',
        address: 'Test Mahallesi 1. Sokak No: 1',
      },
      payment_type: 'cash_money',
      package_type: 'box',
      payor_type: 'sender',
      desi: 3,
      kg: 3,
      note: '',
      platform_id: '7616544244049',
      platform_d_id: '1027',
      notification_url: 'https://backend.example/webhooks/shipping/kargo-entegrator',
    });
    expect(preview.customerFieldsValid).toBe(true);
  });

  it('keeps real Kargo provider payload when sandbox mode is enabled without explicit dummy carrier', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingDistrict: 'Kadikoy',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });
    adapter.createShipment.mockResolvedValue({
      providerShipmentId: 'ke-live-1027',
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'created',
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: { ok: true },
    });

    await createShipmentExecution(
      {
        allocationId: 'alloc-1',
        provider: 'kargo_entegrator',
      },
      {
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
        vendorId: 'sporjinal',
        adapter,
      },
    );

    expect(adapter.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'kargo_entegrator',
        requestSnapshot: expect.objectContaining({
          package_type: 'box',
          customer: expect.objectContaining({
            name: 'Test',
            surname: 'Customer',
            email: 'customer@example.com',
            phone: '905551112233',
          }),
          payment_type: 'cash_money',
          payor_type: 'sender',
          kg: 3,
          platform_id: '7616544244049',
          platform_d_id: '1027',
        }),
      }),
    );
    const requestSnapshot = adapter.createShipment.mock.calls[0]?.[0]?.requestSnapshot;
    expect(requestSnapshot).not.toHaveProperty('cargo_company');
  });

  it('blocks invalid Kargo package_type before calling the provider', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingDistrict: 'Kadikoy',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: {
        packageType: 'package',
      },
    });
    const adapter = buildAdapter({
      provider: 'KARGO_ENTEGRATOR' as const,
    });

    await expect(
      createShipmentExecution(
        {
          allocationId: 'alloc-1',
          carrierId: 'dummy',
        },
        {
          env: {
            ...env,
            SHIPPING_PROVIDER: 'kargo_entegrator',
            SHIPPING_SANDBOX_MODE: true,
          },
          vendorId: 'sporjinal',
          adapter,
        },
      ),
    ).rejects.toThrow('Invalid Kargo package_type. Allowed values: box, document.');
    expect(adapter.createShipment).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
    expect(prismaMock.fulfillment.upsert).not.toHaveBeenCalled();
  });

  it('uses province as Kargo district when Shopify district is unavailable', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+905551112233',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        province: 'Kadikoy',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        carrierId: 'dummy',
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(preview.payload).toMatchObject({
      customer: {
        district: 'Kadikoy',
      },
    });
    expect(preview.customerFieldsValid).toBe(true);
  });

  it('uses stored Shopify order webhook shipping address when order columns are still empty', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        webhookEvents: [
          {
            rawPayload: JSON.stringify({
              id: 1028,
              shipping_address: {
                phone: '+90 555 111 22 33',
                country_code: 'TR',
                zip: '34000',
                city: 'Istanbul',
                district: 'Kadikoy',
                address1: 'Test Mahallesi 1. Sokak No: 1',
              },
            }),
          },
        ],
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        carrierId: 'dummy',
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(preview.payload).toMatchObject({
      customer: {
        phone: '905551112233',
        country: 'TR',
        postcode: '34000',
        city: 'Istanbul',
        district: 'Kadikoy',
        address: 'Test Mahallesi 1. Sokak No: 1',
      },
    });
    expect(preview.customerFieldsValid).toBe(true);
  });

  it('falls back to stored Shopify billing phone when shipping phone is unavailable', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingDistrict: 'Kadikoy',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
        webhookEvents: [
          {
            rawPayload: JSON.stringify({
              id: 1028,
              shipping_address: {
                country_code: 'TR',
                zip: '34000',
                city: 'Istanbul',
                district: 'Kadikoy',
                address1: 'Test Mahallesi 1. Sokak No: 1',
              },
              billing_address: {
                phone: '0555 111 22 33',
              },
            }),
          },
        ],
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        carrierId: 'dummy',
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(preview.payload).toMatchObject({
      customer: {
        phone: '905551112233',
      },
    });
    expect(preview.customerFieldsValid).toBe(true);
  });

  it('logs missing Kargo required payload fields before provider execution', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });

    await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(warnSpy).toHaveBeenCalledWith(
      '[shipping:kargo:missing-required-payload-fields]',
      expect.objectContaining({
        provider: 'kargo_entegrator',
        missingFields: expect.arrayContaining(['customer.phone']),
        requestBlocked: false,
      }),
    );
    warnSpy.mockRestore();
  });

  it('blocks Dummy Kargo creation outside sandbox mode', async () => {
    await expect(
      previewShipmentExecution(
        {
          allocationId: 'alloc-1',
          carrierId: 'dummy',
        },
        {
          vendorId: 'sporjinal',
          env,
        },
      ),
    ).rejects.toThrow('Dummy Kargo shipment creation is available only when shipping sandbox mode is enabled.');
  });

  it('blocks Dummy Kargo shipment create when required receiver fields are missing', async () => {
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          configId: 'shipping-config-sporjinal',
          vendorId: 'sporjinal',
          provider: 'KARGO_ENTEGRATOR',
          warehouseId: '1774',
          name: 'Sporjinal default warehouse',
          address: null,
          isDefault: true,
          metadata: null,
          createdAt: new Date('2026-05-15T10:00:00.000Z'),
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
      ],
      providerMetadata: null,
    });

    await expect(
      createShipmentExecution(
        {
          allocationId: 'alloc-1',
          carrierId: 'dummy',
        },
        {
          vendorId: 'sporjinal',
          env: {
            ...env,
            SHIPPING_SANDBOX_MODE: true,
            SHIPPING_PROVIDER: 'kargo_entegrator',
          },
        },
      ),
    ).rejects.toThrow(/Missing required shipment fields:[\s\S]*customer\.phone[\s\S]*Provider request blocked before create call/);
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
  });

  it('blocks Dummy Kargo shipment create when only district is missing', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({
      order: {
        id: 'order-1',
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        customerPhone: '+905551112233',
        shippingCountry: 'TR',
        shippingPostcode: '34000',
        shippingCity: 'Istanbul',
        shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
      },
    }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });

    await expect(
      createShipmentExecution(
        {
          allocationId: 'alloc-1',
          carrierId: 'dummy',
        },
        {
          vendorId: 'sporjinal',
          env: {
            ...env,
            SHIPPING_SANDBOX_MODE: true,
            SHIPPING_PROVIDER: 'kargo_entegrator',
          },
        },
      ),
    ).rejects.toThrow(/Missing required shipment fields:[\s\S]*customer\.district/);
    expect(prismaMock.shipmentExecution.create).not.toHaveBeenCalled();
  });

  it('applies shipment-only customer overrides without mutating Shopify order data', async () => {
    const order = {
      id: 'order-1',
      customerName: 'Test Customer',
      customerEmail: 'customer@example.com',
      customerPhone: '+905551112233',
      shippingCountry: 'TR',
      shippingPostcode: '34000',
      shippingCity: 'Istanbul',
      shippingAddress: 'Test Mahallesi 1. Sokak No: 1',
    };
    prismaMock.vendorAllocation.findUnique.mockResolvedValue(buildAllocation({ order }));
    prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'KARGO_ENTEGRATOR',
      shippingEnabled: true,
      defaultDesi: 3,
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: 18,
      warehouses: [],
      providerMetadata: null,
    });

    const preview = await previewShipmentExecution(
      {
        allocationId: 'alloc-1',
        carrierId: 'dummy',
        customerOverrides: {
          district: 'Kadikoy',
        },
      },
      {
        vendorId: 'sporjinal',
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          SHIPPING_PROVIDER: 'kargo_entegrator',
        },
      },
    );

    expect(preview.payload).toMatchObject({
      customer: {
        district: 'Kadikoy',
      },
    });
    expect(order).not.toHaveProperty('shippingDistrict');
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(preview.customerFieldsValid).toBe(true);
  });

  it('registers a Kargo webhook placeholder that returns 501 without mutating shipment data', async () => {
    const posts = new Map<string, (request: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn((path: string, ...args: unknown[]) => {
        const handler = args.at(-1) as (request: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown;
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerShippingExecutionRoutes(app as never, env);
    const result = await posts.get('/webhooks/shipping/kargo-entegrator')?.({}, reply);

    expect(result).toEqual({
      status: 501,
      body: {
        message: 'Kargo Entegratör webhook ingestion is not implemented yet.',
      },
    });
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('ingests Dummy Kargo sandbox webhook updates into shipment execution only', async () => {
    const existing = buildShipmentExecution({
      id: 'shipment-kargo_entegrator-alloc-1',
      provider: 'KARGO_ENTEGRATOR',
      providerShipmentId: 'ke-dummy-1',
      responseSnapshot: {
        ok: true,
        dummyCarrierDetected: true,
        timeline: [{ label: 'Shipment created', at: '2026-05-15T10:00:00.000Z', status: 'created' }],
      },
    });
    prismaMock.shipmentExecution.findFirst.mockResolvedValue(existing);
    storedExecution = existing;

    const result = await ingestKargoEntegratorWebhook(
      {
        data: {
          id: 'ke-dummy-1',
          status: 'created',
          tracking_number: 'DUMMY-TRACK-1',
          barcode: 'DUMMY-BARCODE-1',
        },
      },
      {
        env: {
          ...env,
          SHIPPING_SANDBOX_MODE: true,
          KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: true,
        },
      },
    );

    expect(result).toEqual({
      ok: true,
      shipmentExecutionId: 'shipment-kargo_entegrator-alloc-1',
      shipmentStatus: 'created',
    });
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shipment-kargo_entegrator-alloc-1' },
        data: expect.objectContaining({
          trackingNumber: 'DUMMY-TRACK-1',
          shipmentStatus: 'CREATED',
          responseSnapshot: expect.objectContaining({
            webhookReceived: true,
            dummyCarrierDetected: true,
            providerStatus: 'created',
            barcode: 'DUMMY-BARCODE-1',
            timeline: expect.arrayContaining([
              expect.objectContaining({ label: 'Tracking assigned', status: 'created' }),
            ]),
          }),
        }),
      }),
    );
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.fulfillment.upsert).not.toHaveBeenCalled();
  });

  it('diagnoses deprecated Kargo cargo integration env fallback without exposing values', () => {
    const diagnostics = getShippingProviderGateDiagnostics({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: true,
      KARGO_ENTEGRATOR_ENABLED: true,
      KARGO_ENTEGRATOR_BASE_URL: 'https://app.kargoentegrator.com/api',
      KARGO_ENTEGRATOR_API_KEY: 'configured',
      KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID: '2547',
      KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID_SOURCE: 'deprecated',
    });

    expect(diagnostics.deprecatedEnvFallbacks).toEqual(['ARGO_ENTEGRATOR_CARGO_INTEGRATION_ID']);
    expect(JSON.stringify(diagnostics)).not.toContain('2547');
  });

  it('marks Kargo execution ready only when all safe gates and config are present', () => {
    const diagnostics = getShippingProviderGateDiagnostics({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: true,
      KARGO_ENTEGRATOR_ENABLED: true,
      KARGO_ENTEGRATOR_BASE_URL: 'https://app.kargoentegrator.com/api',
      KARGO_ENTEGRATOR_API_KEY: 'configured',
    });

    expect(diagnostics).toMatchObject({
      provider: 'kargo_entegrator',
      executionReady: true,
      shippingExecutionEnabled: true,
      providerEnabled: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      missing: [],
      deprecatedEnvFallbacks: [],
    });
  });

  it('sends Kargo requests with documented bearer and JSON headers and parses data object responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockProviderResponse(
        JSON.stringify({
          data: {
            id: 'ke-live-1028',
            tracking_number: null,
            status: 'created',
            shipping_cost: 88,
            currency: 'TRY',
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new KargoEntegratorAdapter({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: true,
      KARGO_ENTEGRATOR_ENABLED: true,
      KARGO_ENTEGRATOR_BASE_URL: 'https://app.kargoentegrator.com/api/',
      KARGO_ENTEGRATOR_API_KEY: 'test-kargo-key',
    });
    const result = await adapter.createShipment({
      allocationId: 'alloc-1',
      vendorId: 'sporjinal',
      provider: 'kargo_entegrator',
      requestSnapshot: {
        platform_id: 2547,
        platform_d_id: 1774,
      },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.kargoentegrator.com/api/shipments',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-kargo-key',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      platform_id: 2547,
      platform_d_id: 1774,
    });
    expect(result).toMatchObject({
      providerShipmentId: 'ke-live-1028',
      trackingNumber: null,
      shipmentStatus: 'created',
      shippingCost: 88,
      currency: 'TRY',
    });
    expect(result.responseSnapshot).toMatchObject({
      authHeaderMode: 'bearer',
      acceptHeader: 'application/json',
      detectedResponseFormat: 'json:data_object',
      bodyKeys: expect.arrayContaining(['id', 'tracking_number']),
    });
    expect(JSON.stringify(result.responseSnapshot)).not.toContain('test-kargo-key');
  });

  it('parses Kargo data array responses and maps provider shipment id from the first row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockProviderResponse(
        JSON.stringify({
          data: [
            {
              id: 'ke-array-1028',
              tracking_number: 'TRACK-1028',
              tracking_url: 'https://track.example/TRACK-1028',
            },
          ],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new KargoEntegratorAdapter({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: true,
      KARGO_ENTEGRATOR_ENABLED: true,
    });
    const result = await adapter.createShipment({
      allocationId: 'alloc-1',
      vendorId: 'sporjinal',
      provider: 'kargo_entegrator',
      requestSnapshot: {
        platform_id: 2547,
      },
    });

    expect(result).toMatchObject({
      providerShipmentId: 'ke-array-1028',
      trackingNumber: 'TRACK-1028',
      trackingUrl: 'https://track.example/TRACK-1028',
    });
    expect(result.responseSnapshot).toMatchObject({
      detectedResponseFormat: 'json:data_array',
      bodyKeys: expect.arrayContaining(['id', 'tracking_number']),
    });
  });

  it('treats HTML Kargo responses as invalid provider contract responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockProviderResponse('<html><body>Login</body></html>', {
        contentType: 'text/html; charset=utf-8',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new KargoEntegratorAdapter({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: true,
      KARGO_ENTEGRATOR_ENABLED: true,
      KARGO_ENTEGRATOR_API_KEY: 'test-kargo-key',
    });

    await expect(
      adapter.createShipment({
        allocationId: 'alloc-1',
        vendorId: 'sporjinal',
        provider: 'kargo_entegrator',
        requestSnapshot: {
          platform_id: 2547,
        },
      }),
    ).rejects.toMatchObject({
      message: 'Kargo Entegratör returned an invalid provider response format.',
      responseSnapshot: expect.objectContaining({
        status: 200,
        ok: true,
        contentType: 'text/html; charset=utf-8',
        detectedResponseFormat: 'html',
        authHeaderMode: 'bearer',
        responseSnippet: '<html><body>Login</body></html>',
        providerError: 'Provider returned HTML instead of JSON. Check endpoint and Bearer authentication.',
      }),
    });
  });

  it('parses safe Kargo provider validation failures without exposing secrets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockProviderResponse(
        JSON.stringify({
          message: 'Validation failed.',
          errors: {
            'customer.district': ['The district field is required.'],
            token: 'should-not-render',
          },
          request_id: 'ke-req-422',
        }),
        {
          status: 422,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new KargoEntegratorAdapter({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: true,
      KARGO_ENTEGRATOR_ENABLED: true,
      KARGO_ENTEGRATOR_API_KEY: 'test-kargo-key',
    });

    await expect(
      adapter.createShipment({
        allocationId: 'alloc-1',
        vendorId: 'sporjinal',
        provider: 'kargo_entegrator',
        requestSnapshot: {
          platform_id: 2547,
          notification_url: 'https://backend.example/webhooks/shipping/kargo-entegrator',
          customer: {
            phone: '+905551112233',
          },
        },
      }),
    ).rejects.toMatchObject({
      message: 'Kargo Entegratör shipment execution failed with HTTP 422.',
      responseSnapshot: expect.objectContaining({
        status: 422,
        ok: false,
        providerError: 'Validation failed.',
        providerValidationErrors: ['The district field is required.'],
        requestId: 'ke-req-422',
        notificationUrlIncluded: true,
        bodyKeys: expect.arrayContaining(['errors', 'message', 'request_id']),
      }),
    });

    const error = await adapter
      .createShipment({
        allocationId: 'alloc-1',
        vendorId: 'sporjinal',
        provider: 'kargo_entegrator',
        requestSnapshot: {
          platform_id: 2547,
        },
      })
      .catch((caught) => caught as ShippingProviderExecutionError);
    expect(JSON.stringify(error.responseSnapshot)).not.toContain('test-kargo-key');
    expect(JSON.stringify(error.responseSnapshot)).not.toContain('should-not-render');
    expect(JSON.stringify(error.responseSnapshot)).not.toContain('+905551112233');
  });

  it('parses Kargo package_type validation failures clearly', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockProviderResponse(
        JSON.stringify({
          message: 'Seçilen paket tipi geçersiz.',
          errors: {
            package_type: ['Seçilen paket tipi geçersiz.'],
          },
        }),
        {
          status: 422,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new KargoEntegratorAdapter({
      ...env,
      SHIPPING_PROVIDER: 'kargo_entegrator',
      SHIPPING_EXECUTION_ENABLED: true,
      KARGO_ENTEGRATOR_ENABLED: true,
      KARGO_ENTEGRATOR_API_KEY: 'test-kargo-key',
    });

    await expect(
      adapter.createShipment({
        allocationId: 'alloc-1',
        vendorId: 'sporjinal',
        provider: 'kargo_entegrator',
        requestSnapshot: {
          package_type: 'package',
        },
      }),
    ).rejects.toMatchObject({
      message: 'Kargo Entegratör shipment execution failed with HTTP 422.',
      responseSnapshot: expect.objectContaining({
        status: 422,
        ok: false,
        providerError: 'Seçilen paket tipi geçersiz.',
        providerValidationErrors: ['Seçilen paket tipi geçersiz.'],
        bodyKeys: expect.arrayContaining(['errors', 'message']),
      }),
    });
  });
});
