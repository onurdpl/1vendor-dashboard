import { useMutation, type UseMutationOptions } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { queryClient } from '../lib/api/queryClient';

type MutationActionOptions<TData, TVariables> = Omit<
  UseMutationOptions<TData, unknown, TVariables>,
  'mutationFn' | 'onSuccess' | 'onError'
> & {
  invalidateQueryKeys?: readonly QueryKey[];
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: unknown, variables: TVariables) => void;
};

export function useMutationAction<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: MutationActionOptions<TData, TVariables> = {},
) {
  const { invalidateQueryKeys = [], onSuccess, onError, ...mutationOptions } = options;

  const mutation = useMutation({
    mutationFn,
    ...mutationOptions,
    onSuccess: (data, variables) => {
      void Promise.all(invalidateQueryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      onSuccess?.(data, variables);
    },
    onError: (error, variables) => {
      onError?.(error, variables);
    },
  });

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    reset: mutation.reset,
    isIdle: mutation.isIdle,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    data: mutation.data,
  } as const;
}
