import type { VendorIntegrationProviderCode } from '@prisma/client';

export type VendorIntegrationContext = {
  clientId: string;
  vendorIdentifier: string;
  providerName: string;
  providerCode: VendorIntegrationProviderCode | null;
  scopes: string[];
};

declare module 'fastify' {
  interface FastifyRequest {
    vendorIntegration?: VendorIntegrationContext;
  }
}
