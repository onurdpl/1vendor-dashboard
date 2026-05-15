import { runtimeServices } from '../../services/runtime-services';

export async function listOrders(options: { vendorId?: string | null } = {}) {
  return runtimeServices.orders.list(options.vendorId ?? undefined);
}

export async function getOrder(orderId: string, options: { vendorId?: string | null } = {}) {
  return runtimeServices.orders.detail(orderId, options.vendorId ?? undefined);
}

export async function getAdminShopifyOrderBreakdown(shopifyOrderId: string) {
  return runtimeServices.orders.adminBreakdown(shopifyOrderId);
}

export async function submitFulfillmentTracking(
  allocationId: string,
  payload: {
    trackingNumber: string;
    carrier: string;
    trackingUrl?: string;
    notifyCustomer?: boolean;
  },
) {
  return runtimeServices.orders.submitFulfillmentTracking(allocationId, payload);
}
