import { describe, expect, it } from 'vitest';
import {
  filterOperationalEvents,
  filterOperationalLinks,
  normalizeOperationalOrderNumber,
  sameOperationalOrderNumber,
  supportTicketMatchesFinance,
  supportTicketMatchesOrder,
  supportTicketMatchesReturn,
} from './operationalCrossLinks';
import type { SupportTicket } from './api/contracts';

function ticket(overrides: Partial<SupportTicket>): SupportTicket {
  return {
    id: 'ticket-1',
    createdAt: '2026-05-13T10:00:00Z',
    updatedAt: '2026-05-13T10:00:00Z',
    createdByUserId: 'vendor',
    createdByRole: 'vendor',
    vendorId: 'demo-vendor-a',
    vendorName: 'Demo Vendor',
    subject: 'Need help',
    message: 'Please review this.',
    priority: 'normal',
    status: 'OPEN',
    category: 'ORDER',
    assigneeUserId: null,
    assigneeName: null,
    vendorUnreadCount: 0,
    adminUnreadCount: 0,
    lastReplyAt: null,
    lastReplyByRole: null,
    firstResponseDueAt: null,
    nextResponseDueAt: null,
    escalatedAt: null,
    escalationReason: null,
    sla: null,
    contextType: 'order',
    contextId: 'order-1',
    contextSnapshot: null,
    resolvedAt: null,
    closedAt: null,
    ...overrides,
  };
}

describe('operational cross-link helpers', () => {
  it('formats Shopify order numbers without duplicated prefixes', () => {
    expect(normalizeOperationalOrderNumber('#1029')).toBe('1029');
    expect(normalizeOperationalOrderNumber('Order #1029')).toBe('1029');
    expect(sameOperationalOrderNumber('#1029', '1029')).toBe(true);
  });

  it('matches support tickets by context id or sanitized order snapshot', () => {
    expect(supportTicketMatchesOrder(ticket({ contextId: 'alloc-1' }), 'alloc-1', '#1029')).toBe(true);
    expect(
      supportTicketMatchesOrder(
        ticket({ contextId: 'other', contextSnapshot: { orderNumber: '#1029', customerEmail: 'hidden@example.com' } }),
        'alloc-1',
        '1029',
      ),
    ).toBe(true);
  });

  it('matches finance support links across Shopify refund GID and numeric forms', () => {
    expect(
      supportTicketMatchesFinance(
        ticket({ contextSnapshot: { sourceShopifyRefundId: 'gid://shopify/Refund/5002' } }),
        'ledger-1',
        null,
        '5002',
      ),
    ).toBe(true);
  });

  it('rejects cross-vendor support links in vendor contexts', () => {
    const otherVendorTicket = ticket({
      vendorId: 'demo-vendor-b',
      contextId: 'alloc-1',
      contextSnapshot: {
        orderNumber: '#1029',
        financeLedgerEntryId: 'ledger-1',
      },
    });

    expect(
      supportTicketMatchesOrder(otherVendorTicket, 'alloc-1', '#1029', {
        audience: 'vendor',
        currentVendorId: 'demo-vendor-a',
      }),
    ).toBe(false);
    expect(
      supportTicketMatchesReturn(
        ticket({ vendorId: 'demo-vendor-b', contextType: 'return', contextId: 'return-1' }),
        'return-1',
        {
          audience: 'vendor',
          currentVendorId: 'demo-vendor-a',
        },
      ),
    ).toBe(false);
    expect(
      supportTicketMatchesFinance(otherVendorTicket, 'ledger-1', '#1029', null, {
        audience: 'vendor',
        currentVendorId: 'demo-vendor-a',
      }),
    ).toBe(false);
  });

  it('keeps admin cross-link matching intentionally unscoped', () => {
    expect(
      supportTicketMatchesOrder(
        ticket({ vendorId: 'demo-vendor-b', contextSnapshot: { orderNumber: '#1029' } }),
        'alloc-1',
        '1029',
        { audience: 'admin', currentVendorId: 'demo-vendor-a' },
      ),
    ).toBe(true);
  });

  it('filters admin-only timeline events and links for vendors', () => {
    expect(
      filterOperationalEvents(
        [
          { id: 'public', title: 'Support ticket opened', at: '2026-05-13T10:00:00Z' },
          { id: 'admin', title: 'Internal note added', visibility: 'admin' },
        ],
        'vendor',
      ).map((event) => event.id),
    ).toEqual(['public']);

    expect(
      filterOperationalLinks(
        [
          { id: 'order', title: 'Order #1029' },
          { id: 'diagnostic', title: 'Internal diagnostics', visibility: 'admin' },
        ],
        'vendor',
      ).map((link) => link.id),
    ).toEqual(['order']);
  });

  it('sorts visible timeline events chronologically with undated events last', () => {
    expect(
      filterOperationalEvents(
        [
          { id: 'late', title: 'Refund processed', at: '2026-05-14T10:00:00Z' },
          { id: 'missing', title: 'Support ticket opened' },
          { id: 'early', title: 'Order created', at: '2026-05-13T10:00:00Z' },
        ],
        'admin',
      ).map((event) => event.id),
    ).toEqual(['early', 'late', 'missing']);
  });
});
