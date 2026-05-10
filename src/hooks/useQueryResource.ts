import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import { ApiError } from '../lib/api';

type ResourceStatus = 'idle' | 'loading' | 'success' | 'error';

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
  options: Omit<UseQueryOptions<TData, unknown, TData, QueryKey>, 'queryKey' | 'queryFn'> = {},
) {
  const query = useQuery({
    queryKey,
    queryFn,
    ...options,
  });

  const status: ResourceStatus = query.isPending ? 'loading' : query.isError ? 'error' : query.isSuccess ? 'success' : 'idle';

  return {
    data: query.data ?? null,
    error: query.error ? getErrorMessage(query.error) : null,
    status,
    isIdle: status === 'idle',
    isLoading: query.isPending,
    isError: query.isError,
    isSuccess: query.isSuccess,
    refetch: query.refetch,
  } as const;
}
