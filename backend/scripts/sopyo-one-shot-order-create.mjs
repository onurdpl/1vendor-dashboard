#!/usr/bin/env node

import { prisma } from '../dist/db/prisma.js';
import { runSopyoOneShotOrderCreateTest } from '../dist/modules/vendor-integration/sopyo-one-shot-order-create.service.js';

const ALLOWED_ALLOCATION_ID = 'alloc-yalispor-8256823525713';

async function main() {
  if (process.env.TEST_ALLOCATION_ID !== ALLOWED_ALLOCATION_ID) {
    throw new Error('TEST_ALLOCATION_ID_NOT_ALLOWLISTED');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_MISSING');
  const result = await runSopyoOneShotOrderCreateTest({
    allocationId: ALLOWED_ALLOCATION_ID,
    expectedVendorId: 'yalispor',
    onPreSend: (safe) => {
      process.stdout.write(`${JSON.stringify({ SOPYO_CREATE_TEST_PRE_SEND: safe })}\n`);
    },
  });
  process.stdout.write(`${JSON.stringify({ SOPYO_CREATE_TEST: result.status, ...result })}\n`);
  if (!['SUCCESS', 'ALREADY_EXISTS', 'FOUND_AFTER_AMBIGUOUS_POST'].includes(result.status)) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  // Never print provider errors, raw payloads, customer data, or credentials.
  const safeCode = error && typeof error === 'object' && 'code' in error &&
    typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code)
    ? error.code : 'ONE_SHOT_FAILED';
  process.stderr.write(`SOPYO_CREATE_TEST = BLOCKED (${safeCode})\n`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
