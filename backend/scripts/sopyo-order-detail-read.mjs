#!/usr/bin/env node

import { prisma } from '../dist/db/prisma.js';
import { readSopyoOrderDetailDiagnostic } from '../dist/modules/vendor-integration/sopyo-order-detail-diagnostic.service.js';

async function main() {
  const result = await readSopyoOrderDetailDiagnostic({
    pushId: process.env.SOPYO_PUSH_ID,
    databaseUrl: process.env.DATABASE_URL,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if ('SOPYO_ORDER_DETAIL_READ' in result) process.exitCode = 1;
}

try {
  await main();
} catch {
  // Never print arbitrary exceptions, provider data, credentials, or tokens.
  process.stderr.write('{"SOPYO_ORDER_DETAIL_READ":"FAILED","reason":"UNKNOWN","stage":"OUTPUT"}\n');
  process.exitCode = 1;
} finally {
  try {
    await prisma.$disconnect();
  } catch {
    process.exitCode = 1;
  }
}
