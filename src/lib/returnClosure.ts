type ClosureView = {
  status?: string | null;
  returnLifecycleStatus?: string | null;
  shopifyClosureStatus?: string | null;
  shopifyClosedAt?: string | null;
};

export function getCurrentReturnClosure(value: ClosureView) {
  const local = (value.returnLifecycleStatus || value.status || '').trim().toUpperCase();
  const canonical = value.shopifyClosureStatus?.trim().toUpperCase();
  if (canonical ? canonical !== 'CLOSED' : local !== 'CLOSED') return null;
  const date = value.shopifyClosedAt;
  return {
    label: 'Closed',
    at: canonical === 'CLOSED' && date && Number.isFinite(Date.parse(date)) ? date : null,
  };
}
