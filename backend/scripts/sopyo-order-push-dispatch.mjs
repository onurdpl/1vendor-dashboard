#!/usr/bin/env node

import { prisma } from '../dist/db/prisma.js';
import { dispatchSopyoOrderPush } from '../dist/modules/vendor-integration/sopyo-order-push-dispatch.service.js';

async function main() {
  const pushId = process.env.SOPYO_PUSH_ID?.trim();
  if (!pushId || !/^c[a-z0-9]{20,40}$/.test(pushId)) throw new Error('PUSH_ID_REQUIRED');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_MISSING');
  if (process.env.SOPYO_PUSH_RECONCILE_ONLY && process.env.SOPYO_PUSH_RECONCILE_ONLY !== '1') {
    throw new Error('INVALID_RECONCILE_MODE');
  }
  const result = await dispatchSopyoOrderPush({
    pushId, reconcileOnly: process.env.SOPYO_PUSH_RECONCILE_ONLY === '1',
  });
  process.stdout.write(`${JSON.stringify({ SOPYO_PUSH_DISPATCH: result.status, ...result })}\n`);
  if (result.status !== 'SUCCEEDED') process.exitCode = 1;
}

try {
  await main();
} catch {
  // Never print provider exceptions, request/response bodies, payloads, or credentials.
  process.stderr.write('SOPYO_PUSH_DISPATCH = FAILED (SAFE_ERROR)\n');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
