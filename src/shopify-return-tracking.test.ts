import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShopifyAdminService } from '../backend/src/modules/shopify/shopify-admin.service.js';

function buildGraphqlResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Shopify return tracking fetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps reverse delivery shipping tracking fields from Shopify return details', async () => {
    const fetchMock = vi.fn().mockResolvedValue(buildGraphqlResponse({
      return: {
        id: 'gid://shopify/Return/231',
        order: { id: 'gid://shopify/Order/1028' },
        returnLineItems: {
          edges: [
            {
              node: {
                id: 'gid://shopify/ReturnLineItem/1',
                customerNote: null,
                returnReason: 'SIZE_TOO_LARGE',
                returnReasonNote: 'Beden büyük geldi.',
                fulfillmentLineItem: {
                  id: 'gid://shopify/FulfillmentLineItem/1',
                  lineItem: {
                    id: 'gid://shopify/LineItem/99',
                    sku: 'SKU-99',
                  },
                },
              },
            },
          ],
        },
        reverseFulfillmentOrders: {
          edges: [
            {
              node: {
                reverseDeliveries: {
                  edges: [
                    {
                      node: {
                        deliverable: {
                          tracking: {
                            carrierName: 'Yurtiçi Kargo',
                            number: 'returnkargo-123',
                            url: 'https://tracking.example/returnkargo-123',
                          },
                        },
                      },
                    },
                  ],
                },
                lineItems: { edges: [] },
              },
            },
          ],
        },
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createShopifyAdminService({
      SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test',
      SHOPIFY_API_VERSION: '2025-07',
    } as never).fetchReturnDetails('gid://shopify/Return/231');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { query: string };
    expect(body.query).toContain('reverseDeliveries');
    expect(body.query).toContain('ReverseDeliveryShippingDeliverable');
    expect(result.returnTracking).toEqual({
      carrierName: 'Yurtiçi Kargo',
      trackingNumber: 'returnkargo-123',
      trackingUrl: 'https://tracking.example/returnkargo-123',
    });
  });

  it('keeps return tracking null when Shopify does not provide reverse delivery tracking', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(buildGraphqlResponse({
      return: {
        id: 'gid://shopify/Return/232',
        order: { id: 'gid://shopify/Order/1029' },
        returnLineItems: { edges: [] },
        reverseFulfillmentOrders: {
          edges: [
            {
              node: {
                reverseDeliveries: {
                  edges: [
                    {
                      node: {
                        deliverable: {
                          tracking: {
                            carrierName: null,
                            number: null,
                            url: null,
                          },
                        },
                      },
                    },
                  ],
                },
                lineItems: { edges: [] },
              },
            },
          ],
        },
      },
    })));

    const result = await createShopifyAdminService({
      SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test',
      SHOPIFY_API_VERSION: '2025-07',
    } as never).fetchReturnDetails('gid://shopify/Return/232');

    expect(result.returnTracking).toBeNull();
  });

  it('fetches canonical return cancellation state before abandoned return auto-cancel', async () => {
    const fetchMock = vi.fn().mockResolvedValue(buildGraphqlResponse({
      return: {
        id: 'gid://shopify/Return/239',
        status: 'OPEN',
        requestApprovedAt: '2026-05-25T10:00:00Z',
        closedAt: null,
        refunds: { edges: [] },
        transactions: { edges: [] },
        reverseFulfillmentOrders: {
          nodes: [
            {
              id: 'gid://shopify/ReverseFulfillmentOrder/1',
              status: 'OPEN',
              lineItems: { nodes: [] },
              reverseDeliveries: { nodes: [] },
            },
          ],
        },
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createShopifyAdminService({
      SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test',
      SHOPIFY_API_VERSION: '2026-04',
    } as never).fetchReturnCancellationState('gid://shopify/Return/239');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { query: string; variables: { id: string } };
    expect(body.query).toContain('requestApprovedAt');
    expect(body.query).toContain('refunds(first: 1)');
    expect(body.query).toContain('reverseFulfillmentOrders');
    expect(body.variables.id).toBe('gid://shopify/Return/239');
    expect(result).toMatchObject({
      returnGid: 'gid://shopify/Return/239',
      status: 'OPEN',
      requestApprovedAt: '2026-05-25T10:00:00Z',
      refundIds: [],
      transactionIds: [],
      reverseFulfillmentOrders: [
        {
          id: 'gid://shopify/ReverseFulfillmentOrder/1',
          status: 'OPEN',
          reverseDeliveries: [],
        },
      ],
    });
  });

  it('calls Shopify returnCancel and maps userErrors without raw payload exposure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(buildGraphqlResponse({
      returnCancel: {
        return: {
          id: 'gid://shopify/Return/239',
          status: 'CANCELED',
        },
        userErrors: [
          {
            field: ['id'],
            message: 'Return was already canceled.',
          },
        ],
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createShopifyAdminService({
      SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test',
      SHOPIFY_API_VERSION: '2026-04',
    } as never).cancelReturn('gid://shopify/Return/239');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { query: string; variables: { id: string } };
    expect(body.query).toContain('returnCancel');
    expect(body.variables.id).toBe('gid://shopify/Return/239');
    expect(result).toEqual({
      returnGid: 'gid://shopify/Return/239',
      status: 'CANCELED',
      userErrors: [
        {
          field: ['id'],
          message: 'Return was already canceled.',
        },
      ],
      source: 'shopify_admin',
    });
  });

  it('probes Shopify reverse delivery label upload with return tracking and label URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(buildGraphqlResponse({
        return: {
          id: 'gid://shopify/Return/231',
          reverseFulfillmentOrders: {
            nodes: [
              {
                id: 'gid://shopify/ReverseFulfillmentOrder/1',
                status: 'OPEN',
                lineItems: {
                  nodes: [
                    {
                      id: 'gid://shopify/ReverseFulfillmentOrderLineItem/1',
                      totalQuantity: 1,
                      fulfillmentLineItem: {
                        lineItem: {
                          id: 'gid://shopify/LineItem/99',
                          sku: 'SKU-99',
                        },
                      },
                    },
                  ],
                },
                reverseDeliveries: {
                  nodes: [],
                },
              },
            ],
          },
        },
      }))
      .mockResolvedValueOnce(buildGraphqlResponse({
        reverseDeliveryCreateWithShipping: {
          reverseDelivery: {
            id: 'gid://shopify/ReverseDelivery/1',
            deliverable: {
              label: {
                publicFileUrl: 'https://labels.example/return.pdf',
              },
              tracking: {
                carrierName: 'Sürat Kargo',
                number: 'RET-TRACK-1',
                url: 'https://tracking.example/RET-TRACK-1',
              },
            },
          },
          userErrors: [],
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createShopifyAdminService({
      SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test',
      SHOPIFY_API_VERSION: '2025-07',
    } as never).probeReturnLabelUpload({
      returnGid: 'gid://shopify/Return/231',
      trackingNumber: 'RET-TRACK-1',
      trackingUrl: 'https://tracking.example/RET-TRACK-1',
      labelUrl: 'https://labels.example/return.pdf',
      carrierName: 'Sürat Kargo',
    });

    const [, mutationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const mutationBody = JSON.parse(String(mutationInit.body)) as {
      query: string;
      variables: {
        trackingInput: { number: string; url?: string };
        labelInput: { fileUrl: string };
        notifyCustomer: boolean;
      };
    };
    expect(mutationBody.query).toContain('reverseDeliveryCreateWithShipping');
    expect(mutationBody.query).toContain('labelInput');
    expect(mutationBody.query).toContain('tracking');
    expect(mutationBody.variables.trackingInput).toEqual({
      number: 'RET-TRACK-1',
      url: 'https://tracking.example/RET-TRACK-1',
    });
    expect(mutationBody.variables.labelInput).toEqual({
      fileUrl: 'https://labels.example/return.pdf',
    });
    expect(mutationBody.variables.notifyCustomer).toBe(false);
    expect(mutationBody.variables).not.toHaveProperty('carrierName');
    expect(result).toMatchObject({
      mutationUsed: 'reverseDeliveryCreateWithShipping',
      reverseDeliveryId: 'gid://shopify/ReverseDelivery/1',
      trackingAccepted: true,
      labelAccepted: true,
      returnedCarrierName: 'Sürat Kargo',
      userErrors: [],
    });
  });

  it('probes Shopify reverse delivery with tracking only when return label URL is unavailable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(buildGraphqlResponse({
        return: {
          id: 'gid://shopify/Return/231',
          reverseFulfillmentOrders: {
            nodes: [
              {
                id: 'gid://shopify/ReverseFulfillmentOrder/1',
                status: 'OPEN',
                lineItems: {
                  nodes: [
                    {
                      id: 'gid://shopify/ReverseFulfillmentOrderLineItem/1',
                      totalQuantity: 1,
                      fulfillmentLineItem: {
                        lineItem: {
                          id: 'gid://shopify/LineItem/99',
                          sku: 'SKU-99',
                        },
                      },
                    },
                  ],
                },
                reverseDeliveries: {
                  nodes: [],
                },
              },
            ],
          },
        },
      }))
      .mockResolvedValueOnce(buildGraphqlResponse({
        reverseDeliveryCreateWithShipping: {
          reverseDelivery: {
            id: 'gid://shopify/ReverseDelivery/1',
            deliverable: {
              label: null,
              tracking: {
                carrierName: 'Sürat Kargo',
                number: 'RET-TRACK-1',
                url: 'https://tracking.example/RET-TRACK-1',
              },
            },
          },
          userErrors: [],
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createShopifyAdminService({
      SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test',
      SHOPIFY_API_VERSION: '2025-07',
    } as never).probeReturnLabelUpload({
      returnGid: 'gid://shopify/Return/231',
      trackingNumber: 'RET-TRACK-1',
      trackingUrl: 'https://tracking.example/RET-TRACK-1',
      labelUrl: null,
      carrierName: 'Sürat Kargo',
    });

    const [, mutationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const mutationBody = JSON.parse(String(mutationInit.body)) as {
      query: string;
      variables: {
        trackingInput: { number: string; url?: string };
        labelInput?: { fileUrl: string };
      };
    };
    expect(mutationBody.query).toContain('reverseDeliveryCreateWithShipping');
    expect(mutationBody.variables.trackingInput).toEqual({
      number: 'RET-TRACK-1',
      url: 'https://tracking.example/RET-TRACK-1',
    });
    expect(mutationBody.variables).not.toHaveProperty('labelInput');
    expect(result).toMatchObject({
      mutationUsed: 'reverseDeliveryCreateWithShipping',
      reverseDeliveryId: 'gid://shopify/ReverseDelivery/1',
      trackingAccepted: true,
      labelAccepted: false,
      returnedCarrierName: 'Sürat Kargo',
      userErrors: [],
    });
  });

  it('creates a line-scoped Shopify reverse delivery with notifyCustomer true', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(buildGraphqlResponse({
        return: {
          id: 'gid://shopify/Return/231',
          reverseFulfillmentOrders: {
            nodes: [
              {
                id: 'gid://shopify/ReverseFulfillmentOrder/other',
                status: 'OPEN',
                lineItems: {
                  nodes: [
                    {
                      id: 'gid://shopify/ReverseFulfillmentOrderLineItem/other',
                      totalQuantity: 1,
                      fulfillmentLineItem: {
                        lineItem: {
                          id: 'gid://shopify/LineItem/12',
                          sku: 'OTHER',
                        },
                      },
                    },
                  ],
                },
                reverseDeliveries: { nodes: [] },
              },
              {
                id: 'gid://shopify/ReverseFulfillmentOrder/target',
                status: 'OPEN',
                lineItems: {
                  nodes: [
                    {
                      id: 'gid://shopify/ReverseFulfillmentOrderLineItem/target',
                      totalQuantity: 1,
                      fulfillmentLineItem: {
                        lineItem: {
                          id: 'gid://shopify/LineItem/99',
                          sku: 'SKU-99',
                        },
                      },
                    },
                  ],
                },
                reverseDeliveries: { nodes: [] },
              },
            ],
          },
        },
      }))
      .mockResolvedValueOnce(buildGraphqlResponse({
        reverseDeliveryCreateWithShipping: {
          reverseDelivery: {
            id: 'gid://shopify/ReverseDelivery/created',
            deliverable: {
              label: null,
              tracking: {
                carrierName: null,
                number: 'RET-TRACK-1',
                url: 'https://tracking.example/RET-TRACK-1',
              },
            },
          },
          userErrors: [],
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createShopifyAdminService({
      SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test',
      SHOPIFY_API_VERSION: '2025-07',
    } as never).syncReturnShipping({
      returnGid: 'gid://shopify/Return/231',
      sourceLineItemId: '99',
      trackingNumber: 'RET-TRACK-1',
      trackingUrl: 'https://tracking.example/RET-TRACK-1',
      labelUrl: null,
      notifyCustomer: true,
    });

    const [, mutationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const mutationBody = JSON.parse(String(mutationInit.body)) as {
      query: string;
      variables: {
        reverseFulfillmentOrderId: string;
        reverseDeliveryLineItems: Array<{ reverseFulfillmentOrderLineItemId: string; quantity: number }>;
        trackingInput: { number: string; url?: string };
        labelInput?: { fileUrl: string };
        notifyCustomer: boolean;
      };
    };
    expect(mutationBody.query).toContain('reverseDeliveryCreateWithShipping');
    expect(mutationBody.variables.reverseFulfillmentOrderId).toBe('gid://shopify/ReverseFulfillmentOrder/target');
    expect(mutationBody.variables.reverseDeliveryLineItems).toEqual([
      {
        reverseFulfillmentOrderLineItemId: 'gid://shopify/ReverseFulfillmentOrderLineItem/target',
        quantity: 1,
      },
    ]);
    expect(mutationBody.variables.notifyCustomer).toBe(true);
    expect(mutationBody.variables).not.toHaveProperty('labelInput');
    expect(result).toMatchObject({
      mutationUsed: 'reverseDeliveryCreateWithShipping',
      reverseFulfillmentOrderId: 'gid://shopify/ReverseFulfillmentOrder/target',
      reverseDeliveryId: 'gid://shopify/ReverseDelivery/created',
      trackingAccepted: true,
      labelAccepted: false,
      labelUploadSkippedReason: 'label_missing',
    });
  });

  it('updates an existing Shopify reverse delivery for the matched return line', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(buildGraphqlResponse({
        return: {
          id: 'gid://shopify/Return/231',
          reverseFulfillmentOrders: {
            nodes: [
              {
                id: 'gid://shopify/ReverseFulfillmentOrder/target',
                status: 'OPEN',
                lineItems: {
                  nodes: [
                    {
                      id: 'gid://shopify/ReverseFulfillmentOrderLineItem/target',
                      totalQuantity: 1,
                      fulfillmentLineItem: {
                        lineItem: {
                          id: 'gid://shopify/LineItem/99',
                          sku: 'SKU-99',
                        },
                      },
                    },
                  ],
                },
                reverseDeliveries: {
                  nodes: [
                    {
                      id: 'gid://shopify/ReverseDelivery/existing',
                      deliverable: { label: null, tracking: null },
                    },
                  ],
                },
              },
            ],
          },
        },
      }))
      .mockResolvedValueOnce(buildGraphqlResponse({
        reverseDeliveryShippingUpdate: {
          reverseDelivery: {
            id: 'gid://shopify/ReverseDelivery/existing',
            deliverable: {
              label: null,
              tracking: {
                carrierName: null,
                number: 'RET-TRACK-2',
                url: null,
              },
            },
          },
          userErrors: [],
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createShopifyAdminService({
      SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test',
      SHOPIFY_API_VERSION: '2025-07',
    } as never).syncReturnShipping({
      returnGid: 'gid://shopify/Return/231',
      sourceLineItemId: 'gid://shopify/LineItem/99',
      trackingNumber: 'RET-TRACK-2',
      labelUrl: null,
      notifyCustomer: true,
    });

    const [, mutationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const mutationBody = JSON.parse(String(mutationInit.body)) as {
      query: string;
      variables: {
        reverseDeliveryId: string;
        notifyCustomer: boolean;
      };
    };
    expect(mutationBody.query).toContain('reverseDeliveryShippingUpdate');
    expect(mutationBody.variables.reverseDeliveryId).toBe('gid://shopify/ReverseDelivery/existing');
    expect(mutationBody.variables.notifyCustomer).toBe(true);
    expect(result).toMatchObject({
      mutationUsed: 'reverseDeliveryShippingUpdate',
      reverseDeliveryId: 'gid://shopify/ReverseDelivery/existing',
      trackingAccepted: true,
    });
  });

  it('stages a PDF data URL and sends the staged resource URL as labelInput', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(buildGraphqlResponse({
        return: {
          id: 'gid://shopify/Return/231',
          reverseFulfillmentOrders: {
            nodes: [
              {
                id: 'gid://shopify/ReverseFulfillmentOrder/target',
                status: 'OPEN',
                lineItems: {
                  nodes: [
                    {
                      id: 'gid://shopify/ReverseFulfillmentOrderLineItem/target',
                      totalQuantity: 1,
                      fulfillmentLineItem: {
                        lineItem: {
                          id: 'gid://shopify/LineItem/99',
                          sku: 'SKU-99',
                        },
                      },
                    },
                  ],
                },
                reverseDeliveries: { nodes: [] },
              },
            ],
          },
        },
      }))
      .mockResolvedValueOnce(buildGraphqlResponse({
        stagedUploadsCreate: {
          stagedTargets: [
            {
              url: 'https://staged-upload.example/target',
              resourceUrl: 'https://cdn.shopify.example/return-label.pdf',
              parameters: [
                { name: 'key', value: 'abc' },
              ],
            },
          ],
          userErrors: [],
        },
      }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
      .mockResolvedValueOnce(buildGraphqlResponse({
        reverseDeliveryCreateWithShipping: {
          reverseDelivery: {
            id: 'gid://shopify/ReverseDelivery/created',
            deliverable: {
              label: {
                publicFileUrl: 'https://cdn.shopify.example/return-label.pdf',
              },
              tracking: {
                carrierName: null,
                number: 'RET-TRACK-3',
                url: null,
              },
            },
          },
          userErrors: [],
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createShopifyAdminService({
      SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test',
      SHOPIFY_API_VERSION: '2025-07',
    } as never).syncReturnShipping({
      returnGid: 'gid://shopify/Return/231',
      sourceLineItemId: 'gid://shopify/LineItem/99',
      trackingNumber: 'RET-TRACK-3',
      labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
      notifyCustomer: true,
    });

    const [, stagedInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const stagedBody = JSON.parse(String(stagedInit.body)) as {
      query: string;
      variables: { input: Array<{ resource: string; mimeType: string }> };
    };
    expect(stagedBody.query).toContain('stagedUploadsCreate');
    expect(stagedBody.variables.input[0]).toMatchObject({
      resource: 'RETURN_LABEL',
      mimeType: 'application/pdf',
    });
    const [uploadUrl, uploadInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(uploadUrl).toBe('https://staged-upload.example/target');
    expect(uploadInit.method).toBe('POST');

    const [, mutationInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    const mutationBody = JSON.parse(String(mutationInit.body)) as {
      variables: {
        labelInput: { fileUrl: string };
      };
    };
    expect(mutationBody.variables.labelInput).toEqual({
      fileUrl: 'https://cdn.shopify.example/return-label.pdf',
    });
    expect(JSON.stringify(mutationBody)).not.toContain('JVBER');
    expect(result).toMatchObject({
      labelInputSent: true,
      labelUploadAttempted: true,
      labelUploadSucceeded: true,
      labelUploadSkippedReason: null,
      labelUploadSource: 'staged_upload',
      labelAccepted: true,
    });
  });
});
