#!/usr/bin/env node

import { prisma } from '../dist/db/prisma.js';
import { getDecryptedSopyoCredentialForInternalUse } from '../dist/modules/vendor-integration/sopyo-credential.service.js';
import { createSopyoDeliveryClient } from '../dist/modules/vendor-integration/sopyo-delivery.client.js';

async function main() {
  const pushId = process.env.SOPYO_PUSH_ID?.trim();
  if (!pushId || !/^c[a-z0-9]{20,40}$/.test(pushId)) throw new Error('PUSH_ID_REQUIRED');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_MISSING');
  const push = await prisma.sopyoOrderPush.findUnique({
    where: { id: pushId },
    select: {
      vendorAllocationId: true, assignedVendorId: true, orderCode: true,
      status: true, sopyoOrderId: true,
      vendorAllocation: { select: {
        id: true, assignedVendorId: true, outboundMethodSnapshot: true,
        outboundIntegrationProviderSnapshot: true,
      } },
    },
  });
  if (!push || push.status !== 'SUCCEEDED' || !push.sopyoOrderId ||
      !/^[1-9]\d{0,15}$/.test(push.sopyoOrderId) ||
      !Number.isSafeInteger(Number(push.sopyoOrderId)) ||
      String(Number(push.sopyoOrderId)) !== push.sopyoOrderId ||
      push.vendorAllocationId !== push.vendorAllocation.id ||
      push.assignedVendorId !== push.vendorAllocation.assignedVendorId ||
      push.orderCode !== push.vendorAllocation.id ||
      push.vendorAllocation.outboundMethodSnapshot !== 'VENDOR_INTEGRATION' ||
      push.vendorAllocation.outboundIntegrationProviderSnapshot !== 'SOPYO') {
    throw new Error('PUSH_IDENTITY_INVALID');
  }
  const apiToken = await getDecryptedSopyoCredentialForInternalUse(push.assignedVendorId);
  const client = createSopyoDeliveryClient();
  const bearer = await client.authenticate(apiToken);
  const detail = await client.orderById(bearer, push.sopyoOrderId);
  if (String(detail.id) !== push.sopyoOrderId || detail.orderCode !== push.orderCode ||
      detail.orderType !== 'SOPYOAPI') throw new Error('PROVIDER_IDENTITY_MISMATCH');
  process.stdout.write(`${JSON.stringify({
    id: detail.id, orderCode: detail.orderCode,
    orderType: detail.orderType, orderStatus: detail.orderStatus,
  })}\n`);
}

try {
  await main();
} catch {
  // Never print provider errors, URLs, credentials, tokens, or raw order data.
  process.stderr.write('SOPYO_ORDER_DETAIL_READ = FAILED (SAFE_ERROR)\n');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
