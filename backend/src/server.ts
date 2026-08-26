import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { registerGracefulShutdownHandlers } from './runtime/graceful-shutdown.js';

async function startServer() {
  const env = loadEnv();
  const app = createApp();
  const shutdown = registerGracefulShutdownHandlers({ app });

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (error) {
    shutdown.dispose();
    app.log.error(error);
    process.exit(1);
  }
}

void startServer();
