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

export type AuthFailureStage = 'missing_token' | 'jwt_verify' | 'user_lookup' | null;

export type AuthRestoreDiagnostics = {
  cookiePresent: boolean;
  authorizationBearerPresent: boolean;
  jwtVerifySuccess: boolean;
  userLookupSuccess: boolean;
  authFailureStage: AuthFailureStage;
  selectedSessionSource: 'bearer' | 'cookie' | null;
  attemptedSessionSources: Array<'bearer' | 'cookie'>;
};

export type AuthLoginServiceTiming = {
  dbConnectionAcquisitionMs: number | null;
  dbConnectionAcquisitionMode: 'probed' | 'not_probed';
  userLookupMs: number;
  passwordVerificationMs: number;
  vendorAccessLookupMs: number;
  vendorAccessLookupMode: 'separate_query' | 'included_in_user_lookup';
  tokenSignMs: number;
  serviceTotalMs: number;
  passwordHashMode: 'argon2id' | 'demo_sha256_v1' | 'bcrypt' | 'other';
};

export type AuthLoginRouteTiming = AuthLoginServiceTiming & {
  routeEntryToBodyValidationMs: number;
  routeEntryToServiceStartMs: number;
  responsePreparationMs: number;
  responseSerializationMs: number;
  routeHandlerMs: number;
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
    authUserResponse?: AuthUserResponse;
    authSessionSource?: 'bearer' | 'cookie';
    authSessionToken?: string;
    authDiagnostics?: AuthRestoreDiagnostics;
    authSessionValidationDurationMs?: number;
    authSessionUserLookupDurationMs?: number;
    authFailureReason?: 'missing_cookie' | 'invalid_token' | 'expired_token' | 'user_not_found' | 'unknown';
  }
}
