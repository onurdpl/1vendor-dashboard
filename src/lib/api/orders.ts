import { runtimeServices } from '../../services/runtime-services';

export async function listOrders() {
  return runtimeServices.orders.list();
}

export async function getOrder(orderId: string) {
  return runtimeServices.orders.detail(orderId);
}

export async function getAdminShopifyOrderBreakdown(shopifyOrderId: string) {
  return runtimeServices.orders.adminBreakdown(shopifyOrderId);
}
