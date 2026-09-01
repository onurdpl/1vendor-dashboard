import jwt from 'jsonwebtoken';
import type { AppEnv } from '../../config/env.js';

const CUSTOMER_GID_PATTERN = /^gid:\/\/shopify\/Customer\/[A-Za-z0-9_-]+$/;
const TOKEN_CLOCK_TOLERANCE_SECONDS = 5;
const MAX_TOKEN_LIFETIME_SECONDS = 5 * 60 + TOKEN_CLOCK_TOLERANCE_SECONDS;

export type CustomerAccountSession = {
  shopDomain: string;
  customerGid: string;
  audience: string;
  tokenId: string;
  issuedAt: number;
  expiresAt: number;
};

export class CustomerAccountAuthConfigurationError extends Error {
  readonly code = 'CUSTOMER_ACCOUNT_AUTH_NOT_CONFIGURED';
  readonly statusCode = 503;

  constructor() {
    super('Customer Account authentication is not configured.');
    this.name = 'CustomerAccountAuthConfigurationError';
    Object.setPrototypeOf(this, CustomerAccountAuthConfigurationError.prototype);
  }
}

export class CustomerAccountSessionTokenError extends Error {
  readonly code = 'CUSTOMER_SESSION_INVALID';
  readonly statusCode = 401;

  constructor() {
    super('Customer Account session is missing or invalid.');
    this.name = 'CustomerAccountSessionTokenError';
    Object.setPrototypeOf(this, CustomerAccountSessionTokenError.prototype);
  }
}

function normalizeShopHostname(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim().toLowerCase();
  try {
    const url = new URL(normalized.includes('://') ? normalized : `https://${normalized}`);
    if (url.username || url.password || url.port || (url.pathname && url.pathname !== '/')) return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeIssuerHostname(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function readRequiredNumber(payload: jwt.JwtPayload, key: 'exp' | 'nbf' | 'iat') {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CustomerAccountSessionTokenError();
  }
  return value;
}

export function createCustomerAccountSessionTokenVerifier(env: AppEnv) {
  function verifySessionToken(token: string): CustomerAccountSession {
    const clientId = env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID?.trim();
    const clientSecret = env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET?.trim();
    const configuredShop = normalizeShopHostname(env.SHOPIFY_SHOP_DOMAIN);
    if (!clientId || !clientSecret || !configuredShop) {
      throw new CustomerAccountAuthConfigurationError();
    }

    try {
      const payload = jwt.verify(token, clientSecret, {
        algorithms: ['HS256'],
        audience: clientId,
        clockTolerance: TOKEN_CLOCK_TOLERANCE_SECONDS,
      });
      if (!payload || typeof payload === 'string') {
        throw new CustomerAccountSessionTokenError();
      }

      const expiresAt = readRequiredNumber(payload, 'exp');
      const notBefore = readRequiredNumber(payload, 'nbf');
      const issuedAt = readRequiredNumber(payload, 'iat');
      const now = Math.floor(Date.now() / 1000);
      if (
        issuedAt > now + TOKEN_CLOCK_TOLERANCE_SECONDS ||
        expiresAt <= issuedAt ||
        expiresAt - issuedAt > MAX_TOKEN_LIFETIME_SECONDS
      ) {
        throw new CustomerAccountSessionTokenError();
      }

      const destination = normalizeShopHostname(payload.dest);
      if (!destination || destination !== configuredShop) {
        throw new CustomerAccountSessionTokenError();
      }
      if (payload.iss !== undefined) {
        const issuer = normalizeIssuerHostname(payload.iss);
        if (!issuer || issuer !== destination) {
          throw new CustomerAccountSessionTokenError();
        }
      }

      if (typeof payload.sub !== 'string' || !CUSTOMER_GID_PATTERN.test(payload.sub)) {
        throw new CustomerAccountSessionTokenError();
      }
      if (typeof payload.jti !== 'string' || !payload.jti.trim()) {
        throw new CustomerAccountSessionTokenError();
      }

      return {
        shopDomain: destination,
        customerGid: payload.sub,
        audience: clientId,
        tokenId: payload.jti,
        issuedAt,
        expiresAt,
      };
    } catch (error) {
      if (error instanceof CustomerAccountSessionTokenError) throw error;
      throw new CustomerAccountSessionTokenError();
    }
  }

  return { verifySessionToken };
}
