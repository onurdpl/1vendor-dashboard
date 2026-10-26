import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { isVendorRestrictedStatus } from '../vendor-access/restricted-vendor.js';

const DEFAULT_VENDOR_DIRECTORY_LIMIT = 100;
const MAX_VENDOR_DIRECTORY_LIMIT = 200;
const MAX_VENDOR_DIRECTORY_CURSOR_LENGTH = 16_384;
const SUPPORTED_DIRECTORY_STATUSES = new Set(['all', 'active', 'restricted']);

export type VendorDirectoryStatusFilter = 'all' | 'active' | 'restricted';

export type VendorDirectoryQueryDto = {
  search?: unknown;
  status?: unknown;
  limit?: unknown;
  cursor?: unknown;
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
  hasMore: boolean;
  nextCursor: string | null;
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

type DirectoryCursor = {
  v: 1;
  updatedAt: string;
  createdAt: string;
  id: string;
  search: string | null;
  status: VendorDirectoryStatusFilter;
  limit: number;
};

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function encodeCursor(cursor: DirectoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: unknown, context: Pick<DirectoryCursor, 'search' | 'status' | 'limit'>): DirectoryCursor | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !value || value.length > MAX_VENDOR_DIRECTORY_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new VendorDirectoryError('Invalid vendor directory cursor.');
  }

  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(decoded).toString('base64url') !== value) throw new Error('Non-canonical cursor encoding.');
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid cursor shape.');
    const cursor = parsed as Record<string, unknown>;
    if (
      Object.keys(cursor).sort().join(',') !== 'createdAt,id,limit,search,status,updatedAt,v'
      || cursor.v !== 1
      || !isCanonicalUtcTimestamp(cursor.updatedAt)
      || !isCanonicalUtcTimestamp(cursor.createdAt)
      || typeof cursor.id !== 'string'
      || !cursor.id
      || (cursor.search !== null && typeof cursor.search !== 'string')
      || !SUPPORTED_DIRECTORY_STATUSES.has(cursor.status as string)
      || typeof cursor.limit !== 'number'
      || !Number.isInteger(cursor.limit)
      || cursor.limit < 1
      || cursor.limit > MAX_VENDOR_DIRECTORY_LIMIT
    ) throw new Error('Invalid cursor fields.');
    if (cursor.search !== context.search || cursor.status !== context.status || cursor.limit !== context.limit) {
      throw new VendorDirectoryError('Vendor directory cursor does not match the current filters and limit.');
    }
    return cursor as DirectoryCursor;
  } catch (error) {
    if (error instanceof VendorDirectoryError) throw error;
    throw new VendorDirectoryError('Invalid vendor directory cursor.');
  }
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
  const cursor = decodeCursor(query.cursor, { search, status, limit });
  const filters: Prisma.VendorWhereInput = {};

  if (search) {
    filters.OR = [
      { id: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (status === 'active') {
    filters.status = 'active';
  } else if (status === 'restricted') {
    filters.status = { not: 'active' };
  }

  const continuation: Prisma.VendorWhereInput | null = cursor ? {
    OR: [
      { updatedAt: { lt: new Date(cursor.updatedAt) } },
      { updatedAt: new Date(cursor.updatedAt), createdAt: { lt: new Date(cursor.createdAt) } },
      { updatedAt: new Date(cursor.updatedAt), createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
    ],
  } : null;
  const where: Prisma.VendorWhereInput = continuation ? { AND: [filters, continuation] } : filters;

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
      { id: 'desc' },
    ],
    take: limit + 1,
  });

  const hasMore = vendors.length > limit;
  const page = vendors.slice(0, limit);
  const last = page.at(-1);

  return {
    vendors: page.map(mapVendorDirectoryItem),
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({
      v: 1,
      updatedAt: last.updatedAt.toISOString(),
      createdAt: last.createdAt.toISOString(),
      id: last.id,
      search,
      status,
      limit,
    }) : null,
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
