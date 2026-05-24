import { useEffect } from 'react';
import { useQuery, keepPreviousData, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import { ApiError, getApiErrorDiagnostics } from '../lib/api';

type ResourceStatus = 'idle' | 'loading' | 'success' | 'error';
const DEFAULT_QUERY_TIMEOUT_MS = 15000;
export type QueryResourceContext = { signal: AbortSignal };

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
  queryFn: (context: QueryResourceContext) => Promise<TData>,
  options: ResilientQueryOptions<TData> = {},
) {
  const { timeoutMs = DEFAULT_QUERY_TIMEOUT_MS, routeName, endpoint, placeholderData, ...queryOptions } = options;
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => withTimeout((timeoutSignal) => queryFn({ signal: timeoutSignal }), timeoutMs, signal),
    placeholderData: placeholderData ?? keepPreviousData,
    throwOnError: false,
    ...queryOptions,
  });

  const hasData = query.data !== undefined && query.data !== null;
  const blockingError = query.isError && !hasData;
  const queryKeyLabel = queryKey.map(String).join('/');
  const status: ResourceStatus = query.isPending && query.fetchStatus !== 'idle' && !hasData
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
    hasData,
    isIdle: status === 'idle',
    isInitialLoading: status === 'loading',
    isLoading: status === 'loading',
    isRefreshing: query.isFetching && hasData,
    isFetching: query.isFetching,
    fetchStatus: query.fetchStatus,
    isError: blockingError,
    hasBackgroundError: Boolean(query.error && hasData),
    isSuccess: status === 'success',
    refetch: query.refetch,
  } as const;
}

function withTimeout<TData>(
  execute: (signal: AbortSignal) => Promise<TData>,
  timeoutMs: number,
  parentSignal: AbortSignal,
): Promise<TData> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return execute(parentSignal);
  }

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const abortFromParent = () => {
    controller.abort(parentSignal.reason);
  };

  if (parentSignal.aborted) {
    abortFromParent();
  } else {
    parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError = new Error(`Request timed out after ${timeoutMs}ms.`);
      reject(timeoutError);
      controller.abort(timeoutError);
    }, timeoutMs);
  });

  return Promise.race([execute(controller.signal), timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    parentSignal.removeEventListener('abort', abortFromParent);
  });
}
