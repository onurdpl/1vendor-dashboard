import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../../db/prisma.js';

export const ALLOWED_VENDOR_INTEGRATION_SCOPES = [
  'orders:read',
  'status:write',
  'shipment:write',
  'invoice:write',
] as const;

const allowedVendorIntegrationScopes = new Set<string>(ALLOWED_VENDOR_INTEGRATION_SCOPES);

export type CreateVendorIntegrationClientInput = {
  vendorIdentifier: string;
  providerName: string;
  scopes: unknown[];
};

export type CreatedVendorIntegrationClientToken = {
  clientId: string;
  vendorIdentifier: string;
  providerName: string;
  scopes: string[];
  token: string;
};

type VendorIntegrationClientStore = Pick<typeof prisma, 'vendor' | 'vendorIntegrationClient'>;

export function generateVendorIntegrationToken() {
  return `spg_vi_${randomBytes(32).toString('base64url')}`;
}

export function hashVendorIntegrationToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function normalizeVendorIntegrationScopes(scopes: unknown[]) {
  const normalized = scopes.map((scope) => {
    if (typeof scope !== 'string') {
      throw new Error('Invalid vendor integration scope.');
    }

    return scope.trim();
  }).filter(Boolean);

  const invalidScope = normalized.find((scope) => !allowedVendorIntegrationScopes.has(scope));
  if (invalidScope) {
    throw new Error(`Unsupported vendor integration scope: ${invalidScope}`);
  }

  return [...new Set(normalized)].sort();
}

export async function createVendorIntegrationClientToken(
  input: CreateVendorIntegrationClientInput,
  store: VendorIntegrationClientStore = prisma,
): Promise<CreatedVendorIntegrationClientToken> {
  const vendorIdentifier = input.vendorIdentifier.trim();
  const providerName = input.providerName.trim();
  const scopes = normalizeVendorIntegrationScopes(input.scopes);

  if (!vendorIdentifier) {
    throw new Error('vendorIdentifier is required.');
  }

  if (!providerName) {
    throw new Error('providerName is required.');
  }

  if (scopes.length === 0) {
    throw new Error('At least one scope is required.');
  }

  const vendor = await store.vendor.findUnique({
    where: {
      id: vendorIdentifier,
    },
    select: {
      id: true,
    },
  });
  if (!vendor) {
    throw new Error('Vendor integration token requires an existing vendor.');
  }

  const token = generateVendorIntegrationToken();
  const tokenHash = hashVendorIntegrationToken(token);
  const client = await store.vendorIntegrationClient.create({
    data: {
      vendorIdentifier,
      providerName,
      scopes,
      tokenHash,
    },
    select: {
      id: true,
      vendorIdentifier: true,
      providerName: true,
      scopes: true,
    },
  });

  return {
    clientId: client.id,
    vendorIdentifier: client.vendorIdentifier,
    providerName: client.providerName,
    scopes: client.scopes,
    token,
  };
}
