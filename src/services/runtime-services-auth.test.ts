import { afterEach, describe, expect, it, vi } from 'vitest';

const backendLoginMock = vi.hoisted(() => vi.fn());
const backendMeMock = vi.hoisted(() => vi.fn());

describe('runtimeServices real-mode auth', () => {
  afterEach(() => {
    vi.doUnmock('../config/runtime');
    vi.doUnmock('./backend-auth');
    vi.resetModules();
  });

  it.each(['real', 'mock'])('I03 keeps supported shipping in %s mode without retired success simulations', async (apiMode) => {
    vi.doMock('../config/runtime', () => ({ runtimeConfig: { apiMode } }));
    const { runtimeServices } = await import('./runtime-services');
    for (const name of ['refreshShipmentExecutionStatus', 'cancelShipmentExecution', 'updateNavlungoShipmentExecution',
      'createReturnShipmentLabel', 'probeShopifyReturnLabelUpload', 'probeTryOtoReturnDetails',
      'probeTryOtoReturnLink', 'probeTryOtoReturnAwbPrint']) {
      expect(runtimeServices.orders).not.toHaveProperty(name);
    }
    for (const name of ['createNavlungoReturnPickup', 'saveNavlungoReturnPickupAddressCompletion', 'syncNavlungoReturnStatus']) {
      expect(runtimeServices.returns).not.toHaveProperty(name);
    }
    for (const name of ['navlungoAuth', 'navlungoCarriers', 'navlungoCreatePostProbe', 'navlungoCheckPostProbe', 'navlungoBarcodeProbe']) {
      expect(runtimeServices.diagnostics).not.toHaveProperty(name);
    }
    for (const name of ['createShipmentExecution', 'retryFailedShipmentExecution', 'retryShipmentExecution',
      'refreshShipmentProviderData', 'submitFulfillmentTracking']) {
      expect(runtimeServices.orders).toHaveProperty(name, expect.any(Function));
    }
    for (const name of ['createKargonomiReturnShipment', 'refreshKargonomiReturnProviderData', 'syncKargonomiReturnToShopify']) {
      expect(runtimeServices.returns).toHaveProperty(name, expect.any(Function));
    }
  });

  it('uses the cookie-session login response without requiring a JSON token or duplicate /auth/me call', async () => {
    vi.doMock('../config/runtime', () => ({
      runtimeConfig: {
        apiMode: 'real',
      },
    }));
    vi.doMock('./backend-auth', () => ({
      login: backendLoginMock,
      me: backendMeMock,
      logout: vi.fn(),
    }));
    backendLoginMock.mockResolvedValueOnce({
      user: {
        email: 'login-response@example.com',
        name: 'Login Response',
        role: 'vendor',
        status: 'active',
        vendorAccess: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      },
    });
    backendMeMock.mockResolvedValueOnce({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      status: 'active',
      vendorAccess: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
    });

    const { runtimeServices } = await import('./runtime-services');
    const result = await runtimeServices.auth.login('vendor@example.com', 'demo123', {
      authAttemptId: 'auth-test123',
    });

    expect(backendLoginMock).toHaveBeenCalledWith('vendor@example.com', 'demo123', expect.objectContaining({
      authAttemptId: 'auth-test123',
      authFlowId: undefined,
      authRequestId: undefined,
      signal: undefined,
    }));
    expect(backendMeMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      token: null,
      user: expect.objectContaining({
        email: 'login-response@example.com',
        name: 'Login Response',
        role: 'vendor',
        vendorAccess: ['sporjinal'],
        defaultVendorId: 'sporjinal',
      }),
    });
  });
});
