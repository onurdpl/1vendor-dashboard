import { describe, expect, it } from 'vitest';
import {
  buildOperationalRecommendations,
  buildVendorRiskSummaries,
  deriveOperationalSeverity,
} from '../backend/src/modules/operations/operations.service.js';
import type { OperationsAttentionItemDto } from '../backend/src/modules/operations/operations.types.js';

function attentionItem(overrides: Partial<OperationsAttentionItemDto>): OperationsAttentionItemDto {
  return {
    id: 'item-1',
    type: 'support',
    severity: 'warning',
    vendorId: 'vendor-a',
    vendorName: 'Vendor A',
    objectType: 'Support ticket',
    objectReference: 'Ticket',
    objectId: 'ticket-1',
    status: 'OPEN',
    ageHours: 12,
    title: 'Support needs response',
    description: 'Due soon',
    recommendedAction: 'Review ticket',
    destinationPath: '/admin/support/ticket-1',
    createdAt: '2026-05-17T10:00:00.000Z',
    ...overrides,
  };
}

describe('operational attention derivation', () => {
  it('derives critical severity for overdue or high priority items', () => {
    expect(deriveOperationalSeverity({ overdue: true, ageHours: 2 })).toBe('critical');
    expect(deriveOperationalSeverity({ priority: 'high', ageHours: 2 })).toBe('critical');
    expect(deriveOperationalSeverity({ status: 'failed', ageHours: 2 })).toBe('critical');
  });

  it('derives warning for older unresolved items and info for low pressure items', () => {
    expect(deriveOperationalSeverity({ ageHours: 25 })).toBe('warning');
    expect(deriveOperationalSeverity({ ageHours: 2, status: 'active' })).toBe('info');
  });

  it('groups vendor risk by simple operational drivers', () => {
    const risks = buildVendorRiskSummaries([
      attentionItem({ id: 'support-1', type: 'support', severity: 'critical' }),
      attentionItem({ id: 'shipment-1', type: 'shipment', severity: 'warning' }),
      attentionItem({ id: 'finance-1', type: 'finance', severity: 'warning', vendorId: 'vendor-b', vendorName: 'Vendor B' }),
      attentionItem({ id: 'platform-1', vendorId: 'platform', vendorName: 'Platform', severity: 'critical' }),
    ]);

    expect(risks[0]).toEqual(expect.objectContaining({
      vendorId: 'vendor-a',
      riskLevel: 'critical',
      supportItems: 1,
      shipmentItems: 1,
    }));
    expect(risks.map((risk) => risk.vendorId)).not.toContain('platform');
  });

  it('derives non-destructive operational recommendations from attention signals', () => {
    const queue = [
      attentionItem({
        id: 'support-overdue',
        type: 'support',
        severity: 'critical',
        title: 'Overdue support ticket',
        objectReference: 'Order #1029',
        objectId: 'ticket-1',
      }),
      attentionItem({
        id: 'shipment-missing',
        type: 'shipment',
        severity: 'warning',
        title: 'Shipment pending carrier identifiers',
        objectReference: 'Order #1028',
        objectId: 'shipment-1',
        ageHours: 30,
      }),
      attentionItem({
        id: 'finance-issue',
        type: 'finance',
        severity: 'critical',
        title: 'Invoice visibility issue',
        objectReference: 'Order #1027',
        objectId: 'finance-1',
      }),
    ];
    const risks = buildVendorRiskSummaries(queue);
    const recommendations = buildOperationalRecommendations(queue, risks, '2026-05-17T10:00:00.000Z');

    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'support_escalation',
          title: 'Escalate overdue support request',
          recommendedAction: expect.stringContaining('Review owner'),
          vendorVisible: false,
        }),
        expect.objectContaining({
          type: 'shipment_stale',
          title: 'Review stale shipment update',
          vendorVisible: true,
        }),
        expect.objectContaining({
          type: 'finance_review',
          title: 'Review payout issue',
          recommendedAction: 'Open finance and review payout status',
          vendorVisible: false,
        }),
        expect.objectContaining({
          type: 'vendor_risk',
          vendorVisible: false,
        }),
      ]),
    );
    expect(recommendations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'invoice_retry',
        }),
      ]),
    );
  });
});
