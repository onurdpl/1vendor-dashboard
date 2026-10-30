import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';
import { upsertSeedUser } from '../../../backend/prisma/seed-user-utils.js';
import { writeFile } from 'node:fs/promises';
const target = new URL(process.env.DATABASE_URL || 'file:invalid');
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || !['localhost','127.0.0.1'].includes(target.hostname) ||
  !/^\/vendor_dashboard_browser_smoke_\d+_\d+$/.test(target.pathname) || !/^[a-f0-9]{64}$/.test(process.env.FIN03_DB_PROOF || '')) throw new Error('Unverified FIN03 fixture target');
const db = new PrismaClient();
try {
  const [identity] = await db.$queryRawUnsafe<any[]>(`SELECT current_setting('server_version_num')::int/10000 AS major,
    (pg_control_system()).system_identifier::text AS cluster,shobj_description(d.oid,'pg_database') AS proof,
    current_user AS owner,pg_get_userbyid(d.datdba) AS "databaseOwner" FROM pg_database d WHERE datname=current_database()`);
  if (identity.major !== 18 || identity.cluster !== process.env.FIN03_CLUSTER_ID || identity.owner !== identity.databaseOwner ||
    identity.proof !== `fin03-history:${process.env.FIN03_DB_PROOF}`) throw new Error('PG18 fixture identity failed');
  if (await db.vendor.count() || await db.user.count() || await db.settlementApproval.count()) throw new Error('Fixture requires empty database');
  const vendors = [{id:'fin03-a',name:'FIN03 Yalıspor İ'}, {id:'fin03-b',name:'FIN03 Sporjinal'}, {id:'fin03-action',name:'FIN03 Cancel Only'}];
  await db.vendor.createMany({data:vendors});
  for (const vendor of vendors) await db.vendorFinancialProfile.create({data:{vendorId:vendor.id,settlementDelayDays:0,settlementFrequencyType:'WEEKLY',weeklySettlementDay:'WEDNESDAY',autoSettlementDraftEnabled:false}});
  const admin = await upsertSeedUser(db,{email:'admin@demo.com',name:'FIN03 Admin',role:'ADMIN',vendorIds:vendors.map(v=>v.id)});
  await upsertSeedUser(db,{email:'vendor@demo.com',name:'FIN03 Vendor',role:'VENDOR',vendorIds:['fin03-a']});
  // Synthetic, read-only historical snapshots: no provider/payment/refund evidence is asserted.
  for (const [vendorId,size] of [['fin03-a',605],['fin03-b',27]] as const) {
    await db.settlementApproval.createMany({data:Array.from({length:size},(_,i)=>({
      id:`${vendorId}-${String(i).padStart(4,'0')}${i === 450 || i === 500 ? '-sparse_İ%_' : ''}`,
      vendorId,createdAt:new Date(Date.UTC(2026,7,31,0,0,-Math.floor(i/3))),
      status:(['DRAFT','APPROVED','CANCELLED'] as const)[i%3],currency:'TRY',
      grossSalesMinor:(vendorId==='fin03-b' ? 900000 : i>=400 ? 8000000 : 200000)+i,refundTotalMinor:0,commissionMinor:0,commissionVatMinor:0,netPayableMinor:(vendorId==='fin03-b' ? 900000 : i>=400 ? 8000000 : 200000)+i,
      approvedAt:i%3===1 ? new Date('2026-08-31T00:00:00Z') : null,approvedBy:i%3===1 ? admin.id : null,
      scheduledCycleKey:i===21 && vendorId==='fin03-a' ? `scheduled-settlement:${vendorId}:${process.env.BROWSER_SMOKE_RUN_DATE}` : i === 50 && vendorId==='fin03-a' ? 'all' : i === 430 ? `${vendorId}_élan_%_` : `${vendorId}_period_${i}`,
      sourceSnapshotJson:{fixture:'fin03-history',syntheticReadOnlyHistory:true},
    }))});
  }
  // Cancellation needs no fabricated SALE/delivery/payment evidence: this empty
  // DRAFT has no invoices, payouts, adjustments or correction claims. The real
  // cancellation service must revalidate all existing guards before changing it.
  await db.settlementApproval.createMany({data:Array.from({length:22},(_,i)=>({
    id:i===0 ? 'fin03-cancel-target' : i===1 ? 'fin03-cancel-reject' : `fin03-action-${i}`,
    vendorId:'fin03-action',status:i<2 ? 'DRAFT' as const : 'CANCELLED' as const,currency:'TRY',
    createdAt:new Date(Date.UTC(2026,8,30,0,0,-i)),scheduledCycleKey:`fin03-action-period-${i}`,
    grossSalesMinor:0,refundTotalMinor:0,commissionMinor:0,commissionVatMinor:0,netPayableMinor:0,
    sourceSnapshotJson:{fixture:'fin03-history',cancelOnly:true},
  }))});
  const searchTarget='fin03-a-0430';
  await db.financeLedgerEntry.createMany({data:Array.from({length:17},(_,i)=>({id:`fin03-zero-ledger-${i}`,vendorId:'fin03-a',entryType:'sale',amount:'0.00',description:'Read-only zero-value Search fixture'}))});
  await db.settlementApprovalLine.createMany({data:Array.from({length:17},(_,i)=>({id:`fin03-zero-line-${i}`,settlementApprovalId:searchTarget,financeLedgerEntryId:`fin03-zero-ledger-${i}`,lineType:'SALE',amountMinor:0,commissionMinor:0,commissionVatMinor:0,payableImpactMinor:0,sourceSnapshotJson:{fixture:'read-only-zero-search'}}))});
  // Read-only review fixtures, following the existing PostgreSQL review test pattern.
  // No scheduler, trusted approval service, refund offset or payment is invoked.
  const historyVendors=[{id:'fin03-evidence-a',name:'FIN03 History A'},{id:'fin03-evidence-b',name:'FIN03 History B'}];
  await db.vendor.createMany({data:historyVendors});
  await db.userVendorAccess.createMany({data:historyVendors.map(v=>({userId:admin.id,vendorId:v.id}))});
  const historyTargets=historyVendors.map(v=>({vendorId:v.id,settlementId:v.id+'-cancelled'}));
  for(const owner of historyTargets){
    await db.settlementApproval.create({data:{id:owner.settlementId,vendorId:owner.vendorId,status:'CANCELLED',grossSalesMinor:0,refundTotalMinor:0,commissionMinor:0,commissionVatMinor:0,netPayableMinor:0,cancelledFromStatus:'DRAFT',cancelledAt:new Date(),cancelledBy:admin.id,sourceSnapshotJson:{readOnlyHistoryFixture:true}}});
    for(let i=0;i<27;i++){
      const id=owner.vendorId+'-blocked-'+String(i).padStart(2,'0');
      await db.settlementAutoApprovalAttempt.create({data:{id,vendorId:owner.vendorId,settlementApprovalId:owner.settlementId,outcome:'BLOCKED',reasonCode:'SETTLEMENT_CANCELLED',completedAt:new Date(),events:{create:[{outcome:'STARTED',reasonCode:'ATTEMPT_CREATED'},{outcome:'BLOCKED',reasonCode:'SETTLEMENT_CANCELLED'}]}}});
      const {recordAutoApprovalOperationalError}=await import('../../../backend/src/modules/finance/settlement-auto-approval-operational-error.service.js');
      await recordAutoApprovalOperationalError({vendorId:owner.vendorId,settlementApprovalId:owner.settlementId,attemptId:id,phase:'ATTEMPT_RECONCILIATION',category:'RECONCILIATION_FAILED',error:new TypeError('Disposable review fixture')});
    }
  }
  const unknownId='fin03-evidence-a-unknown',observedAt=new Date();
  await db.settlementAutoApprovalAttempt.create({data:{id:unknownId,vendorId:historyTargets[0].vendorId,settlementApprovalId:historyTargets[0].settlementId,createdAt:observedAt,outcome:'UNKNOWN',reasonCode:'UNCLASSIFIED_FAILURE',events:{create:Array.from({length:51},(_,i)=>({id:'fin03-review-event-'+String(i).padStart(2,'0'),outcome:'UNKNOWN' as const,reasonCode:'UNCLASSIFIED_FAILURE',createdAt:observedAt}))}}});
  // Archived technical observations exercise event pagination, not financial authority.
  const extra={vendors:historyVendors,historyTargets,unknownId,snapshot:JSON.parse(JSON.stringify({
    payouts:await db.payoutBatch.findMany({orderBy:{id:'asc'},include:{lines:{orderBy:{id:'asc'}},payoutOffsetClaims:{orderBy:{id:'asc'}}}}),
    attempts:await db.settlementAutoApprovalAttempt.findMany({orderBy:{id:'asc'}}),
    events:await db.settlementAutoApprovalAttemptEvent.findMany({orderBy:{id:'asc'}}),
    operational:await db.settlementAutoApprovalOperationalError.findMany({orderBy:{id:'asc'}}),
    adjustments:await db.settlementRefundAdjustment.findMany({orderBy:{id:'asc'}}),
    claimEvents:await db.payoutOffsetClaimEvent.findMany({orderBy:{id:'asc'}}),
    refundSnapshots:await db.refundEvidenceSnapshot.findMany({orderBy:{id:'asc'}}),
    invoices:await db.settlementCommissionInvoice.findMany({orderBy:{id:'asc'}}),
  }))};
  const {prisma}=await import('../../../backend/src/db/prisma.js');await prisma.$disconnect();
  const approvals = await db.settlementApproval.findMany({orderBy:[{createdAt:'desc'},{id:'desc'}]});
  const lines=await db.settlementApprovalLine.findMany({orderBy:{id:'asc'}});
  const ledgers=await db.financeLedgerEntry.findMany({orderBy:{id:'asc'}});
  const counts = {payouts:await db.payoutBatch.count(),invoices:await db.settlementCommissionInvoice.count(),
    ledgers:await db.financeLedgerEntry.count(),attempts:await db.settlementAutoApprovalAttempt.count(),
    adjustments:await db.settlementRefundAdjustment.count()};
  await writeFile(process.env.BROWSER_SMOKE_EVIDENCE_PATH!,JSON.stringify({identity,vendors:[...vendors,...extra.vendors],extra,adminId:admin.id,approvals,lines,ledgers,counts,runDate:process.env.BROWSER_SMOKE_RUN_DATE}));
  console.log('FIN03 fixture: PG18; original605 A /27 B /22 cancel-only records retained; read-only attempt/event/operational fixtures, zero payouts; no provider calls.');
} finally {await db.$disconnect();}
