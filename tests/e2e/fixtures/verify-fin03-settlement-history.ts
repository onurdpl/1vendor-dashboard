import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const target = new URL(process.env.DATABASE_URL || 'file:invalid');
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || !['localhost','127.0.0.1'].includes(target.hostname) ||
  !/^\/vendor_dashboard_browser_smoke_\d+_\d+$/.test(target.pathname)) throw new Error('Unverified FIN03 post-check target');
const before=JSON.parse(await readFile(process.env.BROWSER_SMOKE_EVIDENCE_PATH!,'utf8'));
const db=new PrismaClient();
try {
  const [identity]=await db.$queryRawUnsafe<any[]>(`SELECT current_setting('server_version_num')::int/10000 AS major,
    (pg_control_system()).system_identifier::text AS cluster,shobj_description(d.oid,'pg_database') AS proof,
    current_user AS owner,pg_get_userbyid(d.datdba) AS "databaseOwner" FROM pg_database d WHERE datname=current_database()`);
  assert.deepEqual(identity,before.identity);
  const after=JSON.parse(JSON.stringify(await db.settlementApproval.findMany({orderBy:[{createdAt:'desc'},{id:'desc'}]})));
  assert.equal(after.length,before.approvals.length);
  for(const row of after){
    const original=before.approvals.find((item:any)=>item.id===row.id);assert.ok(original);
    if(row.id==='fin03-cancel-target' && row.status==='CANCELLED'){
      assert.equal(row.status,'CANCELLED');assert.equal(row.cancelledFromStatus,'DRAFT');assert.equal(row.cancelledBy,before.adminId);
      assert.ok(row.cancelledAt);assert.ok(row.updatedAt);
      const expected={...original,status:row.status,cancelledFromStatus:row.cancelledFromStatus,cancelledBy:row.cancelledBy,cancelledAt:row.cancelledAt,updatedAt:row.updatedAt};
      assert.deepEqual(row,expected);
    } else assert.deepEqual(row,original);
  }
  if(process.env.FIN03_BROWSER_PASSED==='1') assert.equal(after.find((row:any)=>row.id==='fin03-cancel-target').status,'CANCELLED');
  const network=await readFile(process.env.BROWSER_SMOKE_EVIDENCE_PATH!+'.network.jsonl','utf8').catch(()=> '');
  const networkEvents=network.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  if(process.env.FIN03_BROWSER_PASSED==='1'){
    assert.equal(networkEvents.length,19);assert.equal(new Set(networkEvents.map((event:any)=>event.test)).size,19);
    assert.ok(networkEvents.every((event:any)=>event.status==='passed'));
    assert.equal(networkEvents.flatMap((event:any)=>event.posts).length,1);
  }
  assert.equal(before.counts.payouts,0);assert.equal(before.counts.invoices,0);assert.equal(before.counts.adjustments,0);
  for(const event of networkEvents){
    if(event.test.startsWith('E/I'))assert.ok(event.posts.length<=1 && event.posts.every((url:string)=>url==='/admin/finance/settlement-approvals/fin03-cancel-target/cancel'));
    else assert.deepEqual(event.posts,[]);
  }
  const immutableExtra = JSON.parse(JSON.stringify({
    payouts: await db.payoutBatch.findMany({ orderBy: { id: 'asc' }, include: { lines: { orderBy: { id: 'asc' } }, payoutOffsetClaims: { orderBy: { id: 'asc' } } } }),
    attempts: await db.settlementAutoApprovalAttempt.findMany({ orderBy: { id: 'asc' } }),
    events: await db.settlementAutoApprovalAttemptEvent.findMany({ orderBy: { id: 'asc' } }),
    operational: await db.settlementAutoApprovalOperationalError.findMany({ orderBy: { id: 'asc' } }),
    adjustments: await db.settlementRefundAdjustment.findMany({ orderBy: { id: 'asc' } }),
    claimEvents: await db.payoutOffsetClaimEvent.findMany({ orderBy: { id: 'asc' } }),
    refundSnapshots: await db.refundEvidenceSnapshot.findMany({ orderBy: { id: 'asc' } }),
    invoices: await db.settlementCommissionInvoice.findMany({ orderBy: { id: 'asc' } }),
  }));
  assert.deepEqual(immutableExtra,before.extra.snapshot);
  const counts={payouts:await db.payoutBatch.count(),invoices:await db.settlementCommissionInvoice.count(),
    ledgers:await db.financeLedgerEntry.count(),attempts:await db.settlementAutoApprovalAttempt.count(),adjustments:await db.settlementRefundAdjustment.count()};
  assert.deepEqual(counts,before.counts);
  assert.deepEqual(JSON.parse(JSON.stringify(await db.settlementApprovalLine.findMany({orderBy:{id:'asc'}}))),before.lines);
  assert.deepEqual(JSON.parse(JSON.stringify(await db.financeLedgerEntry.findMany({orderBy:{id:'asc'}}))),before.ledgers);
  assert.equal(await db.financialCorrectionCreditSettlementLine.count(),0);
  assert.equal(await db.financialCorrectionDeductionSettlementLine.count(),0);
  await writeFile(process.env.BROWSER_SMOKE_EVIDENCE_PATH!+'.post.json',JSON.stringify({verified:true,rows:after.length,unchangedHistorical:after.length-(after.find((row:any)=>row.id==='fin03-cancel-target').status==='CANCELLED'?1:0),onlyCancellation:after.find((row:any)=>row.id==='fin03-cancel-target').status==='CANCELLED'?'fin03-cancel-target':null,counts}));
  console.log('FIN03 DB post-check PASS: all non-target historical rows and complete payout/attempt/event/invoice snapshots unchanged; at most one exact audited cancellation; unchanged zero-value test ledgers/lines and no new payouts/invoices/refunds/attempts.');
} finally {await db.$disconnect();}
