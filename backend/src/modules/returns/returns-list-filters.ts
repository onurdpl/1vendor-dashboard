import type { ReturnSummaryDto } from './returns.types.js';

export type ReturnsListFilters = {
  workflow?: 'requested' | 'needs-action' | 'approved' | 'refunded' | 'closed';
  status?: string;
  source?: 'pending' | 'refunded';
};

const WORKFLOWS = ['requested', 'needs-action', 'approved', 'refunded', 'closed'] as const;
const SOURCES = ['pending', 'refunded'] as const;

export function parseReturnsListFilters(query: unknown): ReturnsListFilters {
  const source = query && typeof query === 'object' ? query as Record<string, unknown> : {};
  const workflow = source.workflow;
  const status = source.status;
  const classification = source.source;
  if (workflow !== undefined && (typeof workflow !== 'string' || !WORKFLOWS.includes(workflow as typeof WORKFLOWS[number]))) {
    throw new Error('Invalid Returns workflow.');
  }
  if (status !== undefined && (typeof status !== 'string' || !status.trim())) {
    throw new Error('Invalid Returns status.');
  }
  if (classification !== undefined && (typeof classification !== 'string' || !SOURCES.includes(classification as typeof SOURCES[number]))) {
    throw new Error('Invalid Returns source.');
  }
  return {
    ...(workflow ? { workflow: workflow as ReturnsListFilters['workflow'] } : {}),
    ...(status ? { status } : {}),
    ...(classification ? { source: classification as ReturnsListFilters['source'] } : {}),
  };
}

// Mirrors the existing real client mapStatus/toTitleCaseLabel presentation contract.
export function displayReturnStatus(status: string, requestSource: string | null): string {
  if (!status) return 'Not available';
  const normalized = status.trim().toLowerCase();
  if (requestSource === 'shopify_return_request') {
    if (['requested', 'approved', 'declined', 'cancelled', 'closed'].includes(normalized)) {
      return normalized[0].toUpperCase() + normalized.slice(1);
    }
  } else if (['processed', 'refunded', 'approved'].includes(normalized)) {
    return 'Processed';
  }
  return status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalize(value: string | null | undefined) {
  return String(value ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim();
}

function validSummaryText(value: string | null | undefined) {
  const text = value?.trim() ?? '';
  const normalized = text.toLowerCase();
  return text && text !== 'Return item' && normalized !== 'default' && normalized !== 'default title'
    && !/^gid:\/\//i.test(text) && !/^unknown-sku$/i.test(text) ? text : '';
}

function hasSummaryFallbackItem(row: ReturnSummaryDto) {
  const sku = row.refundedSkus[0] ?? null;
  const title = [row.displayTitle, row.itemTitle].some((value) => {
    const text = validSummaryText(value).replace(/\s*\/\s*default(?:\s+title)?$/i, '').trim();
    return Boolean(text && text !== validSummaryText(sku) && !/^\d{6,}$/.test(text));
  });
  return title || Boolean(validSummaryText(row.variantTitle) || sku);
}

function isRefunded(row: ReturnSummaryDto) {
  if (row.returnRequestSource !== 'shopify_return_request') return true;
  const status = normalize(displayReturnStatus(row.status, row.returnRequestSource));
  // Matches the existing page predicate: the mapped list has returned items as
  // refund evidence, while returnLifecycleStatus is not copied into ReturnSummary.
  const hasRefundEvidence = Boolean(row.sourceShopifyRefundId?.trim())
    || row.refundedItems.length > 0 || hasSummaryFallbackItem(row);
  return hasRefundEvidence && ['refunded', 'processed', 'closed'].includes(status);
}

export function matchesReturnsListFilters(row: ReturnSummaryDto, filters: ReturnsListFilters) {
  const status = displayReturnStatus(row.status, row.returnRequestSource);
  if (filters.status && status !== filters.status) return false;
  const normalized = normalize(status);
  const requestedLike = ['requested', 'awaiting review', 'pending', 'in review'].includes(normalized);
  const received = Boolean(row.vendorReceivedAt?.trim());
  const decision = Boolean(row.vendorDecision?.trim());
  const refunded = isRefunded(row);
  if (filters.source === 'pending' && !(row.returnRequestSource === 'shopify_return_request' && requestedLike)) return false;
  if (filters.source === 'refunded' && !refunded) return false;
  switch (filters.workflow) {
    case 'requested': return requestedLike && !received;
    case 'needs-action': return requestedLike && received && !decision;
    case 'approved': return (normalized === 'approved' || normalize(row.vendorDecision) === 'approved')
      && !refunded && !['closed', 'cancelled', 'declined', 'rejected'].includes(normalized);
    case 'refunded': return refunded;
    case 'closed': return ['closed', 'cancelled', 'declined', 'rejected'].includes(normalized) && !refunded;
    default: return true;
  }
}
