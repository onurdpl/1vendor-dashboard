import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../../db/prisma.js';

export type CreateVendorIntegrationClientInput = {
  vendorIdentifier: string;
  providerName: string;
  scopes: string[];
};

export type CreatedVendorIntegrationClientToken = {
  clientId: string;
  vendorIdentifier: string;
  providerName: string;
  scopes: string[];
  token: string;
};

type VendorIntegrationClientStore = Pick<typeof prisma, 'vendorIntegrationClient'>;

export function generateVendorIntegrationToken() {
  return `spg_vi_${randomBytes(32).toString('base64url')}`;
}

export function hashVendorIntegrationToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function normalizeVendorIntegrationScopes(scopes: string[]) {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
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
