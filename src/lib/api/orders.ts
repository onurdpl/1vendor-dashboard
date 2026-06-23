import { runtimeServices } from '../../services/runtime-services';
import type { ShipmentCustomerOverrides, ShippingProvider, VendorShippingConfigUpdate } from './contracts';
import type {
  AdminCancelRefundReviewPayload,
  AdminResolutionNotePayload,
  AdminEconomicTransferPayload,
  AdminShopifyRefundExecutionPayload,
  AdminReturnToVendorPayload,
  AdminShopifyRefundPreviewPayload,
  AllocationSplitExecutePayload,
  AllocationSplitPlanPayload,
  RejectOrderPayload,
  UpdateNavlungoShipmentPayload,
} from '../../services/real/orders';

export async function listOrders(options: { vendorId?: string | null; signal?: AbortSignal } = {}) {
  return runtimeServices.orders.list(options.vendorId ?? undefined, { signal: options.signal });
}

export async function getOrder(orderId: string, options: { vendorId?: string | null; signal?: AbortSignal } = {}) {
  return runtimeServices.orders.detail(orderId, options.vendorId ?? undefined, { signal: options.signal });
}

export async function getAdminShopifyOrderBreakdown(shopifyOrderId: string, options: { signal?: AbortSignal } = {}) {
  return runtimeServices.orders.adminBreakdown(shopifyOrderId, { signal: options.signal });
}

export async function returnAdminBlockedAllocationToVendor(
  shopifyOrderId: string,
  allocationId: string,
  payload: AdminReturnToVendorPayload,
) {
  return runtimeServices.orders.returnAdminBlockedAllocationToVendor(shopifyOrderId, allocationId, payload);
}

export async function addAdminAllocationResolutionNote(
  shopifyOrderId: string,
  allocationId: string,
  payload: AdminResolutionNotePayload,
) {
  return runtimeServices.orders.addAdminAllocationResolutionNote(shopifyOrderId, allocationId, payload);
}

export async function requestAdminCancelRefundReview(
  shopifyOrderId: string,
  allocationId: string,
  payload: AdminCancelRefundReviewPayload,
) {
  return runtimeServices.orders.requestAdminCancelRefundReview(shopifyOrderId, allocationId, payload);
}

export async function previewAdminShopifyRefund(
  shopifyOrderId: string,
  allocationId: string,
  payload: AdminShopifyRefundPreviewPayload,
) {
  return runtimeServices.orders.previewAdminShopifyRefund(shopifyOrderId, allocationId, payload);
}

export async function executeAdminShopifyRefund(
  shopifyOrderId: string,
  allocationId: string,
  payload: AdminShopifyRefundExecutionPayload,
) {
  return runtimeServices.orders.executeAdminShopifyRefund(shopifyOrderId, allocationId, payload);
}

export async function transferAdminAllocationEconomics(
  shopifyOrderId: string,
  allocationId: string,
  payload: AdminEconomicTransferPayload,
) {
  return runtimeServices.orders.transferAdminAllocationEconomics(shopifyOrderId, allocationId, payload);
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

export async function rejectOrder(
  orderId: string,
  payload: RejectOrderPayload,
  options: { vendorId?: string | null } = {},
) {
  return runtimeServices.orders.reject(orderId, payload, options.vendorId ?? undefined);
}

export async function planAllocationSplit(
  allocationId: string,
  payload: AllocationSplitPlanPayload,
  options: { vendorId?: string | null } = {},
) {
  return runtimeServices.orders.planAllocationSplit(allocationId, payload, options.vendorId ?? undefined);
}

export async function splitAllocation(
  allocationId: string,
  payload: AllocationSplitExecutePayload,
  options: { vendorId?: string | null } = {},
) {
  return runtimeServices.orders.splitAllocation(allocationId, payload, options.vendorId ?? undefined);
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

export async function refreshShipmentProviderData(
  shipmentExecutionId: string,
  options: { vendorId?: string | null } = {},
) {
  return runtimeServices.orders.refreshShipmentProviderData(
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
  options: { vendorId?: string | null; dryRun?: boolean; customerOverrides?: ShipmentCustomerOverrides } = {},
) {
  return runtimeServices.orders.createReturnShipmentLabel(
    shipmentExecutionId,
    options.vendorId ?? undefined,
    options.dryRun,
    options.customerOverrides,
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
  options: { vendorId?: string | null; provider?: ShippingProvider | 'navlungo' | null; signal?: AbortSignal } = {},
) {
  return runtimeServices.orders.shippingProviderDiagnostics(options.vendorId ?? undefined, options.provider ?? undefined, { signal: options.signal });
}

export async function getVendorShippingConfig(options: { vendorId?: string | null; signal?: AbortSignal } = {}) {
  return runtimeServices.orders.vendorShippingConfig(options.vendorId ?? undefined, { signal: options.signal });
}

export async function updateVendorShippingConfig(vendorId: string, input: VendorShippingConfigUpdate) {
  return runtimeServices.orders.updateVendorShippingConfig(vendorId, input);
}

export async function syncKargonomiWarehouseDetails(vendorId: string, warehouseId: string) {
  return runtimeServices.orders.syncKargonomiWarehouseDetails(vendorId, warehouseId);
}
