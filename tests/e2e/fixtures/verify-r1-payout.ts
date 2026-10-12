import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const target = databaseUrl ? new URL(databaseUrl) : null;
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || !target ||
    target.hostname !== '127.0.0.1' || !target.port ||
    !/^\/vendor_dashboard_browser_smoke_r1_[0-9]+$/.test(target.pathname)) {
  throw new Error('R1 browser post-check requires its dedicated disposable database.');
}
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
try {
  await db.$connect();
  const [identity] = await db.$queryRaw<Array<{ version: string; name: string; owner: string; port: number }>>`
    SELECT current_setting('server_version_num') AS version, current_database() AS name,
      current_user AS owner, inet_server_port() AS port`;
  assert(Number(identity.version) >= 180000 && Number(identity.version) < 190000 &&
    identity.name === target.pathname.slice(1) && identity.owner === target.username &&
    identity.port === Number(target.port), 'R1 browser post-check database identity changed.');
  for (const scenario of [
    { name: 'positive', status: 'PAID', netMinor: 80000, offsetMinor: 20000, claimStatus: 'FINALIZED', remainingMinor: 0 },
    { name: 'cashless', status: 'CASHLESS_COMPLETED', netMinor: 0, offsetMinor: 440, claimStatus: 'FINALIZED', remainingMinor: 440 },
    { name: 'cancel', status: 'CANCELLED', netMinor: 80000, offsetMinor: 20000, claimStatus: 'RELEASED', remainingMinor: 20000 },
  ] as const) {
    const vendorId = `r1-browser-${scenario.name}`;
    const [batches, adjustments] = await Promise.all([
      db.payoutBatch.findMany({ where: { vendorId }, include: { lines: true,
        payoutOffsetClaims: { include: { events: true } } } }),
      db.settlementRefundAdjustment.findMany({ where: { vendorId } }),
    ]);
    assert(batches.length === 1 && adjustments.length === 1,
      `${scenario.name}: expected one exact payout and refund obligation.`);
    const batch = batches[0]!;
    const adjustment = adjustments[0]!;
    assert(batch.status === scenario.status && Math.round(Number(batch.netAmount) * 100) === scenario.netMinor &&
      batch.r1OffsetTotalMinor === scenario.offsetMinor, `${scenario.name}: frozen payout money changed.`);
    assert(batch.lines.length === 1 &&
      batch.lines[0]?.financeLedgerEntryId === `${vendorId}-payable-sale`,
    `${scenario.name}: exact SALE lineage changed.`);
    assert(batch.payoutOffsetClaims.length === 1 &&
      batch.payoutOffsetClaims[0]?.status === scenario.claimStatus &&
      batch.payoutOffsetClaims[0]?.settlementRefundAdjustmentId === adjustment.id,
    `${scenario.name}: claim identity or state changed.`);
    assert(adjustment.remainingAmountMinor === scenario.remainingMinor,
      `${scenario.name}: remaining obligation changed.`);
    if (scenario.name === 'positive') {
      assert(batch.eftAmountMinor === 80000 && batch.eftExecutedAt && batch.paidAt,
        'Positive payout lacks exact external EFT attestation.');
    } else {
      assert(!batch.eftExecutedAt && !batch.paidAt && !batch.paymentReference,
        `${scenario.name}: forbidden bank payment evidence appeared.`);
    }
    if (scenario.name === 'cashless') {
      assert(await db.payoutR1CashlessCompletion.count({ where: { payoutBatchId: batch.id } }) === 1,
        'Cashless completion audit missing or duplicated.');
    }
    if (scenario.name === 'cancel') {
      assert(await db.payoutR1ReviewCancellationAttestation.count({ where: { payoutBatchId: batch.id } }) === 1,
        'No-EFT cancellation attestation missing or duplicated.');
    }
  }
  console.log('R1 browser PostgreSQL post-check passed: PAID 80000/20000, CASHLESS 0/440, CANCELLED RELEASED 20000.');
} finally {
  await db.$disconnect();
}
