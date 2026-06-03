import { prisma } from '../../db/prisma.js';
import { classifyPasswordHashScheme, type PasswordHashScheme } from './password-hashing.js';

export type AuthHashReport = {
  userCount: number;
  schemes: Record<PasswordHashScheme, number>;
};

export function buildAuthHashReport(users: Array<{ passwordHash: string }>): AuthHashReport {
  const schemes: Record<PasswordHashScheme, number> = {
    argon2id: 0,
    demo_sha256_v1: 0,
    bcrypt: 0,
    other: 0,
  };

  for (const user of users) {
    schemes[classifyPasswordHashScheme(user.passwordHash)] += 1;
  }

  return {
    userCount: users.length,
    schemes,
  };
}

export async function runAuthHashReportCli(log: (message: string) => void = console.log) {
  const users = await prisma.user.findMany({
    select: {
      passwordHash: true,
    },
  });

  log(JSON.stringify(buildAuthHashReport(users), null, 2));
}
