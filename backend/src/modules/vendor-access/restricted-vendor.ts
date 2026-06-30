import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../db/prisma.js';

export const RESTRICTED_VENDOR_MESSAGE =
  'Your account is temporarily restricted. Please contact support if you believe this is incorrect.';

export class RestrictedVendorError extends Error {
  readonly statusCode = 403;

  constructor(message = RESTRICTED_VENDOR_MESSAGE) {
    super(message);
    this.name = 'RestrictedVendorError';
  }
}

export function isVendorRestrictedStatus(status: string | null | undefined) {
  return String(status ?? '').trim().toLowerCase() !== 'active';
}

export async function getVendorOperationalRestriction(vendorId: string | null | undefined) {
  const normalizedVendorId = vendorId?.trim();
  if (!normalizedVendorId) {
    return null;
  }

  const vendor = await prisma.vendor.findUnique({
    where: {
      id: normalizedVendorId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!vendor || !isVendorRestrictedStatus(vendor.status)) {
    return null;
  }

  return {
    vendorId: vendor.id,
    status: vendor.status,
    message: RESTRICTED_VENDOR_MESSAGE,
  };
}

export async function assertVendorOperationalAccess(vendorId: string | null | undefined) {
  const restriction = await getVendorOperationalRestriction(vendorId);
  if (restriction) {
    throw new RestrictedVendorError();
  }
}

export async function requireUnrestrictedVendorMutation(request: FastifyRequest, reply: FastifyReply) {
  if (request.authUser?.role === 'admin') {
    return;
  }

  const restriction = await getVendorOperationalRestriction(request.vendorContext?.vendorId);
  if (restriction) {
    return reply.code(403).send({ message: RESTRICTED_VENDOR_MESSAGE });
  }
}

export function sendRestrictedVendorError(error: unknown, reply: FastifyReply) {
  if (error instanceof RestrictedVendorError) {
    return reply.code(error.statusCode).send({ message: error.message });
  }
  return null;
}
