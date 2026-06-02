import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorAllocation: {
    findFirst: vi.fn(),
  },
  webhookEvent: {
    findMany: vi.fn(),
  },
  shopifyOrderLineItem: {
    updateMany: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { getVendorOrderById } = await import('../backend/src/modules/orders/orders.service.js');

function buildAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-sporjinal-1001',
    assignedVendorId: 'sporjinal',
    originalVendorId: 'sporjinal',
    allocationStatus: 'ACTIVE',
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    carrier: null,
    trackingNumber: null,
    reassignmentRequired: false,
    cancellationReason: null,
    vendorIntegrationStatus: 'acknowledged',
    vendorIntegrationStatusMessage: 'Order imported into Entegra',
    vendorIntegrationStatusUpdatedAt: new Date('2026-06-01T10:06:00.000Z'),
    vendorIntegrationProvider: 'Provider A',
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    updatedAt: new Date('2026-06-01T10:05:00.000Z'),
    order: {
      id: 'shopify-order-db-1',
      sourceShopifyOrderId: 'gid://shopify/Order/1001',
      sourceShopifyOrderNumber: '#1001',
      customerName: 'Snapshot Customer',
      shopifyCreatedAt: new Date('2026-06-01T09:55:00.000Z'),
      currency: 'TRY',
      financialStatus: 'paid',
      paymentGatewayName: 'PayTR Marketplace',
      taxesIncluded: true,
      orderTaxAmount: '109.09',
      shippingAmount: '49.90',
      discountAmount: '10.00',
      orderNote: 'Leave at desk',
      orderTags: ['entegrasyon', 'priority'],
      billingFullName: 'Billing Customer',
      billingCompany: 'Billing Co',
      billingPhone: '+900000000001',
      billingCity: 'Istanbul',
      billingDistrict: 'Besiktas',
      billingAddress1: 'Billing street 1',
      billingAddress2: 'Floor 2',
      billingPostcode: '34330',
    },
    fulfillment: null,
    shipmentExecutions: [],
    lineItems: [
      {
        id: 'allocation-line-1',
        quantity: 2,
        lineAmount: '1200.00',
        shopifyOrderLineItem: {
          id: 'shopify-line-db-1',
          sourceLineItemId: 'gid://shopify/LineItem/1',
          sourceVariantId: 'gid://shopify/ProductVariant/1',
          sku: 'SKU-1001',
          title: 'Snapshot Shoe',
          imageUrl: 'https://cdn.example.com/snapshot-shoe.png',
          shopifyProductId: 'gid://shopify/Product/1',
          unitPriceVatIncluded: '600.00',
          lineTotalVatIncluded: '1200.00',
          lineTaxAmount: '109.09',
          vatRate: '10.00',
        },
      },
    ],
    assignmentHistory: [],
    ...overrides,
  };
}

describe('order detail snapshot API mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.webhookEvent.findMany.mockResolvedValue([]);
  });

  it('returns persisted order snapshot and line item VAT fields without exposing raw Shopify payloads', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValue(buildAllocation());

    const result = await getVendorOrderById('sporjinal', 'alloc-sporjinal-1001');

    expect(result?.orderSnapshot).toEqual({
      shopifyCreatedAt: '2026-06-01T09:55:00.000Z',
      currency: 'TRY',
      financialStatus: 'paid',
      paymentGatewayName: 'PayTR Marketplace',
      taxesIncluded: true,
      orderTaxAmount: '109.09',
      shippingAmount: '49.90',
      discountAmount: '10.00',
      orderNote: 'Leave at desk',
      orderTags: ['entegrasyon', 'priority'],
      vendorIntegrationStatus: 'acknowledged',
      vendorIntegrationStatusMessage: 'Order imported into Entegra',
      vendorIntegrationStatusUpdatedAt: '2026-06-01T10:06:00.000Z',
      vendorIntegrationProvider: 'Provider A',
      billingAddress: {
        fullName: 'Billing Customer',
        company: 'Billing Co',
        phone: '+900000000001',
        city: 'Istanbul',
        district: 'Besiktas',
        address1: 'Billing street 1',
        address2: 'Floor 2',
        postcode: '34330',
      },
    });
    expect(result?.lineItems[0]).toEqual(
      expect.objectContaining({
        shopifyProductId: 'gid://shopify/Product/1',
        unitPriceVatIncluded: '600.00',
        lineTotalVatIncluded: '1200.00',
        lineTaxAmount: '109.09',
        vatRate: '10.00',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('rawPayload');
  });

  it('renders missing optional snapshot values as null in the API payload', async () => {
    prismaMock.vendorAllocation.findFirst.mockResolvedValue(
      buildAllocation({
        order: {
          ...buildAllocation().order,
          paymentGatewayName: null,
          taxesIncluded: null,
          orderTaxAmount: null,
          shippingAmount: null,
          discountAmount: null,
          orderNote: null,
          orderTags: [],
          billingCompany: null,
          billingAddress2: null,
        },
      }),
    );

    const result = await getVendorOrderById('sporjinal', 'alloc-sporjinal-1001');

    expect(result?.orderSnapshot.paymentGatewayName).toBeNull();
    expect(result?.orderSnapshot.taxesIncluded).toBeNull();
    expect(result?.orderSnapshot.orderTaxAmount).toBeNull();
    expect(result?.orderSnapshot.shippingAmount).toBeNull();
    expect(result?.orderSnapshot.discountAmount).toBeNull();
    expect(result?.orderSnapshot.billingAddress.company).toBeNull();
    expect(result?.lineItems[0].unitPriceVatIncluded).toBe('600.00');
  });
});
