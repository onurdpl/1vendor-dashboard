import type { CustomerAccountSession } from './customer-cancellation-session-token.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    customerAccountSession?: CustomerAccountSession;
  }
}

export type CustomerCancellationCreateBody = {
  shopifyOrderId?: string;
  items?: unknown;
  reasonCode?: string;
  note?: string | null;
  idempotencyKey?: string;
};
