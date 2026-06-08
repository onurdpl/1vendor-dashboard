import jwt from 'jsonwebtoken';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { UserRole } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';
import type { AuthFailureStage, AuthLoginServiceTiming, AuthUserContext, AuthUserResponse, JwtPayload, LoginBody } from './auth.types.js';
import { mapRole } from './auth.types.js';
import { classifyPasswordHashScheme, hashPasswordArgon2id, verifyPasswordHash } from './password-hashing.js';

const AUTH_LOGIN_DB_PROBE_ENABLED = process.env.AUTH_LOGIN_DB_PROBE_ENABLED === 'true';

type UserRecordWithVendorLinks = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: string;
  passwordHash?: string;
  vendorLinks: Array<{
    vendor: {
      id: string;
      name: string;
    };
  }>;
};

type AuthLoginFailureReason = 'user_not_found' | 'invalid_password' | 'inactive_user' | 'unknown';

type AuthLoginDiagnosticResult =
  | {
      success: true;
      token: string;
      user: AuthUserResponse;
      timing: AuthLoginServiceTiming;
      failureStage: null;
      failureReason: null;
    }
  | {
      success: false;
      token: null;
      user: null;
      timing: AuthLoginServiceTiming;
      failureStage: 'user_lookup' | 'password_verify' | 'user_status' | 'unknown';
      failureReason: AuthLoginFailureReason;
    };

function startTimer() {
  return process.hrtime.bigint();
}

function elapsedMs(startedAt: bigint) {
  return Math.max(0, Math.round((Number(process.hrtime.bigint() - startedAt) / 1_000_000) * 10) / 10);
}

function createInitialLoginTiming(): AuthLoginServiceTiming {
  return {
    dbConnectionAcquisitionMs: null,
    dbConnectionAcquisitionMode: AUTH_LOGIN_DB_PROBE_ENABLED ? 'probed' : 'not_probed',
    userLookupMs: 0,
    passwordVerificationMs: 0,
    vendorAccessLookupMs: 0,
    vendorAccessLookupMode: 'included_in_user_lookup',
    tokenSignMs: 0,
    serviceTotalMs: 0,
    passwordHashMode: 'other',
  };
}

function mapUserRecordToAuthResponse(user: UserRecordWithVendorLinks): AuthUserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: mapRole(user.role),
    status: user.status,
    vendorAccess: user.vendorLinks.map((link) => ({
      vendorId: link.vendor.id,
      vendorName: link.vendor.name,
    })),
  };
}

export function createAuthService(env: AppEnv) {
  function signToken(payload: JwtPayload) {
    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });
  }

  function verifyToken(token: string) {
    return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  }

  function createCsrfToken(sessionToken: string) {
    return createHmac('sha256', env.JWT_SECRET)
      .update(`csrf:${sessionToken}`)
      .digest('base64url');
  }

  function verifyCsrfToken(sessionToken: string, providedToken: string | null | undefined) {
    if (!providedToken) {
      return false;
    }

    const expected = Buffer.from(createCsrfToken(sessionToken));
    const provided = Buffer.from(providedToken);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }

  async function buildUserResponse(userId: string): Promise<AuthUserResponse | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        vendorLinks: {
          include: {
            vendor: true,
          },
        },
      },
    });

    if (!user) {
      return null;
    }

    return mapUserRecordToAuthResponse(user);
  }

  async function loginWithDiagnostics(credentials: LoginBody): Promise<AuthLoginDiagnosticResult> {
    const serviceStartedAt = startTimer();
    const timing = createInitialLoginTiming();

    if (AUTH_LOGIN_DB_PROBE_ENABLED) {
      const dbConnectionStartedAt = startTimer();
      await prisma.$queryRaw`SELECT 1`;
      timing.dbConnectionAcquisitionMs = elapsedMs(dbConnectionStartedAt);
    }

    const userLookupStartedAt = startTimer();
    const user = await prisma.user.findUnique({
      where: { email: credentials.email.trim().toLowerCase() },
      include: {
        vendorLinks: {
          include: {
            vendor: true,
          },
        },
      },
    });
    timing.userLookupMs = elapsedMs(userLookupStartedAt);

    if (!user) {
      timing.serviceTotalMs = elapsedMs(serviceStartedAt);
      return {
        success: false,
        token: null,
        user: null,
        timing,
        failureStage: 'user_lookup',
        failureReason: 'user_not_found',
      };
    }

    timing.passwordHashMode = classifyPasswordHashScheme(user.passwordHash);
    const passwordVerificationStartedAt = startTimer();
    const passwordVerification = await verifyPasswordHash(user.passwordHash, credentials.password);
    timing.passwordVerificationMs = elapsedMs(passwordVerificationStartedAt);

    if (!passwordVerification.valid) {
      timing.serviceTotalMs = elapsedMs(serviceStartedAt);
      return {
        success: false,
        token: null,
        user: null,
        timing,
        failureStage: 'password_verify',
        failureReason: 'invalid_password',
      };
    }

    if (passwordVerification.needsMigration) {
      const migratedPasswordHash = await hashPasswordArgon2id(credentials.password);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: migratedPasswordHash,
        },
      });
    }

    const authUser = mapUserRecordToAuthResponse(user);
    const tokenSignStartedAt = startTimer();
    const token = signToken({
      sub: authUser.id,
      email: authUser.email,
      role: authUser.role,
    });
    timing.tokenSignMs = elapsedMs(tokenSignStartedAt);
    timing.serviceTotalMs = elapsedMs(serviceStartedAt);

    return {
      success: true,
      token,
      user: authUser,
      timing,
      failureStage: null,
      failureReason: null,
    };
  }

  async function login(credentials: LoginBody) {
    const result = await loginWithDiagnostics(credentials);
    if (!result.success) {
      return null;
    }

    return {
      token: result.token,
      user: result.user,
      timing: result.timing,
    };
  }

  async function inspectToken(token: string): Promise<{
    jwtVerifySuccess: boolean;
    userLookupSuccess: boolean;
    authFailureStage: AuthFailureStage;
    authFailureReason: 'invalid_token' | 'expired_token' | 'user_not_found' | null;
    user: AuthUserResponse | null;
  }> {
    let payload: JwtPayload;
    try {
      payload = verifyToken(token);
    } catch (error) {
      return {
        jwtVerifySuccess: false,
        userLookupSuccess: false,
        authFailureStage: 'jwt_verify',
        authFailureReason: error instanceof jwt.TokenExpiredError ? 'expired_token' : 'invalid_token',
        user: null,
      };
    }

    const user = await buildUserResponse(payload.sub);
    return {
      jwtVerifySuccess: true,
      userLookupSuccess: Boolean(user),
      authFailureStage: user ? null : 'user_lookup',
      authFailureReason: user ? null : 'user_not_found',
      user,
    };
  }

  async function currentUserFromToken(token: string): Promise<AuthUserResponse | null> {
    return (await inspectToken(token)).user;
  }

  async function requestContextFromToken(token: string): Promise<AuthUserContext | null> {
    const user = await currentUserFromToken(token);
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
    };
  }

  return {
    login,
    loginWithDiagnostics,
    currentUserFromToken,
    requestContextFromToken,
    inspectToken,
    createCsrfToken,
    verifyCsrfToken,
  };
}
