import Fastify from 'fastify';
import { loadEnv } from './config/env.js';

export function createApp() {
  const env = loadEnv();
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
  });

  app.get('/health', async () => {
    return { ok: true };
  });

  app.get('/version', async () => {
    return {
      service: 'vendor-dashboard-backend',
      version: '0.1.0',
      nodeEnv: env.NODE_ENV,
    };
  });

  return app;
}

