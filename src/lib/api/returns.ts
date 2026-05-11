import { runtimeServices } from '../../services/runtime-services';

export async function listReturns() {
  return runtimeServices.returns.list();
}

export async function getReturn(returnId: string) {
  return runtimeServices.returns.detail(returnId);
}
