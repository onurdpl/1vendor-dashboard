import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('App startup runtime safety', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('renders a safe startup error when runtime configuration is invalid', async () => {
    vi.doMock('./config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
        apiBaseUrl: 'http://127.0.0.1:4000',
        apiBaseOrigin: 'http://127.0.0.1:4000',
        appEnvironment: 'production',
        appVersion: '0.1.0',
        buildTimestamp: null,
        gitCommit: null,
        startupIssues: ['Real API mode requires VITE_API_BASE_URL.'],
      },
    }));

    const { default: App } = await import('./App');

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('Runtime configuration needs attention')).toBeInTheDocument();
    expect(screen.getByText('Real API mode requires VITE_API_BASE_URL.')).toBeInTheDocument();
  });
});
