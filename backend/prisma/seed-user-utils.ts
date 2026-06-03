import { hashPasswordArgon2id } from '../src/modules/auth/password-hashing.js';

export type SeedUserInput = {
  email: string;
  name: string;
  role: 'ADMIN' | 'VENDOR';
  vendorIds: string[];
};

type SeedUserPrisma = {
  user: {
    upsert: (input: {
      where: { email: string };
      update: {
        name: string;
        role: SeedUserInput['role'];
        status: string;
      };
      create: {
        email: string;
        name: string;
        role: SeedUserInput['role'];
        status: string;
        passwordHash: string;
      };
    }) => Promise<{ id: string }>;
  };
  userVendorAccess: {
    createMany: (input: {
      data: Array<{
        userId: string;
        vendorId: string;
      }>;
      skipDuplicates: true;
    }) => Promise<unknown>;
  };
};

export async function upsertSeedUser(
  seedPrisma: SeedUserPrisma,
  user: SeedUserInput,
  options: { initialPassword?: string; hashPassword?: (password: string) => Promise<string> } = {},
) {
  const passwordHash = await (options.hashPassword ?? hashPasswordArgon2id)(options.initialPassword ?? 'demo123');
  const createdOrUpdatedUser = await seedPrisma.user.upsert({
    where: { email: user.email },
    update: {
      name: user.name,
      role: user.role,
      status: 'active',
    },
    create: {
      email: user.email,
      name: user.name,
      role: user.role,
      status: 'active',
      passwordHash,
    },
  });

  await seedPrisma.userVendorAccess.createMany({
    data: user.vendorIds.map((vendorId) => ({
      userId: createdOrUpdatedUser.id,
      vendorId,
    })),
    skipDuplicates: true,
  });

  return createdOrUpdatedUser;
}
