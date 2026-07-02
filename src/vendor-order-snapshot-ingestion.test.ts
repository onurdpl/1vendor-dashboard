import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  vendor: {
    findMany: vi.fn(),
  },
  webhookEvent: {
    update: vi.fn(),
  },
  shopifyOrder: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  shopifyOrderLineItem: {
    upsert: vi.fn(),
  },
  vendorAllocation: {
    upsert: vi.fn(),
  },
  vendorAllocationLineItem: {
    upsert: vi.fn(),
  },
  allocationAssignmentHistory: {
    upsert: vi.fn(),
  },
}));

const upsertSaleLedgerForAllocationMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/finance/sale-ledger.service.js', () => ({
  upsertSaleLedgerForAllocation: upsertSaleLedgerForAllocationMock,
}));

const {
  ingestShopifyOrderWebhook,
  syncShopifyOrderPaidSnapshotFromWebhook,
  updateShopifyOrderContactAddressSnapshotFromWebhook,
} = await import('../backend/src/modules/shopify/order-ingestion.service.js');

function buildSimpleOrderPayload(orderId = 2001, sku = 'SKU-1') {
  return {
    id: orderId,
    name: `#${orderId}`,
    total_price: '100.00',
    line_items: [
      {
        id: orderId + 1000,
        sku,
        title: 'Sports Shoe',
        quantity: 1,
        price: '100.00',
      },
    ],
  };
}

function mockSuccessfulDbWrites() {
  prismaMock.vendor.findMany.mockResolvedValue([{ id: 'sporjinal' }]);
  prismaMock.webhookEvent.update.mockResolvedValue({});
  prismaMock.shopifyOrder.upsert.mockResolvedValue({ id: 'shopify-order-db-1' });
  prismaMock.shopifyOrder.findFirst.mockResolvedValue(null);
  prismaMock.shopifyOrder.update.mockResolvedValue({});
  prismaMock.shopifyOrderLineItem.upsert.mockResolvedValue({ id: 'shopify-line-db-1' });
  prismaMock.vendorAllocation.upsert.mockResolvedValue({ id: 'alloc-sporjinal-2001' });
  prismaMock.vendorAllocationLineItem.upsert.mockResolvedValue({});
  prismaMock.allocationAssignmentHistory.upsert.mockResolvedValue({});
  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
  upsertSaleLedgerForAllocationMock.mockResolvedValue({});
}

describe('vendor order snapshot ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSuccessfulDbWrites();
  });

  it('persists vendor integration order snapshot fields from the Shopify payload', async () => {
    await ingestShopifyOrderWebhook({
      event: { id: 'webhook-1' } as never,
      sellerInfo: {
        'SKU-1': 'sporjinal',
      },
      payload: {
        id: 2001,
        name: '#2001',
        created_at: '2026-06-02T09:00:00.000Z',
        currency: 'TRY',
        financial_status: 'paid',
        payment_gateway_names: ['PayTR Marketplace'],
        total_price: '245.40',
        total_discounts: '15.50',
        total_shipping_price_set: {
          shop_money: {
            amount: '29.90',
            currency_code: 'TRY',
          },
        },
        note: 'Provider import note',
        tags: 'entegrasyon, priority',
        customer: {
          first_name: 'Test',
          last_name: 'Customer',
          email: 'customer@example.test',
        },
        shipping_address: {
          phone: '+90 555 111 22 33',
          country_code: 'TR',
          zip: '34000',
          city: 'Istanbul',
          district: 'Kadikoy',
          address1: 'Shipping address 1',
        },
        billing_address: {
          first_name: 'Billing',
          last_name: 'Customer',
          company: 'Billing Co',
          phone: '0555 222 33 44',
          city: 'Istanbul',
          county: 'Besiktas',
          address1: 'Billing address 1',
          address2: 'Floor 2',
          zip: '34330',
        },
        line_items: [
          {
            id: 3001,
            product_id: 4001,
            variant_id: 5001,
            sku: 'SKU-1',
            title: 'Sports Shoe',
            variant_title: '43',
            quantity: 2,
            price: '100.25',
          },
        ],
      },
    });

    expect(prismaMock.shopifyOrder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          shopifyCreatedAt: new Date('2026-06-02T09:00:00.000Z'),
          currency: 'TRY',
          financialStatus: 'paid',
          paymentGatewayName: 'PayTR Marketplace',
          taxesIncluded: null,
          orderTaxAmount: null,
          shippingAmount: '29.90',
          discountAmount: '15.50',
          orderNote: 'Provider import note',
          orderTags: ['entegrasyon', 'priority'],
          billingFullName: 'Billing Customer',
          billingCompany: 'Billing Co',
          billingPhone: '05552223344',
          billingCity: 'Istanbul',
          billingDistrict: 'Besiktas',
          billingAddress1: 'Billing address 1',
          billingAddress2: 'Floor 2',
          billingPostcode: '34330',
        }),
      }),
    );
    expect(prismaMock.shopifyOrderLineItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          shopifyProductId: '4001',
          unitPriceVatIncluded: '100.25',
          lineTotalVatIncluded: '200.50',
          lineTaxAmount: null,
          vatRate: '10',
        }),
      }),
    );
  });

  it('persists pending financial status from orders/create until a paid webhook arrives', async () => {
    await ingestShopifyOrderWebhook({
      event: { id: 'webhook-pending-financial-status' } as never,
      sellerInfo: {
        'SKU-1': 'sporjinal',
      },
      payload: {
        ...buildSimpleOrderPayload(2005),
        financial_status: 'pending',
        payment_gateway_names: ['Credit Card Gateway'],
      },
    });

    expect(prismaMock.shopifyOrder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          financialStatus: 'pending',
          paymentGatewayName: 'Credit Card Gateway',
        }),
        update: expect.objectContaining({
          financialStatus: 'pending',
          paymentGatewayName: 'Credit Card Gateway',
        }),
      }),
    );
  });

  it('updates only safe payment snapshot fields from orders/paid webhook', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce({
      id: 'shopify-order-db-2005',
      sourceShopifyOrderId: '2005',
      financialStatus: 'pending',
      paymentGatewayName: null,
    });

    const result = await syncShopifyOrderPaidSnapshotFromWebhook({
      id: 2005,
      name: '#2005',
      financial_status: 'paid',
      payment_gateway_names: ['Credit Card Gateway'],
      line_items: [
        {
          id: 3005,
          sku: 'SKU-1',
          title: 'Sports Shoe',
          quantity: 1,
          price: '100.00',
        },
      ],
    });

    expect(result).toEqual({
      matched: true,
      updated: true,
      orderId: 'shopify-order-db-2005',
      sourceShopifyOrderId: '2005',
      changedFields: ['financialStatus', 'paymentGatewayName'],
      financialStatus: 'paid',
      paymentGatewayName: 'Credit Card Gateway',
    });
    expect(prismaMock.shopifyOrder.update).toHaveBeenCalledWith({
      where: { id: 'shopify-order-db-2005' },
      data: {
        financialStatus: 'paid',
        paymentGatewayName: 'Credit Card Gateway',
      },
    });
    expect(prismaMock.shopifyOrder.upsert).not.toHaveBeenCalled();
    expect(prismaMock.vendorAllocation.upsert).not.toHaveBeenCalled();
    expect(prismaMock.vendorAllocationLineItem.upsert).not.toHaveBeenCalled();
    expect(prismaMock.shopifyOrderLineItem.upsert).not.toHaveBeenCalled();
    expect(upsertSaleLedgerForAllocationMock).not.toHaveBeenCalled();
  });

  it('falls back to paid when orders/paid payload omits financial_status', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce({
      id: 'shopify-order-db-2006',
      sourceShopifyOrderId: '2006',
      financialStatus: 'pending',
      paymentGatewayName: 'Existing Gateway',
    });

    const result = await syncShopifyOrderPaidSnapshotFromWebhook({
      id: 2006,
      name: '#2006',
    });

    expect(result).toMatchObject({
      matched: true,
      updated: true,
      changedFields: ['financialStatus'],
      financialStatus: 'paid',
      paymentGatewayName: null,
    });
    expect(prismaMock.shopifyOrder.update).toHaveBeenCalledWith({
      where: { id: 'shopify-order-db-2006' },
      data: {
        financialStatus: 'paid',
      },
    });
  });

  it('ignores orders/paid for an unknown order without creating partial order state', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(null);

    const result = await syncShopifyOrderPaidSnapshotFromWebhook({
      id: 9999,
      name: '#9999',
      financial_status: 'paid',
    });

    expect(result).toEqual({
      matched: false,
      updated: false,
      orderId: null,
      sourceShopifyOrderId: '9999',
      changedFields: [],
      financialStatus: null,
      paymentGatewayName: null,
    });
    expect(prismaMock.shopifyOrder.update).not.toHaveBeenCalled();
    expect(prismaMock.shopifyOrder.upsert).not.toHaveBeenCalled();
    expect(prismaMock.vendorAllocation.upsert).not.toHaveBeenCalled();
    expect(prismaMock.shopifyOrderLineItem.upsert).not.toHaveBeenCalled();
    expect(upsertSaleLedgerForAllocationMock).not.toHaveBeenCalled();
  });

  it('keeps repeated orders/paid sync idempotent when the snapshot is already current', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce({
      id: 'shopify-order-db-2007',
      sourceShopifyOrderId: '2007',
      financialStatus: 'paid',
      paymentGatewayName: 'Credit Card Gateway',
    });

    const result = await syncShopifyOrderPaidSnapshotFromWebhook({
      id: 2007,
      name: '#2007',
      financial_status: 'paid',
      payment_gateway_names: ['Credit Card Gateway'],
    });

    expect(result).toEqual({
      matched: true,
      updated: false,
      orderId: 'shopify-order-db-2007',
      sourceShopifyOrderId: '2007',
      changedFields: [],
      financialStatus: 'paid',
      paymentGatewayName: 'Credit Card Gateway',
    });
    expect(prismaMock.shopifyOrder.update).not.toHaveBeenCalled();
    expect(prismaMock.shopifyOrder.upsert).not.toHaveBeenCalled();
    expect(prismaMock.vendorAllocation.upsert).not.toHaveBeenCalled();
    expect(prismaMock.shopifyOrderLineItem.upsert).not.toHaveBeenCalled();
  });

  it('preserves existing allocation workflow state when Shopify order ingestion is replayed', async () => {
    await ingestShopifyOrderWebhook({
      event: { id: 'webhook-replay-preserve-blocked-state' } as never,
      sellerInfo: {
        'SKU-1': 'sporjinal',
      },
      payload: buildSimpleOrderPayload(),
    });

    expect(prismaMock.vendorAllocation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.not.objectContaining({
          allocationStatus: expect.anything(),
          cancellationReason: expect.anything(),
          reassignmentRequired: expect.anything(),
          originalVendorId: expect.anything(),
        }),
      }),
    );
  });

  it('preserves existing pending reassignment state during Shopify order ingestion replay', async () => {
    await ingestShopifyOrderWebhook({
      event: { id: 'webhook-replay-preserve-pending-reassignment' } as never,
      sellerInfo: {
        'SKU-1': 'sporjinal',
      },
      payload: buildSimpleOrderPayload(2003),
    });

    const allocationUpsert = prismaMock.vendorAllocation.upsert.mock.calls[0]?.[0];
    expect(allocationUpsert.update).not.toHaveProperty('allocationStatus');
    expect(allocationUpsert.update).not.toHaveProperty('cancellationReason');
    expect(allocationUpsert.update).not.toHaveProperty('reassignmentRequired');
    expect(allocationUpsert.update).not.toHaveProperty('originalVendorId');
  });

  it('defaults new allocations to active workflow state during Shopify order ingestion', async () => {
    await ingestShopifyOrderWebhook({
      event: { id: 'webhook-new-allocation-defaults' } as never,
      sellerInfo: {
        'SKU-1': 'sporjinal',
      },
      payload: buildSimpleOrderPayload(2004),
    });

    expect(prismaMock.vendorAllocation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          allocationStatus: 'ACTIVE',
          cancellationReason: null,
          reassignmentRequired: false,
        }),
      }),
    );
  });

  it('updates persisted order contact and shipping address fields from orders/updated payload', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce({
      id: 'shopify-order-db-1080',
      sourceShopifyOrderId: '1080-shopify',
      sourceShopifyOrderNumber: '#1080',
      customerName: 'Old Customer',
      customerEmail: 'old@example.test',
      customerPhone: null,
      shippingAddress: 'NA, NA NA',
      shippingCity: 'NA',
      shippingDistrict: 'NA NA',
      shippingPostcode: null,
      shippingCountry: 'TR',
      billingFullName: null,
      billingCompany: null,
      billingPhone: null,
      billingCity: null,
      billingDistrict: null,
      billingAddress1: null,
      billingAddress2: null,
      billingPostcode: null,
    });

    const result = await updateShopifyOrderContactAddressSnapshotFromWebhook({
      id: '1080-shopify',
      name: '#1080',
      financial_status: 'paid',
      payment_gateway_names: ['Credit Card Gateway'],
      customer: {
        first_name: 'Orhan',
        last_name: 'Customer',
        email: 'orhan@example.test',
        phone: '+90 555 111 22 33',
      },
      shipping_address: {
        phone: '+90 555 444 55 66',
        country_code: 'TR',
        zip: '34160',
        city: 'istanbul',
        province: 'istanbul',
        address1: 'Orhan Sokak',
        address2: 'Gungoren',
      },
      billing_address: {
        name: 'Orhan Billing',
        company: 'Billing Co',
        phone: '+90 555 777 88 99',
        country_code: 'TR',
        city: 'istanbul',
        province: 'istanbul',
        address1: 'Billing Sokak',
        address2: 'Kat 2',
        zip: '34160',
      },
    });

    expect(result).toMatchObject({
      matched: true,
      updated: true,
      orderId: 'shopify-order-db-1080',
      changedFields: expect.arrayContaining([
        'customerName',
        'customerEmail',
        'customerPhone',
        'shippingAddress',
        'shippingCity',
        'shippingDistrict',
        'shippingPostcode',
        'billingFullName',
        'billingCompany',
        'billingPhone',
        'billingCity',
        'billingDistrict',
        'billingAddress1',
        'billingAddress2',
        'billingPostcode',
      ]),
    });
    expect(prismaMock.shopifyOrder.update).toHaveBeenCalledWith({
      where: { id: 'shopify-order-db-1080' },
      data: expect.objectContaining({
        customerName: 'Orhan Customer',
        customerEmail: 'orhan@example.test',
        customerPhone: '+905554445566',
        shippingAddress: 'Orhan Sokak, Gungoren',
        shippingCity: 'istanbul',
        shippingDistrict: 'Gungoren',
        shippingPostcode: '34160',
        billingFullName: 'Orhan Billing',
        billingCompany: 'Billing Co',
        billingPhone: '+905557778899',
        billingCity: 'istanbul',
        billingDistrict: 'Kat 2',
        billingAddress1: 'Billing Sokak',
        billingAddress2: 'Kat 2',
        billingPostcode: '34160',
      }),
    });
    const addressUpdateData = prismaMock.shopifyOrder.update.mock.calls[0]?.[0]?.data;
    expect(addressUpdateData).not.toHaveProperty('financialStatus');
    expect(addressUpdateData).not.toHaveProperty('paymentGatewayName');
    expect(prismaMock.shopifyOrder.upsert).not.toHaveBeenCalled();
    expect(prismaMock.shopifyOrderLineItem.upsert).not.toHaveBeenCalled();
    expect(prismaMock.vendorAllocation.upsert).not.toHaveBeenCalled();
    expect(prismaMock.vendorAllocationLineItem.upsert).not.toHaveBeenCalled();
    expect(upsertSaleLedgerForAllocationMock).not.toHaveBeenCalled();
  });

  it('does not create a ShopifyOrder when orders/updated has no matching existing order', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(null);

    const result = await updateShopifyOrderContactAddressSnapshotFromWebhook({
      id: 'missing-shopify-order',
      name: '#9999',
      shipping_address: {
        address1: 'Corrected address',
        city: 'Istanbul',
      },
    });

    expect(result).toEqual({
      matched: false,
      updated: false,
      orderId: null,
      sourceShopifyOrderId: 'missing-shopify-order',
      changedFields: [],
    });
    expect(prismaMock.shopifyOrder.update).not.toHaveBeenCalled();
    expect(prismaMock.shopifyOrder.upsert).not.toHaveBeenCalled();
    expect(prismaMock.vendorAllocation.upsert).not.toHaveBeenCalled();
    expect(prismaMock.shopifyOrderLineItem.upsert).not.toHaveBeenCalled();
  });

  it('maps Shopify Turkey shipping address2 to shippingDistrict when explicit district fields are absent', async () => {
    await ingestShopifyOrderWebhook({
      event: { id: 'webhook-tr-address2' } as never,
      sellerInfo: {
        'SKU-TR': 'sporjinal',
      },
      payload: {
        id: 2101,
        name: '#2101',
        total_price: '100.00',
        shipping_address: {
          country_code: 'TR',
          city: 'Istanbul',
          address1: 'Street line',
          address2: 'Kartal',
        },
        line_items: [
          {
            id: 3101,
            sku: 'SKU-TR',
            title: 'Shoe',
            quantity: 1,
            price: '100.00',
          },
        ],
      },
    });

    expect(prismaMock.shopifyOrder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          shippingDistrict: 'Kartal',
        }),
      }),
    );
  });

  it('maps Shopify Turkey billing address2 to billingDistrict when explicit district fields are absent', async () => {
    await ingestShopifyOrderWebhook({
      event: { id: 'webhook-tr-billing-address2' } as never,
      sellerInfo: {
        'SKU-TR': 'sporjinal',
      },
      payload: {
        id: 2102,
        name: '#2102',
        total_price: '100.00',
        billing_address: {
          country: 'Türkiye',
          city: 'Istanbul',
          address1: 'Billing street',
          address2: 'Kartal',
        },
        line_items: [
          {
            id: 3102,
            sku: 'SKU-TR',
            title: 'Shoe',
            quantity: 1,
            price: '100.00',
          },
        ],
      },
    });

    expect(prismaMock.shopifyOrder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          billingDistrict: 'Kartal',
        }),
      }),
    );
  });

  it('keeps explicit Shopify district ahead of Turkey address2', async () => {
    await ingestShopifyOrderWebhook({
      event: { id: 'webhook-tr-explicit-district' } as never,
      sellerInfo: {
        'SKU-TR': 'sporjinal',
      },
      payload: {
        id: 2103,
        name: '#2103',
        total_price: '100.00',
        shipping_address: {
          country_code: 'TR',
          city: 'Istanbul',
          district: 'Kadikoy',
          address1: 'Street line',
          address2: 'Kartal',
        },
        line_items: [
          {
            id: 3103,
            sku: 'SKU-TR',
            title: 'Shoe',
            quantity: 1,
            price: '100.00',
          },
        ],
      },
    });

    expect(prismaMock.shopifyOrder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          shippingDistrict: 'Kadikoy',
        }),
      }),
    );
  });

  it('does not map non-Turkey address2 to shippingDistrict', async () => {
    await ingestShopifyOrderWebhook({
      event: { id: 'webhook-non-tr-address2' } as never,
      sellerInfo: {
        'SKU-US': 'sporjinal',
      },
      payload: {
        id: 2104,
        name: '#2104',
        total_price: '100.00',
        shipping_address: {
          country_code: 'US',
          city: 'New York',
          province: 'NY',
          address1: 'Street line',
          address2: 'Apartment 4',
        },
        line_items: [
          {
            id: 3104,
            sku: 'SKU-US',
            title: 'Shoe',
            quantity: 1,
            price: '100.00',
          },
        ],
      },
    });

    expect(prismaMock.shopifyOrder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          shippingDistrict: 'NY',
        }),
      }),
    );
  });

  it('uses Shopify GraphQL tax snapshot data before the VAT fallback', async () => {
    await ingestShopifyOrderWebhook({
      event: { id: 'webhook-1069' } as never,
      sellerInfo: {
        'JZ4960-L': 'sporjinal',
      },
      taxSnapshot: {
        orderGid: 'gid://shopify/Order/7693738639697',
        sourceShopifyOrderId: '7693738639697',
        taxesIncluded: true,
        orderTaxAmount: {
          amount: '1172.36',
          currencyCode: 'TRY',
        },
        currentTaxLines: [
          {
            title: 'KDV',
            rate: 0.1,
            ratePercentage: 10,
            price: {
              amount: '1172.36',
              currencyCode: 'TRY',
            },
          },
        ],
        lineItems: [
          {
            lineItemGid: 'gid://shopify/LineItem/20477973659985',
            sourceLineItemId: '20477973659985',
            sku: 'JZ4960-L',
            quantity: 1,
            originalUnitPrice: {
              amount: '2999.0',
              currencyCode: 'TRY',
            },
            discountedTotal: {
              amount: '2999.0',
              currencyCode: 'TRY',
            },
            taxLines: [
              {
                title: 'KDV',
                rate: 0.1,
                ratePercentage: 10,
                price: {
                  amount: '272.64',
                  currencyCode: 'TRY',
                },
              },
            ],
          },
        ],
        source: 'shopify_admin',
      },
      payload: {
        id: 7693738639697,
        name: '#1069',
        currency: 'TRY',
        line_items: [
          {
            id: 20477973659985,
            sku: 'JZ4960-L',
            title: 'Adidas All Me RIB LS Kadın Mor Büstiyer',
            quantity: 1,
            price: '2999.00',
          },
        ],
      },
    });

    expect(prismaMock.shopifyOrder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          taxesIncluded: true,
          orderTaxAmount: '1172.36',
        }),
        update: expect.objectContaining({
          taxesIncluded: true,
          orderTaxAmount: '1172.36',
        }),
      }),
    );
    expect(prismaMock.shopifyOrderLineItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          unitPriceVatIncluded: '2999.00',
          lineTotalVatIncluded: '2999.00',
          lineTaxAmount: '272.64',
          vatRate: '10.00',
        }),
        update: expect.objectContaining({
          unitPriceVatIncluded: '2999.00',
          lineTotalVatIncluded: '2999.00',
          lineTaxAmount: '272.64',
          vatRate: '10.00',
        }),
      }),
    );
  });

  it('persists optional missing snapshot fields as null and defaults VAT rate to 10', async () => {
    await ingestShopifyOrderWebhook({
      event: { id: 'webhook-2' } as never,
      sellerInfo: {
        'SKU-1': 'sporjinal',
      },
      payload: {
        id: 2002,
        name: '#2002',
        line_items: [
          {
            id: 3002,
            sku: 'SKU-1',
            quantity: 1,
          },
        ],
      },
    });

    expect(prismaMock.shopifyOrder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          shopifyCreatedAt: null,
          currency: null,
          financialStatus: null,
          paymentGatewayName: null,
          taxesIncluded: null,
          orderTaxAmount: null,
          shippingAmount: null,
          discountAmount: null,
          orderNote: null,
          orderTags: [],
          billingFullName: null,
          billingCompany: null,
          billingPhone: null,
          billingCity: null,
          billingDistrict: null,
          billingAddress1: null,
          billingAddress2: null,
          billingPostcode: null,
        }),
      }),
    );
    expect(prismaMock.shopifyOrderLineItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          shopifyProductId: null,
          unitPriceVatIncluded: null,
          lineTotalVatIncluded: null,
          lineTaxAmount: null,
          vatRate: '10',
        }),
      }),
    );
  });
});
