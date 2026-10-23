import type { FastifyRequest } from 'fastify';
import { prisma } from '../../db/prisma.js';
import type { AuthUserContext } from '../auth/auth.types.js';

export type AdminVendorTargetResult =
  | {
      ok: true;
      actor: AuthUserContext & { role: 'admin' };
      vendor: { id: string; name: string; status: string };
    }
  | {
      ok: false;
      code: 400 | 401 | 403 | 404;
      message: string;
    };

export function readAdminVendorTargetHeader(request: Pick<FastifyRequest, 'raw' | 'headers'>): string | null {
  const rawHeaders = request.raw.rawHeaders;
  if (!Array.isArray(rawHeaders) || rawHeaders.length % 2 !== 0) return null;

  let targetCount = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === 'x-vendor-id') targetCount += 1;
  }

  const target = request.headers['x-vendor-id'];
  if (targetCount !== 1 || typeof target !== 'string' || target.includes(',')) return null;
  return target;
}

// Call only after authenticateRequest. This helper accepts one explicit, structured
// target source; future routes must reject conflicting URL/header sources before use.
export async function resolveAdminVendorTarget(
  request: Pick<FastifyRequest, 'authUser'>,
  explicitVendorId: unknown,
): Promise<AdminVendorTargetResult> {
  const actor = request.authUser;
  if (!actor) {
    return { ok: false, code: 401, message: 'Unauthorized' };
  }
  if (actor.role !== 'admin') {
    return { ok: false, code: 403, message: 'Admin access required.' };
  }
  if (typeof explicitVendorId !== 'string' || !explicitVendorId.trim()) {
    return { ok: false, code: 400, message: 'A single explicit vendor ID is required.' };
  }

  const vendor = await prisma.vendor.findUnique({
    where: { id: explicitVendorId.trim() },
    select: { id: true, name: true, status: true },
  });
  if (!vendor) {
    return { ok: false, code: 404, message: 'Vendor not found.' };
  }

  return { ok: true, actor: { ...actor, role: 'admin' }, vendor };
}
