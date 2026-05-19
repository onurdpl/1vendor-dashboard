import type { AppEnv } from '../../config/env.js';
import type {
  CreateFulfillmentTrackingInput,
  CreateFulfillmentTrackingResult,
  FetchShopifyReturnDetailsResult,
  FetchShopifyReturnReverseDeliveryInputsResult,
  FetchOrderSellerInfoResult,
  ProbeShopifyReturnLabelUploadInput,
  ProbeShopifyReturnLabelUploadResult,
  SellerInfoMap,
  ShopifyFulfillmentOrder,
  ShopifyFulfillmentOrdersResponse,
  ShopifyGraphqlResponse,
  ShopifyOrderFulfillmentState,
  ShopifyReturnLineItem,
  ShopifyReturnTrackingInfo,
} from './shopify-admin.types.js';

type OrderSellerInfoQueryResponse = {
  order: {
    metafield: {
      value: string | null;
    } | null;
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

function toShopifyOrderGid(orderId: string) {
  return `gid://shopify/Order/${orderId}`;
}

function extractShopifyGidTail(gid: string) {
  const tail = gid.split('/').at(-1)?.trim() ?? '';
  return tail || null;
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

  function normalizeUserErrors(
    errors: Array<{ field?: string[] | null; message?: string | null }> | undefined,
  ) {
    return (errors ?? []).map((error) => ({
      field: Array.isArray(error.field) ? error.field.filter((field): field is string => typeof field === 'string') : [],
      message: error.message ?? 'Unknown Shopify user error.',
    }));
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
    const variables = existingReverseDelivery
      ? {
          reverseDeliveryId: existingReverseDelivery.id,
          trackingInput: {
            number: input.trackingNumber,
            ...(input.trackingUrl ? { url: input.trackingUrl } : {}),
          },
          labelInput: {
            fileUrl: input.labelUrl,
          },
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
          labelInput: {
            fileUrl: input.labelUrl,
          },
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
    fetchOrderSellerInfo,
    fetchReturnDetails,
    fetchReturnReverseDeliveryInputs,
    probeReturnLabelUpload,
    fetchFulfillmentOrders,
    fetchOrderFulfillmentState,
    createFulfillmentTracking,
  };
}
