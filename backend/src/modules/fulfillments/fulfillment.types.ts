export type UpdateAllocationTrackingBody = {
  trackingNumber?: string;
  carrier?: string;
  trackingUrl?: string | null;
  notifyCustomer?: boolean;
};

export type UpdateAllocationTrackingSuccess = {
  ok: true;
  allocationId: string;
  trackingNumber: string;
  carrier: string;
  trackingUrl: string | null;
  notifyCustomer: boolean;
  fulfillmentStatus: string;
  shippingStatus: string;
  shopifySyncSource: 'mock' | 'shopify_admin';
  shopifyFulfillmentId: string;
};

export type UpdateAllocationTrackingFailure =
  | {
      ok: false;
      code: 400 | 404 | 409 | 502;
      message: string;
    }
  | {
      ok: false;
      code: 403;
      message: string;
    };

export type UpdateAllocationTrackingResult =
  | UpdateAllocationTrackingSuccess
  | UpdateAllocationTrackingFailure;
