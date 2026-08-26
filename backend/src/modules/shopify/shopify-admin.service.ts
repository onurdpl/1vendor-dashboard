import type { AppEnv } from '../../config/env.js';
import { Buffer } from 'node:buffer';
import type {
  CanonicalShopifyOrderSnapshot,
  CanonicalShopifyRefundSnapshot,
  CanonicalShopifyReturnSnapshot,
  CancelFulfillmentOrderResult,
  CancelShopifyReturnResult,
  CreateFulfillmentTrackingInput,
  CreateFulfillmentTrackingResult,
  CreateShopifyRefundInput,
  CreateShopifyRefundResult,
  FetchOrderLineItemImagesResult,
  FetchCanonicalShopifyOrderSnapshotResult,
  FetchCanonicalShopifyRefundsForOrderResult,
  FetchCanonicalShopifyReturnsForOrderResult,
  FetchOrderTaxSnapshotResult,
  FetchShopifyReturnDetailsResult,
  FetchShopifyReturnReverseDeliveryInputsResult,
  FetchOrderSellerInfoResult,
  FetchRecentShopifyOrdersPageResult,
  ProbeShopifyReturnLabelUploadInput,
  ProbeShopifyReturnLabelUploadResult,
  PreviewSuggestedRefundInput,
  PreviewSuggestedRefundResult,
  SellerInfoMap,
  ShopifyFulfillmentOrderCancellationClassificationResponse,
  ShopifyFulfillmentOrder,
  ShopifyFulfillmentOrdersResponse,
  ShopifyGraphqlResponse,
  ShopifyMoneySnapshot,
  ShopifyRefundRestockType,
  ShopifyOrderFulfillmentState,
  ShopifyReturnCancellationState,
  ShopifyReverseDeliveryLineItem,
  ShopifyReturnLineItem,
  ShopifyTaxLineSnapshot,
  ShopifyReturnTrackingInfo,
  SyncShopifyReturnShippingInput,
  SyncShopifyReturnShippingResult,
} from './shopify-admin.types.js';

export class CanonicalShopifySnapshotParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalShopifySnapshotParseError';
  }
}

async function parseCanonicalShopifyResponse<T>(response: Response): Promise<ShopifyGraphqlResponse<T>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new CanonicalShopifySnapshotParseError('Shopify canonical response was not valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CanonicalShopifySnapshotParseError('Shopify canonical response had an invalid envelope.');
  }
  return value as ShopifyGraphqlResponse<T>;
}

type OrderSellerInfoQueryResponse = {
  order: {
    metafield: {
      value: string | null;
    } | null;
  } | null;
};

type RecentOrdersQueryResponse = {
  orders: {
    nodes: Array<{
      id?: string | null;
      legacyResourceId?: string | null;
      name?: string | null;
      createdAt?: string | null;
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor?: string | null;
    };
  };
};

type OrderLineItemImagesQueryResponse = {
  order: {
    id: string;
    lineItems: {
      edges: Array<{
        node: {
          id: string;
          sku: string | null;
          image?: {
            url: string | null;
            altText: string | null;
          } | null;
          variant?: {
            id: string;
            image?: {
              url: string | null;
              altText: string | null;
            } | null;
          } | null;
          product?: {
            id: string;
            featuredMedia?: {
              image?: {
                url: string | null;
                altText: string | null;
              } | null;
            } | null;
          } | null;
        };
      }>;
    };
  } | null;
};

type OrderLineItemImageNode = NonNullable<OrderLineItemImagesQueryResponse['order']>['lineItems']['edges'][number]['node'];

type ShopifyMoneySetNode = {
  shopMoney?: {
    amount?: string | null;
    currencyCode?: string | null;
  } | null;
  presentmentMoney?: {
    amount?: string | null;
    currencyCode?: string | null;
  } | null;
} | null;

type ShopifyTaxLineNode = {
  title?: string | null;
  rate?: number | null;
  ratePercentage?: number | null;
  priceSet?: ShopifyMoneySetNode;
};

type OrderTaxSnapshotQueryResponse = {
  order: {
    id: string;
    taxesIncluded?: boolean | null;
    currentTotalTaxSet?: ShopifyMoneySetNode;
    currentTaxLines?: ShopifyTaxLineNode[];
    lineItems: {
      edges: Array<{
        node: {
          id: string;
          sku: string | null;
          quantity: number;
          originalUnitPriceSet?: ShopifyMoneySetNode;
          discountedTotalSet?: ShopifyMoneySetNode;
          taxLines?: ShopifyTaxLineNode[];
        };
      }>;
    };
  } | null;
};

type CanonicalOrderAddressNode = {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  phone?: string | null;
  country?: string | null;
  countryCodeV2?: string | null;
  zip?: string | null;
  city?: string | null;
  province?: string | null;
  address1?: string | null;
  address2?: string | null;
};

type CanonicalOrderSnapshotQueryResponse = {
  order: {
    id: string;
    legacyResourceId?: string | null;
    name?: string | null;
    createdAt?: string | null;
    currencyCode?: string | null;
    displayFinancialStatus?: string | null;
    cancelledAt?: string | null;
    cancelReason?: string | null;
    paymentGatewayNames?: string[] | null;
    taxesIncluded?: boolean | null;
    note?: string | null;
    tags?: string[] | null;
    email?: string | null;
    phone?: string | null;
    totalPriceSet?: ShopifyMoneySetNode;
    currentTotalTaxSet?: ShopifyMoneySetNode;
    totalShippingPriceSet?: ShopifyMoneySetNode;
    currentTotalDiscountsSet?: ShopifyMoneySetNode;
    customer?: {
      email?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      phone?: string | null;
    } | null;
    shippingAddress?: CanonicalOrderAddressNode | null;
    billingAddress?: CanonicalOrderAddressNode | null;
    metafield?: {
      value?: string | null;
    } | null;
    lineItems: {
      pageInfo?: {
        hasNextPage?: boolean | null;
      } | null;
      edges: Array<{
        node: OrderLineItemImageNode & {
          title?: string | null;
          name?: string | null;
          quantity?: number | null;
          currentQuantity?: number | null;
          refundableQuantity?: number | null;
          originalUnitPriceSet?: ShopifyMoneySetNode;
          discountedTotalSet?: ShopifyMoneySetNode;
          taxLines?: ShopifyTaxLineNode[];
          variant?: OrderLineItemImageNode['variant'] & {
            legacyResourceId?: string | null;
          };
          product?: OrderLineItemImageNode['product'] & {
            legacyResourceId?: string | null;
          };
        };
      }>;
    };
    fulfillmentOrders?: {
      pageInfo?: {
        hasNextPage?: boolean | null;
      } | null;
      edges: Array<{
        node: {
          id: string;
          status?: string | null;
          requestStatus?: string | null;
          lineItems?: {
            pageInfo?: {
              hasNextPage?: boolean | null;
            } | null;
            edges: Array<{
              node: {
                id: string;
                remainingQuantity?: number | null;
                totalQuantity?: number | null;
                lineItem?: {
                  id?: string | null;
                } | null;
              };
            }>;
          } | null;
        };
      }>;
    } | null;
  } | null;
};

type CanonicalRefundsForOrderQueryResponse = {
  order: {
    id: string;
    legacyResourceId?: string | null;
    displayFinancialStatus?: string | null;
    totalReceivedSet?: ShopifyMoneySetNode;
    totalRefundedSet?: ShopifyMoneySetNode;
    netPaymentSet?: ShopifyMoneySetNode;
    totalOutstandingSet?: ShopifyMoneySetNode;
    totalRefundedShippingSet?: ShopifyMoneySetNode;
    refunds: Array<{
      id: string;
      createdAt?: string | null;
      updatedAt?: string | null;
      note?: string | null;
      totalRefundedSet?: ShopifyMoneySetNode;
      transactions: {
        pageInfo?: {
          hasNextPage?: boolean | null;
        } | null;
        edges: Array<{
          node: {
            id: string;
            kind?: string | null;
            status?: string | null;
            amountSet?: ShopifyMoneySetNode;
            parentTransaction?: {
              id?: string | null;
            } | null;
            createdAt?: string | null;
            processedAt?: string | null;
          };
        }>;
      };
      refundLineItems: {
        pageInfo?: {
          hasNextPage?: boolean | null;
        } | null;
        edges: Array<{
          node: {
            id: string;
            quantity?: number | null;
            subtotalSet?: ShopifyMoneySetNode;
            lineItem?: {
              id?: string | null;
              sku?: string | null;
              title?: string | null;
              name?: string | null;
              variantTitle?: string | null;
            } | null;
          };
        }>;
      };
    }>;
  } | null;
};

type CanonicalReturnsForOrderQueryResponse = {
  order: {
    id: string;
    legacyResourceId?: string | null;
    returns: {
      pageInfo?: {
        hasNextPage?: boolean | null;
      } | null;
      edges: Array<{
        node: {
          id: string;
          status?: string | null;
          createdAt?: string | null;
          requestApprovedAt?: string | null;
          closedAt?: string | null;
          returnLineItems: {
            pageInfo?: {
              hasNextPage?: boolean | null;
            } | null;
            edges: Array<{
              node: {
                id: string;
                customerNote?: string | null;
                returnReason?: string | null;
                returnReasonNote?: string | null;
                fulfillmentLineItem?: {
                  id?: string | null;
                  lineItem?: {
                    id?: string | null;
                    sku?: string | null;
                  } | null;
                } | null;
              };
            }>;
          };
        };
      }>;
    };
  } | null;
};

type SuggestedRefundQueryResponse = {
  order: {
    id: string;
    suggestedRefund: {
      amountSet?: ShopifyMoneySetNode;
      maximumRefundableSet?: ShopifyMoneySetNode;
      subtotalSet?: ShopifyMoneySetNode;
      totalTaxSet?: ShopifyMoneySetNode;
      shipping?: {
        amountSet?: ShopifyMoneySetNode;
        maximumRefundableSet?: ShopifyMoneySetNode;
        taxSet?: ShopifyMoneySetNode;
      } | null;
      refundLineItems: Array<{
        lineItem: {
          id: string;
        } | null;
        quantity: number;
        restockType?: ShopifyRefundRestockType | null;
        subtotalSet?: ShopifyMoneySetNode;
        totalTaxSet?: ShopifyMoneySetNode;
      }>;
      suggestedTransactions: Array<{
        gateway?: string | null;
        formattedGateway?: string | null;
        amountSet?: ShopifyMoneySetNode;
        parentTransaction?: {
          id?: string | null;
        } | null;
      }>;
    } | null;
  } | null;
};

type FulfillmentOrderCancellationClassificationQueryResponse = {
  order: {
    id: string;
    fulfillmentOrders: {
      pageInfo?: {
        hasNextPage?: boolean | null;
      } | null;
      nodes: Array<{
        id: string;
        status: string | null;
        requestStatus: string | null;
        supportedActions: Array<{
          action?: string | null;
        }> | null;
        assignedLocation: {
          location?: {
            id?: string | null;
          } | null;
        } | null;
        lineItems: {
          pageInfo?: {
            hasNextPage?: boolean | null;
          } | null;
          nodes: Array<{
            id: string;
            remainingQuantity: number | null;
            totalQuantity: number | null;
            lineItem: {
              id: string;
            } | null;
          }>;
        };
      }>;
    };
  } | null;
};

type ShopifyReturnQueryResponse = {
  return: {
    id: string;
    order: {
      id: string;
    } | null;
    returnLineItems: {
      edges: Array<{
        node: {
          id: string;
          customerNote?: string | null;
          returnReason?: string | null;
          returnReasonNote?: string | null;
          fulfillmentLineItem?: {
            id: string;
            lineItem: {
              id: string;
              sku: string | null;
            } | null;
          } | null;
        };
      }>;
    };
    reverseFulfillmentOrders: {
      edges: Array<{
        node: {
          reverseDeliveries?: {
            edges: Array<{
              node: {
                deliverable?: {
                  tracking?: {
                    carrierName?: string | null;
                    number?: string | null;
                    url?: string | null;
                  } | null;
                } | null;
              };
            }>;
          };
          lineItems: {
            edges: Array<{
              node: {
                fulfillmentLineItem?: {
                  id: string;
                  lineItem: {
                    id: string;
                    sku: string | null;
                  } | null;
                } | null;
              };
            }>;
          };
        };
      }>;
    };
  } | null;
};

type ShopifyReturnReverseDeliveryInputsQueryResponse = {
  return: {
    id: string;
    reverseFulfillmentOrders: {
      nodes: Array<{
        id: string;
        status: string | null;
        lineItems: {
          nodes: Array<{
            id: string;
            totalQuantity: number | null;
            fulfillmentLineItem?: {
              lineItem?: {
                id: string;
                sku: string | null;
              } | null;
            } | null;
          }>;
        };
        reverseDeliveries: {
          nodes: Array<{
            id: string;
            deliverable?: {
              label?: {
                publicFileUrl?: string | null;
              } | null;
              tracking?: {
                carrierName?: string | null;
                number?: string | null;
                url?: string | null;
              } | null;
            } | null;
          }>;
        };
      }>;
    };
  } | null;
};

type ShopifyReturnCancellationStateQueryResponse = {
  return: {
    id: string;
    status: string;
    requestApprovedAt: string | null;
    closedAt: string | null;
    refunds: {
      edges: Array<{
        node: {
          id: string;
        };
      }>;
    };
    transactions: {
      edges: Array<{
        node: {
          id: string;
        };
      }>;
    };
    reverseFulfillmentOrders: ShopifyReturnReverseDeliveryInputNode['reverseFulfillmentOrders'];
  } | null;
};

type ShopifyReturnReverseDeliveryInputNode = NonNullable<ShopifyReturnReverseDeliveryInputsQueryResponse['return']>;

type ShopifyReturnCancelMutationResponse = {
  returnCancel?: {
    return?: {
      id: string;
      status: string;
    } | null;
    userErrors?: Array<{
      field?: string[] | null;
      message?: string | null;
    }>;
  } | null;
};

type FulfillmentOrderCancelMutationResponse = {
  fulfillmentOrderCancel?: {
    fulfillmentOrder?: {
      id: string;
      status: string | null;
    } | null;
    replacementFulfillmentOrder?: {
      id: string;
      status: string | null;
    } | null;
    userErrors?: Array<{
      field?: string[] | null;
      message?: string | null;
    }>;
  } | null;
};

type RefundCreateMutationResponse = {
  refundCreate?: {
    refund?: {
      id: string;
    } | null;
    order?: {
      id: string;
    } | null;
    userErrors?: Array<{
      field?: string[] | null;
      message?: string | null;
    }>;
  } | null;
};

type ShopifyReverseDeliveryMutationResponse = {
  reverseDeliveryCreateWithShipping?: {
    reverseDelivery?: {
      id: string;
      deliverable?: {
        label?: {
          publicFileUrl?: string | null;
        } | null;
        tracking?: {
          carrierName?: string | null;
          number?: string | null;
          url?: string | null;
        } | null;
      } | null;
    } | null;
    userErrors?: Array<{
      field?: string[] | null;
      message?: string | null;
    }>;
  } | null;
  reverseDeliveryShippingUpdate?: {
    reverseDelivery?: {
      id: string;
      deliverable?: {
        label?: {
          publicFileUrl?: string | null;
        } | null;
        tracking?: {
          carrierName?: string | null;
          number?: string | null;
          url?: string | null;
        } | null;
      } | null;
    } | null;
    userErrors?: Array<{
      field?: string[] | null;
      message?: string | null;
    }>;
  } | null;
};

type ShopifyStagedUploadsCreateResponse = {
  stagedUploadsCreate?: {
    stagedTargets?: Array<{
      url?: string | null;
      resourceUrl?: string | null;
      parameters?: Array<{
        name?: string | null;
        value?: string | null;
      }> | null;
    }> | null;
    userErrors?: Array<{
      field?: string[] | null;
      message?: string | null;
    }> | null;
  } | null;
};

type ShopifyReturnNode = NonNullable<ShopifyReturnQueryResponse['return']>;

type ShopifyOrderFulfillmentStateQueryResponse = {
  order: {
    id: string;
    name: string | null;
    displayFulfillmentStatus: string | null;
    fulfillments: Array<{
      id: string;
      status: string | null;
      createdAt: string | null;
      updatedAt: string | null;
      trackingInfo: Array<{
        company: string | null;
        number: string | null;
        url: string | null;
      }>;
      events: {
        edges: Array<{
          node: {
            status: string | null;
            happenedAt: string | null;
          };
        }>;
      };
      fulfillmentLineItems: {
        edges: Array<{
          node: {
            quantity: number | null;
            lineItem: {
              id: string;
              sku: string | null;
            } | null;
          };
        }>;
      };
    }>;
  } | null;
};

function toShopifyGid(resource: string, id: string) {
  const trimmed = id.trim();
  if (/^gid:\/\/shopify\//i.test(trimmed)) {
    return trimmed;
  }
  return `gid://shopify/${resource}/${trimmed}`;
}

function toShopifyOrderGid(orderId: string) {
  return toShopifyGid('Order', orderId);
}

function toShopifyLineItemGid(lineItemId: string) {
  return toShopifyGid('LineItem', lineItemId);
}

function extractShopifyGidTail(gid: string) {
  const tail = gid.split('/').at(-1)?.trim() ?? '';
  return tail || null;
}

function mapShopifyMoney(value: ShopifyMoneySetNode): ShopifyMoneySnapshot {
  return {
    amount: value?.shopMoney?.amount ?? null,
    currencyCode: value?.shopMoney?.currencyCode ?? null,
  };
}

function mapShopifyTaxLine(value: ShopifyTaxLineNode): ShopifyTaxLineSnapshot {
  return {
    title: value.title ?? null,
    rate: value.rate ?? null,
    ratePercentage: value.ratePercentage ?? null,
    price: mapShopifyMoney(value.priceSet ?? null),
  };
}

function normalizeShopifyString(value: string | null | undefined) {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

function toMoneyAmountString(value: string | number | null | undefined) {
  const parsed = Number(value ?? '');
  return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
}

function readMoneyAmount(value: ShopifyMoneySetNode) {
  return toMoneyAmountString(value?.shopMoney?.amount ?? null);
}

function readCanonicalAddressDistrict(address: CanonicalOrderAddressNode | null | undefined) {
  return normalizeShopifyString(address?.address2) ?? normalizeShopifyString(address?.province);
}

function buildCanonicalAddressLine(address: CanonicalOrderAddressNode | null | undefined) {
  const parts = [normalizeShopifyString(address?.address1), normalizeShopifyString(address?.address2)].filter(
    (part): part is string => Boolean(part),
  );
  return parts.join(', ') || null;
}

function buildCanonicalCustomerName(order: NonNullable<CanonicalOrderSnapshotQueryResponse['order']>) {
  const firstName = normalizeShopifyString(order.customer?.firstName);
  const lastName = normalizeShopifyString(order.customer?.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName || null;
}

function buildCanonicalBillingFullName(address: CanonicalOrderAddressNode | null | undefined) {
  const name = normalizeShopifyString(address?.name);
  if (name) {
    return name;
  }
  const firstName = normalizeShopifyString(address?.firstName);
  const lastName = normalizeShopifyString(address?.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName || null;
}

function normalizeCanonicalOrderSnapshot(value: unknown): FetchCanonicalShopifyOrderSnapshotResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const snapshot = value as CanonicalShopifyOrderSnapshot;
  if (!snapshot.sourceShopifyOrderId || !snapshot.sourceShopifyOrderNumber) {
    return null;
  }
  return {
    ...snapshot,
    source: snapshot.source ?? 'mock',
    lineItems: Array.isArray(snapshot.lineItems) ? snapshot.lineItems : [],
    fulfillmentOrders: Array.isArray(snapshot.fulfillmentOrders) ? snapshot.fulfillmentOrders : [],
    orderTags: Array.isArray(snapshot.orderTags) ? snapshot.orderTags : [],
    sellerInfo: snapshot.sellerInfo && typeof snapshot.sellerInfo === 'object' ? snapshot.sellerInfo : null,
  };
}

function parseMockCanonicalOrderSnapshots(rawValue: string | undefined): Record<string, CanonicalShopifyOrderSnapshot> {
  if (!rawValue) {
    return {};
  }
  const parsed = JSON.parse(rawValue) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SHOPIFY_MOCK_CANONICAL_ORDER_SNAPSHOT must be a JSON object keyed by Shopify order id.');
  }
  return Object.entries(parsed).reduce<Record<string, CanonicalShopifyOrderSnapshot>>((acc, [orderId, value]) => {
    const snapshot = normalizeCanonicalOrderSnapshot(value);
    if (snapshot) {
      acc[orderId] = snapshot;
    }
    return acc;
  }, {});
}

function normalizeCanonicalRefundSnapshot(value: unknown): CanonicalShopifyRefundSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const refund = value as CanonicalShopifyRefundSnapshot;
  if (!refund.sourceShopifyRefundId && !refund.refundGid) {
    return null;
  }

  return {
    ...refund,
    sourceShopifyRefundId: refund.sourceShopifyRefundId ?? extractShopifyGidTail(refund.refundGid) ?? refund.refundGid,
    updatedAt: refund.updatedAt ?? null,
    totalRefundedAmount: refund.totalRefundedAmount ?? null,
    totalRefundedCurrencyCode: refund.totalRefundedCurrencyCode ?? null,
    transactionPaginationComplete: refund.transactionPaginationComplete === true,
    lineItemPaginationComplete: refund.lineItemPaginationComplete === true,
    transactions: Array.isArray(refund.transactions) ? refund.transactions : [],
    refundLineItems: Array.isArray(refund.refundLineItems) ? refund.refundLineItems : [],
  };
}

type MockCanonicalRefundCollection = {
  displayFinancialStatus: string | null;
  orderTotalReceivedAmount: string | null;
  orderTotalReceivedCurrencyCode: string | null;
  orderTotalRefundedAmount: string | null;
  orderTotalRefundedCurrencyCode: string | null;
  orderNetPaymentAmount: string | null;
  orderNetPaymentCurrencyCode: string | null;
  orderTotalOutstandingAmount: string | null;
  orderTotalOutstandingCurrencyCode: string | null;
  orderTotalRefundedShippingAmount: string | null;
  orderTotalRefundedShippingCurrencyCode: string | null;
  refundsListComplete: boolean;
  refunds: CanonicalShopifyRefundSnapshot[];
};

function parseMockCanonicalRefundsByOrderId(rawValue: string | undefined): Record<string, MockCanonicalRefundCollection> {
  if (!rawValue) {
    return {};
  }

  const parsed = JSON.parse(rawValue) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SHOPIFY_MOCK_CANONICAL_REFUNDS must be a JSON object keyed by Shopify order id.');
  }

  return Object.entries(parsed).reduce<Record<string, MockCanonicalRefundCollection>>((acc, [orderId, value]) => {
    const collection = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Partial<MockCanonicalRefundCollection>
      : null;
    const values = Array.isArray(value) ? value : Array.isArray(collection?.refunds) ? collection.refunds : [];
    acc[orderId] = {
      displayFinancialStatus: collection?.displayFinancialStatus ?? null,
      orderTotalReceivedAmount: collection?.orderTotalReceivedAmount ?? null,
      orderTotalReceivedCurrencyCode: collection?.orderTotalReceivedCurrencyCode ?? null,
      orderTotalRefundedAmount: collection?.orderTotalRefundedAmount ?? null,
      orderTotalRefundedCurrencyCode: collection?.orderTotalRefundedCurrencyCode ?? null,
      orderNetPaymentAmount: collection?.orderNetPaymentAmount ?? null,
      orderNetPaymentCurrencyCode: collection?.orderNetPaymentCurrencyCode ?? null,
      orderTotalOutstandingAmount: collection?.orderTotalOutstandingAmount ?? null,
      orderTotalOutstandingCurrencyCode: collection?.orderTotalOutstandingCurrencyCode ?? null,
      orderTotalRefundedShippingAmount: collection?.orderTotalRefundedShippingAmount ?? null,
      orderTotalRefundedShippingCurrencyCode: collection?.orderTotalRefundedShippingCurrencyCode ?? null,
      refundsListComplete: collection?.refundsListComplete === true,
      refunds: values
      .map(normalizeCanonicalRefundSnapshot)
      .filter((refund): refund is CanonicalShopifyRefundSnapshot => Boolean(refund)),
    };
    return acc;
  }, {});
}

function normalizeCanonicalReturnSnapshot(value: unknown): CanonicalShopifyReturnSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const returnSnapshot = value as CanonicalShopifyReturnSnapshot;
  if ((!returnSnapshot.sourceShopifyReturnId && !returnSnapshot.returnGid) || !returnSnapshot.status) {
    return null;
  }

  return {
    ...returnSnapshot,
    sourceShopifyReturnId:
      returnSnapshot.sourceShopifyReturnId ??
      extractShopifyGidTail(returnSnapshot.returnGid) ??
      returnSnapshot.returnGid,
    returnLineItems: Array.isArray(returnSnapshot.returnLineItems) ? returnSnapshot.returnLineItems : [],
  };
}

function parseMockCanonicalReturnsByOrderId(rawValue: string | undefined): Record<string, CanonicalShopifyReturnSnapshot[]> {
  if (!rawValue) {
    return {};
  }

  const parsed = JSON.parse(rawValue) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SHOPIFY_MOCK_CANONICAL_RETURNS must be a JSON object keyed by Shopify order id.');
  }

  return Object.entries(parsed).reduce<Record<string, CanonicalShopifyReturnSnapshot[]>>((acc, [orderId, value]) => {
    const values = Array.isArray(value) ? value : [];
    acc[orderId] = values
      .map(normalizeCanonicalReturnSnapshot)
      .filter((returnSnapshot): returnSnapshot is CanonicalShopifyReturnSnapshot => Boolean(returnSnapshot));
    return acc;
  }, {});
}

export function resolveShopifyLineItemImageUrl(lineItem: OrderLineItemImageNode) {
  const lineItemImageUrl = lineItem.image?.url?.trim() || null;
  if (lineItemImageUrl) {
    return {
      imageUrl: lineItemImageUrl,
      imageSource: 'line_item' as const,
      altText: lineItem.image?.altText?.trim() || null,
    };
  }

  const variantImageUrl = lineItem.variant?.image?.url?.trim() || null;
  if (variantImageUrl) {
    return {
      imageUrl: variantImageUrl,
      imageSource: 'variant' as const,
      altText: lineItem.variant?.image?.altText?.trim() || null,
    };
  }

  const productFeaturedImageUrl = lineItem.product?.featuredMedia?.image?.url?.trim() || null;
  if (productFeaturedImageUrl) {
    return {
      imageUrl: productFeaturedImageUrl,
      imageSource: 'product_featured_media' as const,
      altText: lineItem.product?.featuredMedia?.image?.altText?.trim() || null,
    };
  }

  return {
    imageUrl: null,
    imageSource: null,
    altText: null,
  };
}

function parseSellerInfoValue(value: string | null): SellerInfoMap | null {
  if (!value) {
    return null;
  }

  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Shopify seller_info metafield must be a JSON object.');
  }

  const sellerInfo = Object.entries(parsed).reduce<SellerInfoMap>((acc, [sku, vendorSlug]) => {
    if (typeof vendorSlug === 'string' && sku) {
      acc[sku] = vendorSlug;
    }

    return acc;
  }, {});

  return Object.keys(sellerInfo).length > 0 ? sellerInfo : null;
}

function parseMockSellerInfoByOrderId(rawValue: string | undefined): Record<string, SellerInfoMap> {
  if (!rawValue) {
    return {};
  }

  const parsed = JSON.parse(rawValue) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SHOPIFY_MOCK_SELLER_INFO must be a JSON object keyed by Shopify order id.');
  }

  return Object.entries(parsed).reduce<Record<string, SellerInfoMap>>((acc, [orderId, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return acc;
    }

    const sellerInfo = Object.entries(value).reduce<SellerInfoMap>((map, [sku, vendorSlug]) => {
      if (typeof vendorSlug === 'string' && sku) {
        map[sku] = vendorSlug;
      }

      return map;
    }, {});

    acc[orderId] = sellerInfo;
    return acc;
  }, {});
}

function parseMockOrderLineItemImagesByOrderId(rawValue: string | undefined): Record<string, FetchOrderLineItemImagesResult> {
  if (!rawValue) {
    return {};
  }

  const parsed = JSON.parse(rawValue) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SHOPIFY_MOCK_LINE_ITEM_IMAGES must be a JSON object keyed by Shopify order id.');
  }

  return Object.entries(parsed).reduce<Record<string, FetchOrderLineItemImagesResult>>((acc, [orderId, value]) => {
    const lineItems = Array.isArray(value) ? value : [];
    acc[orderId] = {
      orderGid: toShopifyOrderGid(orderId),
      sourceShopifyOrderId: orderId,
      source: 'mock',
      lineItems: lineItems
        .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
        .map((entry) => {
          const item = entry as Record<string, unknown>;
          const lineItemGid = String(item.lineItemGid ?? item.id ?? '');
          const imageUrl = typeof item.imageUrl === 'string' && item.imageUrl.trim() ? item.imageUrl.trim() : null;
          return {
            lineItemGid,
            sourceLineItemId: String(item.sourceLineItemId ?? extractShopifyGidTail(lineItemGid) ?? lineItemGid),
            sku: item.sku === null || item.sku === undefined ? null : String(item.sku),
            imageUrl,
            imageSource: imageUrl ? ('line_item' as const) : null,
            altText: item.altText === null || item.altText === undefined ? null : String(item.altText),
          };
        })
        .filter((item) => item.sourceLineItemId || item.lineItemGid || item.sku),
    };
    return acc;
  }, {});
}

function parseMockFulfillmentOrdersByOrderId(rawValue: string | undefined): Record<string, ShopifyFulfillmentOrder[]> {
  if (!rawValue) {
    return {};
  }

  const parsed = JSON.parse(rawValue) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SHOPIFY_MOCK_FULFILLMENT_ORDERS must be a JSON object keyed by Shopify order id.');
  }

  return Object.entries(parsed).reduce<Record<string, ShopifyFulfillmentOrder[]>>((acc, [orderId, value]) => {
    if (!Array.isArray(value)) {
      return acc;
    }

    acc[orderId] = value
      .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      .map((entry) => {
        const lineItems = Array.isArray((entry as { lineItems?: unknown }).lineItems)
          ? (entry as { lineItems: Array<Record<string, unknown>> }).lineItems
          : [];

        return {
          id: String((entry as { id?: unknown }).id ?? ''),
          status: typeof (entry as { status?: unknown }).status === 'string'
            ? String((entry as { status?: unknown }).status)
            : 'open',
          lineItems: lineItems.map((lineItem) => ({
            id: String(lineItem.id ?? ''),
            lineItemId: String(lineItem.lineItemId ?? ''),
            quantity: typeof lineItem.quantity === 'number' && lineItem.quantity > 0 ? lineItem.quantity : 1,
          })),
        };
      })
      .filter((entry) => entry.id);

    return acc;
  }, {});
}

function parseMockReturnDetailsByReturnGid(
  rawValue: string | undefined,
): Record<string, FetchShopifyReturnDetailsResult> {
  if (!rawValue) {
    return {};
  }

  const parsed = JSON.parse(rawValue) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SHOPIFY_MOCK_RETURN_DETAILS must be a JSON object keyed by Shopify return gid.');
  }

  return Object.entries(parsed).reduce<Record<string, FetchShopifyReturnDetailsResult>>((acc, [returnGid, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return acc;
    }

    const objectValue = value as Record<string, unknown>;
    const orderGid = typeof objectValue.orderGid === 'string' ? objectValue.orderGid : '';
    const lineItems = Array.isArray(objectValue.lineItems) ? objectValue.lineItems : [];

    if (!returnGid || !orderGid) {
      return acc;
    }

    acc[returnGid] = {
      returnGid,
      orderGid,
      source: 'mock',
      returnTracking: parseReturnTracking(objectValue.returnTracking ?? objectValue),
      lineItems: lineItems
        .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
        .map((entry) => {
          const item = entry as Record<string, unknown>;
          return {
            returnLineItemGid: String(item.returnLineItemGid ?? ''),
            fulfillmentLineItemGid:
              item.fulfillmentLineItemGid === null || item.fulfillmentLineItemGid === undefined
                ? null
                : String(item.fulfillmentLineItemGid),
            lineItemGid:
              item.lineItemGid === null || item.lineItemGid === undefined ? null : String(item.lineItemGid),
            sku: item.sku === null || item.sku === undefined ? null : String(item.sku),
            returnReason: item.returnReason === null || item.returnReason === undefined ? null : String(item.returnReason),
            returnReasonNote:
              item.returnReasonNote === null || item.returnReasonNote === undefined ? null : String(item.returnReasonNote),
            customerNote: item.customerNote === null || item.customerNote === undefined ? null : String(item.customerNote),
          };
        })
        .filter((item) => item.returnLineItemGid),
    };

    return acc;
  }, {});
}

function readOptionalString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function parseReturnTracking(value: unknown): ShopifyReturnTrackingInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const carrierName = readOptionalString(record.carrierName ?? record.carrier ?? record.company);
  const trackingNumber = readOptionalString(record.trackingNumber ?? record.number);
  const trackingUrl = readOptionalString(record.trackingUrl ?? record.url);

  if (!carrierName && !trackingNumber && !trackingUrl) {
    return null;
  }

  return {
    carrierName,
    trackingNumber,
    trackingUrl,
  };
}

function getReturnTrackingFromReverseFulfillmentOrders(
  reverseFulfillmentOrders: ShopifyReturnNode['reverseFulfillmentOrders'],
): ShopifyReturnTrackingInfo | null {
  for (const edge of reverseFulfillmentOrders.edges || []) {
    for (const deliveryEdge of edge.node.reverseDeliveries?.edges || []) {
      const tracking = deliveryEdge.node.deliverable?.tracking;
      const parsed = parseReturnTracking({
        carrierName: tracking?.carrierName,
        number: tracking?.number,
        url: tracking?.url,
      });
      if (parsed) {
        return parsed;
      }
    }
  }

  return null;
}

function parseMockOrderFulfillmentStateByOrderId(
  rawValue: string | undefined,
): Record<string, ShopifyOrderFulfillmentState> {
  if (!rawValue) {
    return {};
  }

  const parsed = JSON.parse(rawValue) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SHOPIFY_MOCK_ORDER_FULFILLMENT_STATE must be a JSON object keyed by Shopify order id.');
  }

  return Object.entries(parsed).reduce<Record<string, ShopifyOrderFulfillmentState>>((acc, [orderId, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return acc;
    }

    const objectValue = value as Record<string, unknown>;
    const fulfillments = Array.isArray(objectValue.fulfillments) ? objectValue.fulfillments : [];

    acc[orderId] = {
      orderGid: typeof objectValue.orderGid === 'string' ? objectValue.orderGid : toShopifyOrderGid(orderId),
      sourceShopifyOrderId: orderId,
      orderName: typeof objectValue.orderName === 'string' ? objectValue.orderName : null,
      displayFulfillmentStatus:
        typeof objectValue.displayFulfillmentStatus === 'string' ? objectValue.displayFulfillmentStatus : null,
      fulfillments: fulfillments
        .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
        .map((entry) => {
          const fulfillment = entry as Record<string, unknown>;
          const lineItems = Array.isArray(fulfillment.lineItems) ? fulfillment.lineItems : [];
          const trackingInfo = Array.isArray(fulfillment.trackingInfo) ? fulfillment.trackingInfo : [];
          const events = Array.isArray(fulfillment.events) ? fulfillment.events : [];

          return {
            id: String(fulfillment.id ?? ''),
            sourceFulfillmentId: String(fulfillment.sourceFulfillmentId ?? fulfillment.id ?? ''),
            status: typeof fulfillment.status === 'string' ? fulfillment.status : 'SUCCESS',
            createdAt: typeof fulfillment.createdAt === 'string' ? fulfillment.createdAt : null,
            updatedAt: typeof fulfillment.updatedAt === 'string' ? fulfillment.updatedAt : null,
            events: events
              .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
              .map((item) => {
                const event = item as Record<string, unknown>;
                return {
                  status: event.status === null || event.status === undefined ? null : String(event.status),
                  happenedAt: event.happenedAt === null || event.happenedAt === undefined ? null : String(event.happenedAt),
                };
              }),
            trackingInfo: trackingInfo
              .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
              .map((item) => {
                const tracking = item as Record<string, unknown>;
                return {
                  company: tracking.company === null || tracking.company === undefined ? null : String(tracking.company),
                  number: tracking.number === null || tracking.number === undefined ? null : String(tracking.number),
                  url: tracking.url === null || tracking.url === undefined ? null : String(tracking.url),
                };
              }),
            lineItems: lineItems
              .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
              .map((item) => {
                const lineItem = item as Record<string, unknown>;
                const lineItemGid = String(lineItem.lineItemGid ?? '');
                return {
                  lineItemGid,
                  sourceLineItemId: String(lineItem.sourceLineItemId ?? extractShopifyGidTail(lineItemGid) ?? lineItemGid),
                  sku: lineItem.sku === null || lineItem.sku === undefined ? null : String(lineItem.sku),
                  quantity:
                    typeof lineItem.quantity === 'number' && Number.isFinite(lineItem.quantity)
                      ? lineItem.quantity
                      : 1,
                };
              })
              .filter((item) => item.sourceLineItemId || item.lineItemGid),
          };
        })
        .filter((entry) => entry.id),
      fulfillmentOrders: [],
      source: 'mock',
    };

    return acc;
  }, {});
}

export function createShopifyAdminService(env: AppEnv) {
  const mockSellerInfoByOrderId = parseMockSellerInfoByOrderId(env.SHOPIFY_MOCK_SELLER_INFO);

  async function fetchRecentOrdersPage(input: {
    createdAtFrom: Date;
    createdAtTo: Date;
    first: number;
    after?: string | null;
  }): Promise<FetchRecentShopifyOrdersPageResult> {
    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error('Shopify Admin credentials are required for missed-order discovery.');
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query RecentOrdersForMissingLocalDiscovery($first: Int!, $after: String, $query: String!) {
              orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
                nodes {
                  id
                  legacyResourceId
                  name
                  createdAt
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          `,
          variables: {
            first: input.first,
            after: input.after ?? null,
            query: `created_at:>='${input.createdAtFrom.toISOString()}' created_at:<='${input.createdAtTo.toISOString()}'`,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify recent-order discovery failed with status ${response.status}.`);
    }

    const json = await parseCanonicalShopifyResponse<RecentOrdersQueryResponse>(response);
    if (json.errors?.length) {
      throw new Error(`Shopify recent-order discovery returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`);
    }
    if (!json.data?.orders || !Array.isArray(json.data.orders.nodes)) {
      throw new CanonicalShopifySnapshotParseError('Shopify recent-order discovery response was incomplete.');
    }

    const orders = json.data.orders.nodes.flatMap((node) => {
      if (!node.id || !node.legacyResourceId || !node.name || !node.createdAt) {
        return [];
      }
      return [{
        orderGid: node.id,
        sourceShopifyOrderId: String(node.legacyResourceId),
        sourceShopifyOrderNumber: node.name,
        shopifyCreatedAt: node.createdAt,
      }];
    });
    return {
      orders,
      nodesCount: json.data.orders.nodes.length,
      malformedNodes: json.data.orders.nodes.length - orders.length,
      hasNextPage: json.data.orders.pageInfo.hasNextPage,
      endCursor: json.data.orders.pageInfo.endCursor ?? null,
    };
  }
  const mockOrderLineItemImagesByOrderId = parseMockOrderLineItemImagesByOrderId(
    (env as { SHOPIFY_MOCK_LINE_ITEM_IMAGES?: string }).SHOPIFY_MOCK_LINE_ITEM_IMAGES,
  );
  const mockCanonicalOrderSnapshotsByOrderId = parseMockCanonicalOrderSnapshots(
    (env as { SHOPIFY_MOCK_CANONICAL_ORDER_SNAPSHOT?: string }).SHOPIFY_MOCK_CANONICAL_ORDER_SNAPSHOT,
  );
  const mockCanonicalRefundsByOrderId = parseMockCanonicalRefundsByOrderId(env.SHOPIFY_MOCK_CANONICAL_REFUNDS);
  const mockCanonicalReturnsByOrderId = parseMockCanonicalReturnsByOrderId(env.SHOPIFY_MOCK_CANONICAL_RETURNS);
  const mockReturnDetailsByReturnGid = parseMockReturnDetailsByReturnGid(env.SHOPIFY_MOCK_RETURN_DETAILS);
  const mockOrderFulfillmentStateByOrderId = parseMockOrderFulfillmentStateByOrderId(
    env.SHOPIFY_MOCK_ORDER_FULFILLMENT_STATE,
  );
  const mockFulfillmentOrdersByOrderId = parseMockFulfillmentOrdersByOrderId(env.SHOPIFY_MOCK_FULFILLMENT_ORDERS);
  const mockFailAllocationIds = new Set(
    (env.SHOPIFY_MOCK_FULFILLMENT_FAIL_ALLOCATION_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

  async function fetchOrderSellerInfo(orderId: string): Promise<FetchOrderSellerInfoResult> {
    if (mockSellerInfoByOrderId[orderId]) {
      return {
        sellerInfo: mockSellerInfoByOrderId[orderId],
        source: 'mock',
      };
    }

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return {
        sellerInfo: null,
        source: 'mock',
      };
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query GetOrderSellerInfo($id: ID!) {
              order(id: $id) {
                metafield(namespace: "custom", key: "seller_info") {
                  value
                }
              }
            }
          `,
          variables: {
            id: toShopifyOrderGid(orderId),
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify Admin seller_info fetch failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<OrderSellerInfoQueryResponse>;
    if (json.errors?.length) {
      throw new Error(`Shopify Admin seller_info fetch returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`);
    }

    return {
      sellerInfo: parseSellerInfoValue(json.data?.order?.metafield?.value ?? null),
      source: 'shopify_admin',
    };
  }

  async function fetchOrderLineItemImages(orderId: string): Promise<FetchOrderLineItemImagesResult> {
    if (mockOrderLineItemImagesByOrderId[orderId]) {
      return mockOrderLineItemImagesByOrderId[orderId];
    }

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return {
        orderGid: toShopifyOrderGid(orderId),
        sourceShopifyOrderId: orderId,
        lineItems: [],
        source: 'mock',
      };
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query OrderLineItemImages($orderId: ID!) {
              order(id: $orderId) {
                id
                lineItems(first: 50) {
                  edges {
                    node {
                      id
                      sku
                      image {
                        url
                        altText
                      }
                      variant {
                        id
                        image {
                          url
                          altText
                        }
                      }
                      product {
                        id
                        featuredMedia {
                          ... on MediaImage {
                            image {
                              url
                              altText
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: {
            orderId: toShopifyOrderGid(orderId),
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify line item image fetch failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<OrderLineItemImagesQueryResponse>;
    if (json.errors?.length) {
      throw new Error(`Shopify line item image fetch returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`);
    }

    const order = json.data?.order;
    if (!order?.id) {
      throw new Error(`Shopify line item image fetch did not return order ${orderId}.`);
    }

    return {
      orderGid: order.id,
      sourceShopifyOrderId: extractShopifyGidTail(order.id) ?? orderId,
      source: 'shopify_admin',
      lineItems: (order.lineItems.edges || [])
        .map((edge) => {
          const resolved = resolveShopifyLineItemImageUrl(edge.node);
          const sourceLineItemId = extractShopifyGidTail(edge.node.id) ?? edge.node.id;
          return {
            lineItemGid: edge.node.id,
            sourceLineItemId,
            sku: edge.node.sku ?? null,
            ...resolved,
          };
        })
        .filter((item) => item.sourceLineItemId || item.lineItemGid || item.sku),
    };
  }

  async function fetchOrderTaxSnapshot(orderId: string): Promise<FetchOrderTaxSnapshotResult> {
    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return {
        orderGid: toShopifyOrderGid(orderId),
        sourceShopifyOrderId: orderId,
        taxesIncluded: null,
        orderTaxAmount: {
          amount: null,
          currencyCode: null,
        },
        currentTaxLines: [],
        lineItems: [],
        source: 'mock',
      };
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query OrderTaxSnapshot($orderId: ID!) {
              order(id: $orderId) {
                id
                taxesIncluded
                currentTotalTaxSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                currentTaxLines {
                  title
                  rate
                  ratePercentage
                  priceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                }
                lineItems(first: 50) {
                  edges {
                    node {
                      id
                      sku
                      quantity
                      originalUnitPriceSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
                      }
                      discountedTotalSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
                      }
                      taxLines {
                        title
                        rate
                        ratePercentage
                        priceSet {
                          shopMoney {
                            amount
                            currencyCode
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: {
            orderId: toShopifyOrderGid(orderId),
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify tax snapshot fetch failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<OrderTaxSnapshotQueryResponse>;
    if (json.errors?.length) {
      throw new Error(`Shopify tax snapshot fetch returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`);
    }

    const order = json.data?.order;
    if (!order?.id) {
      throw new Error(`Shopify tax snapshot fetch did not return order ${orderId}.`);
    }

    return {
      orderGid: order.id,
      sourceShopifyOrderId: extractShopifyGidTail(order.id) ?? orderId,
      taxesIncluded: typeof order.taxesIncluded === 'boolean' ? order.taxesIncluded : null,
      orderTaxAmount: mapShopifyMoney(order.currentTotalTaxSet ?? null),
      currentTaxLines: (order.currentTaxLines ?? []).map(mapShopifyTaxLine),
      lineItems: (order.lineItems.edges ?? []).map((edge) => ({
        lineItemGid: edge.node.id,
        sourceLineItemId: extractShopifyGidTail(edge.node.id) ?? edge.node.id,
        sku: edge.node.sku ?? null,
        quantity: edge.node.quantity,
        originalUnitPrice: mapShopifyMoney(edge.node.originalUnitPriceSet ?? null),
        discountedTotal: mapShopifyMoney(edge.node.discountedTotalSet ?? null),
        taxLines: (edge.node.taxLines ?? []).map(mapShopifyTaxLine),
      })),
      source: 'shopify_admin',
    };
  }

  async function fetchCanonicalOrderSnapshot(orderId: string): Promise<FetchCanonicalShopifyOrderSnapshotResult> {
    const mockSnapshot = mockCanonicalOrderSnapshotsByOrderId[orderId];
    if (mockSnapshot) {
      return {
        ...mockSnapshot,
        source: 'mock',
      };
    }

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return null;
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query CanonicalOrderSnapshot($orderId: ID!) {
              order(id: $orderId) {
                id
                legacyResourceId
                name
                createdAt
                currencyCode
                displayFinancialStatus
                cancelledAt
                cancelReason
                paymentGatewayNames
                taxesIncluded
                note
                tags
                email
                phone
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                currentTotalTaxSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                totalShippingPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                currentTotalDiscountsSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                customer {
                  email
                  firstName
                  lastName
                  phone
                }
                shippingAddress {
                  name
                  firstName
                  lastName
                  company
                  phone
                  country
                  countryCodeV2
                  zip
                  city
                  province
                  address1
                  address2
                }
                billingAddress {
                  name
                  firstName
                  lastName
                  company
                  phone
                  country
                  countryCodeV2
                  zip
                  city
                  province
                  address1
                  address2
                }
                metafield(namespace: "custom", key: "seller_info") {
                  value
                }
                lineItems(first: 100) {
                  pageInfo {
                    hasNextPage
                  }
                  edges {
                    node {
                      id
                      sku
                      title
                      name
                      quantity
                      currentQuantity
                      refundableQuantity
                      image {
                        url
                        altText
                      }
                      originalUnitPriceSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
                      }
                      discountedTotalSet {
                        shopMoney {
                          amount
                          currencyCode
                        }
                      }
                      taxLines {
                        title
                        rate
                        ratePercentage
                        priceSet {
                          shopMoney {
                            amount
                            currencyCode
                          }
                        }
                      }
                      variant {
                        id
                        legacyResourceId
                        image {
                          url
                          altText
                        }
                      }
                      product {
                        id
                        legacyResourceId
                        featuredMedia {
                          ... on MediaImage {
                            image {
                              url
                              altText
                            }
                          }
                        }
                      }
                    }
                  }
                }
                fulfillmentOrders(first: 50) {
                  pageInfo {
                    hasNextPage
                  }
                  edges {
                    node {
                      id
                      status
                      requestStatus
                      lineItems(first: 50) {
                        pageInfo {
                          hasNextPage
                        }
                        edges {
                          node {
                            id
                            remainingQuantity
                            totalQuantity
                            lineItem {
                              id
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: {
            orderId: toShopifyOrderGid(orderId),
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify canonical order snapshot fetch failed with status ${response.status}.`);
    }

    const json = await parseCanonicalShopifyResponse<CanonicalOrderSnapshotQueryResponse>(response);
    if (json.errors?.length) {
      throw new Error(
        `Shopify canonical order snapshot fetch returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`,
      );
    }

    if (!json.data || !Object.prototype.hasOwnProperty.call(json.data, 'order')) {
      throw new CanonicalShopifySnapshotParseError('Shopify canonical order response omitted order data.');
    }
    const order = json.data.order;
    if (order === null) {
      return null;
    }
    if (!order.id) {
      throw new CanonicalShopifySnapshotParseError('Shopify canonical order response had invalid order identity.');
    }

    const shippingAddress = order.shippingAddress ?? null;
    const billingAddress = order.billingAddress ?? null;
    const taxesIncluded = typeof order.taxesIncluded === 'boolean' ? order.taxesIncluded : null;
    if (order.lineItems.pageInfo?.hasNextPage) {
      throw new Error('Shopify canonical order snapshot line item pagination incomplete.');
    }
    if (order.fulfillmentOrders?.pageInfo?.hasNextPage) {
      throw new Error('Shopify canonical order snapshot fulfillment order pagination incomplete.');
    }
    const paginatedFulfillmentOrder = (order.fulfillmentOrders?.edges ?? []).find((edge) =>
      edge.node.lineItems?.pageInfo?.hasNextPage
    );
    if (paginatedFulfillmentOrder) {
      throw new Error(
        `Shopify canonical order snapshot fulfillment order ${paginatedFulfillmentOrder.node.id} line item pagination incomplete.`,
      );
    }

    return {
      orderGid: order.id,
      sourceShopifyOrderId: order.legacyResourceId ?? extractShopifyGidTail(order.id) ?? orderId,
      sourceShopifyOrderNumber: normalizeShopifyString(order.name) ?? `#${extractShopifyGidTail(order.id) ?? orderId}`,
      shopifyCreatedAt: order.createdAt ?? null,
      currency: normalizeShopifyString(order.currencyCode),
      financialStatus: normalizeShopifyString(order.displayFinancialStatus)?.toLowerCase() ?? null,
      cancelledAt: order.cancelledAt ?? null,
      cancelReason: normalizeShopifyString(order.cancelReason)?.toLowerCase() ?? null,
      paymentGatewayName:
        normalizeShopifyString(order.paymentGatewayNames?.find((gateway) => Boolean(normalizeShopifyString(gateway)))) ??
        null,
      taxesIncluded,
      orderTaxAmount: readMoneyAmount(order.currentTotalTaxSet ?? null),
      shippingAmount: readMoneyAmount(order.totalShippingPriceSet ?? null),
      discountAmount: readMoneyAmount(order.currentTotalDiscountsSet ?? null),
      totalPrice: readMoneyAmount(order.totalPriceSet ?? null),
      orderNote: normalizeShopifyString(order.note),
      orderTags: order.tags ?? [],
      customerName: buildCanonicalCustomerName(order),
      customerEmail: normalizeShopifyString(order.customer?.email) ?? normalizeShopifyString(order.email),
      customerPhone:
        normalizeShopifyString(shippingAddress?.phone) ??
        normalizeShopifyString(order.phone) ??
        normalizeShopifyString(order.customer?.phone),
      billingFullName: buildCanonicalBillingFullName(billingAddress),
      billingCompany: normalizeShopifyString(billingAddress?.company),
      billingPhone: normalizeShopifyString(billingAddress?.phone),
      billingCity: normalizeShopifyString(billingAddress?.city),
      billingDistrict: readCanonicalAddressDistrict(billingAddress),
      billingAddress1: normalizeShopifyString(billingAddress?.address1),
      billingAddress2: normalizeShopifyString(billingAddress?.address2),
      billingPostcode: normalizeShopifyString(billingAddress?.zip),
      shippingCountry: normalizeShopifyString(shippingAddress?.countryCodeV2) ?? normalizeShopifyString(shippingAddress?.country),
      shippingPostcode: normalizeShopifyString(shippingAddress?.zip),
      shippingCity: normalizeShopifyString(shippingAddress?.city),
      shippingDistrict: readCanonicalAddressDistrict(shippingAddress),
      shippingAddress: buildCanonicalAddressLine(shippingAddress),
      sellerInfo: parseSellerInfoValue(order.metafield?.value ?? null),
      lineItems: (order.lineItems.edges ?? []).map((edge) => {
        const node = edge.node;
        const resolvedImage = resolveShopifyLineItemImageUrl(node);
        const taxLine = node.taxLines?.[0];
        const discountedTotal = readMoneyAmount(node.discountedTotalSet ?? null);
        const unitPrice = readMoneyAmount(node.originalUnitPriceSet ?? null);
        const quantity = typeof node.quantity === 'number' && Number.isFinite(node.quantity) ? node.quantity : 1;
        return {
          lineItemGid: node.id,
          sourceLineItemId: extractShopifyGidTail(node.id) ?? node.id,
          shopifyProductId: node.product?.legacyResourceId ?? (node.product?.id ? extractShopifyGidTail(node.product.id) : null),
          sourceVariantId: node.variant?.legacyResourceId ?? (node.variant?.id ? extractShopifyGidTail(node.variant.id) : null),
          sku: normalizeShopifyString(node.sku),
          title: normalizeShopifyString(node.title) ?? normalizeShopifyString(node.name),
          imageUrl: resolvedImage.imageUrl,
          quantity,
          currentQuantity:
            typeof node.currentQuantity === 'number' && Number.isFinite(node.currentQuantity)
              ? node.currentQuantity
              : null,
          refundableQuantity:
            typeof node.refundableQuantity === 'number' && Number.isFinite(node.refundableQuantity)
              ? node.refundableQuantity
              : null,
          unitPrice,
          unitPriceVatIncluded: taxesIncluded === true
            ? toMoneyAmountString(discountedTotal ? Number(discountedTotal) / Math.max(quantity, 1) : unitPrice)
            : unitPrice,
          lineTotalVatIncluded: taxesIncluded === true ? discountedTotal : unitPrice && (Number(unitPrice) * quantity).toFixed(2),
          lineTaxAmount: readMoneyAmount(taxLine?.priceSet ?? null),
          vatRate:
            typeof taxLine?.ratePercentage === 'number' && Number.isFinite(taxLine.ratePercentage)
              ? taxLine.ratePercentage.toFixed(2)
              : typeof taxLine?.rate === 'number' && Number.isFinite(taxLine.rate)
                ? (taxLine.rate * 100).toFixed(2)
                : null,
        };
      }),
      fulfillmentOrders: (order.fulfillmentOrders?.edges ?? []).map((edge) => ({
        id: edge.node.id,
        status: edge.node.status ?? null,
        requestStatus: edge.node.requestStatus ?? null,
        lineItems: (edge.node.lineItems?.edges ?? []).map((lineItemEdge) => ({
          id: lineItemEdge.node.id,
          lineItemId: lineItemEdge.node.lineItem?.id ?? null,
          remainingQuantity:
            typeof lineItemEdge.node.remainingQuantity === 'number' ? lineItemEdge.node.remainingQuantity : null,
          totalQuantity: typeof lineItemEdge.node.totalQuantity === 'number' ? lineItemEdge.node.totalQuantity : null,
        })),
      })),
      source: 'shopify_admin',
    };
  }

  async function fetchCanonicalRefundsForOrder(orderId: string): Promise<FetchCanonicalShopifyRefundsForOrderResult> {
    const mockRefundCollection = mockCanonicalRefundsByOrderId[orderId];
    if (mockRefundCollection) {
      return {
        orderGid: toShopifyOrderGid(orderId),
        sourceShopifyOrderId: orderId,
        ...mockRefundCollection,
        source: 'mock',
      };
    }

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return null;
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query CanonicalRefundsForOrder($orderId: ID!) {
              order(id: $orderId) {
                id
                legacyResourceId
                displayFinancialStatus
                totalReceivedSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                totalRefundedSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                  presentmentMoney {
                    amount
                    currencyCode
                  }
                }
                netPaymentSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                totalOutstandingSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                totalRefundedShippingSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                refunds(first: 250) {
                  id
                  createdAt
                  updatedAt
                  note
                  totalRefundedSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                    presentmentMoney {
                      amount
                      currencyCode
                    }
                  }
                  transactions(first: 250) {
                    pageInfo {
                      hasNextPage
                    }
                    edges {
                      node {
                        id
                        kind
                        status
                        amountSet {
                          shopMoney {
                            amount
                            currencyCode
                          }
                          presentmentMoney {
                            amount
                            currencyCode
                          }
                        }
                        parentTransaction {
                          id
                        }
                        createdAt
                        processedAt
                      }
                    }
                  }
                  refundLineItems(first: 250) {
                    pageInfo {
                      hasNextPage
                    }
                    edges {
                      node {
                        id
                        quantity
                        subtotalSet {
                          shopMoney {
                            amount
                            currencyCode
                          }
                        }
                        lineItem {
                          id
                          sku
                          title
                          name
                          variantTitle
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: {
            orderId: toShopifyOrderGid(orderId),
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify canonical refund fetch failed with status ${response.status}.`);
    }

    const json = await parseCanonicalShopifyResponse<CanonicalRefundsForOrderQueryResponse>(response);
    if (json.errors?.length) {
      throw new Error(
        `Shopify canonical refund fetch returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`,
      );
    }

    if (!json.data || !Object.prototype.hasOwnProperty.call(json.data, 'order')) {
      throw new CanonicalShopifySnapshotParseError('Shopify canonical refund response omitted order data.');
    }
    const order = json.data.order;
    if (order === null) {
      return null;
    }
    if (!order.id) {
      throw new CanonicalShopifySnapshotParseError('Shopify canonical refund response had invalid order identity.');
    }
    if (!Array.isArray(order.refunds)) {
      throw new CanonicalShopifySnapshotParseError('Shopify canonical refund collection was malformed.');
    }

    const malformedRefund = order.refunds.find((refund) =>
      !refund?.id ||
      !refund.transactions ||
      !Array.isArray(refund.transactions.edges) ||
      !refund.refundLineItems ||
      !Array.isArray(refund.refundLineItems.edges)
    );
    if (malformedRefund) {
      throw new CanonicalShopifySnapshotParseError('Shopify canonical refund record was malformed.');
    }
    return {
      orderGid: order.id,
      sourceShopifyOrderId: order.legacyResourceId ?? extractShopifyGidTail(order.id) ?? orderId,
      displayFinancialStatus: normalizeShopifyString(order.displayFinancialStatus),
      orderTotalReceivedAmount: readMoneyAmount(order.totalReceivedSet ?? null),
      orderTotalReceivedCurrencyCode: order.totalReceivedSet?.shopMoney?.currencyCode ?? null,
      orderTotalRefundedAmount: readMoneyAmount(order.totalRefundedSet ?? null),
      orderTotalRefundedCurrencyCode: order.totalRefundedSet?.shopMoney?.currencyCode ?? null,
      orderNetPaymentAmount: readMoneyAmount(order.netPaymentSet ?? null),
      orderNetPaymentCurrencyCode: order.netPaymentSet?.shopMoney?.currencyCode ?? null,
      orderTotalOutstandingAmount: readMoneyAmount(order.totalOutstandingSet ?? null),
      orderTotalOutstandingCurrencyCode: order.totalOutstandingSet?.shopMoney?.currencyCode ?? null,
      orderTotalRefundedShippingAmount: readMoneyAmount(order.totalRefundedShippingSet ?? null),
      orderTotalRefundedShippingCurrencyCode: order.totalRefundedShippingSet?.shopMoney?.currencyCode ?? null,
      refundsListComplete: order.refunds.length < 250,
      source: 'shopify_admin',
      refunds: order.refunds.map((refund) => {
        return {
          refundGid: refund.id,
          sourceShopifyRefundId: extractShopifyGidTail(refund.id) ?? refund.id,
          createdAt: refund.createdAt ?? null,
          updatedAt: refund.updatedAt ?? null,
          note: normalizeShopifyString(refund.note),
          totalRefundedAmount: readMoneyAmount(refund.totalRefundedSet ?? null),
          totalRefundedCurrencyCode: refund.totalRefundedSet?.shopMoney?.currencyCode ?? null,
          transactionPaginationComplete: refund.transactions.pageInfo?.hasNextPage !== true,
          lineItemPaginationComplete: refund.refundLineItems.pageInfo?.hasNextPage !== true,
          transactions: (refund.transactions.edges ?? []).map((transactionEdge) => {
            const transaction = transactionEdge.node;
            return {
              transactionGid: transaction.id,
              kind: normalizeShopifyString(transaction.kind),
              status: normalizeShopifyString(transaction.status),
              amount: readMoneyAmount(transaction.amountSet ?? null),
              currencyCode: transaction.amountSet?.shopMoney?.currencyCode ?? null,
              parentTransactionGid: transaction.parentTransaction?.id ?? null,
              createdAt: transaction.createdAt ?? null,
              processedAt: transaction.processedAt ?? null,
            };
          }),
          refundLineItems: (refund.refundLineItems.edges ?? []).map((lineItemEdge) => {
            const lineItem = lineItemEdge.node;
            return {
              refundLineItemGid: lineItem.id,
              sourceRefundLineItemId: extractShopifyGidTail(lineItem.id) ?? lineItem.id,
              lineItemGid: lineItem.lineItem?.id ?? null,
              sourceLineItemId: lineItem.lineItem?.id ? extractShopifyGidTail(lineItem.lineItem.id) : null,
              sku: normalizeShopifyString(lineItem.lineItem?.sku),
              title: normalizeShopifyString(lineItem.lineItem?.title),
              name: normalizeShopifyString(lineItem.lineItem?.name),
              variantTitle: normalizeShopifyString(lineItem.lineItem?.variantTitle),
              quantity: typeof lineItem.quantity === 'number' && lineItem.quantity > 0 ? lineItem.quantity : 1,
              subtotalAmount: readMoneyAmount(lineItem.subtotalSet ?? null),
              currencyCode: lineItem.subtotalSet?.shopMoney?.currencyCode ?? null,
            };
          }),
        };
      }),
    };
  }

  async function fetchCanonicalReturnsForOrder(orderId: string): Promise<FetchCanonicalShopifyReturnsForOrderResult> {
    const mockReturns = mockCanonicalReturnsByOrderId[orderId];
    if (mockReturns) {
      return {
        orderGid: toShopifyOrderGid(orderId),
        sourceShopifyOrderId: orderId,
        returns: mockReturns,
        source: 'mock',
      };
    }

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return null;
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query CanonicalReturnsForOrder($orderId: ID!) {
              order(id: $orderId) {
                id
                legacyResourceId
                returns(first: 50) {
                  pageInfo {
                    hasNextPage
                  }
                  edges {
                    node {
                      id
                      status
                      createdAt
                      requestApprovedAt
                      closedAt
                      returnLineItems(first: 100) {
                        pageInfo {
                          hasNextPage
                        }
                        edges {
                          node {
                            id
                            ... on ReturnLineItem {
                              customerNote
                              returnReason
                              returnReasonNote
                              fulfillmentLineItem {
                                id
                                lineItem {
                                  id
                                  sku
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: {
            orderId: toShopifyOrderGid(orderId),
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify canonical return fetch failed with status ${response.status}.`);
    }

    const json = await parseCanonicalShopifyResponse<CanonicalReturnsForOrderQueryResponse>(response);
    if (json.errors?.length) {
      throw new Error(
        `Shopify canonical return fetch returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`,
      );
    }

    if (!json.data || !Object.prototype.hasOwnProperty.call(json.data, 'order')) {
      throw new CanonicalShopifySnapshotParseError('Shopify canonical return response omitted order data.');
    }
    const order = json.data.order;
    if (order === null) {
      return null;
    }
    if (!order.id) {
      throw new CanonicalShopifySnapshotParseError('Shopify canonical return response had invalid order identity.');
    }
    if (!order.returns || !Array.isArray(order.returns.edges)) {
      throw new CanonicalShopifySnapshotParseError('Shopify canonical return collection was malformed.');
    }
    const malformedReturn = order.returns.edges.find((edge) =>
      !edge?.node?.id || !edge.node.returnLineItems || !Array.isArray(edge.node.returnLineItems.edges)
    );
    if (malformedReturn) {
      throw new CanonicalShopifySnapshotParseError('Shopify canonical return record was malformed.');
    }

    if (order.returns.pageInfo?.hasNextPage) {
      throw new Error('Shopify canonical return pagination incomplete.');
    }

    const paginatedReturn = (order.returns.edges ?? []).find((edge) =>
      edge.node.returnLineItems.pageInfo?.hasNextPage
    );
    if (paginatedReturn) {
      throw new Error(`Shopify canonical return ${paginatedReturn.node.id} line item pagination incomplete.`);
    }

    return {
      orderGid: order.id,
      sourceShopifyOrderId: order.legacyResourceId ?? extractShopifyGidTail(order.id) ?? orderId,
      source: 'shopify_admin',
      returns: (order.returns.edges ?? []).map((edge) => {
        const returnNode = edge.node;
        return {
          returnGid: returnNode.id,
          sourceShopifyReturnId: extractShopifyGidTail(returnNode.id) ?? returnNode.id,
          status: normalizeShopifyString(returnNode.status)?.toLowerCase() ?? 'unknown',
          createdAt: returnNode.createdAt ?? null,
          requestApprovedAt: returnNode.requestApprovedAt ?? null,
          closedAt: returnNode.closedAt ?? null,
          returnLineItems: (returnNode.returnLineItems.edges ?? []).map((lineItemEdge) => {
            const lineItem = lineItemEdge.node;
            return {
              returnLineItemGid: lineItem.id,
              fulfillmentLineItemGid: lineItem.fulfillmentLineItem?.id ?? null,
              lineItemGid: lineItem.fulfillmentLineItem?.lineItem?.id ?? null,
              sourceLineItemId: lineItem.fulfillmentLineItem?.lineItem?.id
                ? extractShopifyGidTail(lineItem.fulfillmentLineItem.lineItem.id)
                : null,
              sku: normalizeShopifyString(lineItem.fulfillmentLineItem?.lineItem?.sku),
              returnReason: normalizeShopifyString(lineItem.returnReason),
              returnReasonNote: normalizeShopifyString(lineItem.returnReasonNote),
              customerNote: normalizeShopifyString(lineItem.customerNote),
            };
          }),
        };
      }),
    };
  }

  async function previewSuggestedRefund(input: PreviewSuggestedRefundInput): Promise<PreviewSuggestedRefundResult> {
    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error('Shopify suggested refund preview is not configured.');
    }

    const orderGid = toShopifyOrderGid(input.shopifyOrderId);
    const refundLineItemsPreview = input.refundLineItems.map((lineItem) => ({
      lineItemId: toShopifyLineItemGid(lineItem.sourceLineItemId),
      quantity: lineItem.quantity,
      restockType: lineItem.restockType,
    }));

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query SuggestedRefundPreview(
              $id: ID!
              $refundLineItems: [RefundLineItemInput!]
              $refundShipping: Boolean
              $shippingAmount: Money
            ) {
              order(id: $id) {
                id
                suggestedRefund(
                  refundLineItems: $refundLineItems
                  refundShipping: $refundShipping
                  shippingAmount: $shippingAmount
                ) {
                  amountSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  maximumRefundableSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  subtotalSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  totalTaxSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  shipping {
                    amountSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                    maximumRefundableSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                    taxSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                  }
                  refundLineItems {
                    lineItem {
                      id
                    }
                    quantity
                    restockType
                    subtotalSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                    totalTaxSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                  }
                  suggestedTransactions {
                    parentTransaction {
                      id
                    }
                    gateway
                    formattedGateway
                    amountSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: {
            id: orderGid,
            refundLineItems: refundLineItemsPreview.map((lineItem) => ({
              lineItemId: lineItem.lineItemId,
              quantity: lineItem.quantity,
              restockType: lineItem.restockType,
            })),
            refundShipping: input.refundShipping,
            shippingAmount: input.shippingAmount?.trim() || null,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify suggested refund preview failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<SuggestedRefundQueryResponse>;
    const graphqlErrors = (json.errors ?? [])
      .map((error) => error.message?.trim())
      .filter((message): message is string => Boolean(message));

    const order = json.data?.order;
    const suggestedRefund = order?.suggestedRefund ?? null;
    const totalRefund = mapShopifyMoney(suggestedRefund?.amountSet ?? null);
    const subtotal = mapShopifyMoney(suggestedRefund?.subtotalSet ?? null);
    const totalTax = mapShopifyMoney(suggestedRefund?.totalTaxSet ?? null);
    const shipping = mapShopifyMoney(suggestedRefund?.shipping?.amountSet ?? null);
    const shippingMaximumRefundable = mapShopifyMoney(suggestedRefund?.shipping?.maximumRefundableSet ?? null);
    const maximumRefundable = mapShopifyMoney(suggestedRefund?.maximumRefundableSet ?? null);

    return {
      orderGid: order?.id ?? orderGid,
      sourceShopifyOrderId: extractShopifyGidTail(order?.id ?? orderGid) ?? input.shopifyOrderId,
      refundLineItemsPreview,
      graphqlErrors,
      source: 'shopify_admin',
      suggestedRefund: suggestedRefund
        ? {
            totalRefundAmount: totalRefund.amount,
            currencyCode: totalRefund.currencyCode ?? subtotal.currencyCode ?? totalTax.currencyCode ?? shipping.currencyCode,
            subtotalAmount: subtotal.amount,
            totalTaxAmount: totalTax.amount,
            shippingAmount: shipping.amount,
            shippingMaximumRefundableAmount: shippingMaximumRefundable.amount,
            shippingCurrencyCode: shippingMaximumRefundable.currencyCode ?? shipping.currencyCode,
            maximumRefundableAmount: maximumRefundable.amount,
            suggestedTransactions: suggestedRefund.suggestedTransactions.map((transaction) => {
              const transactionAmount = mapShopifyMoney(transaction.amountSet ?? null);
              return {
                gateway: transaction.gateway ?? null,
                formattedGateway: transaction.formattedGateway ?? null,
                amount: transactionAmount.amount,
                currencyCode: transactionAmount.currencyCode,
                parentTransactionId: transaction.parentTransaction?.id ?? null,
              };
            }),
            refundLineItems: suggestedRefund.refundLineItems.map((lineItem) => {
              const subtotalAmount = mapShopifyMoney(lineItem.subtotalSet ?? null);
              const totalTaxAmount = mapShopifyMoney(lineItem.totalTaxSet ?? null);
              return {
                lineItemId: lineItem.lineItem?.id ?? '',
                quantity: lineItem.quantity,
                restockType: lineItem.restockType ?? null,
                subtotalAmount: subtotalAmount.amount,
                totalTaxAmount: totalTaxAmount.amount,
                currencyCode: subtotalAmount.currencyCode ?? totalTaxAmount.currencyCode,
              };
            }),
          }
        : null,
    };
  }

  async function fetchReturnDetails(returnGid: string): Promise<FetchShopifyReturnDetailsResult> {
    if (mockReturnDetailsByReturnGid[returnGid]) {
      return mockReturnDetailsByReturnGid[returnGid];
    }

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error('Shopify return details sync is not configured.');
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query GetReturn($id: ID!) {
              return(id: $id) {
                id
                order { id }
                returnLineItems(first: 20) {
                  edges {
                    node {
                      id
                      ... on ReturnLineItem {
                        customerNote
                        returnReason
                        returnReasonNote
                        fulfillmentLineItem {
                          id
                          lineItem {
                            id
                            sku
                          }
                        }
                      }
                    }
                  }
                }
                reverseFulfillmentOrders(first: 20) {
                  edges {
                    node {
                      reverseDeliveries(first: 20) {
                        edges {
                          node {
                            deliverable {
                              ... on ReverseDeliveryShippingDeliverable {
                                tracking {
                                  carrierName
                                  number
                                  url
                                }
                              }
                            }
                          }
                        }
                      }
                      lineItems(first: 20) {
                        edges {
                          node {
                            fulfillmentLineItem {
                              id
                              lineItem {
                                id
                                sku
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: { id: returnGid },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify return detail fetch failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<ShopifyReturnQueryResponse>;
    if (json.errors?.length) {
      throw new Error(
        `Shopify return detail fetch returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`,
      );
    }

    const returnNode = json.data?.return;
    if (!returnNode?.id || !returnNode.order?.id) {
      throw new Error('Shopify return detail response did not include return.id and order.id.');
    }

    const inlineLineItems = (returnNode.returnLineItems.edges || [])
      .map<ShopifyReturnLineItem>((edge) => ({
        returnLineItemGid: edge.node.id,
        fulfillmentLineItemGid: edge.node.fulfillmentLineItem?.id ?? null,
        lineItemGid: edge.node.fulfillmentLineItem?.lineItem?.id ?? null,
        sku: edge.node.fulfillmentLineItem?.lineItem?.sku ?? null,
        returnReason: edge.node.returnReason ?? null,
        returnReasonNote: edge.node.returnReasonNote ?? null,
        customerNote: edge.node.customerNote ?? null,
      }))
      .filter((item) => item.returnLineItemGid);

    const fallbackLineItems = (returnNode.reverseFulfillmentOrders.edges || []).flatMap((edge) =>
      (edge.node.lineItems.edges || [])
        .map<ShopifyReturnLineItem>((lineItemEdge) => ({
          returnLineItemGid: `fallback:${lineItemEdge.node.fulfillmentLineItem?.id ?? 'unknown'}`,
          fulfillmentLineItemGid: lineItemEdge.node.fulfillmentLineItem?.id ?? null,
          lineItemGid: lineItemEdge.node.fulfillmentLineItem?.lineItem?.id ?? null,
          sku: lineItemEdge.node.fulfillmentLineItem?.lineItem?.sku ?? null,
          returnReason: null,
          returnReasonNote: null,
          customerNote: null,
        }))
        .filter((item) => item.fulfillmentLineItemGid || item.lineItemGid || item.sku),
    );

    return {
      returnGid: returnNode.id,
      orderGid: returnNode.order.id,
      lineItems: inlineLineItems.length > 0 ? inlineLineItems : fallbackLineItems,
      returnTracking: getReturnTrackingFromReverseFulfillmentOrders(returnNode.reverseFulfillmentOrders),
      source: 'shopify_admin',
    };
  }

  async function fetchReturnReverseDeliveryInputs(returnGid: string): Promise<FetchShopifyReturnReverseDeliveryInputsResult> {
    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error('Shopify return reverse delivery probe is not configured.');
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query GetReturnReverseDeliveryInputs($id: ID!) {
              return(id: $id) {
                id
                reverseFulfillmentOrders(first: 20) {
                  nodes {
                    id
                    status
                    lineItems(first: 50) {
                      nodes {
                        id
                        totalQuantity
                        fulfillmentLineItem {
                          lineItem {
                            id
                            sku
                          }
                        }
                      }
                    }
                    reverseDeliveries(first: 20) {
                      nodes {
                        id
                        deliverable {
                          ... on ReverseDeliveryShippingDeliverable {
                            label {
                              publicFileUrl
                            }
                            tracking {
                              carrierName
                              number
                              url
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: { id: returnGid },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify return reverse delivery input fetch failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<ShopifyReturnReverseDeliveryInputsQueryResponse>;
    if (json.errors?.length) {
      throw new Error(
        `Shopify return reverse delivery input fetch returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`,
      );
    }

    const returnNode = json.data?.return;
    if (!returnNode?.id) {
      throw new Error('Shopify return reverse delivery input response did not include return.id.');
    }

    return {
      returnGid: returnNode.id,
      source: 'shopify_admin',
      reverseFulfillmentOrders: (returnNode.reverseFulfillmentOrders.nodes || []).map((order) => ({
        id: order.id,
        status: order.status,
        lineItems: (order.lineItems.nodes || [])
          .map((lineItem) => ({
            id: lineItem.id,
            quantity: typeof lineItem.totalQuantity === 'number' && lineItem.totalQuantity > 0 ? lineItem.totalQuantity : 1,
            lineItemGid: lineItem.fulfillmentLineItem?.lineItem?.id ?? null,
            sku: lineItem.fulfillmentLineItem?.lineItem?.sku ?? null,
          }))
          .filter((lineItem) => lineItem.id),
        reverseDeliveries: (order.reverseDeliveries.nodes || [])
          .map((delivery) => ({
            id: delivery.id,
            labelPublicFileUrl: delivery.deliverable?.label?.publicFileUrl ?? null,
            trackingNumber: delivery.deliverable?.tracking?.number ?? null,
            trackingUrl: delivery.deliverable?.tracking?.url ?? null,
            carrierName: delivery.deliverable?.tracking?.carrierName ?? null,
          }))
          .filter((delivery) => delivery.id),
      })),
    };
  }

  function mapReverseFulfillmentOrders(
    returnNode: {
      reverseFulfillmentOrders: ShopifyReturnReverseDeliveryInputNode['reverseFulfillmentOrders'];
    },
  ) {
    return (returnNode.reverseFulfillmentOrders.nodes || []).map((order) => ({
      id: order.id,
      status: order.status,
      lineItems: (order.lineItems.nodes || [])
        .map((lineItem) => ({
          id: lineItem.id,
          quantity: typeof lineItem.totalQuantity === 'number' && lineItem.totalQuantity > 0 ? lineItem.totalQuantity : 1,
          lineItemGid: lineItem.fulfillmentLineItem?.lineItem?.id ?? null,
          sku: lineItem.fulfillmentLineItem?.lineItem?.sku ?? null,
        }))
        .filter((lineItem) => lineItem.id),
      reverseDeliveries: (order.reverseDeliveries.nodes || [])
        .map((delivery) => ({
          id: delivery.id,
          labelPublicFileUrl: delivery.deliverable?.label?.publicFileUrl ?? null,
          trackingNumber: delivery.deliverable?.tracking?.number ?? null,
          trackingUrl: delivery.deliverable?.tracking?.url ?? null,
          carrierName: delivery.deliverable?.tracking?.carrierName ?? null,
        }))
        .filter((delivery) => delivery.id),
    }));
  }

  async function fetchReturnCancellationState(returnGid: string): Promise<ShopifyReturnCancellationState> {
    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error('Shopify return cancellation state fetch is not configured.');
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query GetReturnCancellationState($id: ID!) {
              return(id: $id) {
                id
                status
                requestApprovedAt
                closedAt
                refunds(first: 1) {
                  edges {
                    node {
                      id
                    }
                  }
                }
                transactions(first: 1) {
                  edges {
                    node {
                      id
                    }
                  }
                }
                reverseFulfillmentOrders(first: 20) {
                  nodes {
                    id
                    status
                    lineItems(first: 50) {
                      nodes {
                        id
                        totalQuantity
                        fulfillmentLineItem {
                          lineItem {
                            id
                            sku
                          }
                        }
                      }
                    }
                    reverseDeliveries(first: 20) {
                      nodes {
                        id
                        deliverable {
                          ... on ReverseDeliveryShippingDeliverable {
                            label {
                              publicFileUrl
                            }
                            tracking {
                              carrierName
                              number
                              url
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: { id: returnGid },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify return cancellation state fetch failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<ShopifyReturnCancellationStateQueryResponse>;
    if (json.errors?.length) {
      throw new Error(
        `Shopify return cancellation state fetch returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`,
      );
    }

    const returnNode = json.data?.return;
    if (!returnNode?.id || !returnNode.status) {
      throw new Error('Shopify return cancellation state response did not include return.id and return.status.');
    }

    return {
      returnGid: returnNode.id,
      status: returnNode.status,
      requestApprovedAt: returnNode.requestApprovedAt,
      closedAt: returnNode.closedAt,
      refundIds: (returnNode.refunds.edges || []).map((edge) => edge.node.id).filter(Boolean),
      transactionIds: (returnNode.transactions.edges || []).map((edge) => edge.node.id).filter(Boolean),
      reverseFulfillmentOrders: mapReverseFulfillmentOrders(returnNode),
      source: 'shopify_admin',
    };
  }

  function normalizeUserErrors(
    errors: Array<{ field?: string[] | null; message?: string | null }> | undefined,
  ) {
    return (errors ?? []).map((error) => ({
      field: Array.isArray(error.field) ? error.field.filter((field): field is string => typeof field === 'string') : [],
      message: error.message ?? 'Unknown Shopify user error.',
    }));
  }

  async function cancelReturn(returnGid: string): Promise<CancelShopifyReturnResult> {
    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error('Shopify return cancel is not configured.');
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            mutation CancelReturn($id: ID!) {
              returnCancel(id: $id) {
                return {
                  id
                  status
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: { id: returnGid },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify return cancel failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<ShopifyReturnCancelMutationResponse>;
    if (json.errors?.length) {
      throw new Error(`Shopify return cancel returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`);
    }

    const payload = json.data?.returnCancel;
    return {
      returnGid: payload?.return?.id ?? null,
      status: payload?.return?.status ?? null,
      userErrors: normalizeUserErrors(payload?.userErrors),
      source: 'shopify_admin',
    };
  }

  async function cancelFulfillmentOrder(input: { fulfillmentOrderId: string }): Promise<CancelFulfillmentOrderResult> {
    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error('Shopify fulfillment order cancel is not configured.');
    }

    const fulfillmentOrderGid = toShopifyGid('FulfillmentOrder', input.fulfillmentOrderId);
    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            mutation FulfillmentOrderCancel($id: ID!) {
              fulfillmentOrderCancel(id: $id) {
                fulfillmentOrder {
                  id
                  status
                }
                replacementFulfillmentOrder {
                  id
                  status
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: { id: fulfillmentOrderGid },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify fulfillment order cancel failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<FulfillmentOrderCancelMutationResponse>;
    if (json.errors?.length) {
      throw new Error(
        `Shopify fulfillment order cancel returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`,
      );
    }

    const payload = json.data?.fulfillmentOrderCancel;
    return {
      fulfillmentOrderId: payload?.fulfillmentOrder?.id ?? null,
      fulfillmentOrderStatus: payload?.fulfillmentOrder?.status ?? null,
      replacementFulfillmentOrderId: payload?.replacementFulfillmentOrder?.id ?? null,
      replacementFulfillmentOrderStatus: payload?.replacementFulfillmentOrder?.status ?? null,
      userErrors: normalizeUserErrors(payload?.userErrors),
    };
  }

  async function createShopifyRefund(input: CreateShopifyRefundInput): Promise<CreateShopifyRefundResult> {
    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error('Shopify refund create is not configured.');
    }

    const orderGid = toShopifyOrderGid(input.orderId);
    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            mutation RefundCreate($input: RefundInput!, $idempotencyKey: String!) {
              refundCreate(input: $input) @idempotent(key: $idempotencyKey) {
                refund {
                  id
                }
                order {
                  id
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: {
            idempotencyKey: input.idempotencyKey,
            input: {
              orderId: orderGid,
              refundLineItems: input.refundLineItems.map((lineItem) => ({
                lineItemId: toShopifyLineItemGid(lineItem.lineItemId),
                quantity: lineItem.quantity,
                restockType: lineItem.restockType,
                ...(lineItem.locationId ? { locationId: toShopifyGid('Location', lineItem.locationId) } : {}),
              })),
              ...(input.shipping ? { shipping: { amount: input.shipping.amount } } : {}),
              transactions: input.transactions.map((transaction) => ({
                orderId: orderGid,
                kind: 'REFUND',
                gateway: transaction.gateway,
                amount: transaction.amount,
                parentId: transaction.parentTransactionId,
              })),
              note: input.note?.trim() || undefined,
              notify: input.notify,
            },
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify refund create failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<RefundCreateMutationResponse>;
    if (json.errors?.length) {
      throw new Error(`Shopify refund create returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`);
    }

    const payload = json.data?.refundCreate;
    return {
      refundId: payload?.refund?.id ?? null,
      userErrors: normalizeUserErrors(payload?.userErrors),
      rawResponse: payload ?? null,
    };
  }

  function getShopifyIdentifierCandidates(value: string | null | undefined) {
    const text = value?.trim();
    if (!text) {
      return new Set<string>();
    }
    const tail = extractShopifyGidTail(text);
    return new Set([text, tail].filter((item): item is string => Boolean(item)));
  }

  function returnLineItemMatchesSource(lineItem: ShopifyReverseDeliveryLineItem, sourceLineItemId: string) {
    const sourceCandidates = getShopifyIdentifierCandidates(sourceLineItemId);
    const lineItemCandidates = getShopifyIdentifierCandidates(lineItem.lineItemGid);
    return Array.from(lineItemCandidates).some((candidate) => sourceCandidates.has(candidate));
  }

  function isPublicLabelUrl(value: string | null | undefined) {
    const text = value?.trim();
    return Boolean(text && /^https?:\/\//i.test(text));
  }

  function decodeReturnLabelPdfBytes(value: string | null | undefined) {
    const text = value?.trim();
    if (!text) {
      return null;
    }

    const dataUrlMatch = /^data:application\/pdf;base64,([a-z0-9+/=\s]+)$/i.exec(text);
    const base64 = dataUrlMatch?.[1] ?? (/^[a-z0-9+/=\s]+$/i.test(text) ? text : null);
    if (!base64) {
      return null;
    }

    const normalizedBase64 = base64.replace(/\s+/g, '');
    try {
      const buffer = Buffer.from(normalizedBase64, 'base64');
      const decodedPrefix = buffer.subarray(0, 4).toString('utf8');
      if (!normalizedBase64.startsWith('JVBER') && decodedPrefix !== '%PDF') {
        return null;
      }
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  async function uploadReturnLabelPdfToShopify(labelValue: string | null | undefined): Promise<{
    fileUrl: string | null;
    attempted: boolean;
    succeeded: boolean;
    skippedReason: string | null;
    source: SyncShopifyReturnShippingResult['labelUploadSource'];
    userErrors: Array<{ field?: string[] | null; message?: string | null }>;
  }> {
    if (!labelValue?.trim()) {
      return {
        fileUrl: null,
        attempted: false,
        succeeded: false,
        skippedReason: 'label_missing',
        source: 'missing',
        userErrors: [],
      };
    }

    if (isPublicLabelUrl(labelValue)) {
      return {
        fileUrl: labelValue.trim(),
        attempted: false,
        succeeded: false,
        skippedReason: null,
        source: 'public_url',
        userErrors: [],
      };
    }

    const pdfBytes = decodeReturnLabelPdfBytes(labelValue);
    if (!pdfBytes) {
      return {
        fileUrl: null,
        attempted: false,
        succeeded: false,
        skippedReason: 'unsupported_label_format',
        source: 'unsupported',
        userErrors: [],
      };
    }

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error('Shopify return label staged upload is not configured.');
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            mutation CreateReturnLabelStagedUpload($input: [StagedUploadInput!]!) {
              stagedUploadsCreate(input: $input) {
                stagedTargets {
                  url
                  resourceUrl
                  parameters {
                    name
                    value
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: {
            input: [
              {
                filename: 'sporgym-return-label.pdf',
                mimeType: 'application/pdf',
                httpMethod: 'POST',
                resource: 'RETURN_LABEL',
              },
            ],
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify return label staged upload creation failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<ShopifyStagedUploadsCreateResponse>;
    if (json.errors?.length) {
      throw new Error(
        `Shopify return label staged upload returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`,
      );
    }

    const stagedUpload = json.data?.stagedUploadsCreate;
    const userErrors = normalizeUserErrors(stagedUpload?.userErrors ?? undefined);
    if (userErrors.length > 0) {
      return {
        fileUrl: null,
        attempted: true,
        succeeded: false,
        skippedReason: 'staged_upload_user_error',
        source: 'staged_upload',
        userErrors,
      };
    }

    const target = stagedUpload?.stagedTargets?.[0] ?? null;
    const uploadUrl = target?.url?.trim();
    const resourceUrl = target?.resourceUrl?.trim();
    const targetParameters = target?.parameters ?? [];
    if (!uploadUrl || !resourceUrl) {
      return {
        fileUrl: null,
        attempted: true,
        succeeded: false,
        skippedReason: 'staged_upload_target_missing',
        source: 'staged_upload',
        userErrors: [],
      };
    }

    const formData = new FormData();
    for (const parameter of targetParameters) {
      if (parameter.name && parameter.value !== null && parameter.value !== undefined) {
        formData.append(parameter.name, parameter.value);
      }
    }
    formData.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'sporgym-return-label.pdf');

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });
    if (!uploadResponse.ok) {
      throw new Error(`Shopify return label staged upload failed with status ${uploadResponse.status}.`);
    }

    return {
      fileUrl: resourceUrl,
      attempted: true,
      succeeded: true,
      skippedReason: null,
      source: 'staged_upload',
      userErrors: [],
    };
  }

  async function syncReturnShipping(input: SyncShopifyReturnShippingInput): Promise<SyncShopifyReturnShippingResult> {
    const reverseInputs = await fetchReturnReverseDeliveryInputs(input.returnGid);
    const matchedReverseFulfillmentOrder = reverseInputs.reverseFulfillmentOrders
      .map((order) => ({
        order,
        lineItems: order.lineItems.filter((lineItem) => returnLineItemMatchesSource(lineItem, input.sourceLineItemId)),
      }))
      .find((candidate) => candidate.lineItems.length > 0);

    if (!matchedReverseFulfillmentOrder) {
      throw new Error('Shopify return did not include a reverse fulfillment order for this return line item.');
    }

    const existingReverseDelivery = matchedReverseFulfillmentOrder.order.reverseDeliveries[0] ?? null;
    const mutationUsed = existingReverseDelivery
      ? 'reverseDeliveryShippingUpdate'
      : 'reverseDeliveryCreateWithShipping';
    const labelUpload = await uploadReturnLabelPdfToShopify(input.labelUrl);
    const labelUserErrors = normalizeUserErrors(labelUpload.userErrors);
    const labelInput = labelUpload.fileUrl ? { fileUrl: labelUpload.fileUrl } : null;
    const variables = existingReverseDelivery
      ? {
          reverseDeliveryId: existingReverseDelivery.id,
          trackingInput: {
            number: input.trackingNumber,
            ...(input.trackingUrl ? { url: input.trackingUrl } : {}),
          },
          ...(labelInput ? { labelInput } : {}),
          notifyCustomer: input.notifyCustomer,
        }
      : {
          reverseFulfillmentOrderId: matchedReverseFulfillmentOrder.order.id,
          reverseDeliveryLineItems: matchedReverseFulfillmentOrder.lineItems.map((lineItem) => ({
            reverseFulfillmentOrderLineItemId: lineItem.id,
            quantity: lineItem.quantity,
          })),
          trackingInput: {
            number: input.trackingNumber,
            ...(input.trackingUrl ? { url: input.trackingUrl } : {}),
          },
          ...(labelInput ? { labelInput } : {}),
          notifyCustomer: input.notifyCustomer,
        };

    const query = existingReverseDelivery
      ? `
        mutation SyncReturnReverseDeliveryShippingUpdate(
          $reverseDeliveryId: ID!
          $trackingInput: ReverseDeliveryTrackingInput
          $labelInput: ReverseDeliveryLabelInput
          $notifyCustomer: Boolean
        ) {
          reverseDeliveryShippingUpdate(
            reverseDeliveryId: $reverseDeliveryId
            trackingInput: $trackingInput
            labelInput: $labelInput
            notifyCustomer: $notifyCustomer
          ) {
            reverseDelivery {
              id
              deliverable {
                ... on ReverseDeliveryShippingDeliverable {
                  label {
                    publicFileUrl
                  }
                  tracking {
                    carrierName
                    number
                    url
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `
      : `
        mutation SyncReturnReverseDeliveryCreateWithShipping(
          $reverseFulfillmentOrderId: ID!
          $reverseDeliveryLineItems: [ReverseDeliveryLineItemInput!]!
          $trackingInput: ReverseDeliveryTrackingInput
          $labelInput: ReverseDeliveryLabelInput
          $notifyCustomer: Boolean
        ) {
          reverseDeliveryCreateWithShipping(
            reverseFulfillmentOrderId: $reverseFulfillmentOrderId
            reverseDeliveryLineItems: $reverseDeliveryLineItems
            trackingInput: $trackingInput
            labelInput: $labelInput
            notifyCustomer: $notifyCustomer
          ) {
            reverseDelivery {
              id
              deliverable {
                ... on ReverseDeliveryShippingDeliverable {
                  label {
                    publicFileUrl
                  }
                  tracking {
                    carrierName
                    number
                    url
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error('Shopify return shipping sync is not configured.');
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({ query, variables }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify return shipping sync failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<ShopifyReverseDeliveryMutationResponse>;
    if (json.errors?.length) {
      throw new Error(
        `Shopify return shipping sync returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`,
      );
    }

    const mutationPayload = existingReverseDelivery
      ? json.data?.reverseDeliveryShippingUpdate
      : json.data?.reverseDeliveryCreateWithShipping;
    const userErrors = [
      ...labelUserErrors,
      ...normalizeUserErrors(mutationPayload?.userErrors),
    ];
    const reverseDeliveryId = mutationPayload?.reverseDelivery?.id ?? null;
    const deliverable = mutationPayload?.reverseDelivery?.deliverable;
    const labelPublicFileUrl = deliverable?.label?.publicFileUrl ?? null;
    const returnedTrackingNumber = deliverable?.tracking?.number ?? null;
    const returnedCarrierName = deliverable?.tracking?.carrierName ?? null;
    const trackingAccepted = Boolean(returnedTrackingNumber) && returnedTrackingNumber === input.trackingNumber && userErrors.length === 0;

    return {
      mutationUsed,
      reverseFulfillmentOrderId: matchedReverseFulfillmentOrder.order.id,
      reverseDeliveryId,
      trackingAccepted,
      labelAccepted: Boolean(labelPublicFileUrl) && userErrors.length === 0,
      returnedCarrierName,
      userErrors,
      labelInputSent: Boolean(labelInput),
      labelUploadAttempted: labelUpload.attempted,
      labelUploadSucceeded: labelUpload.succeeded,
      labelUploadSkippedReason: labelUpload.skippedReason,
      labelUploadSource: labelUpload.source,
      source: 'shopify_admin',
    };
  }

  async function probeReturnLabelUpload(input: ProbeShopifyReturnLabelUploadInput): Promise<ProbeShopifyReturnLabelUploadResult> {
    const reverseInputs = await fetchReturnReverseDeliveryInputs(input.returnGid);
    const reverseFulfillmentOrder = reverseInputs.reverseFulfillmentOrders.find((order) => order.lineItems.length > 0);
    if (!reverseFulfillmentOrder) {
      throw new Error('Shopify return did not include a reverse fulfillment order with line items.');
    }

    const existingReverseDelivery = reverseFulfillmentOrder.reverseDeliveries[0] ?? null;
    const mutationUsed = existingReverseDelivery
      ? 'reverseDeliveryShippingUpdate'
      : 'reverseDeliveryCreateWithShipping';
    const labelInput = input.labelUrl ? { fileUrl: input.labelUrl } : null;
    const variables = existingReverseDelivery
      ? {
          reverseDeliveryId: existingReverseDelivery.id,
          trackingInput: {
            number: input.trackingNumber,
            ...(input.trackingUrl ? { url: input.trackingUrl } : {}),
          },
          ...(labelInput ? { labelInput } : {}),
          notifyCustomer: false,
        }
      : {
          reverseFulfillmentOrderId: reverseFulfillmentOrder.id,
          reverseDeliveryLineItems: reverseFulfillmentOrder.lineItems.map((lineItem) => ({
            reverseFulfillmentOrderLineItemId: lineItem.id,
            quantity: lineItem.quantity,
          })),
          trackingInput: {
            number: input.trackingNumber,
            ...(input.trackingUrl ? { url: input.trackingUrl } : {}),
          },
          ...(labelInput ? { labelInput } : {}),
          notifyCustomer: false,
        };
    const query = existingReverseDelivery
      ? `
        mutation ProbeReverseDeliveryShippingUpdate(
          $reverseDeliveryId: ID!
          $trackingInput: ReverseDeliveryTrackingInput
          $labelInput: ReverseDeliveryLabelInput
          $notifyCustomer: Boolean
        ) {
          reverseDeliveryShippingUpdate(
            reverseDeliveryId: $reverseDeliveryId
            trackingInput: $trackingInput
            labelInput: $labelInput
            notifyCustomer: $notifyCustomer
          ) {
            reverseDelivery {
              id
              deliverable {
                ... on ReverseDeliveryShippingDeliverable {
                  label {
                    publicFileUrl
                  }
                  tracking {
                    carrierName
                    number
                    url
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `
      : `
        mutation ProbeReverseDeliveryCreateWithShipping(
          $reverseFulfillmentOrderId: ID!
          $reverseDeliveryLineItems: [ReverseDeliveryLineItemInput!]!
          $trackingInput: ReverseDeliveryTrackingInput
          $labelInput: ReverseDeliveryLabelInput
          $notifyCustomer: Boolean
        ) {
          reverseDeliveryCreateWithShipping(
            reverseFulfillmentOrderId: $reverseFulfillmentOrderId
            reverseDeliveryLineItems: $reverseDeliveryLineItems
            trackingInput: $trackingInput
            labelInput: $labelInput
            notifyCustomer: $notifyCustomer
          ) {
            reverseDelivery {
              id
              deliverable {
                ... on ReverseDeliveryShippingDeliverable {
                  label {
                    publicFileUrl
                  }
                  tracking {
                    carrierName
                    number
                    url
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error('Shopify return label upload probe is not configured.');
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({ query, variables }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify return label upload probe failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<ShopifyReverseDeliveryMutationResponse>;
    if (json.errors?.length) {
      throw new Error(
        `Shopify return label upload probe returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`,
      );
    }

    const mutationPayload = existingReverseDelivery
      ? json.data?.reverseDeliveryShippingUpdate
      : json.data?.reverseDeliveryCreateWithShipping;
    const userErrors = normalizeUserErrors(mutationPayload?.userErrors);
    const reverseDeliveryId = mutationPayload?.reverseDelivery?.id ?? null;
    const deliverable = mutationPayload?.reverseDelivery?.deliverable;
    const labelPublicFileUrl = deliverable?.label?.publicFileUrl ?? null;
    const returnedTrackingNumber = deliverable?.tracking?.number ?? null;
    const returnedCarrierName = deliverable?.tracking?.carrierName ?? null;
    const trackingAccepted = Boolean(returnedTrackingNumber) && returnedTrackingNumber === input.trackingNumber && userErrors.length === 0;

    return {
      mutationUsed,
      reverseFulfillmentOrderIdPresent: Boolean(reverseFulfillmentOrder.id),
      reverseLineItemIdsPresent: reverseFulfillmentOrder.lineItems.length > 0,
      reverseDeliveryId,
      trackingAccepted,
      labelAccepted: Boolean(labelPublicFileUrl) && userErrors.length === 0,
      returnedCarrierName,
      userErrors,
      source: 'shopify_admin',
    };
  }

  async function fetchFulfillmentOrders(shopifyOrderId: string): Promise<ShopifyFulfillmentOrdersResponse> {
    const normalizedShopifyOrderId = extractShopifyGidTail(shopifyOrderId) ?? shopifyOrderId;
    if (mockFulfillmentOrdersByOrderId[shopifyOrderId] || mockFulfillmentOrdersByOrderId[normalizedShopifyOrderId]) {
      return {
        fulfillmentOrders: mockFulfillmentOrdersByOrderId[shopifyOrderId] ?? mockFulfillmentOrdersByOrderId[normalizedShopifyOrderId],
        source: 'mock',
      };
    }

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return {
        fulfillmentOrders: [],
        source: 'mock',
      };
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/orders/${encodeURIComponent(normalizedShopifyOrderId)}/fulfillment_orders.json`,
      {
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify fulfillment orders fetch failed with status ${response.status}.`);
    }

    const json = (await response.json()) as {
      fulfillment_orders?: Array<{
        id: string | number;
        status?: string;
        line_items?: Array<{
          id: string | number;
          line_item_id: string | number;
          quantity?: number;
        }>;
      }>;
    };

    return {
      fulfillmentOrders: (json.fulfillment_orders || []).map((order) => ({
        id: String(order.id),
        status: typeof order.status === 'string' ? order.status : 'open',
        lineItems: (order.line_items || []).map((lineItem) => ({
          id: String(lineItem.id),
          lineItemId: String(lineItem.line_item_id),
          quantity: typeof lineItem.quantity === 'number' && lineItem.quantity > 0 ? lineItem.quantity : 1,
        })),
      })),
      source: 'shopify_admin',
    };
  }

  async function fetchFulfillmentOrdersForCancellationClassification(
    shopifyOrderId: string,
  ): Promise<ShopifyFulfillmentOrderCancellationClassificationResponse> {
    const normalizedShopifyOrderId = extractShopifyGidTail(shopifyOrderId) ?? shopifyOrderId;
    const mockFulfillmentOrders =
      mockFulfillmentOrdersByOrderId[shopifyOrderId] ?? mockFulfillmentOrdersByOrderId[normalizedShopifyOrderId];
    if (mockFulfillmentOrders) {
      return {
        fulfillmentOrders: mockFulfillmentOrders.map((order) => ({
          id: toShopifyGid('FulfillmentOrder', order.id),
          status: order.status,
          requestStatus: null,
          supportedActions: null,
          assignedLocationId: null,
          lineItems: order.lineItems.map((lineItem) => ({
            id: toShopifyGid('FulfillmentOrderLineItem', lineItem.id),
            lineItemId: toShopifyLineItemGid(lineItem.lineItemId),
            remainingQuantity: lineItem.quantity,
            totalQuantity: lineItem.quantity,
          })),
        })),
        source: 'mock',
      };
    }

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error('Shopify fulfillment order cancellation classification is not configured.');
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query FulfillmentOrderCancellationClassification($id: ID!) {
              order(id: $id) {
                id
                fulfillmentOrders(first: 100) {
                  pageInfo {
                    hasNextPage
                  }
                  nodes {
                    id
                    status
                    requestStatus
                    supportedActions {
                      action
                    }
                    assignedLocation {
                      location {
                        id
                      }
                    }
                    lineItems(first: 250) {
                      pageInfo {
                        hasNextPage
                      }
                      nodes {
                        id
                        remainingQuantity
                        totalQuantity
                        lineItem {
                          id
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: {
            id: toShopifyOrderGid(shopifyOrderId),
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify fulfillment order cancellation classification fetch failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<FulfillmentOrderCancellationClassificationQueryResponse>;
    if (json.errors?.length) {
      throw new Error(
        `Shopify fulfillment order cancellation classification fetch returned GraphQL errors: ${json.errors
          .map((error) => error.message)
          .join('; ')}`,
      );
    }

    const order = json.data?.order;
    if (!order?.id) {
      throw new Error(`Shopify order fulfillment orders were not found for order ${shopifyOrderId}.`);
    }
    if (order.fulfillmentOrders.pageInfo?.hasNextPage) {
      throw new Error(`Shopify order ${shopifyOrderId} has more fulfillment orders than the classifier can safely inspect.`);
    }
    const fulfillmentOrderWithTruncatedLineItems = (order.fulfillmentOrders.nodes || []).find(
      (fulfillmentOrder) => fulfillmentOrder.lineItems.pageInfo?.hasNextPage,
    );
    if (fulfillmentOrderWithTruncatedLineItems) {
      throw new Error(
        `Shopify fulfillment order ${fulfillmentOrderWithTruncatedLineItems.id} has more line items than the classifier can safely inspect.`,
      );
    }

    return {
      fulfillmentOrders: (order.fulfillmentOrders.nodes || []).map((fulfillmentOrder) => ({
        id: fulfillmentOrder.id,
        status: fulfillmentOrder.status ?? null,
        requestStatus: fulfillmentOrder.requestStatus ?? null,
        supportedActions: Array.isArray(fulfillmentOrder.supportedActions)
          ? fulfillmentOrder.supportedActions
              .map((action) => action.action?.trim())
              .filter((action): action is string => Boolean(action))
          : null,
        assignedLocationId: fulfillmentOrder.assignedLocation?.location?.id ?? null,
        lineItems: (fulfillmentOrder.lineItems.nodes || []).map((lineItem) => ({
          id: lineItem.id,
          lineItemId: lineItem.lineItem?.id ?? '',
          remainingQuantity: typeof lineItem.remainingQuantity === 'number' ? lineItem.remainingQuantity : null,
          totalQuantity: typeof lineItem.totalQuantity === 'number' ? lineItem.totalQuantity : null,
        })),
      })),
      source: 'shopify_admin',
    };
  }

  async function fetchOrderFulfillmentState(shopifyOrderId: string): Promise<ShopifyOrderFulfillmentState> {
    if (mockOrderFulfillmentStateByOrderId[shopifyOrderId]) {
      return {
        ...mockOrderFulfillmentStateByOrderId[shopifyOrderId],
        fulfillmentOrders: mockFulfillmentOrdersByOrderId[shopifyOrderId] ?? [],
      };
    }

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error('Shopify order fulfillment state sync is not configured.');
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query OrderFulfillmentState($id: ID!) {
              order(id: $id) {
                id
                name
                displayFulfillmentStatus
                fulfillments(first: 20) {
                  id
                  status
                  createdAt
                  updatedAt
                  trackingInfo {
                    company
                    number
                    url
                  }
                  events(first: 20) {
                    edges {
                      node {
                        status
                        happenedAt
                      }
                    }
                  }
                  fulfillmentLineItems(first: 50) {
                    edges {
                      node {
                        quantity
                        lineItem {
                          id
                          sku
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: {
            id: toShopifyOrderGid(shopifyOrderId),
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify order fulfillment state fetch failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<ShopifyOrderFulfillmentStateQueryResponse>;
    if (json.errors?.length) {
      throw new Error(
        `Shopify order fulfillment state fetch returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`,
      );
    }

    const order = json.data?.order;
    if (!order?.id) {
      throw new Error(`Shopify order fulfillment state was not found for order ${shopifyOrderId}.`);
    }

    const fulfillmentOrdersResponse = await fetchFulfillmentOrders(shopifyOrderId);

    return {
      orderGid: order.id,
      sourceShopifyOrderId: extractShopifyGidTail(order.id) ?? shopifyOrderId,
      orderName: order.name,
      displayFulfillmentStatus: order.displayFulfillmentStatus,
      fulfillments: (order.fulfillments || []).map((fulfillment) => ({
        id: fulfillment.id,
        sourceFulfillmentId: extractShopifyGidTail(fulfillment.id) ?? fulfillment.id,
        status: fulfillment.status ?? 'UNKNOWN',
        createdAt: fulfillment.createdAt,
        updatedAt: fulfillment.updatedAt,
        events: (fulfillment.events?.edges || []).map((edge) => ({
          status: edge.node.status,
          happenedAt: edge.node.happenedAt,
        })),
        trackingInfo: (fulfillment.trackingInfo || []).map((tracking) => ({
          company: tracking.company,
          number: tracking.number,
          url: tracking.url,
        })),
        lineItems: (fulfillment.fulfillmentLineItems.edges || [])
          .map((edge) => {
            const lineItemGid = edge.node.lineItem?.id ?? '';
            return {
              lineItemGid,
              sourceLineItemId: extractShopifyGidTail(lineItemGid) ?? lineItemGid,
              sku: edge.node.lineItem?.sku ?? null,
              quantity: edge.node.quantity ?? 1,
            };
          })
          .filter((lineItem) => lineItem.sourceLineItemId || lineItem.lineItemGid),
      })),
      fulfillmentOrders: fulfillmentOrdersResponse.fulfillmentOrders,
      source: 'shopify_admin',
    };
  }

  async function createFulfillmentTracking(
    input: CreateFulfillmentTrackingInput,
  ): Promise<CreateFulfillmentTrackingResult> {
    if (mockFailAllocationIds.has(input.allocationId)) {
      throw new Error(`Mock Shopify fulfillment sync failed for allocation ${input.allocationId}.`);
    }

    if (mockFulfillmentOrdersByOrderId[input.shopifyOrderId]) {
      return {
        fulfillmentId: `mock-fulfillment-${input.allocationId}`,
        status: 'mock_submitted',
        source: 'mock',
        fulfillmentCreated: true,
        skippedReason: null,
        fulfillmentOrderIdPresent: input.lineItemsByFulfillmentOrder.length > 0,
        fulfillmentIdPresent: true,
      };
    }

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error('Shopify fulfillment sync is not configured.');
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/fulfillments.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          fulfillment: {
            notify_customer: input.notifyCustomer,
            tracking_info: {
              number: input.trackingNumber,
              company: input.carrier,
              ...(input.trackingUrl ? { url: input.trackingUrl } : {}),
            },
            line_items_by_fulfillment_order: input.lineItemsByFulfillmentOrder.map((entry) => ({
              fulfillment_order_id: entry.fulfillmentOrderId,
              fulfillment_order_line_items: entry.fulfillmentOrderLineItems.map((lineItem) => ({
                id: lineItem.id,
                quantity: lineItem.quantity,
              })),
            })),
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify fulfillment creation failed with status ${response.status}.`);
    }

    const json = (await response.json()) as {
      fulfillment?: {
        id?: string | number;
      };
    };
    const fulfillmentId =
      json.fulfillment?.id === null || json.fulfillment?.id === undefined
        ? null
        : String(json.fulfillment.id).trim();

    if (!fulfillmentId) {
      throw new Error('Shopify fulfillment creation response did not include a fulfillment id.');
    }

    return {
      fulfillmentId,
      status: 'submitted',
      source: 'shopify_admin',
      fulfillmentCreated: true,
      skippedReason: null,
      fulfillmentOrderIdPresent: input.lineItemsByFulfillmentOrder.length > 0,
      fulfillmentIdPresent: true,
    };
  }

  return {
    fetchRecentOrdersPage,
    fetchOrderSellerInfo,
    fetchOrderLineItemImages,
    fetchOrderTaxSnapshot,
    fetchCanonicalOrderSnapshot,
    fetchCanonicalRefundsForOrder,
    fetchCanonicalReturnsForOrder,
    previewSuggestedRefund,
    fetchReturnDetails,
    fetchReturnCancellationState,
    cancelReturn,
    fetchReturnReverseDeliveryInputs,
    probeReturnLabelUpload,
    syncReturnShipping,
    fetchFulfillmentOrders,
    fetchFulfillmentOrdersForCancellationClassification,
    cancelFulfillmentOrder,
    createShopifyRefund,
    fetchOrderFulfillmentState,
    createFulfillmentTracking,
  };
}
