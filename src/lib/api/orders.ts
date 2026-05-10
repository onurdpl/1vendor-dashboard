import { request } from './client';
import type { OrderDetail, OrderSummary } from './contracts';

export async function listOrders() {
  return request<OrderSummary[]>('/orders');
}

export async function getOrder(orderId: string) {
  return request<OrderDetail>(`/orders/${orderId}`);
}
