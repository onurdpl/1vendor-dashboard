export type DashboardOperationalSummaryDto = {
  vendorId: string;
  orders: {
    total: number;
    awaitingShipment: number;
    blocked: number;
    pendingReassignment: number;
    vendorBlocked: number;
  };
  returns: {
    refundAttention: number;
  };
};
