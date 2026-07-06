import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { isVendorRestrictedStatus } from '../vendor-access/restricted-vendor.js';

const DEFAULT_VENDOR_DIRECTORY_LIMIT = 100;
const MAX_VENDOR_DIRECTORY_LIMIT = 200;
const SUPPORTED_DIRECTORY_STATUSES = new Set(['all', 'active', 'restricted']);

export type VendorDirectoryStatusFilter = 'all' | 'active' | 'restricted';

export type VendorDirectoryQueryDto = {
  search?: unknown;
  status?: unknown;
  limit?: unknown;
};

export type VendorDirectoryItemDto = {
  vendorId: string;
  vendorName: string;
  status: string;
  statusLabel: 'Active' | 'Restricted';
  restrictionReason: string | null;
  restrictedAt: string | null;
  updatedAt: string;
  createdAt: string;
  profileUrl: string;
};

export type VendorDirectoryDto = {
  vendors: VendorDirectoryItemDto[];
  generatedAt: string;
  filters: {
    search: string | null;
    status: VendorDirectoryStatusFilter;
    limit: number;
  };
};

export class VendorDirectoryError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'VendorDirectoryError';
  }
}

function normalizeSearch(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const search = value.trim();
  return search ? search : null;
}

function normalizeStatus(value: unknown): VendorDirectoryStatusFilter {
  if (value === undefined || value === null || value === '') {
    return 'all';
  }

  if (typeof value !== 'string') {
    throw new VendorDirectoryError('status must be all, active, or restricted.');
  }

  const normalized = value.trim().toLowerCase();
  if (!SUPPORTED_DIRECTORY_STATUSES.has(normalized)) {
    throw new VendorDirectoryError('status must be all, active, or restricted.');
  }

  return normalized as VendorDirectoryStatusFilter;
}

function normalizeLimit(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_VENDOR_DIRECTORY_LIMIT;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new VendorDirectoryError('limit must be a positive number.');
  }

  return Math.min(Math.round(parsed), MAX_VENDOR_DIRECTORY_LIMIT);
}

function mapVendorDirectoryItem(vendor: {
  id: string;
  name: string;
  status: string;
  restrictionReason: string | null;
  restrictedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}): VendorDirectoryItemDto {
  const restricted = isVendorRestrictedStatus(vendor.status);

  return {
    vendorId: vendor.id,
    vendorName: vendor.name,
    status: vendor.status,
    statusLabel: restricted ? 'Restricted' : 'Active',
    restrictionReason: restricted ? vendor.restrictionReason ?? null : null,
    restrictedAt: restricted ? vendor.restrictedAt?.toISOString() ?? null : null,
    updatedAt: vendor.updatedAt.toISOString(),
    createdAt: vendor.createdAt.toISOString(),
    profileUrl: `/admin/vendors/${encodeURIComponent(vendor.id)}`,
  };
}

export async function listAdminVendorDirectory(query: VendorDirectoryQueryDto = {}): Promise<VendorDirectoryDto> {
  const search = normalizeSearch(query.search);
  const status = normalizeStatus(query.status);
  const limit = normalizeLimit(query.limit);
  const where: Prisma.VendorWhereInput = {};

  if (search) {
    where.OR = [
      { id: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (status === 'active') {
    where.status = 'active';
  } else if (status === 'restricted') {
    where.status = { not: 'active' };
  }

  const vendors = await prisma.vendor.findMany({
    where,
    select: {
      id: true,
      name: true,
      status: true,
      restrictionReason: true,
      restrictedAt: true,
      updatedAt: true,
      createdAt: true,
    },
    orderBy: [
      { updatedAt: 'desc' },
      { createdAt: 'desc' },
    ],
    take: limit,
  });

  return {
    vendors: vendors.map(mapVendorDirectoryItem),
    generatedAt: new Date().toISOString(),
    filters: {
      search,
      status,
      limit,
    },
  };
}

export const __vendorDirectoryTesting = {
  normalizeSearch,
  normalizeStatus,
  normalizeLimit,
};
