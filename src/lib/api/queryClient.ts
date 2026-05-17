import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './errors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && (error.kind === 'unauthorized' || error.status === 403)) {
          return false;
        }

        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});
