import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('AdminDiagnosticsPage mock mode', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('renders the mock-mode diagnostics guidance without requiring real backend calls', async () => {
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'mock',
        apiBaseUrl: '/api',
      },
    }));

    const { AdminDiagnosticsPage } = await import('./AdminDiagnosticsPage');
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AdminDiagnosticsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Diagnostics are available in real mode')).toBeInTheDocument();
    expect(screen.getByText(/Switch to real API mode/i)).toBeInTheDocument();
  });
});
