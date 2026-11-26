import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from '../backend/node_modules/jsonwebtoken/index.js';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  userVendorAccess: { findMany: vi.fn() },
  vendor: { findUnique: vi.fn() },
}));
const shipmentMock = vi.hoisted(() => ({
  createShipmentExecution: vi.fn(),
  retryFailedShipmentExecution: vi.fn(),
}));

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../backend/src/modules/shipping/shipping-execution.service.js', () => ({
  createShipmentExecution: shipmentMock.createShipmentExecution,
  retryFailedShipmentExecution: shipmentMock.retryFailedShipmentExecution,
  getShipmentExecutionById: vi.fn(),
  getShippingProviderReadinessDiagnostics: vi.fn(),
  getVendorShippingConfig: vi.fn(),
  listShipmentExecutions: vi.fn(),
  previewShipmentExecution: vi.fn(),
  refreshKargonomiShipmentProviderData: vi.fn(),
  retryDryRunShipmentExecution: vi.fn(),
  syncKargonomiWarehouseDetails: vi.fn(),
  upsertVendorShippingConfig: vi.fn(),
}));

const { default: Fastify } = await import('../backend/node_modules/fastify/fastify.js');
const { registerShippingExecutionRoutes } = await import('../backend/src/modules/shipping/shipping-execution.routes.js');
const env = { NODE_ENV: 'test', JWT_SECRET: 'p04-u1-b1-isolated-test-secret', JWT_EXPIRES_IN: '1h' } as Parameters<typeof registerShippingExecutionRoutes>[1];

type Role = 'admin' | 'vendor' | 'support' | 'finance';
const roles: Role[] = ['admin', 'vendor', 'support', 'finance'];
const vendorId = 'vendor-a';

function token(role: Role) {
  return jwt.sign({ sub: `user-${role}`, email: `${role}@example.test`, role, credentialVersion: 0 }, env.JWT_SECRET);
}

function requestHeaders(role: Role, requestedVendorId = vendorId) {
  return { authorization: `Bearer ${token(role)}`, 'x-vendor-id': requestedVendorId };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  registerShippingExecutionRoutes(app, env);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const role = where.id.replace('user-', '').toUpperCase();
    return {
      id: where.id, email: `${role.toLowerCase()}@example.test`, name: role, role,
      status: 'active', credentialVersion: 0,
      vendorLinks: [{ vendor: { id: vendorId, name: 'Vendor A', status: 'active', restrictionReason: null, restrictedByUserId: null, restrictedAt: null } }],
    };
  });
  prismaMock.userVendorAccess.findMany.mockResolvedValue([{ vendorId, vendor: { id: vendorId, name: 'Vendor A', status: 'active' } }]);
  prismaMock.vendor.findUnique.mockResolvedValue({ id: vendorId, status: 'active' });
  shipmentMock.createShipmentExecution.mockResolvedValue({ id: 'shipment-created' });
  shipmentMock.retryFailedShipmentExecution.mockResolvedValue({ id: 'shipment-retried' });
});

describe('P04-U1-B1 shipment role boundary', () => {
  it.each(roles)('%s create follows the approved role policy', async (role) => {
    const app = await buildApp();
    try {
      const response = await app.inject({ method: 'POST', url: '/shipments/create', headers: requestHeaders(role), payload: { allocationId: 'allocation-a' } });
      if (role === 'admin' || role === 'vendor') {
        expect(response.statusCode).toBe(200);
        expect(shipmentMock.createShipmentExecution).toHaveBeenCalledOnce();
      } else {
        expect(response.statusCode).toBe(403);
        expect(shipmentMock.createShipmentExecution).not.toHaveBeenCalled();
      }
    } finally { await app.close(); }
  });

  it.each(roles)('%s ordinary retry follows the approved role policy', async (role) => {
    const app = await buildApp();
    try {
      const response = await app.inject({ method: 'POST', url: '/shipments/shipment-a/retry', headers: requestHeaders(role), payload: {} });
      if (role === 'admin' || role === 'vendor') {
        expect(response.statusCode).toBe(200);
        expect(shipmentMock.retryFailedShipmentExecution).toHaveBeenCalledOnce();
      } else {
        expect(response.statusCode).toBe(403);
        expect(shipmentMock.retryFailedShipmentExecution).not.toHaveBeenCalled();
      }
    } finally { await app.close(); }
  });

  it.each(['/shipments/create', '/shipments/shipment-a/retry'])('keeps unauthenticated and foreign Vendor requests out of %s', async (url) => {
    const app = await buildApp();
    try {
      const anonymous = await app.inject({ method: 'POST', url, payload: { allocationId: 'allocation-a' } });
      expect(anonymous.statusCode).toBe(401);
      const foreign = await app.inject({ method: 'POST', url, headers: requestHeaders('vendor', 'vendor-b'), payload: { allocationId: 'allocation-a' } });
      expect(foreign.statusCode).toBe(403);
      expect(shipmentMock.createShipmentExecution).not.toHaveBeenCalled();
      expect(shipmentMock.retryFailedShipmentExecution).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each(['/shipments/create', '/shipments/shipment-a/retry'])('keeps restricted Vendor mutations out of %s', async (url) => {
    prismaMock.vendor.findUnique.mockResolvedValue({ id: vendorId, status: 'inactive' });
    const app = await buildApp();
    try {
      const response = await app.inject({ method: 'POST', url, headers: requestHeaders('vendor'), payload: { allocationId: 'allocation-a' } });
      expect(response.statusCode).toBe(403);
      expect(shipmentMock.createShipmentExecution).not.toHaveBeenCalled();
      expect(shipmentMock.retryFailedShipmentExecution).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
