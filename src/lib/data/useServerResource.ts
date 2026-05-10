import { useEffect, useRef, useState } from 'react';
import type { DependencyList } from 'react';
import { ApiError } from '../api';

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

export function useServerResource<T>(loader: () => Promise<T>, dependencies: DependencyList = []) {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<ResourceStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadResource() {
      try {
        setStatus('loading');
        setError(null);

        const result = await loaderRef.current();

        if (!active) {
          return;
        }

        setData(result);
        setStatus('success');
      } catch (caught) {
        if (!active) {
          return;
        }

        setData(null);
        setError(getErrorMessage(caught));
        setStatus('error');
      }
    }

    loadResource();

    return () => {
      active = false;
    };
  }, dependencies);

  return {
    data,
    error,
    status,
    isIdle: status === 'idle',
    isLoading: status === 'loading' || status === 'idle',
    isError: status === 'error',
    isSuccess: status === 'success',
  } as const;
}
