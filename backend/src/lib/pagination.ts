export type PaginationOptions = {
  limit: number;
  offset: number;
};

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;

function parseInteger(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolvePagination(query: unknown, defaults: Partial<PaginationOptions> = {}): PaginationOptions {
  const source = typeof query === 'object' && query !== null ? query as Record<string, unknown> : {};
  const requestedLimit = parseInteger(source.limit);
  const requestedOffset = parseInteger(source.offset);
  const fallbackLimit = defaults.limit ?? DEFAULT_LIMIT;
  const fallbackOffset = defaults.offset ?? 0;

  return {
    limit: Math.min(Math.max(requestedLimit ?? fallbackLimit, 1), MAX_LIMIT),
    offset: Math.max(requestedOffset ?? fallbackOffset, 0),
  };
}
