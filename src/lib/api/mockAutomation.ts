import type { AutomationDashboard } from './contracts';

const automationDashboard: AutomationDashboard = {
  alerts: [
    {
      id: 'AUT-30041',
      type: 'Warning',
      message: 'Three vendor orders are waiting on inventory confirmation.',
      status: 'New',
      timestamp: '2026-05-10T09:12:00Z',
      source: 'Order monitor',
    },
    {
      id: 'AUT-30042',
      type: 'Info',
      message: 'Refund queue is within target SLA for the current shift.',
      status: 'Resolved',
      timestamp: '2026-05-10T09:25:00Z',
      source: 'Finance watcher',
    },
    {
      id: 'AUT-30043',
      type: 'Critical',
      message: 'One return request is overdue for policy review.',
      status: 'In Progress',
      timestamp: '2026-05-10T09:40:00Z',
      source: 'Returns engine',
    },
    {
      id: 'AUT-30044',
      type: 'Info',
      message: 'Automation sync completed successfully for the operations board.',
      status: 'Resolved',
      timestamp: '2026-05-10T10:05:00Z',
      source: 'Scheduler',
    },
    {
      id: 'AUT-30045',
      type: 'Warning',
      message: 'Two payouts are waiting on reconciliation verification.',
      status: 'In Progress',
      timestamp: '2026-05-10T10:18:00Z',
      source: 'Ledger watcher',
    },
  ],
  suggestions: [
    {
      title: 'Prepare follow-up queue',
      description: 'Group unresolved alerts into a review queue for the support team.',
      actionLabel: 'Create queue',
    },
    {
      title: 'Escalate overdue return',
      description: 'Notify the operations lead when a return remains in review too long.',
      actionLabel: 'Escalate',
    },
    {
      title: 'Summarize daily signals',
      description: 'Generate a compact snapshot of alerts for the shift handoff.',
      actionLabel: 'Summarize',
    },
  ],
};

export function getMockAutomationDashboard(): AutomationDashboard {
  return automationDashboard;
}
