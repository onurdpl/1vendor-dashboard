import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../db/prisma.js';
import { getVendorOperationalRestriction, RESTRICTED_VENDOR_MESSAGE } from '../vendor-access/restricted-vendor.js';
import { rateLimitInvalidVendorIntegrationAttempt } from './vendor-integration.rate-limit.js';
import { hashVendorIntegrationToken } from './vendor-integration.tokens.js';
import './vendor-integration.types.js';

function extractBearerToken(header: string | undefined) {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || !token?.trim()) {
    return null;
  }

  return token.trim();
}

export async function authenticateVendorIntegrationRequest(request: FastifyRequest, reply: FastifyReply) {
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    const rateLimited = rateLimitInvalidVendorIntegrationAttempt(request, reply);
    if (rateLimited) {
      return rateLimited;
    }
    return reply.code(401).send({ message: 'Vendor integration token is required.' });
  }

  const tokenHash = hashVendorIntegrationToken(token);
  const client = await prisma.vendorIntegrationClient.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      vendorIdentifier: true,
      providerName: true,
      enabled: true,
      scopes: true,
      revokedAt: true,
    },
  });

  if (!client) {
    const rateLimited = rateLimitInvalidVendorIntegrationAttempt(request, reply);
    if (rateLimited) {
      return rateLimited;
    }
    return reply.code(401).send({ message: 'Vendor integration token is invalid.' });
  }

  if (!client.enabled || client.revokedAt) {
    return reply.code(403).send({ message: 'Vendor integration token is disabled or revoked.' });
  }

  request.vendorIntegration = {
    clientId: client.id,
    vendorIdentifier: client.vendorIdentifier,
    providerName: client.providerName,
    scopes: client.scopes,
  };

  await prisma.vendorIntegrationClient.update({
    where: { id: client.id },
    data: { lastUsedAt: new Date() },
    select: { id: true },
  });
}

export function requireVendorIntegrationScope(scope: string) {
  return async function requireScope(request: FastifyRequest, reply: FastifyReply) {
    if (!request.vendorIntegration?.scopes.includes(scope)) {
      return reply.code(403).send({ message: `Missing required scope: ${scope}` });
    }
  };
}

export async function requireUnrestrictedVendorIntegration(request: FastifyRequest, reply: FastifyReply) {
  const restriction = await getVendorOperationalRestriction(request.vendorIntegration?.vendorIdentifier);
  if (restriction) {
    return reply.code(403).send({ message: RESTRICTED_VENDOR_MESSAGE });
  }
}

export async function writeVendorIntegrationAuditLog(request: FastifyRequest, reply: FastifyReply) {
  const context = request.vendorIntegration;
  if (!context) {
    return;
  }

  await prisma.vendorIntegrationAuditLog.create({
    data: {
      clientId: context.clientId,
      vendorIdentifier: context.vendorIdentifier,
      method: request.method,
      path: request.url.slice(0, 512),
      statusCode: reply.statusCode,
      requestId: request.requestId ?? request.id ?? null,
    },
    select: { id: true },
  });
}
