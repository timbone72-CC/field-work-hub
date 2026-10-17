const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const rules = require('../../dashboard/job-workspace.js');
const app = fs.readFileSync(require.resolve('../../dashboard/app.js'), 'utf8').replace(/\r\n/g, '\n');

test('job reads are bounded and presentation filters cannot supply columns or operators', () => {
  const query = rules.parameters({ size: 1000, sort: 'organization_id.asc', status: 'eq.ADMIN',
    searchField: 'organization_id', search: 'A*B_%', offset: 25 });
  assert.equal(query.get('limit'), '25'); assert.equal(query.get('offset'), '25');
  assert.equal(query.get('order'), 'created_at.desc.nullslast,id.asc');
  assert.equal(query.get('property_address'), 'ilike.*A\\*B\\_\\%*');
  assert.equal(query.has('organization_id'), false); assert.equal(query.has('field_status'), false);
  assert.equal(rules.parameters({ size: 50 }).get('limit'), '50');
});
test('stored job-view preferences exclude searches, identities and payloads', () => {
  assert.deepEqual(rules.normalize({ size: 50, status: 'ASSIGNED', sort: 'due_date.asc',
    search: 'Private address', access_token: 'private', instructions: 'Private work', id: 'private' }),
  { size: 50, status: 'ASSIGNED', sort: 'due_date.asc' });
});
test('unknown count stays unknown rather than inventing a total', () => {
  assert.equal(rules.total('0-24/1000'), 1000); assert.equal(rules.total('*/0'), 0);
  assert.equal(rules.total('0-24/*'), null); assert.equal(rules.total(null), null);
});
test('empty and partial authorized pages do not require synthetic control jobs; foreign rows fail closed', () => {
  const ctx = vm.createContext({});
  vm.runInContext(app.match(/function verifyAdminRls[\s\S]*?\n}\n/)[0], ctx);
  const verify = ctx.verifyAdminRls;
  assert.doesNotThrow(() => verify([], 'org-one'));
  assert.doesNotThrow(() => verify([{ organization_id: 'org-one', wo_number: 'WO-25' }], 'org-one'));
  assert.throws(() => verify([{ organization_id: 'org-two' }], 'org-one'), /another organization/);
  assert.throws(() => verify([{ organization_id: 'org-one', wo_number: 'TEST-OTHER-ORG-CONTROL' }], 'org-one'), /control/);
  assert.throws(() => verify({}, 'org-one'), /Unexpected/);
});


test('Phase 6A operational guidance never invents Accept, photo readiness or client delivery', () => {
  const facts = rules.JobOperationalFacts;
  assert.deepEqual(facts.project({field_status:'ASSIGNED',assigned_user_id:null}),{
    label:'Needs assignment',next:'Assign',panel:'assignment'});
  assert.deepEqual(facts.project({field_status:'ASSIGNED',assigned_user_id:'contractor-uuid'}),{
    label:'Awaiting delivery receipt',next:'View assignment',panel:'assignment'});
  assert.deepEqual(facts.project({field_status:'ASSIGNED',assigned_user_id:'contractor-uuid',
    assignment_received_at:'2026-10-10T18:00:00Z'}),{
    label:'Assignment downloaded — human Accept not established',next:'View assignment',panel:'assignment'});
  assert.deepEqual(facts.project({field_status:'IN_PROGRESS'}),{
    label:'In progress',next:'Open details',panel:'details'});
  assert.deepEqual(facts.project({field_status:'FIELD_COMPLETE'}),{
    label:'Field complete — review and delivery status not loaded',next:'Check photos',panel:'photos'});
  assert.deepEqual(facts.project({field_status:'ASSIGNED',pending_assignee_user_id:'pending'}),{
    label:'Reassignment pending',next:'View assignment',panel:'assignment'});
  assert.equal(facts.project({field_status:'CANCELLED'}).label,'Cancelled');
  assert.equal(facts.project({field_status:'DELIVERED'}).label,'Status unavailable');
  assert.equal(facts.project(null).label,'Status unavailable');
});
test('Phase 6A job guidance uses text-only rendering and existing protected tabs', () => {
  const html=fs.readFileSync(require.resolve('../../dashboard/index.html'),'utf8');
  const js=fs.readFileSync(require.resolve('../../dashboard/job-workspace.js'),'utf8');
  assert.match(html,/id="job-next-action"/);
  assert.match(html,/id="job-next-action-open"/);
  assert.match(js,/el\('job-next-action'\)\.textContent/);
  assert.match(js,/el\('job-next-action-open'\)\.dataset\.panel/);
  assert.doesNotMatch(js,/job-next-action'\)\.innerHTML/);
  assert.match(app,/JobOperationalFacts\.project\(row\)\.label/);
});

test('Phase 6A contractor/date filters are server-side and reject SQL operator injection',()=>{
 const uid='11111111-1111-4111-8111-111111111111';
 const filters=rules.parameters({size:50,contractor:uid,dueDate:'2026-10-10',sort:'due_date.desc'});
 assert.equal(filters.get('assigned_user_id'),'eq.'+uid);
 assert.equal(filters.get('due_date'),'eq.2026-10-10');
 assert.equal(filters.get('order'),'due_date.desc.nullslast,id.asc');
 const attack=rules.parameters({contractor:'eq.'+uid+',other',dueDate:'2026-10-10,or.true',sort:'organization_id.asc'});
 assert.equal(attack.has('assigned_user_id'),false);
 assert.equal(attack.has('due_date'),false);
 assert.equal(attack.get('order'),'created_at.desc.nullslast,id.asc');
 assert.equal(rules.normalize({contractor:uid,dueDate:'2026-10-10'}).contractor,undefined);
});

test('Phase 6A closing a job returns keyboard focus by UUID and clears transient account data',()=>{
 const workspace=fs.readFileSync(require.resolve('../../dashboard/job-workspace.js'),'utf8');
 assert.match(workspace,/returnFocusId=id/);
 assert.match(workspace,/node\.dataset\.jobOpenId===id/);
 assert.match(workspace,/button\.isConnected/);
 assert.match(workspace,/el\('job-search'\)\.focus\(\)/);
 assert.match(app,/button\.dataset\.jobOpenId = row\.id/);
 const reset=workspace.match(/function reset\(\) \{[\s\S]*?\n  \}/)?.[0];
 assert.ok(reset);
 assert.match(reset,/returnFocusId = null/);
 assert.match(reset,/contractor:'',dueDate:''/);
 assert.doesNotMatch(reset,/localStorage\.setItem/);
});

test('Phase 6A clear filters resets only bounded list controls, not selected job drafts',()=>{
 const workspace=fs.readFileSync(require.resolve('../../dashboard/job-workspace.js'),'utf8');
 const html=fs.readFileSync(require.resolve('../../dashboard/index.html'),'utf8');
 assert.match(html,/id="job-clear-filters"/);
 const handler=workspace.match(/el\('job-clear-filters'\)\.addEventListener\('click',[\s\S]*?\n    \}\);/)?.[0];
 assert.ok(handler);
 for(const control of ['job-search','job-status','job-contractor','job-due-date','job-sort','job-page-size'])
  assert.ok(handler.includes(control),control);
 assert.match(handler,/change\(0\)/);
 assert.match(handler,/adminWritesPending \|\| saveEditButton\.disabled/);
 assert.doesNotMatch(handler,/ClientRelease\.reset|editForm\.reset|selectedRow\s*=/);
});

test('Phase 6A address navigation stays within exact same-company authorized page',()=>{
 const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const selected={id:uid(1),organization_id:uid(10),client_company_id:uid(20),
  property_address:'123 Main St Apt 2',wo_number:'WO-1'};
 const page=[
  selected,{...selected,id:uid(2),property_address:' 123  Main ST Apt 2 '},
  {...selected,id:uid(3),client_company_id:uid(21)},
  {...selected,id:uid(4),organization_id:uid(11)},
  {...selected,id:uid(5),property_address:'123 Main St Apt 20'},
  {...selected,id:'not-a-uuid'}
 ];
 const matches=rules.JobAddressContext.siblings(page,selected);
 assert.deepEqual(matches.map(x=>x.id),[uid(1),uid(2)]);
 assert.deepEqual(rules.JobAddressContext.siblings(page,{...selected,client_company_id:null}),[]);
 assert.deepEqual(rules.JobAddressContext.siblings([],selected),[]);
});
test('Phase 6A address links use existing unsaved-change navigation and current-page disclosure',()=>{
 const html=fs.readFileSync(require.resolve('../../dashboard/index.html'),'utf8');
 const workspace=fs.readFileSync(require.resolve('../../dashboard/job-workspace.js'),'utf8');
 assert.match(html,/id="job-address-work-orders"/);
 assert.match(html,/loaded in pages of 50/);
 assert.match(workspace,/JobAddressContext\.siblings\(addressRows,selectedRow\)/);
 assert.match(workspace,/button\.addEventListener\('click',\(\)=>choose\(item\.id\)\)/);
 assert.match(workspace,/list\.replaceChildren\(\)/);
 const addressContext=workspace.split('function addressContext() {')[1]?.split('function navigation() {')[0];
 assert.ok(addressContext);
 assert.equal(addressContext.includes('fetch('),false);
});

test('Phase 6A exact-address server lookup stays bounded, scoped and race fenced',()=>{
 const appText=fs.readFileSync(require.resolve('../../dashboard/app.js'),'utf8');
 const work=fs.readFileSync(require.resolve('../../dashboard/job-workspace.js'),'utf8');
 const html=fs.readFileSync(require.resolve('../../dashboard/index.html'),'utf8');
 const fn=appText.split('async function fetchAddressWorkOrders(')[1]?.split('async function fetchWorkOrder(')[0];
 assert.ok(fn);
 for(const required of ["organization_id:'eq.'+row.organization_id","client_company_id:'eq.'+row.client_company_id",
   "property_address:'eq.'+address","limit:'50'","offset:String(offset)","Prefer:'count=exact'",
   "verifyAdminRls(rows,row.organization_id)","item.client_company_id!==row.client_company_id",
   "item.property_address!==row.property_address"])
   assert.ok(fn.includes(required),required);
 const loader=work.split('async function loadAddressContext(')[1]?.split('function navigation()')[0];
 assert.ok(loader);
 assert.match(loader,/epoch!==addressLookupEpoch/);
 assert.match(loader,/selectedRow\?\.id!==row\.id/);
 assert.match(work,/addressLookupEpoch\+\+/);
 assert.match(html,/id="job-address-next"/);
 assert.match(html,/id="job-address-previous"/);
});

test('Phase 6B repeat and custom work both open new protected drafts, never dispatch',()=>{
 const html=fs.readFileSync(require.resolve('../../dashboard/index.html'),'utf8');
 const text=fs.readFileSync(require.resolve('../../dashboard/app.js'),'utf8');
 const handler=text.split('function prepareWorkFromSelectedJob(copyPriorDetails) {')[1]?.split('function fillWorkTypes()')[0];
 assert.ok(handler);
 for (const id of ['prepare-repeat-work','prepare-custom-work','create-wo-details'])
  assert.match(html,new RegExp('id="'+id+'"'));
 for (const name of ['JobWorkspace.guard','fetchWorkOrder(oldId)','currentUser?.id!==actor',
  'editWorkOrderIdInput.value!==oldId','PhotoRules.copyPriorSnapshot',
  'createForm.reset()', "applyWoNumberMode('auto')",
  'propertyAddressInput.value=old.property_address','createPhotos.load(snapshot)'])
  assert.ok(handler.includes(name),name);
 assert.match(handler,/adminSessionEpoch!==epoch/);
 assert.match(handler,/JobWorkspace\.dirty\(\)/);
 assert.match(handler,/existingCreateDraft/);
 assert.match(handler,/woNumberInput\.value\.trim\(\)/);
 assert.match(handler,/window\.confirm\(/);
 assert.match(handler,/copyPriorDetails \? PhotoRules\.copyPriorSnapshot\(old\.run\?\.requirement_snapshot\) : null/);
 assert.match(handler,/if \(copyPriorDetails\) \{[\s\S]*?workTypeInput\.value=old\.work_type/);
 assert.match(handler,/prepareWorkFromSelectedJob\(true\)/);
 assert.match(handler,/prepareWorkFromSelectedJob\(false\)/);
 assert.doesNotMatch(handler,/woNumberInput\.value\s*=|assigneeSelect\.value\s*=|dueDateInput\.value\s*=|createWorkOrder\(/);
});

test('connection timeout guidance never implies a rejected Admin password', () => {
  assert.match(app,/error\?\.name==='TimeoutError'/);
  assert.match(app,/does not mean your password is wrong/);
  assert.match(app,/setLoginStatus\(error\?\.requestStage \? adminLoginFailureMessage\(error\) : timedOut/);
});

function adminRestoreRig({errorStage='identity',errorType='TimeoutError'}={}) {
  const code=fs.readFileSync(require.resolve('../../dashboard/session.js'),'utf8');
  const future=Math.floor(Date.now()/1000)+3600;
  let stored=JSON.stringify({access_token:'SYNTHETIC-ACCESS',refresh_token:'SYNTHETIC-REFRESH',
    expires_at:future});
  const statuses=[];
  let refreshCalls=0,clears=0;
  const issue=new Error(errorType==='TimeoutError'?'signal timed out':'Denied');
  if(errorType==='TimeoutError')issue.name='TimeoutError';else issue.status=403;
  const identity={id:'fixture-user',app_metadata:{organization_id:'fixture-org',role:'ADMIN'}};
  const ctx={
    signInWithPassword:async()=>({}),
    renderSignedIn(){},signOutButton:{addEventListener(){},click(){}},
    setLoginStatus:(message,bad)=>statuses.push({message,bad}),
    sessionStorage:{
      getItem:()=>stored,
      setItem:(_name,data)=>{stored=data;},
      removeItem:()=>{stored=null;clears++;}
    },
    accessToken:null,currentUser:null,assignableUsers:[],workOrderRows:[],
    fetchCurrentUser:async()=>{if(errorStage==='identity')throw issue;return identity;},
    fetchWorkOrders:async()=>{if(errorStage==='work')throw issue;return [];},
    fetchAssignableUsers:async()=>[],
    verifyAdminRls:()=>{},RecoveryGallery:{reset(){},async show(){throw Error('no grant');}},
    SUPABASE_URL:'https://fixture.invalid',SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable',
    fetch:async()=>{refreshCalls++;throw Error('Refresh should not run on transport failure');},
    AbortSignal
  };
  vm.createContext(ctx);
  vm.runInContext(code,ctx,{filename:'dashboard/session.js'});
  return {ctx,statuses,clears:()=>clears,stored:()=>stored,refreshCalls:()=>refreshCalls};
}

test('restore timeouts retain the saved tab identity but expose no stale operational data',async()=>{
 for(const stage of ['identity','work']){
  const rig=adminRestoreRig({errorStage:stage});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(rig.stored()?.includes('SYNTHETIC-REFRESH'),stage);
  assert.equal(rig.clears(),0);
  assert.equal(rig.refreshCalls(),0,'An offline response must not rotate refresh token');
  assert.equal(rig.ctx.accessToken,null,'Do not retain a live work credential in view');
  assert.equal(rig.ctx.currentUser,null);
  assert.deepEqual(Array.from(rig.ctx.workOrderRows),[]);
  assert.match(rig.statuses.at(-1).message,/session was preserved/);
 }
});

test('denied identity restore still removes previously stored credentials',async()=>{
 const rig=adminRestoreRig({errorType:'Denied'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(rig.stored(),null);
 assert.equal(rig.clears(),1);
 assert.equal(rig.ctx.currentUser,null);
 assert.match(rig.statuses.at(-1).message,/Sign in again/);
});

test('verified office identity may retain tab login if only first data page times out',()=>{
 const source=fs.readFileSync(require.resolve('../../dashboard/app.js'),'utf8');
 assert.match(source,/transientAdminConnectionError\(error\) && pendingAdminSession/);
 assert.match(source,/currentUser\?\.app_metadata\?\.organization_id/);
 assert.match(source,/storeAdminSession\(pendingAdminSession\)/);
 assert.match(source,/pendingAdminSession=null/);
 assert.match(source,/accessToken = null;/);
});

test('Modern Premium Stage 1 does not hide actions or change the existing job workspace', () => {
  const html = fs.readFileSync(require.resolve('../../dashboard/index.html'), 'utf8');
  const css = fs.readFileSync(require.resolve('../../dashboard/styles.css'), 'utf8');
  const premium = css.split('/* Modern Premium foundation — Stage 1')[1]?.split('/* Modern Premium Stage 2:')[0];
  assert.ok(premium, 'The visual refinement must remain isolated and reviewable');
  assert.match(html, /styles\.css\?v=modern-premium-stage2-20261017/);
  // Preserve each established functional destination and the same data-driven tab owners.
  for (const id of [
    'login-form', 'sign-out', 'notification-center', 'create-wo-details',
    'job-filters', 'work-orders', 'edit-work-order-section',
    'job-photos', 'job-delivery', 'job-history', 'job-unsaved',
    'job-next-action-open', 'save-edit', 'cancel-edit'
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'), 'Missing existing control: ' + id);
  }
  assert.equal((html.match(/data-job-tab="/g) || []).length, 6);
  assert.match(premium, /#results-card\s+>\s+\.row\.between\.gap/);
  assert.match(premium, /\.workspace-tabs button\[aria-pressed="true"\]/);
  assert.match(premium, /:focus-visible/);
  assert.match(premium, /max-width:\s*440px/);
  // This package may restyle visible controls, never take ownership of visibility.
  assert.doesNotMatch(premium, /(?:display:\s*none|visibility:\s*hidden|pointer-events:\s*none)/i);
});

test('Modern Premium Stage 2 routes existing work without replacing roles or actions', () => {
  const html = fs.readFileSync(require.resolve('../../dashboard/index.html'), 'utf8');
  const css = fs.readFileSync(require.resolve('../../dashboard/styles.css'), 'utf8');
  const nav = fs.readFileSync(require.resolve('../../dashboard/navigation.js'), 'utf8');
  for (const target of ['home', 'work', 'create', 'alerts', 'team']) {
    assert.match(html, new RegExp('data-fwh-go="' + target + '"'), target + ' entry missing');
  }
  for (const id of ['fwh-home-panel', 'fwh-work-page', 'job-filters', 'create-wo-details',
    'notification-center', 'edit-work-order-section', 'sign-out']) {
    assert.match(html, new RegExp('id="' + id + '"'), id + ' missing');
  }
  assert.match(html, /navigation\.js\?v=modern-premium-stage2-20261017/);
  assert.match(html, /styles\.css\?v=modern-premium-stage2-20261017/);
  assert.match(css, /#results-card\[data-fwh-view\]:not\(\[data-fwh-view="work"\]\) > #fwh-work-page/);
  assert.match(nav, /new MutationObserver\(syncTeam\)/);
  assert.match(nav, /button\.hidden = !available/);
  assert.match(nav, /if \(view === 'create'\) create\.open = true/);
  assert.match(nav, /if \(view === 'alerts'\) alerts\.open = true/);
  assert.match(nav, /create\.addEventListener\('toggle'/);
  assert.doesNotMatch(nav, /fetch\(|localStorage|sessionStorage|accessToken|adminFetch|showModal|innerHTML/);
  assert.equal((html.match(/data-job-tab="/g) || []).length, 6,
    'Selected-job tabs remain unchanged');
});