const DEFAULT_BASE_URL = process.env.BACKEND_URL?.trim() || 'http://127.0.0.1:4000';

function fail(message) {
  console.error(`real-api dry-run failed: ${message}`);
  process.exit(1);
}

async function requestJson(url, options = {}) {
  let response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    fail(`could not reach backend at ${url} (${error instanceof Error ? error.message : 'unknown error'}). Start the backend first.`);
  }

  let json = null;

  try {
    json = await response.json();
  } catch {
    // Keep `json` null so the caller gets a clear failure message.
  }

  return { response, json };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function getSetCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }

  const header = response.headers.get('set-cookie');
  return header ? [header] : [];
}

function extractSessionCookie(response) {
  const sessionCookie = getSetCookieHeaders(response)
    .map((header) => header.split(';')[0]?.trim() ?? '')
    .find((cookie) => cookie.startsWith('sporgym_session='));

  assert(sessionCookie, '/auth/login session cookie missing');
  return sessionCookie;
}

function authHeaders(session, extraHeaders = {}) {
  return {
    Cookie: session.cookie,
    'X-CSRF-Token': session.csrfToken,
    ...extraHeaders,
  };
}

async function loginSession(email, password) {
  const { response, json } = await requestJson(`${DEFAULT_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  assert(response.ok, `/auth/login returned ${response.status}`);
  assert(isObject(json?.user), '/auth/login user missing');
  assert(typeof json?.csrfToken === 'string' && json.csrfToken.length > 0, '/auth/login csrfToken missing');
  assert(json?.token === undefined, '/auth/login should not return a JSON token');

  return {
    cookie: extractSessionCookie(response),
    csrfToken: json.csrfToken,
    user: json.user,
  };
}

async function run() {
  const { response: healthResponse, json: healthJson } = await requestJson(`${DEFAULT_BASE_URL}/health`);
  assert(healthResponse.ok, `/health returned ${healthResponse.status}`);
  assert(healthJson?.ok === true, '/health payload missing ok=true');

  const session = await loginSession('admin@demo.com', 'demo123');

  const { response: ordersResponse, json: ordersJson } = await requestJson(`${DEFAULT_BASE_URL}/orders`, {
    headers: authHeaders(session, { 'X-Vendor-Id': 'yalispor' }),
  });
  assert(ordersResponse.ok, `/orders returned ${ordersResponse.status}`);
  assert(Array.isArray(ordersJson), '/orders payload is not an array');
  assert(ordersJson.length > 0, '/orders returned no records');
  assert(typeof ordersJson[0]?.id === 'string', '/orders first record missing id');

  const firstOrderId = ordersJson[0].id;

  const { response: orderDetailResponse, json: orderDetailJson } = await requestJson(
    `${DEFAULT_BASE_URL}/orders/${firstOrderId}`,
    {
      headers: authHeaders(session, { 'X-Vendor-Id': 'yalispor' }),
    },
  );
  assert(orderDetailResponse.ok, `/orders/:orderId returned ${orderDetailResponse.status}`);
  assert(typeof orderDetailJson?.id === 'string', '/orders/:orderId missing id');
  assert(Array.isArray(orderDetailJson?.lineItems), '/orders/:orderId missing lineItems array');

  const { response: returnsResponse, json: returnsJson } = await requestJson(`${DEFAULT_BASE_URL}/returns`, {
    headers: authHeaders(session, { 'X-Vendor-Id': 'yalispor' }),
  });
  assert(returnsResponse.ok, `/returns returned ${returnsResponse.status}`);
  assert(Array.isArray(returnsJson), '/returns payload is not an array');

  if (returnsJson.length > 0) {
    const firstReturnId = returnsJson[0]?.id;
    assert(typeof firstReturnId === 'string', '/returns first record missing id');

    const { response: returnDetailResponse, json: returnDetailJson } = await requestJson(
      `${DEFAULT_BASE_URL}/returns/${firstReturnId}`,
      {
        headers: authHeaders(session, { 'X-Vendor-Id': 'yalispor' }),
      },
    );
    assert(returnDetailResponse.ok, `/returns/:returnId returned ${returnDetailResponse.status}`);
    assert(typeof returnDetailJson?.id === 'string', '/returns/:returnId missing id');
  }

  const { response: financeResponse, json: financeJson } = await requestJson(`${DEFAULT_BASE_URL}/finance`, {
    headers: authHeaders(session, { 'X-Vendor-Id': 'yalispor' }),
  });
  assert(financeResponse.ok, `/finance returned ${financeResponse.status}`);
  assert(isObject(financeJson?.summary), '/finance missing summary object');
  assert(Array.isArray(financeJson?.records), '/finance missing records array');

  const { response: automationResponse, json: automationJson } = await requestJson(
    `${DEFAULT_BASE_URL}/automation`,
    {
      headers: authHeaders(session, { 'X-Vendor-Id': 'yalispor' }),
    },
  );
  assert(automationResponse.ok, `/automation returned ${automationResponse.status}`);
  assert(Array.isArray(automationJson?.alerts), '/automation missing alerts array');
  assert(Array.isArray(automationJson?.suggestions), '/automation missing suggestions array');

  const { response: operationsResponse, json: operationsJson } = await requestJson(
    `${DEFAULT_BASE_URL}/admin/operations`,
    {
      headers: authHeaders(session),
    },
  );
  assert(operationsResponse.ok, `/admin/operations returned ${operationsResponse.status}`);
  assert(isObject(operationsJson?.summary), '/admin/operations missing summary object');
  assert(Array.isArray(operationsJson?.items), '/admin/operations missing items array');

  const { response: adminOrderResponse, json: adminOrderJson } = await requestJson(
    `${DEFAULT_BASE_URL}/admin/orders/1001`,
    {
      headers: authHeaders(session),
    },
  );
  assert(adminOrderResponse.ok, `/admin/orders/1001 returned ${adminOrderResponse.status}`);
  assert(isObject(adminOrderJson?.order), '/admin/orders/1001 missing order object');
  assert(Array.isArray(adminOrderJson?.allocations), '/admin/orders/1001 missing allocations array');

  console.log('real-api dry-run passed.');
}

run().catch((error) => {
  fail(error instanceof Error ? error.message : 'unknown error');
});
