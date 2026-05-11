import { getCurrentVendorContext, type VendorId } from '../auth/vendorContext';
import type { AutomationDashboard } from './contracts';

type VendorAutomationDashboard = AutomationDashboard & {
  vendorId: VendorId;
};

const automationDashboards: Record<VendorId, VendorAutomationDashboard> = {
  'demo-vendor-a': {
    vendorId: 'demo-vendor-a',
    alerts: [
      {
        id: 'AUT-A-7001',
        type: 'Warning',
        message: 'Three vendor A orders are waiting on inventory confirmation.',
        status: 'New',
        timestamp: '2026-05-10T09:12:00Z',
        source: 'Order monitor',
      },
      {
        id: 'AUT-A-7002',
        type: 'Info',
        message: 'Vendor A refund queue is within target SLA for the current shift.',
        status: 'Resolved',
        timestamp: '2026-05-10T09:25:00Z',
        source: 'Finance watcher',
      },
      {
        id: 'AUT-A-7003',
        type: 'Critical',
        message: 'One vendor A return request is overdue for policy review.',
        status: 'In Progress',
        timestamp: '2026-05-10T09:40:00Z',
        source: 'Returns engine',
      },
    ],
    suggestions: [
      {
        title: 'Prepare vendor A follow-up queue',
        description: 'Group unresolved alerts into a review queue for the support team.',
        actionLabel: 'Create queue',
      },
      {
        title: 'Escalate vendor A overdue return',
        description: 'Notify the operations lead when a return remains in review too long.',
        actionLabel: 'Escalate',
      },
      {
        title: 'Summarize vendor A signals',
        description: 'Generate a compact snapshot of alerts for the shift handoff.',
        actionLabel: 'Summarize',
      },
    ],
  },
  'demo-vendor-b': {
    vendorId: 'demo-vendor-b',
    alerts: [
      {
        id: 'AUT-B-8001',
        type: 'Info',
        message: 'Vendor B automation sync completed successfully for the operations board.',
        status: 'Resolved',
        timestamp: '2026-05-10T10:05:00Z',
        source: 'Scheduler',
      },
      {
        id: 'AUT-B-8002',
        type: 'Warning',
        message: 'Two vendor B payouts are waiting on reconciliation verification.',
        status: 'In Progress',
        timestamp: '2026-05-10T10:18:00Z',
        source: 'Ledger watcher',
      },
      {
        id: 'AUT-B-8003',
        type: 'Critical',
        message: 'Vendor B return queue has a policy review deadline approaching.',
        status: 'New',
        timestamp: '2026-05-10T10:32:00Z',
        source: 'Returns engine',
      },
    ],
    suggestions: [
      {
        title: 'Prepare vendor B follow-up queue',
        description: 'Group unresolved alerts into a review queue for the support team.',
        actionLabel: 'Create queue',
      },
      {
        title: 'Escalate vendor B overdue return',
        description: 'Notify the operations lead when a return remains in review too long.',
        actionLabel: 'Escalate',
      },
      {
        title: 'Summarize vendor B signals',
        description: 'Generate a compact snapshot of alerts for the shift handoff.',
        actionLabel: 'Summarize',
      },
    ],
  },
};

function resolveVendorId(vendorId?: VendorId) {
  return vendorId ?? getCurrentVendorContext().vendorId;
}

export function getMockAutomationDashboard(vendorId?: VendorId): AutomationDashboard {
  const currentVendorId = resolveVendorId(vendorId);
  const dashboard = automationDashboards[currentVendorId];

  if (!dashboard) {
    return {
      alerts: [],
      suggestions: [],
    };
  }

  return {
    alerts: dashboard.alerts,
    suggestions: dashboard.suggestions,
  };
}
