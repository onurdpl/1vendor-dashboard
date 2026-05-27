import { describe, expect, it } from 'vitest';
import {
  getDashboardWorkflowAction,
  getFinanceWorkflowAction,
  getOrderWorkflowAction,
  getReturnWorkflowAction,
  getSupportWorkflowAction,
} from './workflowActionGuidance';

describe('workflow action guidance', () => {
  it('maps shipment and tracking states to existing order workflows', () => {
    expect(getOrderWorkflowAction({ shippingStatus: 'Awaiting Shipment', hasShipment: false }).actionLabel).toBe('Create shipment');
    expect(getOrderWorkflowAction({ shippingStatus: 'Awaiting Shipment', hasShipment: true }).actionLabel).toBe('Sync tracking');
    expect(getOrderWorkflowAction({ allocationStatus: 'vendor_blocked', shippingStatus: 'Awaiting Shipment', hasShipment: false }).actionLabel).toBe(
      'Review allocation',
    );
  });

  it('maps return states to review actions without inventing refund execution', () => {
    expect(getReturnWorkflowAction({ status: 'Requested', sourceType: 'shopify_return_request' }).actionLabel).toBe('Review return');
    expect(
      getReturnWorkflowAction({
        status: 'Requested',
        sourceType: 'shopify_return_request',
        vendorReceivedAt: '2026-05-22T10:00:00.000Z',
      }).actionLabel,
    ).toBe('Approve or reject return');
  });

  it('uses settlement review language without final payout certainty', () => {
    const guidance = getFinanceWorkflowAction({
      status: 'Pending',
      settlementStatus: 'held',
      payoutReady: true,
      audience: 'vendor',
    });

    expect(guidance.actionLabel).toBe('Review settlement');
    expect(guidance.description).toContain('settlement preview');
    expect(guidance.description).not.toMatch(/payable|confirmed|final payout/i);
  });

  it('keeps dashboard issue groups mapped to existing workspaces', () => {
    expect(getDashboardWorkflowAction('Automation issue groups').actionLabel).toBe('Review automation queue');
    expect(getDashboardWorkflowAction('Open support issues').actionLabel).toBe('Open linked support record');
  });

  it('guides support users toward existing records before new requests', () => {
    expect(getSupportWorkflowAction(true).actionLabel).toBe('Open linked support record');
    expect(getSupportWorkflowAction(false).actionLabel).toBe('Request support');
  });
});
