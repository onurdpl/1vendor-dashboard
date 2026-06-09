import { runtimeServices } from '../../services/runtime-services';

export async function listReturns(options: { vendorId?: string | null; signal?: AbortSignal } = {}) {
  return runtimeServices.returns.list(options.vendorId ?? undefined, { signal: options.signal });
}

export async function getReturn(returnId: string, options: { vendorId?: string | null; signal?: AbortSignal } = {}) {
  return runtimeServices.returns.detail(returnId, options.vendorId ?? undefined, { signal: options.signal });
}

export async function getKargonomiReturnPreview(returnId: string, options: { vendorId?: string | null; signal?: AbortSignal } = {}) {
  return runtimeServices.returns.kargonomiPreview(returnId, options.vendorId ?? undefined, { signal: options.signal });
}

export async function createKargonomiReturnShipment(returnId: string, options: { vendorId?: string | null } = {}) {
  return runtimeServices.returns.createKargonomiReturnShipment(returnId, options.vendorId ?? undefined);
}

export async function refreshKargonomiReturnProviderData(returnId: string, options: { vendorId?: string | null } = {}) {
  return runtimeServices.returns.refreshKargonomiReturnProviderData(returnId, options.vendorId ?? undefined);
}

export async function markReturnReceived(returnId: string, options: { vendorId?: string | null } = {}) {
  return runtimeServices.returns.markReceived(returnId, options.vendorId ?? undefined);
}

export async function reviewReturn(
  returnId: string,
  input: { decision: 'approved' | 'rejected'; reason?: string },
  options: { vendorId?: string | null } = {},
) {
  return runtimeServices.returns.review(returnId, input, options.vendorId ?? undefined);
}

export async function createNavlungoReturnPickup(
  returnId: string,
  input: {
    dryRun?: boolean;
    apiVersionOverride?: 'current' | 'v2' | 'v2.1';
    endpointVersionOverride?: 'current' | 'v2' | 'v2.1';
    carrierOverride?: 'current' | '9' | '10';
    carrierIdOverride?: 'current' | '9' | '10';
    endpointPathOverride?: '/post/create' | '/post/return';
    diagnosticConfirm?: 'YES';
    customerOverrides?: Record<string, string | undefined>;
  } = {},
  options: { vendorId?: string | null } = {},
) {
  return runtimeServices.returns.createNavlungoReturnPickup(returnId, input, options.vendorId ?? undefined);
}

export async function saveNavlungoReturnPickupAddressCompletion(
  returnId: string,
  input: { customerOverrides?: Record<string, string | undefined> } = {},
  options: { vendorId?: string | null } = {},
) {
  return runtimeServices.returns.saveNavlungoReturnPickupAddressCompletion(returnId, input, options.vendorId ?? undefined);
}

export async function syncNavlungoReturnStatus(
  returnId: string,
  options: { vendorId?: string | null } = {},
) {
  return runtimeServices.returns.syncNavlungoReturnStatus(returnId, options.vendorId ?? undefined);
}
