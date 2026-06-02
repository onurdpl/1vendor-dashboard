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
    upsert: vi.fn(),
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
const syncOdooSaleOrdersForAllocationsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/finance/sale-ledger.service.js', () => ({
  upsertSaleLedgerForAllocation: upsertSaleLedgerForAllocationMock,
}));

vi.mock('../backend/src/integrations/odoo/odooAllocationOrderSync.service.js', () => ({
  syncOdooSaleOrdersForAllocations: syncOdooSaleOrdersForAllocationsMock,
}));

const { ingestShopifyOrderWebhook } = await import('../backend/src/modules/shopify/order-ingestion.service.js');

function mockSuccessfulDbWrites() {
  prismaMock.vendor.findMany.mockResolvedValue([{ id: 'sporjinal' }]);
  prismaMock.webhookEvent.update.mockResolvedValue({});
  prismaMock.shopifyOrder.upsert.mockResolvedValue({ id: 'shopify-order-db-1' });
  prismaMock.shopifyOrderLineItem.upsert.mockResolvedValue({ id: 'shopify-line-db-1' });
  prismaMock.vendorAllocation.upsert.mockResolvedValue({ id: 'alloc-sporjinal-2001' });
  prismaMock.vendorAllocationLineItem.upsert.mockResolvedValue({});
  prismaMock.allocationAssignmentHistory.upsert.mockResolvedValue({});
  prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
  upsertSaleLedgerForAllocationMock.mockResolvedValue({});
  syncOdooSaleOrdersForAllocationsMock.mockResolvedValue([]);
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
