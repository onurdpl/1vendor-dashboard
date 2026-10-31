import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';
import { upsertSeedUser } from '../../../backend/prisma/seed-user-utils.js';
import { writeFile } from 'node:fs/promises';
const target=new URL(process.env.DATABASE_URL || 'file:invalid');
if(process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB!=='1'||!['localhost','127.0.0.1'].includes(target.hostname)||!/^\/vendor_dashboard_browser_smoke_\d+_\d+$/.test(target.pathname)||!/^[a-f0-9]{64}$/.test(process.env.FIN03_DB_PROOF||''))throw Error('Unverified 005C fixture target');
const db=new PrismaClient();
try {
 const [identity]=await db.$queryRawUnsafe<any[]>(`SELECT current_setting('server_version_num')::int/10000 AS major,(pg_control_system()).system_identifier::text AS cluster,current_user AS owner,pg_get_userbyid(datdba) AS "databaseOwner",shobj_description(oid,'pg_database') AS proof FROM pg_database WHERE datname=current_database()`);
 if(identity.major!==18||identity.cluster!==process.env.FIN03_CLUSTER_ID||identity.owner!==identity.databaseOwner||identity.proof!==`fin03-history:${process.env.FIN03_DB_PROOF}`)throw Error('005C identity mismatch');
 if(await db.user.count()||await db.vendor.count()||await db.settlementApproval.count())throw Error('005C requires empty DB');
 const vendors=[{id:'cancel-a',name:'005C Yalıspor'},{id:'cancel-b',name:'005C Sporjinal'}];
 await db.vendor.createMany({data:vendors});
 const admin=await upsertSeedUser(db,{email:'admin@demo.com',name:'005C Admin',role:'ADMIN',vendorIds:vendors.map(v=>v.id)});
 for(const v of vendors)await db.vendorFinancialProfile.create({data:{vendorId:v.id,settlementDelayDays:0,settlementFrequencyType:'WEEKLY',weeklySettlementDay:'WEDNESDAY',autoSettlementDraftEnabled:false}});
 for(const [id,vendorId] of [['eligible','cancel-a'],['transport','cancel-a'],['stale','cancel-a'],['blocked','cancel-a'],['unknown','cancel-a'],['other','cancel-b'],['recheck','cancel-a']]){
  await db.settlementApproval.create({data:{id:'005c-'+id,vendorId,status:'DRAFT',currency:'TRY',grossSalesMinor:0,refundTotalMinor:0,commissionMinor:0,commissionVatMinor:0,netPayableMinor:0,sourceSnapshotJson:{fixture:'005c'}}});
 }
 // Existing cancellation guard blocks a DRAFT with an active invoice, as in 005B.
 await db.settlementCommissionInvoice.create({data:{settlementApprovalId:'005c-blocked',vendorId:'cancel-a',provider:'LOGO_ISBASI',status:'PENDING'}});
 // Existing 005B legacy NULL-lineage inconsistent-amount pattern; synthetic local evidence only.
 await db.financeLedgerEntry.create({data:{id:'005c-ledger',vendorId:'cancel-a',entryType:'sale',amount:'100.00'}});
 await db.settlementApproval.update({where:{id:'005c-unknown'},data:{status:'APPROVED',approvedAt:new Date(),approvedBy:admin.id,grossSalesMinor:10000,netPayableMinor:10000}});
 await db.settlementApprovalLine.create({data:{id:'005c-line',settlementApprovalId:'005c-unknown',financeLedgerEntryId:'005c-ledger',lineType:'SALE',amountMinor:10000,commissionMinor:0,commissionVatMinor:0,payableImpactMinor:10000,sourceSnapshotJson:{fixture:'005c'}}});
 await db.payoutBatch.create({data:{id:'005c-paid',vendorId:'cancel-a',status:'PAID',currency:'TRY',grossAmount:'100.00',netAmount:'100.00',lines:{create:{id:'005c-paid-line',financeLedgerEntryId:'005c-ledger',settlementApprovalLineId:null,amountSnapshot:'99.00'}}}});
 for(let i=0;i<21;i++)await db.settlementApproval.create({data:{id:`005c-history-${i}`,vendorId:'cancel-b',status:'DRAFT',grossSalesMinor:0,refundTotalMinor:0,commissionMinor:0,commissionVatMinor:0,netPayableMinor:0,createdAt:new Date(Date.UTC(2026,0,1,0,0,-i)),sourceSnapshotJson:{fixture:'005c-history'}}});
 const tables=['SettlementApproval','SettlementApprovalLine','PayoutBatch','PayoutBatchLine','FinanceLedgerEntry','SettlementCommissionInvoice','SettlementRefundAdjustment','FinancialCorrectionAuthority','VendorBalanceEvent'];
 const snapshot:Record<string,unknown>={};for(const table of tables)snapshot[table]=await db.$queryRawUnsafe(`SELECT * FROM "${table}" ORDER BY id`);
 await writeFile(process.env.BROWSER_SMOKE_EVIDENCE_PATH!,JSON.stringify({identity,adminId:admin.id,tables,snapshot},(_,v)=>typeof v==='bigint'?v.toString():v));
 console.log('005C fixture verified: two Vendors, eligible/blocked/unknown/history targets; isolated synthetic finance only.');
}finally{await db.$disconnect();}
