import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { DataStatePanel } from './DataStatePanel';
import type { ApiErrorDiagnostics } from '../lib/api';

const diagnostics: ApiErrorDiagnostics = {
  endpoint: '/orders',
  status: 403,
  requestId: 'req-safe-123',
  hasAuthHeader: true,
  hasVendorHeader: false,
  selectedVendorPresent: false,
  readinessState: 'loading_vendor_context',
};

describe('DataStatePanel diagnostics', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders collapsed safe diagnostics only for error states', () => {
    render(
      <MemoryRouter>
        <DataStatePanel
          tone="error"
          eyebrow="Orders"
          title="Orders unavailable"
          description="You do not have access to this workspace."
          diagnostics={diagnostics}
        />
      </MemoryRouter>,
    );

    const panel = screen.getByText('Diagnostics').closest('details');

    expect(panel).toBeInTheDocument();
    expect(panel).not.toHaveAttribute('open');
    expect(screen.getByText('/orders')).toBeInTheDocument();
    expect(screen.getByText('req-safe-123')).toBeInTheDocument();
    expect(screen.getByText('loading_vendor_context')).toBeInTheDocument();
    expect(screen.queryByText(/Bearer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/demo-vendor-a/i)).not.toBeInTheDocument();
  });

  it('does not render diagnostics during successful or loading states', () => {
    render(
      <MemoryRouter>
        <DataStatePanel
          tone="loading"
          eyebrow="Orders"
          title="Loading"
          description="Loading orders."
          diagnostics={diagnostics}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Diagnostics')).not.toBeInTheDocument();
  });
});
