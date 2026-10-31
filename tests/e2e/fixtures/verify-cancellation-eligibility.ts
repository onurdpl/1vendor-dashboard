import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const target=new URL(process.env.DATABASE_URL||'file:invalid');
if(process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB!=='1'||!['localhost','127.0.0.1'].includes(target.hostname)||!/^\/vendor_dashboard_browser_smoke_\d+_\d+$/.test(target.pathname))throw Error('Unverified 005C verifier target');
const before=JSON.parse(await readFile(process.env.BROWSER_SMOKE_EVIDENCE_PATH!,'utf8'));const db=new PrismaClient();
try{
 const [identity]=await db.$queryRawUnsafe<any[]>(`SELECT current_setting('server_version_num')::int/10000 AS major,(pg_control_system()).system_identifier::text AS cluster,current_user AS owner,pg_get_userbyid(datdba) AS "databaseOwner",shobj_description(oid,'pg_database') AS proof FROM pg_database WHERE datname=current_database()`);assert.deepEqual(identity,before.identity);
 for(const table of before.tables){const rows=JSON.parse(JSON.stringify(await db.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY id`),(_,v)=>typeof v==='bigint'?v.toString():v));
  if(table==='SettlementApproval')for(const row of rows){const old=before.snapshot[table].find((r:any)=>r.id===row.id);if(row.id==='005c-eligible'&&row.status==='CANCELLED'){assert.equal(row.cancelledFromStatus,'DRAFT');assert.equal(row.cancelledBy,before.adminId);assert.ok(row.cancelledAt);assert.deepEqual(row,{...old,status:row.status,cancelledFromStatus:row.cancelledFromStatus,cancelledBy:row.cancelledBy,cancelledAt:row.cancelledAt,updatedAt:row.updatedAt});}else assert.deepEqual(row,old);}
  else assert.deepEqual(rows,before.snapshot[table]);
  assert.equal(rows.length,before.snapshot[table].length);
 }
 if(process.env.FIN03_BROWSER_PASSED==='1'){assert.equal((await db.settlementApproval.findUniqueOrThrow({where:{id:'005c-eligible'}})).status,'CANCELLED');const events=(await readFile(process.env.BROWSER_SMOKE_EVIDENCE_PATH!+'.network.jsonl','utf8')).trim().split('\n').map(s=>JSON.parse(s));assert.equal(events.length,6);assert.ok(events.every((e:any)=>e.status==='passed'));assert.deepEqual(events.flatMap((e:any)=>e.posts),['/admin/finance/settlement-approvals/005c-eligible/cancel']);}
 console.log('005C DB invariants verified: only exact eligible DRAFT cancellation allowed; payouts, ledger, invoices, balances and other settlements unchanged.');
}finally{await db.$disconnect();}
