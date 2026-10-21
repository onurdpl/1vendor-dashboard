import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { hashPasswordArgon2id } from '../auth/password-hashing.js';

const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class VendorPasswordResetError extends Error {
  constructor(readonly code: string, readonly statusCode: number) {
    super(code);
    this.name = 'VendorPasswordResetError';
  }
}

export async function listVendorLoginUsers(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
  if (!vendor) throw new VendorPasswordResetError('vendor_not_found', 404);
  const links = await prisma.userVendorAccess.findMany({
    where: { vendorId },
    select: {
      user: {
        select: {
          id: true, name: true, email: true, role: true, status: true, credentialVersion: true,
          _count: { select: { vendorLinks: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  return {
    vendorId,
    users: links.map(({ user }) => ({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      vendorMembershipCount: user._count.vendorLinks,
      credentialVersion: user.credentialVersion,
      resetEligible: user.role === 'VENDOR' && user._count.vendorLinks === 1,
      ineligibilityReason: user.role !== 'VENDOR' ? 'target_not_vendor'
        : user._count.vendorLinks !== 1 ? 'multiple_vendor_memberships' : null,
    })),
  };
}

export async function getVendorPasswordResetOperation(vendorId: string, operationId: string) {
  if (!OPERATION_ID_PATTERN.test(operationId)) throw new VendorPasswordResetError('operation_not_found', 404);
  const audit = await prisma.vendorPasswordResetAudit.findUnique({
    where: { operationId },
    select: { operationId: true, vendorId: true, actorAdminUserId: true, targetUserId: true,
      eventType: true, createdAt: true, credentialVersion: true },
  });
  if (!audit || audit.vendorId !== vendorId) throw new VendorPasswordResetError('operation_not_found', 404);
  return { ...audit, status: 'COMMITTED' as const };
}

export async function resetVendorUserPassword(input: {
  vendorId: string;
  targetUserId: string;
  actorAdminUserId: string;
  operationId: string;
  expectedCredentialVersion: number;
}) {
  if (!OPERATION_ID_PATTERN.test(input.operationId) ||
      !Number.isSafeInteger(input.expectedCredentialVersion) || input.expectedCredentialVersion < 0) {
    throw new VendorPasswordResetError('invalid_reset_request', 400);
  }

  const temporaryPassword = `spg_${randomBytes(18).toString('base64url')}`;
  const passwordHash = await hashPasswordArgon2id(temporaryPassword);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const previous = await tx.vendorPasswordResetAudit.findUnique({
        where: { operationId: input.operationId }, select: { operationId: true },
      });
      if (previous) throw new VendorPasswordResetError('operation_already_committed', 409);

      const actor = await tx.user.findUnique({
        where: { id: input.actorAdminUserId }, select: { role: true, status: true },
      });
      if (actor?.role !== 'ADMIN' || actor.status !== 'active') {
        throw new VendorPasswordResetError('admin_authority_lost', 403);
      }

      const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId }, select: { id: true } });
      if (!vendor) throw new VendorPasswordResetError('vendor_not_found', 404);

      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.targetUserId} FOR UPDATE`;
      const target = await tx.user.findUnique({
        where: { id: input.targetUserId },
        select: { id: true, role: true, credentialVersion: true,
          vendorLinks: { select: { vendorId: true } } },
      });
      if (!target || !target.vendorLinks.some((link) => link.vendorId === input.vendorId)) {
        throw new VendorPasswordResetError('target_vendor_mismatch', 404);
      }
      if (target.role !== 'VENDOR') throw new VendorPasswordResetError('target_not_vendor', 409);
      if (target.vendorLinks.length !== 1) throw new VendorPasswordResetError('multiple_vendor_memberships', 409);
      if (target.credentialVersion !== input.expectedCredentialVersion) {
        throw new VendorPasswordResetError('credential_version_conflict', 409);
      }

      const updated = await tx.user.update({
        where: { id: target.id },
        data: { passwordHash, credentialVersion: { increment: 1 } },
        select: { credentialVersion: true },
      });
      const audit = await tx.vendorPasswordResetAudit.create({
        data: {
          operationId: input.operationId,
          actorAdminUserId: input.actorAdminUserId,
          targetUserId: target.id,
          vendorId: input.vendorId,
          eventType: 'PASSWORD_RESET',
          credentialVersion: updated.credentialVersion,
        },
        select: { createdAt: true },
      });
      return { operationId: input.operationId, vendorId: input.vendorId, targetUserId: target.id,
        credentialVersion: updated.credentialVersion, createdAt: audit.createdAt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { ...result, temporaryPassword };
  } catch (error) {
    if (error instanceof VendorPasswordResetError) throw error;
    const known = error instanceof Prisma.PrismaClientKnownRequestError ? error : null;
    const concurrencyAbort = known?.code === 'P2034' ||
      (known?.code === 'P2010' && known.meta?.code === '40001');
    if (known?.code === 'P2002' || concurrencyAbort) {
      try {
        const existing = await prisma.vendorPasswordResetAudit.findUnique({
          where: { operationId: input.operationId }, select: { operationId: true },
        });
        if (existing) throw new VendorPasswordResetError('operation_already_committed', 409);
        const current = await prisma.user.findUnique({
          where: { id: input.targetUserId }, select: { credentialVersion: true },
        });
        if (current && current.credentialVersion !== input.expectedCredentialVersion) {
          throw new VendorPasswordResetError('credential_version_conflict', 409);
        }
      } catch (readError) {
        if (readError instanceof VendorPasswordResetError) throw readError;
      }
    }
    // A failed acknowledgement may follow a committed transaction. Never replay automatically.
    throw new VendorPasswordResetError('reset_outcome_unknown', 503);
  }
}
