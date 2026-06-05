import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendor: {
    findUnique: vi.fn(),
  },
  vendorPaymentProviderSeller: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  CONFIRMED_VENDOR_PAYMENT_SELLERS,
  VendorPaymentSellerMappingError,
  resolveVendorPaymentSellerId,
  seedVendorPaymentSellerMappings,
} = await import('../backend/src/modules/payments/vendor-payment-seller.service.js');

const PARATIKA = 'PARATIKA';

describe('vendor payment provider seller mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defines the confirmed Paratika seller mappings for seed data', async () => {
    expect(CONFIRMED_VENDOR_PAYMENT_SELLERS).toEqual([
      {
        vendorId: 'sporjinal',
        provider: PARATIKA,
        externalSellerId: '100003585',
      },
      {
        vendorId: 'yalispor',
        provider: PARATIKA,
        externalSellerId: '100003586',
      },
    ]);

    prismaMock.vendor.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
    }));
    prismaMock.vendorPaymentProviderSeller.upsert.mockResolvedValue({});

    await seedVendorPaymentSellerMappings(prismaMock as never);

    expect(prismaMock.vendorPaymentProviderSeller.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.vendorPaymentProviderSeller.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          provider_vendorId: {
            provider: PARATIKA,
            vendorId: 'sporjinal',
          },
        },
        create: expect.objectContaining({
          vendorId: 'sporjinal',
          provider: PARATIKA,
          externalSellerId: '100003585',
          enabled: true,
        }),
      }),
    );
    expect(prismaMock.vendorPaymentProviderSeller.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          provider_vendorId: {
            provider: PARATIKA,
            vendorId: 'yalispor',
          },
        },
        create: expect.objectContaining({
          vendorId: 'yalispor',
          provider: PARATIKA,
          externalSellerId: '100003586',
          enabled: true,
        }),
      }),
    );
  });

  it.each([
    ['sporjinal', '100003585'],
    ['yalispor', '100003586'],
  ])('resolves Paratika seller id for %s', async (vendorId, externalSellerId) => {
    prismaMock.vendor.findUnique.mockResolvedValue({ id: vendorId });
    prismaMock.vendorPaymentProviderSeller.findUnique.mockResolvedValue({
      externalSellerId,
      enabled: true,
    });

    await expect(resolveVendorPaymentSellerId('paratika', vendorId)).resolves.toBe(externalSellerId);
    expect(prismaMock.vendorPaymentProviderSeller.findUnique).toHaveBeenCalledWith({
      where: {
        provider_vendorId: {
          provider: PARATIKA,
          vendorId,
        },
      },
      select: {
        externalSellerId: true,
        enabled: true,
      },
    });
  });

  it('fails closed when the vendor does not exist', async () => {
    prismaMock.vendor.findUnique.mockResolvedValue(null);

    await expect(resolveVendorPaymentSellerId(PARATIKA, 'unknown-vendor')).rejects.toMatchObject({
      code: 'VENDOR_NOT_FOUND',
    } satisfies Partial<VendorPaymentSellerMappingError>);
    expect(prismaMock.vendorPaymentProviderSeller.findUnique).not.toHaveBeenCalled();
  });

  it('fails closed when the vendor mapping is missing', async () => {
    prismaMock.vendor.findUnique.mockResolvedValue({ id: 'sporvol' });
    prismaMock.vendorPaymentProviderSeller.findUnique.mockResolvedValue(null);

    await expect(resolveVendorPaymentSellerId(PARATIKA, 'sporvol')).rejects.toMatchObject({
      code: 'MAPPING_MISSING',
    } satisfies Partial<VendorPaymentSellerMappingError>);
  });

  it('fails closed when the vendor mapping is disabled', async () => {
    prismaMock.vendor.findUnique.mockResolvedValue({ id: 'sporjinal' });
    prismaMock.vendorPaymentProviderSeller.findUnique.mockResolvedValue({
      externalSellerId: '100003585',
      enabled: false,
    });

    await expect(resolveVendorPaymentSellerId(PARATIKA, 'sporjinal')).rejects.toMatchObject({
      code: 'MAPPING_DISABLED',
    } satisfies Partial<VendorPaymentSellerMappingError>);
  });

  it('fails closed when the provider is not allowlisted', async () => {
    await expect(resolveVendorPaymentSellerId('unknown-provider', 'sporjinal')).rejects.toMatchObject({
      code: 'UNSUPPORTED_PROVIDER',
    } satisfies Partial<VendorPaymentSellerMappingError>);
    expect(prismaMock.vendor.findUnique).not.toHaveBeenCalled();
  });
});
