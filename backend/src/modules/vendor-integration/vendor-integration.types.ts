export type VendorIntegrationContext = {
  clientId: string;
  vendorIdentifier: string;
  providerName: string;
  scopes: string[];
};

declare module 'fastify' {
  interface FastifyRequest {
    vendorIntegration?: VendorIntegrationContext;
  }
}
