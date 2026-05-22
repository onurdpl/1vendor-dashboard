import { useEffect } from 'react';
import { useQuery, keepPreviousData, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import { ApiError, getApiErrorDiagnostics } from '../lib/api';

type ResourceStatus = 'idle' | 'loading' | 'success' | 'error';
const DEFAULT_QUERY_TIMEOUT_MS = 15000;

type ResilientQueryOptions<TData> = Omit<UseQueryOptions<TData, unknown, TData, QueryKey>, 'queryKey' | 'queryFn'> & {
  timeoutMs?: number;
  routeName?: string;
  endpoint?: string;
};

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unable to load data.';
}

export function useQueryResource<TData>(
  queryKey: QueryKey,
  queryFn: () => Promise<TData>,
  options: ResilientQueryOptions<TData> = {},
) {
  const { timeoutMs = DEFAULT_QUERY_TIMEOUT_MS, routeName, endpoint, placeholderData, ...queryOptions } = options;
  const query = useQuery({
    queryKey,
    queryFn: () => withTimeout(queryFn(), timeoutMs),
    placeholderData: placeholderData ?? keepPreviousData,
    refetchOnMount: 'always',
    throwOnError: false,
    ...queryOptions,
  });

  const hasData = query.data !== undefined && query.data !== null;
  const blockingError = query.isError && !hasData;
  const queryKeyLabel = queryKey.map(String).join('/');
  const status: ResourceStatus = query.isPending && !hasData
    ? 'loading'
    : blockingError
      ? 'error'
      : hasData
        ? 'success'
        : 'idle';
  const diagnostics = getApiErrorDiagnostics(query.error);

  useEffect(() => {
    if (!query.error) {
      return;
    }
    const safeEndpoint = endpoint ?? diagnostics?.endpoint ?? queryKeyLabel;
    console.warn('[client-query-error]', {
      routeName: routeName ?? 'unknown',
      endpoint: safeEndpoint,
      status: diagnostics?.status ?? null,
      message: getErrorMessage(query.error),
      staleDataVisible: hasData,
    });
  }, [diagnostics?.endpoint, diagnostics?.status, endpoint, hasData, query.error, queryKeyLabel, routeName]);

  return {
    data: query.data ?? null,
    error: query.error ? getErrorMessage(query.error) : null,
    errorObject: query.error ?? null,
    diagnostics,
    status,
    isIdle: status === 'idle',
    isLoading: status === 'loading',
    isFetching: query.isFetching,
    isError: blockingError,
    hasBackgroundError: Boolean(query.error && hasData),
    isSuccess: status === 'success',
    refetch: query.refetch,
  } as const;
}

function withTimeout<TData>(promise: Promise<TData>, timeoutMs: number): Promise<TData> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Request timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}
