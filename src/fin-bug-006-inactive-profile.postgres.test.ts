import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('FIN-BUG-006 inactive profile preservation with isolated PostgreSQL', () => {
  let db: PrismaClient;
  let getAdminProfile: typeof import('../backend/src/modules/finance/finance.service.js')['getAdminVendorFinancialProfile'];
  let getVendorProfile: typeof import('../backend/src/modules/finance/finance.service.js')['getVendorFinancialProfile'];
  let saveProfile: typeof import('../backend/src/modules/finance/finance.service.js')['upsertVendorFinancialProfile'];
  let scheduleDryRun: typeof import('../backend/src/modules/finance/settlement-schedule.service.js')['getSettlementScheduleDryRun'];
  let vendorId: string;
  let sequence = 0;

  beforeEach(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.FIN_BUG_006_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'fin_bug_006_validation') {
      throw new Error('FIN-BUG-006 PostgreSQL test requires isolated local fin_bug_006_validation.');
    }
    process.env.DATABASE_URL = databaseUrl;
    ({ getAdminVendorFinancialProfile: getAdminProfile, getVendorFinancialProfile: getVendorProfile,
      upsertVendorFinancialProfile: saveProfile } =
      await import('../backend/src/modules/finance/finance.service.js'));
    ({ getSettlementScheduleDryRun: scheduleDryRun } =
      await import('../backend/src/modules/finance/settlement-schedule.service.js'));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    vendorId = `fin-bug-006-${process.pid}-${Date.now()}-${++sequence}`;
    await db.vendor.create({ data: { id: vendorId, name: 'Inactive Profile Test Vendor' } });
  });

  afterEach(async () => {
    if (!db) return;
    await db.vendorProfileAuditLog.deleteMany({ where: { vendorId } });
    await db.vendorFinancialProfile.deleteMany({ where: { vendorId } });
    await db.vendor.deleteMany({ where: { id: vendorId } });
    await db.$disconnect();
  });

  it('reads inactive policy through Admin, preserves it across edit and no-change save, and excludes it from scheduling', async () => {
    await db.vendorFinancialProfile.create({ data: {
      vendorId, active: false, commissionPercent: '17.00', commissionVatPercent: '8.00',
      settlementDelayDays: 35, settlementFrequencyType: 'WEEKLY', weeklySettlementDay: 'WEDNESDAY',
      autoSettlementDraftEnabled: true,
    } });

    expect(await getAdminProfile(vendorId)).toMatchObject({
      active: false, source: 'configured', commissionPercent: '17.00', settlementDelayDays: 35,
    });
    expect(await getVendorProfile(vendorId)).toMatchObject({ active: true, source: 'default' });

    await saveProfile(vendorId, { settlementDelayDays: 28 });
    let persisted = await db.vendorFinancialProfile.findUniqueOrThrow({ where: { vendorId } });
    expect(persisted).toMatchObject({ active: false, settlementDelayDays: 28,
      autoSettlementDraftEnabled: true });
    expect(persisted.commissionPercent.toString()).toBe('17');

    await saveProfile(vendorId, {});
    persisted = await db.vendorFinancialProfile.findUniqueOrThrow({ where: { vendorId } });
    expect(persisted).toMatchObject({ active: false, settlementDelayDays: 28 });
    expect(persisted.commissionPercent.toString()).toBe('17');
    expect((await scheduleDryRun({ vendorId, runDate: '2026-09-30' })).vendors).toHaveLength(0);
  });

  it('retains active updates, new-profile defaults, and explicit Admin active input', async () => {
    await saveProfile(vendorId, { commissionPercent: 12 });
    expect((await db.vendorFinancialProfile.findUniqueOrThrow({ where: { vendorId } })).active).toBe(true);

    await saveProfile(vendorId, { settlementDelayDays: 14 });
    expect((await db.vendorFinancialProfile.findUniqueOrThrow({ where: { vendorId } })).active).toBe(true);

    await saveProfile(vendorId, { active: false });
    expect((await db.vendorFinancialProfile.findUniqueOrThrow({ where: { vendorId } })).active).toBe(false);
    await saveProfile(vendorId, { active: true });
    expect((await db.vendorFinancialProfile.findUniqueOrThrow({ where: { vendorId } })).active).toBe(true);
  });
});
