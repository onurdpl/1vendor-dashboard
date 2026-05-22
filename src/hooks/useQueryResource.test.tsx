import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useQueryResource } from './useQueryResource';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function Probe({
  queryFn,
  timeoutMs,
}: {
  queryFn: () => Promise<string>;
  timeoutMs?: number;
}) {
  const query = useQueryResource(['stable-resource'], queryFn, { timeoutMs });

  return (
    <div>
      <span data-testid="value">{query.data ?? 'No data'}</span>
      <span data-testid="fetching">{query.isFetching ? 'Fetching' : 'Idle'}</span>
      <span data-testid="error-state">{query.isError ? 'Error' : 'No error'}</span>
      <span data-testid="background-error">{query.hasBackgroundError ? 'Background error' : 'No background error'}</span>
      <span data-testid="error-message">{query.error ?? 'No message'}</span>
      <button type="button" onClick={() => void query.refetch()}>
        Refetch
      </button>
    </div>
  );
}

function renderProbe(queryFn: () => Promise<string>, options: { timeoutMs?: number } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Probe queryFn={queryFn} timeoutMs={options.timeoutMs} />
    </QueryClientProvider>,
  );
}

describe('useQueryResource', () => {
  afterEach(() => {
    cleanup();
  });

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

  it('keeps cached data visible when a background refetch fails', async () => {
    const refetch = createDeferred<string>();
    let calls = 0;
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockImplementation(() => {
        calls += 1;
        return calls === 1 ? Promise.resolve('Cached returns') : refetch.promise;
      });

    renderProbe(queryFn);

    expect(await screen.findByText('Cached returns')).toBeInTheDocument();

    await act(async () => {
      screen.getByRole('button', { name: 'Refetch' }).click();
    });

    await act(async () => {
      refetch.reject(new Error('Network down'));
      await refetch.promise.catch(() => undefined);
    });

    expect(screen.getByTestId('value')).toHaveTextContent('Cached returns');
    await waitFor(() => expect(screen.getByTestId('error-state')).toHaveTextContent('No error'));
    expect(screen.getByTestId('background-error')).toHaveTextContent('Background error');
    expect(screen.getByTestId('error-message')).toHaveTextContent('Network down');
  });

  it('fails with a finite timeout when no cached data is available', async () => {
    const queryFn = vi.fn<() => Promise<string>>().mockImplementation(() => new Promise(() => undefined));

    renderProbe(queryFn, { timeoutMs: 5 });

    await waitFor(() => expect(screen.getByTestId('error-state')).toHaveTextContent('Error'));
    expect(screen.getByTestId('value')).toHaveTextContent('No data');
    expect(screen.getByTestId('error-message')).toHaveTextContent('Request timed out after 5ms.');
  });
});
