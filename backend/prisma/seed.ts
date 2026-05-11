import { createHash } from 'node:crypto';
import { prisma } from '../src/db/prisma.js';

type SeedUserInput = {
  email: string;
  name: string;
  role: 'ADMIN' | 'VENDOR';
  vendorIds: string[];
};

type SeedVendorInput = {
  id: string;
  name: string;
  status: string;
};

const vendors: SeedVendorInput[] = [
  { id: 'yalispor', name: 'Yalı Spor', status: 'active' },
  { id: 'sporjinal', name: 'Sporjinal', status: 'active' },
  { id: 'sporvol', name: 'Sporvol', status: 'active' },
];

const users: SeedUserInput[] = [
  {
    email: 'admin@demo.com',
    name: 'Demo Admin',
    role: 'ADMIN',
    vendorIds: ['yalispor', 'sporjinal', 'sporvol'],
  },
  {
    email: 'yalispor@demo.com',
    name: 'Yalı Spor User',
    role: 'VENDOR',
    vendorIds: ['yalispor'],
  },
  {
    email: 'sporjinal@demo.com',
    name: 'Sporjinal User',
    role: 'VENDOR',
    vendorIds: ['sporjinal'],
  },
  {
    email: 'sporvol@demo.com',
    name: 'Sporvol User',
    role: 'VENDOR',
    vendorIds: ['sporvol'],
  },
];

function makeDemoPasswordHash(password: string) {
  // Demo-only deterministic hash. Not suitable for production auth storage.
  return `demo_sha256_v1:${createHash('sha256').update(`vendor-dashboard-demo:${password}`).digest('hex')}`;
}

async function runSeed() {
  for (const vendor of vendors) {
    await prisma.vendor.upsert({
      where: { id: vendor.id },
      update: { name: vendor.name, status: vendor.status },
      create: vendor,
    });
  }

  const demoPasswordHash = makeDemoPasswordHash('demo123');

  for (const user of users) {
    const createdOrUpdatedUser = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        role: user.role,
        status: 'active',
        passwordHash: demoPasswordHash,
      },
      create: {
        email: user.email,
        name: user.name,
        role: user.role,
        status: 'active',
        passwordHash: demoPasswordHash,
      },
    });

    await prisma.userVendorAccess.createMany({
      data: user.vendorIds.map((vendorId) => ({
        userId: createdOrUpdatedUser.id,
        vendorId,
      })),
      skipDuplicates: true,
    });
  }
}

runSeed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
