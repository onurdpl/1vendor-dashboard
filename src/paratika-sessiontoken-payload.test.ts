import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  shopifyOrder: {
    findFirst: vi.fn(),
  },
  vendor: {
    findUnique: vi.fn(),
  },
  vendorPaymentProviderSeller: {
    findUnique: vi.fn(),
  },
  vendorFinancialProfile: {
    findFirst: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { buildParatikaSessionTokenPayloadPreviewForOrder } = await import(
  '../backend/src/modules/paratika/paratika-sessiontoken-payload.service.js'
);

const rawOrderPayload = JSON.stringify({
  browser_ip: '203.0.113.10',
  client_details: {
    user_agent: 'Mozilla/5.0 Paratika Preview Test',
  },
});

function buildOrderFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shopify-order-db-1',
    sourceShopifyOrderId: 'order-100',
    sourceShopifyOrderNumber: '#1100',
    customerName: 'Test Customer',
    customerEmail: 'customer@example.test',
    customerPhone: '+905551112233',
    billingFullName: 'Test Customer',
    billingCompany: null,
    billingPhone: '+905551112233',
    billingCity: 'Istanbul',
    billingDistrict: 'Kadikoy',
    billingAddress1: 'Billing address 1',
    billingAddress2: null,
    billingPostcode: '34000',
    shippingCountry: 'TR',
    shippingPostcode: '34000',
    shippingCity: 'Istanbul',
    shippingDistrict: 'Kadikoy',
    shippingAddress: 'Shipping address',
    totalPrice: '100.00',
    lineItems: [
      {
        id: 'line-db-1',
        sourceLineItemId: 'shopify-line-1',
        sourceVariantId: 'variant-sporjinal-1',
        sku: 'SPJ-SKU-1',
        title: 'Sporjinal Shoe',
        quantity: 1,
        unitPriceVatIncluded: '60.00',
        lineTotalVatIncluded: '60.00',
        unitPrice: '60.00',
        originalVendorId: 'sporjinal',
      },
      {
        id: 'line-db-2',
        sourceLineItemId: 'shopify-line-2',
        sourceVariantId: 'variant-yalispor-1',
        sku: 'YALI-SKU-1',
        title: 'Yalispor Shirt',
        quantity: 2,
        unitPriceVatIncluded: '20.00',
        lineTotalVatIncluded: '40.00',
        unitPrice: '20.00',
        originalVendorId: 'yalispor',
      },
    ],
    webhookEvents: [
      {
        rawPayload: rawOrderPayload,
      },
    ],
    ...overrides,
  };
}

function mockHappyPath(order = buildOrderFixture()) {
  prismaMock.shopifyOrder.findFirst.mockResolvedValue(order);
  prismaMock.vendor.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
  }));
  prismaMock.vendorPaymentProviderSeller.findUnique.mockImplementation(
    async ({ where }: { where: { provider_vendorId: { vendorId: string } } }) => {
      const sellerIds: Record<string, string> = {
        sporjinal: '100003585',
        yalispor: '100003586',
      };
      const externalSellerId = sellerIds[where.provider_vendorId.vendorId];
      return externalSellerId ? { externalSellerId, enabled: true } : null;
    },
  );
  prismaMock.vendorFinancialProfile.findFirst.mockResolvedValue({
    commissionPercent: '10.00',
    commissionVatPercent: '0.00',
    deductShippingEnabled: false,
    shippingMode: 'DISABLED',
    fixedShippingFee: null,
  });
}

function stringifyResult(value: unknown) {
  return JSON.stringify(value);
}

describe('Paratika SESSIONTOKEN payload preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a multi-vendor seller payment amount based ORDERITEMS payload preview', async () => {
    mockHappyPath();

    const result = await buildParatikaSessionTokenPayloadPreviewForOrder('order-100', {
      returnUrl: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
    });

    expect(result.ok).toBe(true);
    expect(result.writesPerformed).toBe(false);
    expect(result.shippingDeductionPolicy).toBe('deferred_not_applied');
    expect(result.externalApiCallAttempted).toBe(false);
    expect(result.cardDataIncluded).toBe(false);
    expect(result.sessionTokenPayloadPreview).toMatchObject({
      ACTION: 'SESSIONTOKEN',
      AMOUNT: '100.00',
      CURRENCY: 'TRY',
      MERCHANTPAYMENTID: 'SPORGYM-SHOPIFY-order-100',
      RETURNURL: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
      CUSTOMER: 'customer@example.test',
      CUSTOMERNAME: 'Test Customer',
      CUSTOMEREMAIL: 'customer@example.test',
      CUSTOMERIP: '203.0.113.10',
      CUSTOMERUSERAGENT: 'Mozilla/5.0 Paratika Preview Test',
      CUSTOMERPHONE: '+905551112233',
      TOTALSELLERPAYMENTAMOUNT: '90.00',
      SESSIONTYPE: 'PAYMENTSESSION',
    });

    expect(typeof result.sessionTokenPayloadPreview?.ORDERITEMS).toBe('string');
    const orderItems = JSON.parse(result.sessionTokenPayloadPreview?.ORDERITEMS ?? '[]');
    expect(orderItems).toEqual([
      {
        productCode: 'variant-sporjinal-1',
        name: 'Sporjinal Shoe',
        description: 'SPJ-SKU-1',
        quantity: 1,
        amount: '60.00',
        sellerID: '100003585',
        sellerPaymentAmount: '54.00',
      },
      {
        productCode: 'variant-yalispor-1',
        name: 'Yalispor Shirt',
        description: 'YALI-SKU-1',
        quantity: 2,
        amount: '40.00',
        sellerID: '100003586',
        sellerPaymentAmount: '36.00',
      },
    ]);
    expect(result.itemBreakdown.map((item) => [item.vendorId, item.sellerID])).toEqual([
      ['sporjinal', '100003585'],
      ['yalispor', '100003586'],
    ]);
  });

  it('fails closed when PARATIKA_RETURN_URL is not configured', async () => {
    mockHappyPath();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await buildParatikaSessionTokenPayloadPreviewForOrder('order-100');

    expect(result.ok).toBe(false);
    expect(result.sessionTokenPayloadPreview).toBeNull();
    expect(result.validationErrors).toContain('RETURNURL is required for Paratika SESSIONTOKEN preview.');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('defers shipping deductions in preview-only sellerPaymentAmount calculations', async () => {
    mockHappyPath();
    prismaMock.vendorFinancialProfile.findFirst.mockResolvedValue({
      commissionPercent: '10.00',
      commissionVatPercent: '0.00',
      deductShippingEnabled: true,
      shippingMode: 'FIXED',
      fixedShippingFee: '35.00',
    });

    const result = await buildParatikaSessionTokenPayloadPreviewForOrder('order-100', {
      returnUrl: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
    });

    expect(result.ok).toBe(true);
    expect(result.shippingDeductionPolicy).toBe('deferred_not_applied');
    expect(result.validationErrors).not.toContain(
      'Line item shopify-line-1 cannot compute sellerPaymentAmount: shipping deductions are not modeled for item-level Paratika previews.',
    );
    expect(result.sessionTokenPayloadPreview).toMatchObject({
      TOTALSELLERPAYMENTAMOUNT: '90.00',
    });

    const orderItems = JSON.parse(result.sessionTokenPayloadPreview?.ORDERITEMS ?? '[]');
    expect(orderItems.map((item: { sellerPaymentAmount: string }) => item.sellerPaymentAmount)).toEqual(['54.00', '36.00']);
  });

  it('fails closed when a Paratika seller mapping is missing', async () => {
    mockHappyPath();
    prismaMock.vendorPaymentProviderSeller.findUnique.mockImplementation(
      async ({ where }: { where: { provider_vendorId: { vendorId: string } } }) =>
        where.provider_vendorId.vendorId === 'sporjinal'
          ? { externalSellerId: '100003585', enabled: true }
          : null,
    );

    const result = await buildParatikaSessionTokenPayloadPreviewForOrder('order-100', {
      returnUrl: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
    });

    expect(result.ok).toBe(false);
    expect(result.sessionTokenPayloadPreview).toBeNull();
    expect(result.validationErrors).toContain(
      'Line item shopify-line-2 cannot resolve Paratika sellerID: MAPPING_MISSING.',
    );
  });

  it('fails closed when productCode cannot be resolved from variant id or SKU', async () => {
    mockHappyPath(
      buildOrderFixture({
        lineItems: [
          {
            id: 'line-db-1',
            sourceLineItemId: 'shopify-line-1',
            sourceVariantId: null,
            sku: null,
            title: 'Sporjinal Shoe',
            quantity: 1,
            unitPriceVatIncluded: '60.00',
            lineTotalVatIncluded: '60.00',
            unitPrice: '60.00',
            originalVendorId: 'sporjinal',
          },
        ],
      }),
    );

    const result = await buildParatikaSessionTokenPayloadPreviewForOrder('order-100', {
      returnUrl: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
    });

    expect(result.ok).toBe(false);
    expect(result.validationErrors).toContain(
      'Line item shopify-line-1 is missing productCode sourceVariantId/SKU.',
    );
  });

  it('fails closed when sellerPaymentAmount cannot be computed from a configured financial profile', async () => {
    mockHappyPath();
    prismaMock.vendorFinancialProfile.findFirst.mockResolvedValue(null);

    const result = await buildParatikaSessionTokenPayloadPreviewForOrder('order-100', {
      returnUrl: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
    });

    expect(result.ok).toBe(false);
    expect(result.validationErrors).toContain(
      'Line item shopify-line-1 cannot compute sellerPaymentAmount: active vendor financial profile is missing.',
    );
  });

  it('fails closed when order total does not match ORDERITEMS amount total', async () => {
    mockHappyPath(buildOrderFixture({ totalPrice: '101.00' }));

    const result = await buildParatikaSessionTokenPayloadPreviewForOrder('order-100', {
      returnUrl: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
    });

    expect(result.ok).toBe(false);
    expect(result.validationErrors).toContain('AMOUNT does not match sum of ORDERITEMS[].amount.');
  });

  it('does not expose credentials, token values, or card fields in preview responses', async () => {
    mockHappyPath();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await buildParatikaSessionTokenPayloadPreviewForOrder('order-100', {
      returnUrl: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
    });
    const serialized = stringifyResult(result).toLowerCase();
    const previewKeys = Object.keys(result.sessionTokenPayloadPreview ?? {});

    expect(result.omittedCredentialFields).toEqual(['MERCHANTUSER', 'MERCHANTPASSWORD', 'MERCHANT']);
    expect(previewKeys).not.toContain('MERCHANTUSER');
    expect(previewKeys).not.toContain('MERCHANTPASSWORD');
    expect(previewKeys).not.toContain('MERCHANT');
    expect(serialized).not.toContain('cardnumber');
    expect(serialized).not.toContain('cvv');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
