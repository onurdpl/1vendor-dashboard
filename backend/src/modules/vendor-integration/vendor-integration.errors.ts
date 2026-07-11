export class VendorIntegrationOrderStateError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'VendorIntegrationOrderStateError';
  }
}
