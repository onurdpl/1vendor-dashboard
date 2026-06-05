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

  it('renders the public Paratika payment return placeholder route', async () => {
    vi.doMock('./config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
        apiBaseUrl: 'https://vendor-dashboard-backend-398h.onrender.com',
        apiBaseOrigin: 'https://vendor-dashboard-backend-398h.onrender.com',
        appEnvironment: 'production',
        appVersion: '0.1.0',
        buildTimestamp: null,
        gitCommit: null,
        startupIssues: [],
      },
    }));

    const { default: App } = await import('./App');

    render(
      <MemoryRouter initialEntries={['/payments/paratika/return?token=secret-session-token&cardNumber=4111111111111111']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('Payment return received. Verification pending.')).toBeInTheDocument();
    expect(screen.getByText(/No payment, Shopify order, settlement, or payout state has been changed/i)).toBeInTheDocument();
    expect(screen.queryByText('secret-session-token')).not.toBeInTheDocument();
    expect(screen.queryByText('4111111111111111')).not.toBeInTheDocument();
  });
});
