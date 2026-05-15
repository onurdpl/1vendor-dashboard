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

const { createShipmentExecution, getShippingProviderGateDiagnostics, inferShipmentDesi } = await import(
  '../backend/src/modules/shipping/shipping-execution.service.js'
);

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
  SHIPPING_PROVIDER: 'hepsijet' as const,
  KARGO_ENTEGRATOR_ENABLED: true,
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

describe('shipping execution foundation', () => {
  let storedExecution: ReturnType<typeof buildShipmentExecution>;

  beforeEach(() => {
    prismaMock.vendorAllocation.findUnique.mockReset();
    prismaMock.vendorAllocation.update.mockReset();
    prismaMock.vendorShippingConfig.findUnique.mockReset();
    prismaMock.vendorShippingConfig.upsert.mockReset();
    prismaMock.shipmentExecution.findUnique.mockReset();
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
          platform_id: 2547,
          platform_d_id: 1774,
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
      providerEnabled: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      missing: ['SHIPPING_EXECUTION_ENABLED'],
    });
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
    });
  });
});
