import { getCurrentVendorContext, type VendorId } from '../auth/vendorContext';
import { getMockAutomationDashboard } from './mockAutomation';
import { getMockFinanceDashboard } from './mockFinance';
import { listMockOrders } from './mockOrders';
import { listMockReturns } from './mockReturns';
import type { DashboardOverview } from './contracts';

function resolveVendorId(vendorId?: VendorId) {
  return vendorId ?? getCurrentVendorContext().vendorId;
}

function formatCount(value: number) {
  return value.toString();
}

export function buildDashboardOverview(vendorId?: VendorId): DashboardOverview {
  const currentVendorId = resolveVendorId(vendorId);
  const currentVendor = getCurrentVendorContext();
  const orders = listMockOrders(currentVendorId);
  const returns = listMockReturns(currentVendorId);
  const finance = getMockFinanceDashboard(currentVendorId);
  const automation = getMockAutomationDashboard(currentVendorId);
  const activeOrders = orders.filter((order) =>
    ['Pending', 'Processing', 'Shipped', 'On Hold'].includes(order.status),
  ).length;
  const activeReturns = returns.filter((item) => ['Pending', 'In Review'].includes(item.status)).length;
  const pendingPayouts = finance.transactions.filter((transaction) => transaction.status === 'Pending').length;
  const unresolvedAlerts = automation.alerts.filter((alert) => alert.status !== 'Resolved').length;

  const recentActivity: string[] = [];

  if (orders[0]) {
    recentActivity.push(`${orders[0].id} is ${orders[0].status.toLowerCase()} for ${orders[0].customer}`);
  }

  if (returns[0]) {
    recentActivity.push(`${returns[0].id} is ${returns[0].status.toLowerCase()} against ${returns[0].relatedOrderId}`);
  }

  if (automation.alerts[0]) {
    recentActivity.push(`${automation.alerts[0].source} flagged ${automation.alerts[0].type.toLowerCase()} signals`);
  }

  return {
    vendorId: currentVendorId,
    vendorName: currentVendor.vendorName,
    title: `${currentVendor.vendorName} command center`,
    description: `Track ${currentVendor.vendorName} activity, support workload, and finance status from one place.`,
    stats: [
      { label: 'Open tickets', value: formatCount(activeReturns + unresolvedAlerts) },
      { label: 'Pending payouts', value: formatCount(pendingPayouts) },
      { label: 'Vendor checks', value: formatCount(activeOrders) },
    ],
    recentActivity: recentActivity.length > 0 ? recentActivity : [`No recent activity for ${currentVendor.vendorName}.`],
    workspaceStatus: `${currentVendor.vendorName} has ${activeOrders} active orders, ${activeReturns} active returns, and ${unresolvedAlerts} automation alerts in flight.`,
  };
}

export function getDashboardOverview(vendorId?: VendorId): Promise<DashboardOverview> {
  return Promise.resolve(buildDashboardOverview(vendorId));
}
