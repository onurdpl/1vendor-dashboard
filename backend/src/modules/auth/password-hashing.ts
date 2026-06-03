import { createHash } from 'node:crypto';
import argon2 from 'argon2';

const DEMO_HASH_PREFIX = 'demo_sha256_v1:';

export type PasswordHashScheme = 'argon2id' | 'demo_sha256_v1' | 'bcrypt' | 'other';

const ARGON2ID_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function makeDemoPasswordHash(password: string) {
  return `${DEMO_HASH_PREFIX}${createHash('sha256').update(`vendor-dashboard-demo:${password}`).digest('hex')}`;
}

export function classifyPasswordHashScheme(passwordHash: string | null | undefined): PasswordHashScheme {
  if (!passwordHash) {
    return 'other';
  }

  if (passwordHash.startsWith('$argon2id$')) {
    return 'argon2id';
  }

  if (passwordHash.startsWith(DEMO_HASH_PREFIX)) {
    return 'demo_sha256_v1';
  }

  if (/^\$2[aby]\$/.test(passwordHash)) {
    return 'bcrypt';
  }

  return 'other';
}

export async function hashPasswordArgon2id(password: string) {
  return argon2.hash(password, ARGON2ID_OPTIONS);
}

export async function verifyPasswordHash(passwordHash: string, password: string) {
  const scheme = classifyPasswordHashScheme(passwordHash);

  if (scheme === 'argon2id') {
    return {
      valid: await argon2.verify(passwordHash, password),
      scheme,
      needsMigration: false,
    };
  }

  if (scheme === 'demo_sha256_v1') {
    return {
      valid: passwordHash === makeDemoPasswordHash(password),
      scheme,
      needsMigration: true,
    };
  }

  return {
    valid: false,
    scheme,
    needsMigration: false,
  };
}
