import type { FastifyRequest } from 'fastify';
import type { UserRole } from '@prisma/client';

export type AuthRole = 'admin' | 'vendor' | 'support' | 'finance';

export type AuthUserContext = {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  status: string;
};

export type LoginBody = {
  email: string;
  password: string;
};

export type AuthVendorAccess = {
  vendorId: string;
  vendorName: string;
};

export type AuthUserResponse = AuthUserContext & {
  vendorAccess: AuthVendorAccess[];
};

export type JwtPayload = {
  sub: string;
  email: string;
  role: AuthRole;
};

export function mapRole(role: UserRole): AuthRole {
  switch (role) {
    case 'ADMIN':
      return 'admin';
    case 'VENDOR':
      return 'vendor';
    case 'SUPPORT':
      return 'support';
    case 'FINANCE':
      return 'finance';
    default:
      return 'vendor';
  }
}

export function requireAuthUser(request: FastifyRequest): AuthUserContext {
  if (!request.authUser) {
    throw new Error('Unauthorized');
  }

  return request.authUser;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUserContext;
  }
}

