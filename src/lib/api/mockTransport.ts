import { getToken } from '../auth';
import { getCurrentVendorContext } from '../auth/vendorContext';
import { getMockAutomationDashboard } from './mockAutomation';
import { getMockFinanceDashboard } from './mockFinance';
import { getMockOrder, listMockOrders } from './mockOrders';
import { getMockReturn, listMockReturns } from './mockReturns';

export type RequestOptions = Omit<RequestInit, 'body' | 'headers'> & {
  headers?: HeadersInit;
  body?: unknown;
};

type MockResponse =
  | {
      status: 200;
      body: unknown;
    }
  | {
      status: 401 | 404 | 500;
      body: unknown;
    };

export class MockRequestError extends Error {
  readonly status: 401 | 404 | 500;
  readonly body: unknown;

  constructor(message: string, status: 401 | 404 | 500, body: unknown) {
    super(message);
    this.name = 'MockRequestError';
    this.status = status;
    this.body = body;
  }
}

function resolveMockResponse(path: string, options: RequestOptions): MockResponse | null {
  const method = (options.method ?? 'GET').toUpperCase();
  const token = getToken();

  if (!token) {
    return {
      status: 401,
      body: { message: 'Unauthorized' },
    };
  }

  if (method === 'GET' && path === '/orders') {
    return {
      status: 200,
      body: listMockOrders(getCurrentVendorContext().vendorId),
    };
  }

  const orderMatch = path.match(/^\/orders\/([^/]+)$/);

  if (method === 'GET' && orderMatch) {
    const order = getMockOrder(orderMatch[1], getCurrentVendorContext().vendorId);

    if (!order) {
      return {
        status: 404,
        body: { message: 'Order not found' },
      };
    }

    return {
      status: 200,
      body: order,
    };
  }

  if (method === 'GET' && path === '/returns') {
    return {
      status: 200,
      body: listMockReturns(getCurrentVendorContext().vendorId),
    };
  }

  const returnMatch = path.match(/^\/returns\/([^/]+)$/);

  if (method === 'GET' && returnMatch) {
    const returnRequest = getMockReturn(returnMatch[1], getCurrentVendorContext().vendorId);

    if (!returnRequest) {
      return {
        status: 404,
        body: { message: 'Return not found' },
      };
    }

    return {
      status: 200,
      body: returnRequest,
    };
  }

  if (method === 'GET' && path === '/finance') {
    return {
      status: 200,
      body: getMockFinanceDashboard(getCurrentVendorContext().vendorId),
    };
  }

  if (method === 'GET' && path === '/automation') {
    return {
      status: 200,
      body: getMockAutomationDashboard(),
    };
  }

  return null;
}

export async function mockRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = resolveMockResponse(path, options);

  if (!response) {
    throw new MockRequestError(`No mock response configured for ${path}`, 404, { message: 'Not found' });
  }

  if (response.status >= 400) {
    const status = response.status as 401 | 404 | 500;
    throw new MockRequestError(
      typeof response.body === 'object' && response.body && 'message' in response.body
        ? String((response.body as { message?: unknown }).message)
        : 'Mock request failed',
      status,
      response.body,
    );
  }

  return response.body as T;
}
