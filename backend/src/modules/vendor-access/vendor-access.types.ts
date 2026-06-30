import type { AuthUserContext } from '../auth/auth.types.js';

export type VendorAccessScope = 'admin' | 'vendor';

export type RequestVendorContext = {
  vendorId: string;
  vendorName: string;
  vendorStatus: string;
  role: AuthUserContext['role'];
  accessScope: VendorAccessScope;
};

export type ResolveVendorResult =
  | {
      ok: true;
      context: RequestVendorContext;
    }
  | {
      ok: false;
      code: 400 | 403;
      message: string;
    };

declare module 'fastify' {
  interface FastifyRequest {
    vendorContext?: RequestVendorContext;
  }
}
