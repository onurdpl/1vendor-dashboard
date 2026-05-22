import { runtimeServices } from '../../services/runtime-services';
import type { ShipmentCustomerOverrides, ShippingProvider, VendorShippingConfigUpdate } from './contracts';
import type { UpdateNavlungoShipmentPayload } from '../../services/real/orders';

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
  options: {
    vendorId?: string | null;
    customerOverrides?: ShipmentCustomerOverrides;
    useFullSenderDetailsForThisRetry?: boolean;
  } = {},
) {
  return runtimeServices.orders.retryFailedShipmentExecution(
    shipmentExecutionId,
    options.vendorId ?? undefined,
    options.customerOverrides,
    options.useFullSenderDetailsForThisRetry,
  );
}

export async function refreshShipmentExecutionStatus(
  shipmentExecutionId: string,
  options: { vendorId?: string | null } = {},
) {
  return runtimeServices.orders.refreshShipmentExecutionStatus(
    shipmentExecutionId,
    options.vendorId ?? undefined,
  );
}

export async function cancelShipmentExecution(
  shipmentExecutionId: string,
  options: { vendorId?: string | null } = {},
) {
  return runtimeServices.orders.cancelShipmentExecution(
    shipmentExecutionId,
    options.vendorId ?? undefined,
  );
}

export async function updateNavlungoShipmentExecution(
  shipmentExecutionId: string,
  payload: UpdateNavlungoShipmentPayload,
  options: { vendorId?: string | null } = {},
) {
  return runtimeServices.orders.updateNavlungoShipmentExecution(
    shipmentExecutionId,
    payload,
    options.vendorId ?? undefined,
  );
}

export async function createReturnShipmentLabel(
  shipmentExecutionId: string,
  options: { vendorId?: string | null } = {},
) {
  return runtimeServices.orders.createReturnShipmentLabel(
    shipmentExecutionId,
    options.vendorId ?? undefined,
  );
}

export async function probeShopifyReturnLabelUpload(shipmentExecutionId: string) {
  return runtimeServices.orders.probeShopifyReturnLabelUpload(shipmentExecutionId);
}

export async function probeTryOtoReturnDetails(shipmentExecutionId: string) {
  return runtimeServices.orders.probeTryOtoReturnDetails(shipmentExecutionId);
}

export async function probeTryOtoReturnLink(shipmentExecutionId: string) {
  return runtimeServices.orders.probeTryOtoReturnLink(shipmentExecutionId);
}

export async function probeTryOtoReturnAwbPrint(shipmentExecutionId: string) {
  return runtimeServices.orders.probeTryOtoReturnAwbPrint(shipmentExecutionId);
}

export async function getShippingProviderDiagnostics(
  options: { vendorId?: string | null; provider?: ShippingProvider | 'navlungo' | null } = {},
) {
  return runtimeServices.orders.shippingProviderDiagnostics(options.vendorId ?? undefined, options.provider ?? undefined);
}

export async function getVendorShippingConfig(options: { vendorId?: string | null } = {}) {
  return runtimeServices.orders.vendorShippingConfig(options.vendorId ?? undefined);
}

export async function updateVendorShippingConfig(vendorId: string, input: VendorShippingConfigUpdate) {
  return runtimeServices.orders.updateVendorShippingConfig(vendorId, input);
}
