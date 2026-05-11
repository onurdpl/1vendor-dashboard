type NodeEnv = 'development' | 'test' | 'production';

export type AppEnv = {
  NODE_ENV: NodeEnv;
  PORT: number;
  DATABASE_URL?: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
};

function normalizeNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'production' || value === 'test') {
    return value;
  }

  return 'development';
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 4000;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Invalid PORT value. Expected a positive integer.');
  }

  return parsed;
}

export function loadEnv(): AppEnv {
  const nodeEnv = normalizeNodeEnv(process.env.NODE_ENV);
  const jwtSecret = process.env.JWT_SECRET || (nodeEnv !== 'production' ? 'dev-only-jwt-secret-change-in-production' : undefined);

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required in production.');
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: parsePort(process.env.PORT),
    DATABASE_URL: process.env.DATABASE_URL || undefined,
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '12h',
  };
}
