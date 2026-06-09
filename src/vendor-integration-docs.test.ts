import { describe, expect, it, vi } from 'vitest';
import { registerVendorIntegrationDocsRoutes } from '../backend/src/modules/vendor-integration/vendor-integration.docs.routes.js';
import { registerVendorIntegrationRoutes } from '../backend/src/modules/vendor-integration/vendor-integration.routes.js';

const prismaMock = vi.hoisted(() => ({
  vendorIntegrationClient: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  vendorIntegrationAuditLog: {
    create: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

type RegisteredRoute = {
  handler: (request: Record<string, unknown>, reply: ReturnType<typeof createReply>) => Promise<unknown>;
};

function createReply() {
  const reply = {
    statusCode: 200,
    headers: new Map<string, string>(),
    payload: undefined as unknown,
    code: vi.fn((status: number) => {
      reply.statusCode = status;
      return reply;
    }),
    type: vi.fn((contentType: string) => {
      reply.headers.set('content-type', contentType);
      return reply;
    }),
    send: vi.fn((payload: unknown) => {
      reply.payload = payload;
      return payload;
    }),
  };

  return reply;
}

function createAppStub() {
  const gets = new Map<string, RegisteredRoute>();
  const posts = new Map<string, RegisteredRoute>();
  const app = {
    addHook: vi.fn(),
    get: vi.fn((path: string, optionsOrHandler: unknown, maybeHandler?: unknown) => {
      const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
      gets.set(path, { handler: handler as RegisteredRoute['handler'] });
    }),
    post: vi.fn((path: string, optionsOrHandler: unknown, maybeHandler?: unknown) => {
      const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
      posts.set(path, { handler: handler as RegisteredRoute['handler'] });
    }),
  };

  return { app, gets, posts };
}

describe('vendor integration docs routes', () => {
  it('returns Swagger UI HTML for the docs page', async () => {
    const { app, gets } = createAppStub();
    registerVendorIntegrationDocsRoutes(app as never);

    const reply = createReply();
    const result = await gets.get('/docs/vendor-integration')?.handler({}, reply);

    expect(reply.statusCode).toBe(200);
    expect(reply.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(result).toBe(reply.payload);
    expect(String(reply.payload)).toContain('SwaggerUIBundle');
    expect(String(reply.payload)).toContain('/docs/openapi/vendor-integration.openapi.yaml');
    expect(String(reply.payload)).toContain('supportedSubmitMethods: []');
  });

  it('returns the Vendor Integration OpenAPI YAML', async () => {
    const { app, gets } = createAppStub();
    registerVendorIntegrationDocsRoutes(app as never);

    const reply = createReply();
    const result = await gets.get('/docs/openapi/vendor-integration.openapi.yaml')?.handler({}, reply);

    expect(reply.statusCode).toBe(200);
    expect(reply.headers.get('content-type')).toBe('application/yaml; charset=utf-8');
    expect(result).toBe(reply.payload);
    expect(String(reply.payload)).toContain('openapi: 3.0.3');
    expect(String(reply.payload)).toContain('url: https://api.sporgym.com');
    expect(String(reply.payload)).toContain('/api/vendor-integration/orders:');
    expect(String(reply.payload)).toContain('/api/vendor-integration/orders/{allocationId}/status:');
    expect(String(reply.payload)).not.toContain('/admin/vendor-integration');
  });

  it('keeps public OpenAPI examples free of real vendor, provider, and payment names', async () => {
    const { app, gets } = createAppStub();
    registerVendorIntegrationDocsRoutes(app as never);

    const reply = createReply();
    await gets.get('/docs/openapi/vendor-integration.openapi.yaml')?.handler({}, reply);

    const yaml = String(reply.payload);
    const bannedExamples = [
      /sporjinal/i,
      /yalispor/i,
      /entegra/i,
      /ayensoftware/i,
      /paytr/i,
      /yurtiçi/i,
      /yurtici/i,
    ];

    for (const bannedExample of bannedExamples) {
      expect(yaml).not.toMatch(bannedExample);
    }
    expect(yaml).toContain('alloc-vendor-demo-1001');
    expect(yaml).toContain('vendorIdentifier: vendor-demo');
    expect(yaml).toContain('originalVendorIdentifier: vendor-demo');
    expect(yaml).toContain('paymentGatewayName: Marketplace Payment');
  });

  it('does not change registered provider-facing vendor integration routes', () => {
    const { app, gets, posts } = createAppStub();
    registerVendorIntegrationRoutes(app as never);

    expect([...gets.keys()].filter((path) => path.startsWith('/api/vendor-integration'))).toEqual([
      '/api/vendor-integration/orders',
    ]);
    expect([...posts.keys()].filter((path) => path.startsWith('/api/vendor-integration'))).toEqual([
      '/api/vendor-integration/orders/:allocationId/status',
      '/api/vendor-integration/orders/:allocationId/shipment',
      '/api/vendor-integration/orders/:allocationId/invoice',
    ]);
  });
});
