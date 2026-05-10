import { request } from './client';
import type { OrderDetail, OrderSummary, ShopifyOrderBreakdown } from './contracts';

export async function listOrders() {
  return request<OrderSummary[]>('/orders');
}

export async function getOrder(orderId: string) {
  return request<OrderDetail>(`/orders/${orderId}`);
}

export async function getAdminShopifyOrderBreakdown(shopifyOrderId: string) {
  return request<ShopifyOrderBreakdown>(`/admin/orders/${shopifyOrderId}`);
}
