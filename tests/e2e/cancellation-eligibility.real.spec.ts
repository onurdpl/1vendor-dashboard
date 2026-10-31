import { expect, test, type Page } from './fixtures/browser-egress-guard';
import { readFile, appendFile } from 'node:fs/promises';
const root='http://localhost:4000/admin/finance/settlement-approvals';
const path='/admin/finance/settlement-approvals';
const endpoint=(id:string,vendor='cancel-a')=>`${root}/${id}/cancellation-eligibility?vendorId=${vendor}`;
let posts:string[]=[];let gets:Array<{url:string;status:number;body:any}>=[];
const panel=(page:Page)=>page.getByLabel('Settlement review detail panel');
async function vendor(page:Page,id:string){await page.getByRole('combobox',{name:'Select vendor',exact:true}).selectOption(id);}
async function open(page:Page,id:string){await page.goto(path+'?approvalId='+id);await expect(panel(page)).toContainText(id);}
test.beforeEach(async({page})=>{
 posts=[];gets=[];
 page.on('request',r=>{if(r.method()==='POST'&&/\/settlement-approvals\/[^/]+\/cancel$/.test(new URL(r.url()).pathname))posts.push(new URL(r.url()).pathname);});
 page.on('response',async r=>{if(r.url().includes('/cancellation-eligibility')){try{gets.push({url:r.url(),status:r.status(),body:await r.json()});}catch{}}});
 await page.goto('/login');await page.getByLabel('Email').fill('admin@demo.com');await page.getByLabel('Password').fill('demo123');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/\/login/);
 await page.getByRole('button',{name:/005C.*Admin view/}).click();await page.getByRole('menu',{name:'Account menu'}).getByLabel('Workspace',{exact:true}).selectOption('admin');await page.goto(path);await vendor(page,'cancel-a');
});
test.afterEach(async({},info)=>{await appendFile(process.env.BROWSER_SMOKE_EVIDENCE_PATH!+'.network.jsonl',JSON.stringify({test:info.title,status:info.status,posts,eligibility:gets})+'\n');expect(posts).toEqual(info.title.startsWith('6 ') ? [ '/admin/finance/settlement-approvals/005c-eligible/cancel' ]:[]);});
test('1 real blocked and unknown evidence disables Cancel; history remains read-only',async({page})=>{
 for(const [id,state,reason,text] of [['005c-blocked','blocked','ACTIVE_COMMISSION_INVOICE','Cancellation unavailable: an active commission invoice exists.'],['005c-unknown','unknown','LEGACY_LINEAGE_INCONSISTENT','Cancellation cannot be verified because historical payout records require financial review.']]){
  await open(page,id);await expect(panel(page).getByText(text,{exact:true})).toBeVisible();await expect(panel(page).getByRole('button',{name:'Cancel Settlement',exact:true})).toBeDisabled();
  const response=await page.request.get(endpoint(id));expect(response.status()).toBe(200);expect(await response.json()).toMatchObject({writesPerformed:false,settlementApprovalId:id,vendorId:'cancel-a',state,reason});
 }
 await vendor(page,'cancel-b');await open(page,'005c-history-20');await expect(panel(page)).toContainText('This record is read-only under the current action-authority data.');await expect(panel(page).getByRole('button',{name:'Cancel Settlement',exact:true})).toHaveCount(0);expect(gets.some(r=>r.url.includes('005c-history-20/cancellation-eligibility'))).toBe(false);
});
test('2 simulated transport failure fails closed; Retry uses real eligibility',async({page})=>{
 await page.route(endpoint('005c-transport'),r=>r.abort('failed'),{times:1});await open(page,'005c-transport');
 await expect(panel(page)).toContainText('Cancellation eligibility could not be verified. No cancellation was performed.');await expect(panel(page).getByRole('button',{name:'Cancel Settlement',exact:true})).toBeDisabled();await panel(page).getByRole('button',{name:'Retry',exact:true}).click();await expect(panel(page).getByRole('button',{name:'Cancel Settlement',exact:true})).toBeEnabled();expect(gets.some(r=>r.body.settlementApprovalId==='005c-transport'&&r.body.state==='eligible')).toBe(true);
});
test('3 genuine foreign eligibility response cannot authorize selected settlement',async({page})=>{
 await page.route(endpoint('005c-transport'),async route=>{const response=await route.fetch({url:endpoint('005c-other','cancel-b')});expect(await response.json()).toMatchObject({settlementApprovalId:'005c-other',vendorId:'cancel-b',state:'eligible'});await route.fulfill({response});});
 await open(page,'005c-transport');await expect(panel(page)).toContainText('Cancellation eligibility response did not match the selected settlement.');await expect(panel(page).getByRole('button',{name:'Cancel Settlement',exact:true})).toBeDisabled();
});
test('4 delayed real response cannot restore prior Vendor or settlement',async({page})=>{
 let release!:()=>void;const held=new Promise<void>(r=>release=r);let fetched!:()=>void;const ready=new Promise<void>(r=>fetched=r);let completed!:()=>void;const finished=new Promise<void>(r=>completed=r);
 await page.route(endpoint('005c-stale'),async route=>{const response=await route.fetch();expect(await response.json()).toMatchObject({settlementApprovalId:'005c-stale',vendorId:'cancel-a',state:'eligible'});fetched();await held;await route.fulfill({response}).catch(()=>{});completed();});
 await open(page,'005c-stale');await ready;await vendor(page,'cancel-b');await page.locator('.settlement-review-table .op-table-row').first().click();await expect(panel(page)).toContainText('005c-other');await expect(panel(page).getByRole('button',{name:'Cancel Settlement',exact:true})).toBeEnabled();release();await finished;await expect(panel(page)).toContainText('005c-other');await expect(panel(page)).not.toContainText('005c-stale');await expect(panel(page)).not.toContainText('Cancellation eligibility response did not match');
});
test('5 late real response from old selection cannot enable blocked current target',async({page})=>{
 let release!:()=>void;const held=new Promise<void>(r=>release=r);let fetched!:()=>void;const ready=new Promise<void>(r=>fetched=r);let completed!:()=>void;const finished=new Promise<void>(r=>completed=r);
 await page.route(endpoint('005c-stale'),async route=>{const response=await route.fetch();fetched();await held;await route.fulfill({response}).catch(()=>{});completed();});
 await open(page,'005c-stale');await ready;await page.getByPlaceholder('Vendor, settlement, status').fill('005c-blocked');await expect(page.locator('.settlement-review-table .op-table-row')).toHaveCount(1);await page.locator('.settlement-review-table .op-table-row').click();await expect(panel(page)).toContainText('Cancellation unavailable: an active commission invoice exists.');release();await finished;await expect(panel(page).getByRole('button',{name:'Cancel Settlement',exact:true})).toBeDisabled();await expect(panel(page)).toContainText('005c-blocked');
});
test('6 real eligibility, canonical GET, revalidation and exact single Cancel POST',async({page})=>{
 const timeline:string[]=[];page.on('request',r=>{if(r.url().startsWith(root+'/005c-eligible'))timeline.push(r.method()+' '+new URL(r.url()).pathname);});
 let release!:()=>void;const held=new Promise<void>(r=>release=r);let fetched!:()=>void;const ready=new Promise<void>(r=>fetched=r);
 await page.route(endpoint('005c-eligible'),async route=>{const response=await route.fetch();expect(await response.json()).toMatchObject({writesPerformed:false,settlementApprovalId:'005c-eligible',vendorId:'cancel-a',settlementStatus:'draft',state:'eligible',reason:null});fetched();await held;await route.fulfill({response});},{times:1});
 await open(page,'005c-eligible');await ready;await expect(panel(page).getByRole('button',{name:'Cancel Settlement',exact:true})).toBeDisabled();await expect(page.getByRole('dialog')).toHaveCount(0);release();await expect(panel(page).getByRole('button',{name:'Cancel Settlement',exact:true})).toBeEnabled();await panel(page).getByRole('button',{name:'Cancel Settlement',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Vendor: cancel-a');await expect(dialog).toContainText('Settlement: 005c-eligible');
 const before=timeline.length;const done=page.waitForResponse(r=>r.request().method()==='POST'&&r.url()===root+'/005c-eligible/cancel');await dialog.getByRole('button',{name:'Cancel Settlement',exact:true}).evaluate((el:HTMLButtonElement)=>{el.click();el.click();});expect((await done).status()).toBe(200);await expect(page.getByText('Settlement cancelled.',{exact:true})).toBeVisible();
 const post=timeline.indexOf('POST /admin/finance/settlement-approvals/005c-eligible/cancel',before);const detail=timeline.indexOf('GET /admin/finance/settlement-approvals/005c-eligible',before);const recheck=timeline.indexOf('GET /admin/finance/settlement-approvals/005c-eligible/cancellation-eligibility',before);expect(detail).toBeGreaterThanOrEqual(before);expect(recheck).toBeGreaterThan(detail);expect(post).toBeGreaterThan(recheck);
 expect(await(await page.request.get(root+'/005c-eligible')).json()).toMatchObject({id:'005c-eligible',vendorId:'cancel-a',status:'cancelled'});
});
