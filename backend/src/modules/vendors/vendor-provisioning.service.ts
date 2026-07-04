import { randomBytes } from 'node:crypto';
import { Prisma, VendorProfileSnapshotImpact } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { hashPasswordArgon2id } from '../auth/password-hashing.js';
import type { VendorProfileAuditActor } from './vendor-profile-audit-log.service.js';

const VENDOR_STATUS_RESTRICTED = 'inactive';
const TEMPORARY_PASSWORD_BYTES = 18;
const MAX_REASON_LENGTH = 500;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VENDOR_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export type VendorProvisioningInputDto = {
  vendorId?: unknown;
  vendorName?: unknown;
  adminName?: unknown;
  adminEmail?: unknown;
  restrictionReason?: unknown;
  adminPhone?: unknown;
};

export type VendorProvisioningResultDto = {
  vendorId: string;
  vendorName: string;
  adminUserId: string;
  adminEmail: string;
  temporaryPassword: string;
  vendorStatus: string;
  restrictionReason: string;
};

export class VendorProvisioningError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'VendorProvisioningError';
    this.statusCode = statusCode;
  }
}

function requireTrimmedString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new VendorProvisioningError(`${fieldName} is required.`);
  }
  return value.trim();
}

export function normalizeProvisionedVendorId(value: unknown) {
  const vendorId = requireTrimmedString(value, 'vendorId');

  if (vendorId.includes('/') || vendorId.includes('\\')) {
    throw new VendorProvisioningError('vendorId must not contain path separators.');
  }

  if (CONTROL_CHARACTER_PATTERN.test(vendorId)) {
    throw new VendorProvisioningError('vendorId must not contain control characters.');
  }

  if (!VENDOR_ID_PATTERN.test(vendorId)) {
    throw new VendorProvisioningError(
      'vendorId must use lowercase letters, numbers, hyphen, or underscore so it matches Shopify seller_info after current ingestion normalization.',
    );
  }

  return vendorId;
}

function normalizeProvisioningInput(input: VendorProvisioningInputDto) {
  const vendorId = normalizeProvisionedVendorId(input.vendorId);
  const vendorName = requireTrimmedString(input.vendorName, 'vendorName');
  const adminName = requireTrimmedString(input.adminName, 'adminName');
  const adminEmail = requireTrimmedString(input.adminEmail, 'adminEmail').toLowerCase();
  const restrictionReason = requireTrimmedString(input.restrictionReason, 'restrictionReason');

  if (!EMAIL_PATTERN.test(adminEmail)) {
    throw new VendorProvisioningError('adminEmail must be a valid email address.');
  }

  if (restrictionReason.length > MAX_REASON_LENGTH) {
    throw new VendorProvisioningError(`restrictionReason must be ${MAX_REASON_LENGTH} characters or fewer.`);
  }

  return {
    vendorId,
    vendorName,
    adminName,
    adminEmail,
    restrictionReason,
  };
}

function generateTemporaryPassword() {
  return `spg_${randomBytes(TEMPORARY_PASSWORD_BYTES).toString('base64url')}`;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function provisionVendor(
  input: VendorProvisioningInputDto,
  options: {
    actor?: VendorProfileAuditActor | null;
  } = {},
): Promise<VendorProvisioningResultDto> {
  const normalized = normalizeProvisioningInput(input);

  const existingVendor = await prisma.vendor.findUnique({
    where: { id: normalized.vendorId },
    select: { id: true },
  });
  if (existingVendor) {
    throw new VendorProvisioningError('A vendor with this ID already exists.', 409);
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: normalized.adminEmail },
    select: { id: true },
  });
  if (existingUser) {
    throw new VendorProvisioningError('A user with this email already exists.', 409);
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPasswordArgon2id(temporaryPassword);
  const restrictedAt = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.create({
        data: {
          id: normalized.vendorId,
          name: normalized.vendorName,
          status: VENDOR_STATUS_RESTRICTED,
          restrictionReason: normalized.restrictionReason,
          restrictedByUserId: options.actor?.userId ?? null,
          restrictedAt,
        },
        select: {
          id: true,
          name: true,
          status: true,
          restrictionReason: true,
        },
      });

      const user = await tx.user.create({
        data: {
          email: normalized.adminEmail,
          name: normalized.adminName,
          role: 'VENDOR',
          status: 'active',
          passwordHash,
        },
        select: {
          id: true,
          email: true,
        },
      });

      await tx.userVendorAccess.create({
        data: {
          userId: user.id,
          vendorId: vendor.id,
        },
      });

      await tx.vendorProfileAuditLog.createMany({
        data: [
          {
            vendorId: vendor.id,
            section: 'vendor_status',
            fieldName: 'status',
            oldValue: Prisma.JsonNull,
            newValue: vendor.status,
            changedByUserId: options.actor?.userId ?? null,
            changedByEmail: options.actor?.email ?? null,
            reason: normalized.restrictionReason,
            snapshotImpact: VendorProfileSnapshotImpact.UNKNOWN,
            source: 'admin_vendor_provisioning',
          },
        ],
      });

      return {
        vendorId: vendor.id,
        vendorName: vendor.name,
        adminUserId: user.id,
        adminEmail: user.email,
        vendorStatus: vendor.status,
        restrictionReason: vendor.restrictionReason ?? normalized.restrictionReason,
      };
    });

    return {
      ...result,
      temporaryPassword,
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new VendorProvisioningError('Vendor provisioning conflicts with an existing record.', 409);
    }
    throw error;
  }
}

export const __vendorProvisioningTesting = {
  normalizeProvisionedVendorId,
};
