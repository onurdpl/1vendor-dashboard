import { expect, test, type Page } from './fixtures/browser-egress-guard';
import { readFile, appendFile } from 'node:fs/promises';
import { settlementSummaryPeriodLabel, matchesSettlementSearch } from '../../backend/src/modules/finance/settlement-search-presentation';
const root='http://localhost:4000/admin/finance/settlement-approvals';
const path='/admin/finance/settlement-approvals';
const fixture=JSON.parse(await readFile(process.env.BROWSER_SMOKE_EVIDENCE_PATH!,'utf8'));
const a=fixture.approvals.filter((r:any)=>r.vendorId==='fin03-a');
const b=fixture.approvals.filter((r:any)=>r.vendorId==='fin03-b');
const rows=(page:Page)=>page.locator('.settlement-review-table .op-table-row');
const amount=(value:number)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100);
const summaries=(items:any[])=>items.map(r=>({...r,status:r.status.toLowerCase(),lineCount:fixture.lines.filter((line:any)=>line.settlementApprovalId===r.id).length}));
const requestLog:Array<{url:string;method:string;duration?:number}>=[];
let posts:string[]=[];
let expectedPosts=0;
async function vendor(page:Page,id:string){await page.getByRole('combobox',{name:'Select vendor',exact:true}).selectOption(id);await expect(page.getByLabel('Vendor',{exact:true})).toHaveValue(fixture.vendors.find((v:any)=>v.id===id).name);}
async function list(page:Page,query:Record<string,string>={}){
 const response=await page.request.get(`${root}?${new URLSearchParams({vendorId:'fin03-a',pagination:'cursor',limit:'20',...query})}`);
 expect(response.status()).toBe(200);return response.json();
}
async function visible(page:Page,items:any[]){
 await expect(rows(page)).toHaveCount(items.length);
 for(let i=0;i<items.length;i++) await expect(rows(page).nth(i)).toContainText(`Gross TRY ${amount(items[i].grossSalesMinor)}`);
}
async function login(page:Page,email='admin@demo.com'){
 await page.goto('/login');await page.getByLabel('Email').fill(email);await page.getByLabel('Password').fill('demo123');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).not.toHaveURL(/\/login/);
 if(email==='admin@demo.com'){
  await page.getByRole('button',{name:/FIN03.*Admin view/}).click();
  await page.getByRole('menu',{name:'Account menu'}).getByLabel('Workspace',{exact:true}).selectOption('admin');
 }
}
test.beforeEach(async({page})=>{
 posts=[];expectedPosts=0;
 page.on('request',r=>{const u=new URL(r.url());if(r.method()==='POST'&&/\/settlement-approvals\/[^/]+\/(approve|cancel)$/.test(u.pathname))posts.push(u.pathname);});
 const started=new Map<any,number>();page.on('request',r=>started.set(r,Date.now()));
 page.on('requestfinished',r=>{if(r.url().startsWith(root)&&started.has(r))requestLog.push({url:r.url(),method:r.method(),duration:Date.now()-started.get(r)!});});
 await login(page);await page.goto(path);await vendor(page,'fin03-a');
 await expect(page.getByRole('button',{name:/^All\s*605$/})).toBeVisible();
});
test.afterEach(async({},info)=>{await appendFile(process.env.BROWSER_SMOKE_EVIDENCE_PATH!+'.network.jsonl',JSON.stringify({test:info.title,posts,expectedPosts,status:info.status})+'\n');expect(posts).toHaveLength(expectedPosts);});

test('A — real page replacement and exact historical selection',async({page})=>{
 const first=await list(page);expect(first.approvals.map((r:any)=>r.id)).toEqual(a.slice(0,20).map((r:any)=>r.id));
 await visible(page,a.slice(0,20));
 const next=page.waitForResponse(r=>r.url().startsWith(root+'?')&&new URL(r.url()).searchParams.get('cursor')===first.nextCursor);
 await page.getByRole('button',{name:'Next',exact:true}).click();const second=await (await next).json();
 expect(second.approvals.map((r:any)=>r.id)).toEqual(a.slice(20,40).map((r:any)=>r.id));await visible(page,a.slice(20,40));
 expect(new Set([...first.approvals,...second.approvals].map(r=>r.id)).size).toBe(40);
 const legacy=await (await page.request.get(root+'?vendorId=fin03-a')).json();
 const index=second.approvals.findIndex((r:any)=>!legacy.approvals.some((x:any)=>x.id===r.id));expect(index).toBeGreaterThanOrEqual(0);const historical=second.approvals[index];
 await rows(page).nth(index).click();const panel=page.getByLabel('Settlement review detail panel');
 await expect(panel).toContainText(historical.id);await expect(panel).toContainText('Viewing it does not authorize Approve or Cancel.');
 await expect(panel.getByRole('button',{name:/Approve Settlement|Cancel Settlement/})).toHaveCount(0);
 await page.getByRole('button',{name:'Previous',exact:true}).click();await visible(page,a.slice(0,20));await expect(panel).toContainText(historical.id);
 console.log('A tested IDs',JSON.stringify([...first.approvals,...second.approvals].map(r=>r.id)));
});

for(const term of ['fin03-a-0430','fin03-a','yalıspor i̇','app','élan %','17']) test(`B — six-field real Search ${term}`,async({page})=>{
 const normalized=term.trim().toLowerCase();const expected=summaries(a).filter(r=>matchesSettlementSearch(r,normalized,'FIN03 Yalıspor İ'));const target=['fin03-a-0430','élan %','17'].includes(term) ? 'fin03-a-0430' : null;
 const requests:string[]=[];page.on('request',r=>{if(r.url().startsWith(root+'?')&&new URL(r.url()).searchParams.has('search'))requests.push(r.url());});
 const response=page.waitForResponse(r=>r.url().startsWith(root+'?')&&new URL(r.url()).searchParams.get('search')===normalized);
 await page.getByLabel('Search',{exact:true}).fill(`  ${term}  `);
 let data=await (await response).json();const observed:string[]=[];let steps=0;
 while(true){
  expect(data.approvals.map((r:any)=>r.id)).toEqual(expected.slice(observed.length,observed.length+data.approvals.length).map(r=>r.id));
  expect(data.approvals.every((r:any)=>r.vendorId==='fin03-a')).toBe(true);observed.push(...data.approvals.map((r:any)=>r.id));
  await visible(page,data.approvals);
  if(!target || observed.includes(target) || !data.nextCursor)break;
  expect(++steps).toBeLessThanOrEqual(4);const cursor=data.nextCursor;
  const continued=page.waitForResponse(r=>r.url().startsWith(root+'?')&&new URL(r.url()).searchParams.get('cursor')===cursor);
  await page.getByRole('button',{name:data.searchState==='MORE_CANDIDATES'?'Continue Search':'Next',exact:true}).click();data=await (await continued).json();
 }
 if(target)expect(observed).toContain(target);expect(new Set(observed).size).toBe(observed.length);
 const q=new URL(requests[0]).searchParams;expect(q.get('searchVendorName')).toBe('FIN03 Yalıspor İ');expect(q.has('cursor')).toBe(false);
 expect(requests.filter(url=>!new URL(url).searchParams.has('cursor'))).toHaveLength(1);
});

test('C — sparse real batches, one controlled transport failure, exact retry and exhaustion',async({page})=>{
 const term='sparse_i̇%_';const seen:any[]=[];
 page.on('response',async r=>{if(r.url().startsWith(root+'?')&&new URL(r.url()).searchParams.get('search')===term&&r.status()===200)seen.push(await r.json());});
 const first=page.waitForResponse(r=>r.url().startsWith(root+'?')&&new URL(r.url()).searchParams.get('search')===term);
 await page.getByLabel('Search',{exact:true}).fill(term);let data=await (await first).json();expect(data.searchState).toBe('MORE_CANDIDATES');expect(data.approvals).toEqual([]);
 await expect(page.getByText('Page 1',{exact:true})).toBeVisible();
 const failCursor=data.nextCursor;
 await page.route(url=>url.origin==='http://localhost:4000'&&url.pathname==='/admin/finance/settlement-approvals'&&url.searchParams.get('cursor')===failCursor,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Controlled FIN03 transport failure'})}),{times:1});
 await page.getByRole('button',{name:'Continue Search',exact:true}).click();await expect(page.getByText('Controlled FIN03 transport failure')).toBeVisible();
 const retry=page.waitForResponse(r=>r.url().startsWith(root+'?')&&new URL(r.url()).searchParams.get('cursor')===failCursor&&r.status()===200);
 await page.getByRole('button',{name:'Retry history'}).click();data=await (await retry).json();expect(data.searchState).toBe('MORE_CANDIDATES');
 let continuations=0;
 while(data.nextCursor){
  expect(++continuations).toBeLessThanOrEqual(4);const cursor=data.nextCursor;
  const response=page.waitForResponse(r=>r.url().startsWith(root+'?')&&new URL(r.url()).searchParams.get('cursor')===cursor);
  await page.getByRole('button',{name:data.searchState==='MORE_CANDIDATES'?'Continue Search':'Next',exact:true}).click();data=await (await response).json();
  if(data.approvals.length)await visible(page,data.approvals);
 }
 expect(data.searchState).toBe('EXHAUSTED');await expect(page.getByText('Search completed. No additional settlements were found in this page. Use Previous to view earlier results.')).toBeVisible();
 await page.getByRole('button',{name:'Previous',exact:true}).click();await expect(rows(page)).toHaveCount(2);
 expect(seen.some(r=>r.searchState==='MORE_CANDIDATES')).toBe(true);
 const more=await list(page,{search:'draft',searchVendorName:'FIN03 Yalıspor İ'});expect(more.searchState).toBe('MORE_MATCHES');
 console.log('C real batches',seen.map(r=>({state:r.searchState,count:r.approvals.length,scanned:r.candidatesScanned})));
});

test('D/F — real backend filters and independent workflow totals',async({page})=>{
 await page.getByRole('combobox',{name:/^Status/}).selectOption('approved');await page.getByLabel('High Value only').check();
 await page.getByRole('button',{name:/^Approved\s*202$/}).click();
 const data=await list(page,{status:'approved',highValueOnly:'true',workflow:'approved'});
 await visible(page,data.approvals);expect(data.approvals.every((r:any)=>r.status==='approved'&&r.netPayableMinor>=100000)).toBe(true);
 await expect(page.getByRole('button',{name:/^All\s*605$/})).toBeVisible();await expect(page.getByRole('button',{name:/^Refund\s*0$/})).toBeVisible();
 await expect(page.getByText(/Workflow counts reflect settlement summaries, not payout payments/)).toBeVisible();
 const key=data.approvals[0].scheduledCycleKey;await page.getByRole('combobox',{name:/^Settlement Period/}).selectOption(JSON.stringify([key]));
 await visible(page,[data.approvals[0]]);await expect(page.getByText('Page 1',{exact:true})).toBeVisible();
});

test('F — count failure is unknown and retry retrieves real Vendor totals',async({page})=>{
 await page.route(url=>url.pathname==='/admin/finance/settlement-approvals/workflow-counts'&&url.searchParams.get('vendorId')==='fin03-b',route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"Controlled count failure"}'}),{times:1});
 await vendor(page,'fin03-b');await expect(page.getByText('Controlled count failure')).toBeVisible();
 await expect(page.getByLabel('Settlement review workflow tabs').getByRole('button',{name:/^All\s*—$/})).toBeVisible();
 await page.getByRole('button',{name:'Retry counts'}).click();await expect(page.getByRole('button',{name:/^All\s*27$/})).toBeVisible();
});

test('E/I — verified period retention through one real guarded cancellation and metadata retry',async({page})=>{
 expectedPosts=1;await vendor(page,'fin03-action');await expect(page.getByRole('button',{name:/^All\s*22$/})).toBeVisible();
 await page.goto(path+'?approvalId=fin03-cancel-target');const panel=page.getByLabel('Settlement review detail panel');await expect(panel).toContainText('fin03-cancel-target');
 await page.getByRole('button',{name:'Load More Periods'}).click();const select=page.getByRole('combobox',{name:/^Settlement Period/});
 const key='fin03-action-period-21';await expect(select.locator(`option[value='${JSON.stringify([key])}']`)).toHaveCount(1);
 const label=await select.locator(`option[value='${JSON.stringify([key])}']`).innerText();await select.selectOption(JSON.stringify([key]));
 await panel.getByRole('button',{name:'Cancel Settlement',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Vendor: fin03-action');await expect(dialog).toContainText('Settlement: fin03-cancel-target');
 const gets:string[]=[];page.on('request',r=>{if(r.method()==='GET'&&r.url()===root+'/fin03-cancel-target')gets.push(r.url());});
 let failNextMetadata=true;
 await page.route(url=>url.pathname==='/admin/finance/settlement-approvals/periods'&&!url.searchParams.has('cursor'),async route=>{
  if(failNextMetadata){failNextMetadata=false;await route.fulfill({status:503,contentType:'application/json',body:'{"message":"Controlled metadata failure"}'});}
  else await route.fallback();
 });
 let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
 await page.route(root+'/fin03-cancel-target/cancel',async route=>{const response=await route.fetch();await held;await route.fulfill({response});});
 const submitted=page.waitForRequest(r=>r.method()==='POST'&&r.url()===root+'/fin03-cancel-target/cancel');
 const button=dialog.getByRole('button',{name:'Cancel Settlement',exact:true});await button.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});await submitted;
 expect(posts).toEqual(['/admin/finance/settlement-approvals/fin03-cancel-target/cancel']);release();
 await expect(page.getByText('Settlement cancelled.',{exact:true})).toBeVisible();await expect(page.getByText('Controlled metadata failure')).toBeVisible();
 await expect(select.locator('option:checked')).toHaveText(label);await page.getByRole('button',{name:'Retry periods'}).click();await expect(page.getByText('Controlled metadata failure')).toHaveCount(0);await expect(select.locator('option:checked')).toHaveText(label);
 expect(gets.length).toBeGreaterThanOrEqual(1);
 await page.getByRole('button',{name:'Load More Periods'}).click();await expect(select.locator(`option[value='${JSON.stringify([key])}']`)).toHaveCount(1);
 await select.selectOption('all-periods');await expect(select.locator('option:checked')).toHaveText('All periods');
 const saved=await page.request.get(root+'/fin03-cancel-target');expect((await saved.json()).status).toBe('cancelled');
});

test('G/H/J — real delayed A→B→A, exact old target, foreign link and empty History ownership',async({page})=>{
 const old=a[450];await page.goto(path+'?approvalId='+encodeURIComponent(old.id));const panel=page.getByLabel('Settlement review detail panel');
 await expect(panel).toContainText(old.id);await expect(panel).toContainText(amount(old.grossSalesMinor));await expect(panel).toContainText('Viewing it does not authorize Approve or Cancel.');await expect(panel.getByRole('button',{name:/Approve Settlement|Cancel Settlement/})).toHaveCount(0);
 let release!:()=>void;const hold=new Promise<void>(r=>release=r);let hit!:()=>void;const hitPromise=new Promise<void>(r=>hit=r);
 await page.route(url=>url.pathname.startsWith('/admin/finance/settlement-approvals')&&url.searchParams.get('vendorId')==='fin03-b',async route=>{const response=await route.fetch();hit();await hold;await route.fulfill({response});});
 await vendor(page,'fin03-b');await hitPromise;await vendor(page,'fin03-a');release();await expect(panel).toContainText(old.id);await expect(page.getByRole('button',{name:/^All\s*605$/})).toBeVisible();
 await page.getByLabel('Search',{exact:true}).fill('fin03-a-0000');await expect(rows(page)).toHaveCount(1);
 await expect(panel).toContainText(old.id);await expect(panel.getByRole('button',{name:/Approve Settlement|Cancel Settlement/})).toHaveCount(0);
 await page.goto(path+'?approvalId='+b[0].id);await expect(page.getByText(/requested settlement belongs to a different Vendor/)).toBeVisible();await expect(page.getByLabel('Vendor',{exact:true})).toHaveValue('FIN03 Yalıspor İ');
 await expect(page.getByLabel('Settlement review detail panel')).not.toContainText(b[0].id);
 await page.getByRole('button',{name:'Review automatic approval history'}).click();await expect(page.getByText('No automatic approval attempts match these filters.')).toBeVisible();
 await expect(page.getByText('No persisted operational errors in this view.')).toBeVisible();
 await vendor(page,'fin03-b');await page.getByRole('button',{name:'Review automatic approval history'}).click();await expect(page.getByText('No automatic approval attempts match these filters.')).toBeVisible();
 await expect(rows(page)).toHaveCount(20);await expect(page.getByRole('button',{name:/^All\s*27$/})).toBeVisible();
 await vendor(page,'fin03-a');await page.goto(path+'?approvalId=fin03-a-0000');
 await page.getByLabel('Settlement review detail panel').getByRole('button',{name:'Cancel Settlement',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('Settlement: fin03-a-0000');await vendor(page,'fin03-b');await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('K/M — cross-screen return, literal all, keyboard and narrow viewport',async({page},info)=>{
 const current=a.find((r:any)=>r.scheduledCycleKey===`scheduled-settlement:fin03-a:${fixture.runDate}`);
 await page.getByRole('link',{name:'Scheduled Settlements',exact:true}).click();await expect(page.getByRole('heading',{name:'Scheduled Settlements'})).toBeVisible();
 await page.getByLabel('Run date').fill(fixture.runDate);await page.getByRole('button',{name:'Preview Schedule',exact:true}).click();
 await page.getByLabel('Scheduled settlement workflow tabs').getByRole('button',{name:/^All/}).click();
 await page.locator('.scheduled-settlements-table .op-table-row').filter({hasText:'FIN03 Yalıspor İ'}).click();
 await page.getByRole('link',{name:'Open Settlement',exact:true}).click();await expect(page).toHaveURL(new RegExp('approvalId='+current.id));
 await expect(page.getByLabel('Settlement review detail panel')).toContainText(current.id);
 await page.getByRole('link',{name:'Payment Preparation',exact:true}).click();await expect(page.getByRole('heading',{name:'Payment Preparation'})).toBeVisible();
 await expect(page.getByLabel('Vendor',{exact:true})).toHaveValue('fin03-a');await page.goBack();await expect(page.getByLabel('Settlement review detail panel')).toContainText(current.id);
 let option=page.getByRole('combobox',{name:/^Settlement Period/}).locator(`option[value='${JSON.stringify(['all'])}']`);
 for(let n=0;await option.count()===0&&n<4;n++)await page.getByRole('button',{name:'Load More Periods'}).click();
 await expect(option).toHaveCount(1);await page.getByRole('combobox',{name:/^Settlement Period/}).selectOption(JSON.stringify(['all']));
 const filtered=await list(page,{periodKey:'all'});expect(filtered.approvals).toHaveLength(1);await visible(page,filtered.approvals);
 await page.getByRole('combobox',{name:/^Settlement Period/}).selectOption('all-periods');await expect(rows(page)).toHaveCount(20);
 await page.screenshot({path:info.outputPath('fin03-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});
 await page.getByLabel('Search',{exact:true}).focus();await page.keyboard.type(a[3].id);await expect(rows(page)).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Continue Search',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('fin03-narrow.png'),fullPage:true});
});

test('L — actual authentication and cursor/query access contracts',async({page,browser})=>{
 const anonymous=await browser.newContext();const nonAdmin=await browser.newContext();
 try{
  const vendorPage=await nonAdmin.newPage();await login(vendorPage,'vendor@demo.com');
  for(const suffix of ['?vendorId=fin03-a&pagination=cursor','/periods?vendorId=fin03-a','/workflow-counts?vendorId=fin03-a']){
   expect((await anonymous.request.get(root+suffix)).status()).toBe(401);
   expect((await nonAdmin.request.get(root+suffix)).status()).toBe(403);
   expect((await page.request.get(root+suffix)).status()).toBe(200);
  }
  for(const suffix of ['?pagination=cursor','/periods','/workflow-counts'])expect((await page.request.get(root+suffix)).status()).toBe(400);
  const explicit=await page.request.get(root+'?vendorId=fin03-b&pagination=cursor',{headers:{'X-Vendor-Id':'fin03-a'}});expect(explicit.status()).toBe(200);const scoped=await explicit.json();expect(scoped.vendorId).toBe('fin03-b');expect(scoped.approvals.every((r:any)=>r.vendorId==='fin03-b')).toBe(true);
  expect((await page.request.get(root+'?vendorId=fin03-a&pagination=cursor&cursor=invalid')).status()).toBe(400);
  const first=await list(page);
  for(const change of [{vendorId:'fin03-b'},{status:'approved'}])expect((await page.request.get(`${root}?${new URLSearchParams({vendorId:'fin03-a',pagination:'cursor',cursor:first.nextCursor,...change})}`)).status()).toBe(400);
 }finally{await anonymous.close();await nonAdmin.close();}
});

test.afterAll(()=>{console.log('FIN03 local HTTP observations',JSON.stringify(requestLog.map(r=>({path:new URL(r.url).pathname,query:new URL(r.url).search,method:r.method,duration:r.duration}))));console.log('FIN03 history is read-only; no payout or successful automatic approval is created.');});


const historyRoot='http://localhost:4000/admin/finance/settlement-auto-approval-attempts';
async function openHistory(page:Page,id:string){
 await vendor(page,id);await page.getByRole('button',{name:'Review automatic approval history'}).click();
 return page.getByRole('region',{name:'Automatic approval history',exact:true});
}
test('16B History — populated attempts, events, operational pages, filters and exact link',async({page})=>{
 const history=await openHistory(page,'fin03-evidence-a');
 const attemptRows=history.locator('table').first().locator('tbody tr');
 await expect(attemptRows).toHaveCount(25);
 for(const row of await attemptRows.all())await expect(row).toContainText('(fin03-evidence-a)');
 await history.getByRole('button',{name:'Older attempts',exact:true}).click();await expect(attemptRows).toHaveCount(28);
 const unknown=attemptRows.filter({hasText:fixture.extra.unknownId});await expect(unknown).toHaveCount(1);
 await unknown.getByRole('button',{name:'View 51 events'}).click();
 const events=page.getByRole('region',{name:'Attempt event history'});await expect(events.locator('li')).toHaveCount(50);
 await events.getByRole('button',{name:'Older events'}).click();await expect(events.locator('li')).toHaveCount(51);
 await expect(events).toContainText('UNCLASSIFIED_FAILURE');
 const operational=page.getByRole('region',{name:'Scheduler and worker operational errors'});
 await expect(operational.locator('tbody tr')).toHaveCount(25);await operational.getByRole('button',{name:'Older operational errors'}).click();await expect(operational.locator('tbody tr')).toHaveCount(27);
 await expect(operational).toContainText('TYPE_ERROR');await expect(operational).not.toContainText('fin03-evidence-b');
 await history.getByRole('combobox',{name:'Attempt outcome'}).selectOption('BLOCKED');await expect(attemptRows).toHaveCount(25);
 const candidate=fixture.extra.historyTargets.find((c:any)=>c.vendorId==='fin03-evidence-a');
 await history.getByLabel('Settlement ID',{exact:true}).fill(candidate.settlementId);
 await history.getByLabel('Reason code',{exact:true}).fill('SETTLEMENT_CANCELLED');
 const filtered=page.waitForResponse(r=>r.url().startsWith(historyRoot+'?')&&new URL(r.url()).searchParams.get('reasonCode')==='SETTLEMENT_CANCELLED');
 await history.getByRole('button',{name:'Apply text filters'}).click();const data=await(await filtered).json();
 expect(data.attempts.length).toBe(25);expect(data.attempts.every((r:any)=>r.outcome==='BLOCKED'&&r.vendorId==='fin03-evidence-a'&&r.settlementApprovalId===candidate.settlementId&&!r.exactSuccessfulAttempt)).toBe(true);
 await attemptRows.first().getByRole('link',{name:candidate.settlementId,exact:true}).click();
 await expect(page).toHaveURL(new RegExp('approvalId='+candidate.settlementId));await expect(page.getByLabel('Settlement review detail panel')).toContainText(candidate.settlementId);
 await expect(page.getByLabel('Settlement review detail panel').getByRole('button',{name:/Approve Settlement|Cancel Settlement/})).toHaveCount(0);
});

test('16B History — real delayed events and pages cannot survive Vendor A B A',async({page})=>{
 const history=await openHistory(page,'fin03-evidence-a');await history.getByRole('button',{name:'Older attempts',exact:true}).click();
 let release!:()=>void;const hold=new Promise<void>(r=>release=r);let hit!:()=>void;const reached=new Promise<void>(r=>hit=r);
 await page.route(historyRoot+'/'+fixture.extra.unknownId+'/events',async route=>{const response=await route.fetch();hit();await hold;await route.fulfill({response});});
 await history.locator('tr').filter({hasText:fixture.extra.unknownId}).getByRole('button',{name:'View 51 events'}).click();await reached;
 await vendor(page,'fin03-evidence-b');await page.getByRole('button',{name:'Review automatic approval history'}).click();
 await expect(history.locator('table').first().locator('tbody tr')).toHaveCount(25);await expect(history).not.toContainText(fixture.extra.unknownId);
 await vendor(page,'fin03-evidence-a');await page.getByRole('button',{name:'Review automatic approval history'}).click();release();
 await expect(history.locator('table').first().locator('tbody tr')).toHaveCount(25);await expect(page.getByRole('region',{name:'Attempt event history'})).toHaveCount(0);
 await expect(history).not.toContainText('fin03-evidence-b-blocked');
});

test('16B counters — every persisted Vendor, all seven classifications independent of browsing',async({page})=>{
 for(const v of fixture.vendors){
  const items=fixture.approvals.filter((r:any)=>r.vendorId===v.id);const n=(predicate:(r:any)=>boolean)=>items.filter(predicate).length;
  const lineCount=(r:any)=>fixture.lines.filter((l:any)=>l.settlementApprovalId===r.id).length;
  const expected={all:items.length,needs_review:n(r=>r.status==='DRAFT'&&r.netPayableMinor<=0&&lineCount(r)>0),ready_for_approval:n(r=>r.status==='DRAFT'&&(r.netPayableMinor>0||lineCount(r)===0)),refund_review:0,vendor_hold:n(r=>r.status==='CANCELLED'||r.netPayableMinor<=0&&lineCount(r)>0),approved:n(r=>r.status==='APPROVED'),paid:0};
  // The dedicated Cancel test changes exactly one fixture status before this test.
  if(v.id==='fin03-action'){const target=await(await page.request.get(root+'/fin03-cancel-target')).json();if(target.status==='cancelled'){expected.ready_for_approval--;expected.vendor_hold++;}}
  await vendor(page,v.id);const response=await page.request.get(root+'/workflow-counts?vendorId='+v.id);expect(response.status()).toBe(200);expect((await response.json()).counts).toEqual(expected);
  const labels={all:'All',needs_review:'Summary flags',ready_for_approval:'No summary flags',refund_review:'Refund',vendor_hold:'Hold',approved:'Approved',paid:'Paid'};
  for(const [key,label]of Object.entries(labels))await expect(page.getByLabel('Settlement review workflow tabs').getByRole('button',{name:new RegExp('^'+label+'\\s*'+expected[key as keyof typeof expected]+'$')})).toBeVisible();
  await page.getByLabel('Search',{exact:true}).fill('no-such-fixture');await expect(rows(page)).toHaveCount(0);expect((await(await page.request.get(root+'/workflow-counts?vendorId='+v.id)).json()).counts).toEqual(expected);
 }
});

test('16B combined filters — Search AND status, period, workflow, High Value and all together',async({page})=>{
 const target=a.find((r:any)=>r.id==='fin03-a-0430');
 for(const combination of [ {status:'approved'}, {periodKey:target.scheduledCycleKey}, {workflow:'approved'}, {highValueOnly:'true'}, {status:'approved',periodKey:target.scheduledCycleKey,workflow:'approved',highValueOnly:'true'} ]){
  await page.goto(path);await expect(rows(page)).toHaveCount(20);
  if(combination.status)await page.getByRole('combobox',{name:/^Status/}).selectOption(combination.status);
  if(combination.workflow)await page.getByRole('button',{name:/^Approved\s*202$/}).click();
  if(combination.highValueOnly)await page.getByLabel('High Value only').check();
  if(combination.periodKey){let option=page.getByRole('combobox',{name:/^Settlement Period/}).locator(`option[value='${JSON.stringify([combination.periodKey])}']`);for(let i=0;await option.count()===0&&i<23;i++)await page.getByRole('button',{name:'Load More Periods'}).click();await expect(option).toHaveCount(1);await page.getByRole('combobox',{name:/^Settlement Period/}).selectOption(JSON.stringify([combination.periodKey]));}
  const initial=page.waitForResponse(r=>r.url().startsWith(root+'?')&&new URL(r.url()).searchParams.get('search')==='élan %');
  await page.getByLabel('Search',{exact:true}).fill('élan %');let result=await(await initial).json();
  for(let i=0;result.approvals.length===0&&result.nextCursor&&i<4;i++){
   const cursor=result.nextCursor;const continued=page.waitForResponse(r=>r.url().startsWith(root+'?')&&new URL(r.url()).searchParams.get('cursor')===cursor);
   await page.getByRole('button',{name:'Continue Search',exact:true}).click();result=await(await continued).json();
  }
  expect(result.approvals.map((r:any)=>r.id)).toEqual([target.id]);expect(result.approvals.every((r:any)=>r.vendorId==='fin03-a')).toBe(true);
  await expect(rows(page)).toHaveCount(1);await expect(rows(page).first()).toContainText(amount(target.grossSalesMinor));
 }
});

test('16B keyboard — narrow filters, page controls, history detail and Search continuation',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const keyActivate=async(locator:ReturnType<Page['getByRole']>)=>{await locator.focus();await expect(locator).toBeFocused();await page.keyboard.press('Enter');};
 await keyActivate(page.getByRole('button',{name:'Next',exact:true}));await expect(page.getByText('Page 2',{exact:true})).toBeVisible();await visible(page,a.slice(20,40));
 await keyActivate(page.getByRole('button',{name:'Previous',exact:true}));await expect(page.getByText('Page 1',{exact:true})).toBeVisible();await visible(page,a.slice(0,20));
 const status=page.getByRole('combobox',{name:/^Status/});await status.focus();await expect(status).toBeFocused();await page.keyboard.press('d');await expect(status).toHaveValue('draft');
 await keyActivate(page.getByRole('button',{name:'Load More Periods'}));
 const period=page.getByRole('combobox',{name:/^Settlement Period/});const option=period.locator('option').nth(1);const label=await option.innerText();const value=await option.getAttribute('value');await period.focus();await expect(period).toBeFocused();await page.keyboard.press(label[0].toLowerCase());await expect(period).toHaveValue(value!);await expect(period).not.toHaveValue('all-periods');
 await page.goto(path);await expect(rows(page)).toHaveCount(20);
 // Existing row primitive exposes its supported keyboard selection contract.
 await rows(page).nth(3).focus();await page.keyboard.press('Enter');await expect(page.getByLabel('Settlement review detail panel')).toContainText(a[3].id);await expect(page.getByLabel('Settlement review detail panel')).toContainText(amount(a[3].grossSalesMinor));
 await page.getByLabel('Search',{exact:true}).focus();await page.keyboard.type('sparse_i̇%_');await expect(rows(page)).toHaveCount(0);
 await keyActivate(page.getByRole('button',{name:'Continue Search',exact:true}));await expect(page.getByText('Search scan incomplete. More candidates remain; continue to check the next batch.')).toBeVisible();
});
