import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';
import { upsertSeedUser } from '../../../backend/prisma/seed-user-utils.js';

const url = new URL(process.env.DATABASE_URL ?? 'file:invalid');
const proof = process.env.AUTH_BROWSER_DB_PROOF ?? '';
if (process.env.AUTH_BROWSER_ALLOW_LOCAL_DB !== '1' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !/^\/vendor_dashboard_auth_browser_\d+_\d+$/.test(url.pathname) ||
    !/^[a-f0-9]{64}$/.test(proof)) {
  throw new Error('Unverified auth browser fixture target.');
}

const db = new PrismaClient();
try {
  const [identity] = await db.$queryRawUnsafe<Array<{
    major: number; cluster: string; owner: string; databaseOwner: string; proof: string | null;
  }>>(`SELECT current_setting('server_version_num')::int/10000 AS major,
    (pg_control_system()).system_identifier::text AS cluster,
    current_user AS owner, pg_get_userbyid(datdba) AS "databaseOwner",
    shobj_description(oid, 'pg_database') AS proof
    FROM pg_database WHERE datname = current_database()`);
  if (identity.major !== 18 || identity.cluster !== process.env.AUTH_BROWSER_CLUSTER_ID ||
      identity.owner !== identity.databaseOwner || identity.proof !== `auth-browser:${proof}`) {
    throw new Error('Auth browser fixture database identity mismatch.');
  }
  if (await db.user.count() || await db.vendor.count()) {
    throw new Error('Auth browser fixture requires an empty database.');
  }
  await db.vendor.createMany({ data: [
    { id: 'auth-browser-a', name: 'Auth Browser Vendor A' },
    { id: 'auth-browser-b', name: 'Auth Browser Vendor B' },
  ] });
  await upsertSeedUser(db, { email: 'auth-admin-a@demo.test', name: 'Auth Browser Admin A', role: 'ADMIN', vendorIds: ['auth-browser-a'] });
  await upsertSeedUser(db, { email: 'auth-vendor-b@demo.test', name: 'Auth Browser Vendor B User', role: 'VENDOR', vendorIds: ['auth-browser-b'] });
  console.log('Auth browser fixture verified: isolated PG18, two Vendors, two distinct users.');
} finally {
  await db.$disconnect();
}
