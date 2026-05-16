const RETURNS_TITLE_DEBUG_KEY = 'vendor-dashboard.debug.returns-title';
let enabledMarkerLogged = false;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function read(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return undefined;
}

export function isReturnsTitleDebugEnabled() {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const enabled = window.localStorage.getItem(RETURNS_TITLE_DEBUG_KEY) === '1';
    if (enabled && !enabledMarkerLogged) {
      enabledMarkerLogged = true;
      console.info('[returns-title-debug] enabled');
    }
    return enabled;
  } catch {
    return false;
  }
}

function summarizeTitleObject(value: unknown): UnknownRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const summary: UnknownRecord = {};
  const keys = [
    'id',
    'sourceLineItemId',
    'sourceVariantId',
    'sku',
    'title',
    'name',
    'productTitle',
    'productName',
    'lineItemTitle',
    'orderLineItemTitle',
    'merchandiseTitle',
    'merchandiseName',
    'variantTitle',
    'variant',
    'optionTitle',
    'quantity',
    'refundAmount',
  ];

  keys.forEach((key) => {
    const nextValue = read(value[key]);
    if (nextValue !== undefined) {
      summary[key] = nextValue;
    }
  });

  const nestedKeys = ['product', 'merchandise', 'lineItem', 'orderLineItem', 'shopifyOrderLineItem'];
  nestedKeys.forEach((key) => {
    const nested = summarizeTitleObject(value[key]);
    if (nested && Object.keys(nested).length > 0) {
      summary[key] = nested;
    }
  });

  return summary;
}

function summarizeItemArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => summarizeTitleObject(item) ?? {}) : undefined;
}

export function summarizeReturnTitlePayload(value: unknown) {
  if (!isRecord(value)) {
    return value;
  }

  const summary: UnknownRecord = {};
  const returnKeys = [
    'id',
    'sourceShopifyOrderNumber',
    'sourceShopifyReturnId',
    'sourceShopifyRefundId',
    'sourceType',
    'status',
    'returnLifecycleStatus',
    'returnRequestSource',
    'refundedSkus',
  ];

  returnKeys.forEach((key) => {
    const nextValue = value[key];
    if (nextValue !== undefined) {
      summary[key] = nextValue;
    }
  });

  const itemKeys = ['refundedItems', 'returnItems', 'lineItems', 'items', 'returnedItems', 'refundLineItems'];
  itemKeys.forEach((key) => {
    const items = summarizeItemArray(value[key]);
    if (items) {
      summary[key] = items;
    }
  });

  return summary;
}

export function logReturnsTitleDebugPayload(label: string, payload: unknown) {
  if (!isReturnsTitleDebugEnabled()) {
    return;
  }

  console.groupCollapsed(`[returns-title-debug] ${label}`);
  if (Array.isArray(payload)) {
    payload.forEach((row, index) => {
      console.info(`row ${index + 1}`, summarizeReturnTitlePayload(row));
    });
  } else {
  console.info(summarizeReturnTitlePayload(payload));
  }
  console.groupEnd();
}

export function logReturnsTitleDebugSnapshot(label: string, payload: unknown) {
  if (!isReturnsTitleDebugEnabled()) {
    return;
  }

  console.groupCollapsed(`[returns-title-debug] ${label}`);
  console.info(payload);
  console.groupEnd();
}
