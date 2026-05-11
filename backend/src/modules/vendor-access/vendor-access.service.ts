import { prisma } from '../../db/prisma.js';
import type { AuthUserContext } from '../auth/auth.types.js';
import type { ResolveVendorResult } from './vendor-access.types.js';

function readRequestedVendorId(headerValue: string | string[] | undefined, explicitVendorId?: string | null) {
  if (explicitVendorId) {
    return explicitVendorId.trim();
  }

  if (!headerValue) {
    return null;
  }

  if (Array.isArray(headerValue)) {
    return headerValue[0]?.trim() || null;
  }

  return headerValue.trim() || null;
}

export async function resolveRequestVendorContext(
  user: AuthUserContext,
  requestedVendorIdFromHeader?: string | string[] | undefined,
  explicitVendorId?: string | null,
): Promise<ResolveVendorResult> {
  const requestedVendorId = readRequestedVendorId(requestedVendorIdFromHeader, explicitVendorId);
  const vendorLinks = await prisma.userVendorAccess.findMany({
    where: { userId: user.id },
    include: { vendor: true },
    orderBy: { vendorId: 'asc' },
  });

  if (vendorLinks.length === 0) {
    return {
      ok: false,
      code: 403,
      message: 'No vendor access is configured for this user.',
    };
  }

  const allowedVendorMap = new Map(vendorLinks.map((link) => [link.vendorId, link.vendor.name]));

  if (user.role === 'admin') {
    if (!requestedVendorId) {
      const first = vendorLinks[0];
      if (!first) {
        return {
          ok: false,
          code: 400,
          message: 'No vendor context could be resolved.',
        };
      }

      return {
        ok: true,
        context: {
          vendorId: first.vendorId,
          vendorName: first.vendor.name,
          role: user.role,
          accessScope: 'admin',
        },
      };
    }

    const vendorName = allowedVendorMap.get(requestedVendorId);
    if (!vendorName) {
      return {
        ok: false,
        code: 403,
        message: 'Requested vendor is not allowed for this user.',
      };
    }

    return {
      ok: true,
      context: {
        vendorId: requestedVendorId,
        vendorName,
        role: user.role,
        accessScope: 'admin',
      },
    };
  }

  if (!requestedVendorId) {
    if (vendorLinks.length === 1) {
      const only = vendorLinks[0];
      return {
        ok: true,
        context: {
          vendorId: only.vendorId,
          vendorName: only.vendor.name,
          role: user.role,
          accessScope: 'vendor',
        },
      };
    }

    return {
      ok: false,
      code: 400,
      message: 'Vendor context is required for this user.',
    };
  }

  const vendorName = allowedVendorMap.get(requestedVendorId);
  if (!vendorName) {
    return {
      ok: false,
      code: 403,
      message: 'Requested vendor is not allowed for this user.',
    };
  }

  return {
    ok: true,
    context: {
      vendorId: requestedVendorId,
      vendorName,
      role: user.role,
      accessScope: 'vendor',
    },
  };
}

