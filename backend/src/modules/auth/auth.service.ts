import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';
import type { AuthUserContext, AuthUserResponse, JwtPayload, LoginBody } from './auth.types.js';
import { mapRole } from './auth.types.js';

const DEMO_HASH_PREFIX = 'demo_sha256_v1:';

function makeDemoPasswordHash(password: string) {
  return `${DEMO_HASH_PREFIX}${createHash('sha256').update(`vendor-dashboard-demo:${password}`).digest('hex')}`;
}

function verifyDemoPassword(storedPasswordHash: string, rawPassword: string) {
  if (!storedPasswordHash.startsWith(DEMO_HASH_PREFIX)) {
    return false;
  }

  return storedPasswordHash === makeDemoPasswordHash(rawPassword);
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

  async function login(credentials: LoginBody) {
    const user = await prisma.user.findUnique({
      where: { email: credentials.email.trim().toLowerCase() },
    });

    if (!user || !verifyDemoPassword(user.passwordHash, credentials.password)) {
      return null;
    }

    const authUser = await buildUserResponse(user.id);
    if (!authUser) {
      return null;
    }

    const token = signToken({
      sub: authUser.id,
      email: authUser.email,
      role: authUser.role,
    });

    return {
      token,
      user: authUser,
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
