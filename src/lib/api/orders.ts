import { runtimeServices } from '../../services/runtime-services';
import type { ShipmentCustomerOverrides, VendorShippingConfigUpdate } from './contracts';

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

export async function createShipmentExecution(
  allocationId: string,
  options: { vendorId?: string | null; customerOverrides?: ShipmentCustomerOverrides } = {},
) {
  return runtimeServices.orders.createShipmentExecution(
    allocationId,
    options.vendorId ?? undefined,
    options.customerOverrides,
  );
}

export async function retryShipmentExecution(shipmentExecutionId: string) {
  return runtimeServices.orders.retryShipmentExecution(shipmentExecutionId);
}

export async function retryFailedShipmentExecution(
  shipmentExecutionId: string,
  options: { vendorId?: string | null; customerOverrides?: ShipmentCustomerOverrides } = {},
) {
  return runtimeServices.orders.retryFailedShipmentExecution(
    shipmentExecutionId,
    options.vendorId ?? undefined,
    options.customerOverrides,
  );
}

export async function getShippingProviderDiagnostics(options: { vendorId?: string | null } = {}) {
  return runtimeServices.orders.shippingProviderDiagnostics(options.vendorId ?? undefined);
}

export async function getVendorShippingConfig(options: { vendorId?: string | null } = {}) {
  return runtimeServices.orders.vendorShippingConfig(options.vendorId ?? undefined);
}

export async function updateVendorShippingConfig(vendorId: string, input: VendorShippingConfigUpdate) {
  return runtimeServices.orders.updateVendorShippingConfig(vendorId, input);
}
