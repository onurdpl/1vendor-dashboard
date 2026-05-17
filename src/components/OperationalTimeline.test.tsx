import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { OperationalLinkCards, OperationalTimeline } from './OperationalTimeline';

describe('OperationalTimeline', () => {
  it('renders compact timeline events with navigation links', () => {
    render(
      <MemoryRouter>
        <OperationalTimeline
          events={[
            {
              id: 'return-requested',
              title: 'Return requested',
              description: 'Customer return activity',
              at: '2026-05-13T10:00:00Z',
              href: '/returns/ret-1',
              status: 'Requested',
              tone: 'attention',
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Return requested')).toHaveAttribute('href', '/returns/ret-1');
    expect(screen.getByText('Customer return activity')).toBeInTheDocument();
    expect(screen.getByText('Requested')).toBeInTheDocument();
  });

  it('omits admin-only events for vendors', () => {
    render(
      <MemoryRouter>
        <OperationalTimeline
          audience="vendor"
          events={[
            { id: 'public', title: 'Support ticket opened' },
            { id: 'admin-note', title: 'Internal note added', visibility: 'admin' },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Support ticket opened')).toBeInTheDocument();
    expect(screen.queryByText('Internal note added')).not.toBeInTheDocument();
  });
});

describe('OperationalLinkCards', () => {
  it('renders related object navigation and empty states', () => {
    const { rerender } = render(
      <MemoryRouter>
        <OperationalLinkCards
          title="Related records"
          links={[
            {
              id: 'order-1029',
              eyebrow: 'Order',
              title: 'Order #1029',
              href: '/orders/order-1029',
              status: 'Linked',
              tone: 'info',
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Order #1029').closest('a')).toHaveAttribute('href', '/orders/order-1029');
    expect(screen.getByText('Linked')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <OperationalLinkCards title="Related records" links={[]} />
      </MemoryRouter>,
    );

    expect(screen.getByText('No related records.')).toBeInTheDocument();
  });
});
