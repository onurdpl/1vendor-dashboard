import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeConfig } from '../config/runtime';
import App from '../App';
import { PostTransportDiagnosticPage } from './PostTransportDiagnosticPage';

function createResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('PostTransportDiagnosticPage', () => {
  const originalDiagnosticBackendOrigin = runtimeConfig.diagnosticBackendOrigin;

  beforeEach(() => {
    Object.assign(runtimeConfig, {
      diagnosticBackendOrigin: 'https://backend.example.com',
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.assign(runtimeConfig, {
      diagnosticBackendOrigin: originalDiagnosticBackendOrigin,
    });
  });

  it('sends exactly one native JSON POST for each explicit path and preserves correlation', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch')
      .mockResolvedValue(createResponse(JSON.stringify({ ok: true, status: 'post_transport_ready' })));

    render(
      <MemoryRouter>
        <PostTransportDiagnosticPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Same-origin JSON POST' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [sameOriginUrl, sameOriginOptions] = fetchSpy.mock.calls[0];
    expect(sameOriginUrl).toBe('http://localhost:3000/api/auth/diagnostics/public-login-transport');
    expect(sameOriginOptions).toEqual(expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ probe: 'login-post-transport' }),
      signal: expect.any(AbortSignal),
    }));
    const sameOriginHeaders = new Headers(sameOriginOptions?.headers);
    expect(sameOriginHeaders.get('Content-Type')).toBe('application/json');
    expect(sameOriginHeaders.get('X-Auth-Flow-Id')).toMatch(/^auth-[a-z0-9]{10}$/i);
    expect(sameOriginHeaders.get('X-Auth-Request-Id')).toMatch(/^req-[a-z0-9]{10}$/i);
    expect(await screen.findByText(/post_transport_ready/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Direct-backend JSON POST' }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const [directUrl, directOptions] = fetchSpy.mock.calls[1];
    expect(directUrl).toBe('https://backend.example.com/auth/diagnostics/public-login-transport');
    expect(directOptions).toEqual(expect.objectContaining({
      method: 'POST',
      credentials: 'omit',
      body: JSON.stringify({ probe: 'login-post-transport' }),
      signal: expect.any(AbortSignal),
    }));
    expect(directOptions?.signal).not.toBe(sameOriginOptions?.signal);
    expect(new Headers(directOptions?.headers).get('X-Auth-Flow-Id')).not.toBe(
      sameOriginHeaders.get('X-Auth-Flow-Id'),
    );
    expect(console.info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'ISOLATED_POST_DIAGNOSTIC_BUTTON_CLICKED',
      pathMode: 'same_origin_api',
    }));
    expect(console.info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'ISOLATED_POST_DIAGNOSTIC_FETCH_CALL_ENTERED',
      pathMode: 'same_origin_api',
    }));
    expect(console.info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'ISOLATED_POST_DIAGNOSTIC_FETCH_PROMISE_CREATED',
      pathMode: 'same_origin_api',
    }));
    expect(console.info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'ISOLATED_POST_DIAGNOSTIC_FETCH_RESOLVED',
      pathMode: 'same_origin_api',
      httpStatus: 200,
    }));
  });

  it('is mounted as a public route and runs no request automatically', () => {
    const fetchSpy = vi.spyOn(window, 'fetch');

    render(
      <MemoryRouter initialEntries={['/diagnostics/post-transport']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Isolated login POST transport' })).toBeInTheDocument();
    expect(screen.getByText('No diagnostic request has run.')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not start concurrent requests', async () => {
    let resolveFetch: ((response: Response) => void) | null = null;
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));

    render(<PostTransportDiagnosticPage />);

    const sameOriginButton = screen.getByRole('button', { name: 'Same-origin JSON POST' });
    const directButton = screen.getByRole('button', { name: 'Direct-backend JSON POST' });
    fireEvent.click(sameOriginButton);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sameOriginButton).toBeDisabled();
    expect(directButton).toBeDisabled();
    fireEvent.click(directButton);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch?.(createResponse(JSON.stringify({ ok: true, status: 'post_transport_ready' })));
    });
    await waitFor(() => expect(directButton).toBeEnabled());
  });

  it('displays rejected requests without invoking login behavior', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockRejectedValue(new TypeError('Network request failed'));

    render(<PostTransportDiagnosticPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Same-origin JSON POST' }));

    expect(await screen.findByText('TypeError')).toBeInTheDocument();
    expect(screen.getByText('Network request failed')).toBeInTheDocument();
    expect(screen.getByText('Yes', { selector: 'dd' })).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).not.toContain('/auth/login');
  });

  it('aborts one request with its local controller and reports timeout state', async () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'fetch').mockImplementation((_url, options) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    }));

    render(<PostTransportDiagnosticPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Same-origin JSON POST' }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByText('AbortError')).toBeInTheDocument();
    expect(screen.getByText('Local timeout fired').nextElementSibling).toHaveTextContent('Yes');
    expect(console.info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'ISOLATED_POST_DIAGNOSTIC_TIMEOUT_TRIGGERED',
      outcome: 'timeout',
    }));
    expect(console.info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'ISOLATED_POST_DIAGNOSTIC_CLEANUP_COMPLETED',
    }));
  });
});
