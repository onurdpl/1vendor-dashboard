import type { FastifyReply, FastifyRequest } from 'fastify';
import { withDashboardTiming } from '../../lib/dashboard-timing.js';
import { resolveRequestVendorContext } from './vendor-access.service.js';

export async function requireVendorAccess(request: FastifyRequest, reply: FastifyReply) {
  return withDashboardTiming('auth.vendor_context_validation', async () => {
  if (!request.authUser) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }

  const result = await resolveRequestVendorContext(request.authUser, request.headers['x-vendor-id']);

  if (!result.ok) {
    return reply.code(result.code).send({ message: result.message });
  }

  request.vendorContext = result.context;
  });
}
