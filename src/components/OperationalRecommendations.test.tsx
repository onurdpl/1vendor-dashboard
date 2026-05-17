import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { OperationalRecommendations } from './OperationalRecommendations';
import type { OperationsRecommendation } from '../lib/api/contracts';

const recommendations: OperationsRecommendation[] = [
  {
    id: 'rec-shipment',
    type: 'shipment_tracking',
    severity: 'warning',
    title: 'Review shipment tracking',
    description: 'Order #1028 is waiting for tracking.',
    recommendedAction: 'Open the order and verify shipment tracking',
    relatedObjectType: 'Order',
    relatedObjectId: 'order-1028',
    vendor: {
      id: 'sporjinal',
      name: 'Sporjinal',
    },
    createdFromSignal: 'attention-shipment',
    deepLink: '/orders/order-1028',
    vendorVisible: true,
    createdAt: '2026-05-17T10:00:00.000Z',
  },
  {
    id: 'rec-finance',
    type: 'finance_review',
    severity: 'critical',
    title: 'Review payout issue',
    description: 'Finance row needs admin review.',
    recommendedAction: 'Open finance and review payout status',
    relatedObjectType: 'Finance row',
    relatedObjectId: 'finance-1',
    vendor: {
      id: 'sporjinal',
      name: 'Sporjinal',
    },
    createdFromSignal: 'attention-finance',
    deepLink: '/finance',
    vendorVisible: false,
    createdAt: '2026-05-17T09:00:00.000Z',
  },
];

describe('OperationalRecommendations', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders admin recommendations with quick links', () => {
    render(
      <MemoryRouter>
        <OperationalRecommendations recommendations={recommendations} audience="admin" />
      </MemoryRouter>,
    );

    expect(screen.getByText('Review shipment tracking')).toBeInTheDocument();
    expect(screen.getByText('Review payout issue')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review shipment tracking/i })).toHaveAttribute('href', '/orders/order-1028');
  });

  it('filters admin-only recommendations from vendor view', () => {
    render(
      <MemoryRouter>
        <OperationalRecommendations recommendations={recommendations} audience="vendor" />
      </MemoryRouter>,
    );

    expect(screen.getByText('Review shipment tracking')).toBeInTheDocument();
    expect(screen.queryByText('Review payout issue')).not.toBeInTheDocument();
  });
});
