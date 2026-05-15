import { runtimeServices } from '../../services/runtime-services';

export async function listReturns(options: { vendorId?: string | null } = {}) {
  return runtimeServices.returns.list(options.vendorId ?? undefined);
}

export async function getReturn(returnId: string, options: { vendorId?: string | null } = {}) {
  return runtimeServices.returns.detail(returnId, options.vendorId ?? undefined);
}
