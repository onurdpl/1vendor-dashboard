import { runtimeConfig } from '../config/runtime';
import { createMockSession, createCurrentUserFromVendorAccess, type CurrentUser, getDemoUserByCredentials } from '../lib/auth';
import { getCurrentVendorContext } from '../lib/auth/vendorContext';
import { ApiError } from '../lib/api/errors';
import { getMockFinanceDashboard } from '../lib/api/mockFinance';
import { getMockOrder, getShopifyOrderBreakdown, listMockOrders } from '../lib/api/mockOrders';
import { getMockReturn, listMockReturns } from '../lib/api/mockReturns';
import { listAdminOperationsQueue as listMockAdminOperationsQueue } from '../lib/api/operations';
import * as backendAuth from './backend-auth';
import * as realOrders from './real/orders';
import * as realReturns from './real/returns';
import * as realFinance from './real/finance';
import * as realOperations from './real/operations';

function getCurrentVendorId() {
  return getCurrentVendorContext().vendorId;
}

export const runtimeServices = {
  auth: {
    async login(email: string, password: string): Promise<{ token: string; user: CurrentUser }> {
      if (runtimeConfig.apiMode === 'real') {
        const response = await backendAuth.login(email, password);
        return {
          token: response.token,
          user: createCurrentUserFromVendorAccess({
            email: response.user.email,
            name: response.user.name,
            role: response.user.role,
            status: response.user.status,
            vendorAccess: response.user.vendorAccess,
          }),
        };
      }

      const demoUser = getDemoUserByCredentials(email, password);
      if (!demoUser) {
        throw new Error('Invalid credentials. Use one of the demo accounts listed below.');
      }

      return {
        token: createMockSession(),
        user: {
          email: demoUser.email,
          name: demoUser.name,
          role: demoUser.role,
          vendorAccess: demoUser.vendorAccess,
          vendorDetails: demoUser.vendorDetails,
          canSwitchVendors: demoUser.canSwitchVendors,
          defaultVendorId: demoUser.defaultVendorId,
        },
      };
    },
    async me(token: string) {
      if (runtimeConfig.apiMode === 'real') {
        const user = await backendAuth.me(token);
        return createCurrentUserFromVendorAccess({
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
          vendorAccess: user.vendorAccess,
        });
      }

      return null;
    },
  },
  orders: {
    list: () => (runtimeConfig.apiMode === 'real' ? realOrders.listOrders() : Promise.resolve(listMockOrders(getCurrentVendorId()))),
    async detail(orderId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.getOrder(orderId);
      }

      const order = getMockOrder(orderId, getCurrentVendorId());
      if (!order) {
        throw new ApiError('Order not found.', 'server', { status: 404 });
      }
      return order;
    },
    async adminBreakdown(shopifyOrderId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.getAdminShopifyOrderBreakdown(shopifyOrderId);
      }

      const breakdown = getShopifyOrderBreakdown(shopifyOrderId);
      if (!breakdown) {
        throw new ApiError('Shopify order not found.', 'server', { status: 404 });
      }
      return breakdown;
    },
  },
  returns: {
    list: () => (runtimeConfig.apiMode === 'real' ? realReturns.listReturns() : Promise.resolve(listMockReturns(getCurrentVendorId()))),
    async detail(returnId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realReturns.getReturn(returnId);
      }

      const returnRecord = getMockReturn(returnId, getCurrentVendorId());
      if (!returnRecord) {
        throw new ApiError('Return not found.', 'server', { status: 404 });
      }
      return returnRecord;
    },
  },
  finance: {
    dashboard: () =>
      runtimeConfig.apiMode === 'real'
        ? realFinance.getFinanceDashboard()
        : Promise.resolve(getMockFinanceDashboard(getCurrentVendorId())),
  },
  operations: {
    list: () =>
      runtimeConfig.apiMode === 'real'
        ? realOperations.listAdminOperationsQueue()
        : Promise.resolve(listMockAdminOperationsQueue()),
  },
} as const;
