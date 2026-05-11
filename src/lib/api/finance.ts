import { runtimeServices } from '../../services/runtime-services';

export function getFinanceDashboard() {
  return runtimeServices.finance.dashboard();
}
