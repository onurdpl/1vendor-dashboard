import { createHash } from 'node:crypto';
import type { SupportTicketDto, SupportTicketFilters, SupportTicketsPageDto } from './support.types.js';

const buckets = ['all', 'needs_assignment', 'needs_response', 'escalated', 'overdue', 'waiting_vendor', 'resolved'] as const;
type Bucket = typeof buckets[number];
type PageRow = { rank: number; updatedAt: string; id: string };

export class SupportPageQueryError extends Error {
  readonly statusCode = 400;
}

function choice<T extends string>(value: unknown, allowed: readonly T[], fallback: T, name: string): T {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
  throw new SupportPageQueryError(`Unsupported ${name}.`);
}

function boolean(value: unknown, name: string) {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new SupportPageQueryError(`Unsupported ${name}.`);
}

export function parseSupportPageQuery(raw: SupportTicketFilters, scope: 'admin' | 'vendor', vendorId: string | null, actorName = '') {
  const search = raw.search === undefined ? '' : typeof raw.search === 'string'
    ? raw.search.trim().toLowerCase() : null;
  if (search === null) throw new SupportPageQueryError('Unsupported support search.');
  const timeZone = raw.timeZone === undefined ? 'UTC' : raw.timeZone;
  if (typeof timeZone !== 'string' || timeZone.length > 100) throw new SupportPageQueryError('Unsupported time zone.');
  try { new Intl.DateTimeFormat('en-US', { timeZone }); }
  catch { throw new SupportPageQueryError('Unsupported time zone.'); }
  const options = {
    scope, vendorId, actorName,
    search,
    bucket: choice(raw.bucket, buckets, 'all', 'Support workflow bucket'),
    status: choice(raw.status, ['all', 'OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR', 'RESOLVED', 'CLOSED'] as const, 'all', 'Support status'),
    category: choice(raw.category, ['all', 'ORDER', 'RETURN', 'REFUND', 'SHIPMENT', 'TRACKING', 'PAYOUT', 'INVOICE', 'OTHER'] as const, 'all', 'Support category'),
    priority: choice(raw.priority, ['all', 'low', 'normal', 'high'] as const, 'all', 'Support priority'),
    assignee: choice(raw.assignee, ['all', 'unassigned', 'me'] as const, 'all', 'Support assignee'),
    unresolvedOnly: boolean(raw.unresolvedOnly, 'unresolvedOnly'),
    unreadOnly: boolean(raw.unreadOnly, 'unreadOnly'),
    workflow: choice(raw.workflow, ['all', 'open-support-issues'] as const, 'all', 'Support workflow'),
    timeZone,
  };
  const binding = createHash('sha256').update(JSON.stringify(options)).digest('hex');
  let after: PageRow | null = null;
  if (raw.cursor !== undefined) {
    try {
      if (typeof raw.cursor !== 'string' || raw.cursor.length > 1000) throw new Error();
      const decoded = JSON.parse(Buffer.from(raw.cursor, 'base64url').toString('utf8')) as { binding: string; row: PageRow };
      if (decoded.binding !== binding || !decoded.row || !Number.isInteger(decoded.row.rank) || decoded.row.rank < 0 || decoded.row.rank > 4
        || typeof decoded.row.id !== 'string' || !decoded.row.id || typeof decoded.row.updatedAt !== 'string'
        || !Number.isFinite(Date.parse(decoded.row.updatedAt))) throw new Error();
      after = decoded.row;
    } catch { throw new SupportPageQueryError('Invalid Support page cursor.'); }
  }
  return { ...options, binding, after };
}

export type SupportPageQuery = ReturnType<typeof parseSupportPageQuery>;

function localDay(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function story(ticket: SupportTicketDto, now: Date, timeZone: string) {
  const unresolved = ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED';
  const needsAssignment = unresolved && !ticket.assigneeUserId && !ticket.assigneeName;
  const needsAdminResponse = unresolved && ticket.status !== 'WAITING_FOR_VENDOR'
    && (ticket.adminUnreadCount > 0 || ticket.lastReplyByRole === 'VENDOR');
  const isEscalated = unresolved && Boolean(ticket.escalatedAt || ticket.sla?.escalationLevel === 'escalated');
  const isOverdue = unresolved && Boolean(ticket.sla?.isOverdue || ticket.sla?.escalationLevel === 'overdue');
  const isWaitingOnVendor = ticket.status === 'WAITING_FOR_VENDOR';
  const resolvedAt = ticket.resolvedAt ?? ticket.closedAt;
  const isResolved = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED'
    || Boolean(resolvedAt && localDay(resolvedAt, timeZone) === localDay(now.toISOString(), timeZone));
  const rank = isEscalated ? 0 : isOverdue ? 1 : needsAssignment ? 2 : needsAdminResponse ? 3 : 4;
  return { needsAssignment, needsAdminResponse, isEscalated, isOverdue, isWaitingOnVendor, isResolved, rank };
}

function matchesBucket(bucket: Bucket, result: ReturnType<typeof story>) {
  if (bucket === 'all') return true;
  if (bucket === 'needs_assignment') return result.needsAssignment;
  if (bucket === 'needs_response') return result.needsAdminResponse;
  if (bucket === 'escalated') return result.isEscalated;
  if (bucket === 'overdue') return result.isOverdue;
  if (bucket === 'waiting_vendor') return result.isWaitingOnVendor;
  return result.isResolved;
}

export function matchesSupportPage(ticket: SupportTicketDto, options: SupportPageQuery, now: Date) {
  const projected = story(ticket, now, options.timeZone);
  if (options.scope === 'vendor') {
    if (ticket.vendorId !== options.vendorId || (options.unreadOnly && ticket.vendorUnreadCount <= 0)) return null;
    if (options.workflow === 'open-support-issues' && (ticket.closedAt || ticket.resolvedAt || ticket.status === 'CLOSED' || ticket.status === 'RESOLVED')) return null;
  } else {
    if (!matchesBucket(options.bucket, projected) || (options.unresolvedOnly && (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED'))
      || (options.status !== 'all' && ticket.status !== options.status)
      || (options.category !== 'all' && ticket.category !== options.category)
      || (options.priority !== 'all' && ticket.priority !== options.priority)
      || (options.assignee === 'unassigned' && ticket.assigneeUserId)
      || (options.assignee === 'me' && (!options.actorName || ticket.assigneeName !== options.actorName))) return null;
  }
  if (options.search) {
    const fields = options.scope === 'admin'
      ? [ticket.id, ticket.subject, ticket.vendorId, ticket.vendorName, ticket.assigneeName, ticket.assigneeUserId, ticket.contextId, JSON.stringify(ticket.contextSnapshot ?? {})]
      : [ticket.id, ticket.subject, ticket.message, ticket.vendorId, ticket.vendorName, ticket.contextType, ticket.contextId,
        ticket.assigneeName, ticket.assigneeUserId, ticket.lastReplyByRole, ticket.lastReplyAt, ticket.firstResponseDueAt,
        ticket.nextResponseDueAt, ticket.escalationReason, JSON.stringify(ticket.contextSnapshot ?? {}), JSON.stringify(ticket.contextSummary ?? {})];
    if (!fields.filter(Boolean).join(' ').toLowerCase().includes(options.search)) return null;
  }
  return { rank: options.scope === 'admin' ? projected.rank : 0, updatedAt: ticket.updatedAt, id: ticket.id };
}

export function supportBucketCounts(tickets: SupportTicketDto[], unresolvedOnly: boolean, now: Date, timeZone: string): SupportTicketsPageDto['bucketCounts'] {
  const counts = Object.fromEntries(buckets.map((bucket) => [bucket, 0])) as Record<Bucket, number>;
  for (const ticket of tickets) {
    const result = story(ticket, now, timeZone);
    if (!unresolvedOnly || (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED')) counts.all++;
    for (const bucket of buckets) if (bucket !== 'all' && matchesBucket(bucket, result)) counts[bucket]++;
  }
  return counts;
}

export function compareSupportRows(left: PageRow, right: PageRow) {
  if (left.rank !== right.rank) return left.rank - right.rank;
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? -1 : 1;
  return left.id === right.id ? 0 : left.id > right.id ? -1 : 1;
}

export function encodeSupportCursor(binding: string, row: PageRow) {
  return Buffer.from(JSON.stringify({ binding, row })).toString('base64url');
}
