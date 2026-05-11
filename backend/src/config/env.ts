type NodeEnv = 'development' | 'test' | 'production';

export type AppEnv = {
  NODE_ENV: NodeEnv;
  PORT: number;
  DATABASE_URL?: string;
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
  return {
    NODE_ENV: normalizeNodeEnv(process.env.NODE_ENV),
    PORT: parsePort(process.env.PORT),
    DATABASE_URL: process.env.DATABASE_URL || undefined,
  };
}

