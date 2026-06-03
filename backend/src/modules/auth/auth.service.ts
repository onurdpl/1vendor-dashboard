import jwt from 'jsonwebtoken';
import type { UserRole } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';
import type { AuthLoginServiceTiming, AuthUserContext, AuthUserResponse, JwtPayload, LoginBody } from './auth.types.js';
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

  async function login(credentials: LoginBody) {
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
      return null;
    }

    timing.passwordHashMode = classifyPasswordHashScheme(user.passwordHash);
    const passwordVerificationStartedAt = startTimer();
    const passwordVerification = await verifyPasswordHash(user.passwordHash, credentials.password);
    timing.passwordVerificationMs = elapsedMs(passwordVerificationStartedAt);

    if (!passwordVerification.valid) {
      timing.serviceTotalMs = elapsedMs(serviceStartedAt);
      return null;
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
      token,
      user: authUser,
      timing,
    };
  }

  async function currentUserFromToken(token: string): Promise<AuthUserResponse | null> {
    try {
      const payload = verifyToken(token);
      return buildUserResponse(payload.sub);
    } catch {
      return null;
    }
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
    currentUserFromToken,
    requestContextFromToken,
  };
}
