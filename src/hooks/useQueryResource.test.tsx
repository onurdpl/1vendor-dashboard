import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useQueryResource, type QueryResourceContext } from './useQueryResource';

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
  enabled = true,
}: {
  queryFn: (context: QueryResourceContext) => Promise<string>;
  timeoutMs?: number;
  enabled?: boolean;
}) {
  const query = useQueryResource(['stable-resource'], queryFn, { timeoutMs, enabled });

  return (
    <div>
      <span data-testid="value">{query.data ?? 'No data'}</span>
      <span data-testid="initial-loading">{query.isInitialLoading ? 'Initial loading' : 'Not initial loading'}</span>
      <span data-testid="refreshing">{query.isRefreshing ? 'Refreshing' : 'Not refreshing'}</span>
      <span data-testid="has-data">{query.hasData ? 'Has data' : 'No data flag'}</span>
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

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 60_000,
      },
    },
  });
}

function renderProbe(
  queryFn: (context: QueryResourceContext) => Promise<string>,
  options: { timeoutMs?: number; queryClient?: QueryClient; enabled?: boolean } = {},
) {
  const queryClient = options.queryClient ?? createTestQueryClient();

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <Probe queryFn={queryFn} timeoutMs={options.timeoutMs} enabled={options.enabled} />
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

describe('useQueryResource', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps cached data visible while the same query refetches in the background', async () => {
    const refetch = createDeferred<string>();
    let calls = 0;
    const queryFn = vi
      .fn<(context: QueryResourceContext) => Promise<string>>()
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
    expect(screen.getByTestId('has-data')).toHaveTextContent('Has data');
    expect(screen.getByTestId('initial-loading')).toHaveTextContent('Not initial loading');
    await waitFor(() => expect(screen.getByTestId('fetching')).toHaveTextContent('Fetching'));
    await waitFor(() => expect(screen.getByTestId('refreshing')).toHaveTextContent('Refreshing'));

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
      .fn<(context: QueryResourceContext) => Promise<string>>()
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
    const queryFn = vi.fn<(context: QueryResourceContext) => Promise<string>>().mockImplementation(() => new Promise(() => undefined));

    renderProbe(queryFn, { timeoutMs: 5 });

    await waitFor(() => expect(screen.getByTestId('error-state')).toHaveTextContent('Error'));
    expect(screen.getByTestId('value')).toHaveTextContent('No data');
    expect(screen.getByTestId('error-message')).toHaveTextContent('Request timed out after 5ms.');
  });

  it('reports disabled queries without data as idle instead of initial loading', () => {
    const queryFn = vi.fn<(context: QueryResourceContext) => Promise<string>>().mockResolvedValue('Disabled data');

    renderProbe(queryFn, { enabled: false });

    expect(screen.getByTestId('value')).toHaveTextContent('No data');
    expect(screen.getByTestId('initial-loading')).toHaveTextContent('Not initial loading');
    expect(screen.getByTestId('fetching')).toHaveTextContent('Idle');
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('does not force a refetch on remount while cached data is fresh', async () => {
    const queryClient = createTestQueryClient();
    let calls = 0;
    const queryFn = vi.fn<(context: QueryResourceContext) => Promise<string>>().mockImplementation(() => {
      calls += 1;
      return Promise.resolve(`Cached navigation ${calls}`);
    });

    const firstRender = renderProbe(queryFn, { queryClient });

    expect(await screen.findByText('Cached navigation 1')).toBeInTheDocument();
    firstRender.unmount();

    renderProbe(queryFn, { queryClient });

    expect(await screen.findByText('Cached navigation 1')).toBeInTheDocument();
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('initial-loading')).toHaveTextContent('Not initial loading');
  });

  it('aborts the query signal when a first-load timeout expires', async () => {
    let receivedSignal: AbortSignal | null = null;
    const queryFn = vi.fn<(context: QueryResourceContext) => Promise<string>>().mockImplementation(({ signal }) => {
      receivedSignal = signal;
      return new Promise(() => undefined);
    });

    renderProbe(queryFn, { timeoutMs: 5 });

    await waitFor(() => expect(screen.getByTestId('error-state')).toHaveTextContent('Error'));
    expect(receivedSignal?.aborted).toBe(true);
  });
});
