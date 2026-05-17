import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useQueryResource } from './useQueryResource';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function Probe({ queryFn }: { queryFn: () => Promise<string> }) {
  const query = useQueryResource(['stable-resource'], queryFn);

  return (
    <div>
      <span data-testid="value">{query.data ?? 'No data'}</span>
      <span data-testid="fetching">{query.isFetching ? 'Fetching' : 'Idle'}</span>
      <button type="button" onClick={() => void query.refetch()}>
        Refetch
      </button>
    </div>
  );
}

function renderProbe(queryFn: () => Promise<string>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Probe queryFn={queryFn} />
    </QueryClientProvider>,
  );
}

describe('useQueryResource', () => {
  it('keeps cached data visible while the same query refetches in the background', async () => {
    const refetch = createDeferred<string>();
    let calls = 0;
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockImplementation(() => {
        calls += 1;
        return calls === 1 ? Promise.resolve('Cached orders') : refetch.promise;
      });

    renderProbe(queryFn);

    expect(await screen.findByText('Cached orders')).toBeInTheDocument();

    await act(async () => {
      screen.getByRole('button', { name: 'Refetch' }).click();
    });

    expect(screen.getByTestId('value')).toHaveTextContent('Cached orders');
    await waitFor(() => expect(screen.getByTestId('fetching')).toHaveTextContent('Fetching'));

    await act(async () => {
      refetch.resolve('Fresh orders');
      await refetch.promise;
    });

    expect(await screen.findByText('Fresh orders')).toBeInTheDocument();
  });
});
