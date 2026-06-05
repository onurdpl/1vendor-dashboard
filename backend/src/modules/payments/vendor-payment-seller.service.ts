import { PaymentProvider } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export const CONFIRMED_VENDOR_PAYMENT_SELLERS = [
  {
    vendorId: 'sporjinal',
    provider: PaymentProvider.PARATIKA,
    externalSellerId: '100003585',
  },
  {
    vendorId: 'yalispor',
    provider: PaymentProvider.PARATIKA,
    externalSellerId: '100003586',
  },
] as const;

export type VendorPaymentSellerErrorCode =
  | 'UNSUPPORTED_PROVIDER'
  | 'INVALID_VENDOR_ID'
  | 'VENDOR_NOT_FOUND'
  | 'MAPPING_MISSING'
  | 'MAPPING_DISABLED';

export class VendorPaymentSellerMappingError extends Error {
  constructor(
    message: string,
    public readonly code: VendorPaymentSellerErrorCode,
  ) {
    super(message);
    this.name = 'VendorPaymentSellerMappingError';
  }
}

function normalizeVendorId(vendorId: string) {
  const normalized = vendorId.trim().toLowerCase();
  if (!normalized) {
    throw new VendorPaymentSellerMappingError('Vendor id is required.', 'INVALID_VENDOR_ID');
  }

  return normalized;
}

export function normalizePaymentProvider(provider: PaymentProvider | string): PaymentProvider {
  const normalized = String(provider).trim().toUpperCase();
  if (normalized === PaymentProvider.PARATIKA) {
    return PaymentProvider.PARATIKA;
  }

  throw new VendorPaymentSellerMappingError('Unsupported payment provider.', 'UNSUPPORTED_PROVIDER');
}

export async function resolveVendorPaymentSellerId(provider: PaymentProvider | string, vendorId: string) {
  const normalizedProvider = normalizePaymentProvider(provider);
  const normalizedVendorId = normalizeVendorId(vendorId);

  const vendor = await prisma.vendor.findUnique({
    where: {
      id: normalizedVendorId,
    },
    select: {
      id: true,
    },
  });

  if (!vendor) {
    throw new VendorPaymentSellerMappingError('Vendor does not exist.', 'VENDOR_NOT_FOUND');
  }

  const mapping = await prisma.vendorPaymentProviderSeller.findUnique({
    where: {
      provider_vendorId: {
        provider: normalizedProvider,
        vendorId: normalizedVendorId,
      },
    },
    select: {
      externalSellerId: true,
      enabled: true,
    },
  });

  if (!mapping) {
    throw new VendorPaymentSellerMappingError('Vendor payment seller mapping is not configured.', 'MAPPING_MISSING');
  }

  if (!mapping.enabled) {
    throw new VendorPaymentSellerMappingError('Vendor payment seller mapping is disabled.', 'MAPPING_DISABLED');
  }

  return mapping.externalSellerId;
}

export async function seedVendorPaymentSellerMappings(client: typeof prisma = prisma) {
  for (const mapping of CONFIRMED_VENDOR_PAYMENT_SELLERS) {
    const vendor = await client.vendor.findUnique({
      where: {
        id: mapping.vendorId,
      },
      select: {
        id: true,
      },
    });

    if (!vendor) {
      throw new VendorPaymentSellerMappingError(
        `Cannot seed payment seller mapping because vendor ${mapping.vendorId} does not exist.`,
        'VENDOR_NOT_FOUND',
      );
    }

    await client.vendorPaymentProviderSeller.upsert({
      where: {
        provider_vendorId: {
          provider: mapping.provider,
          vendorId: mapping.vendorId,
        },
      },
      update: {
        externalSellerId: mapping.externalSellerId,
        enabled: true,
      },
      create: {
        vendorId: mapping.vendorId,
        provider: mapping.provider,
        externalSellerId: mapping.externalSellerId,
        enabled: true,
      },
    });
  }
}
