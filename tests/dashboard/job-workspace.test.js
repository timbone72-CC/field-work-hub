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
  assert.equal(facts.project({field_status:'ASSIGNED',assigned_user_id:'contractor-uuid',run:{assignment:[{
    assigned_user_id:'contractor-uuid',assignment_ended_at:null,
    acknowledgment_received_at:'2026-10-10T18:05:00Z'
  }]}}).label,'Accepted by contractor');
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

test('Phase 6B dashboard reads the current assignment Accept fact without replacing receipt truth',()=>{
 const source=fs.readFileSync(require.resolve('../../dashboard/app.js'),'utf8');
 assert.match(source,/assignment:work_order_assignments!work_order_assignments_run_id_fkey/);
 for(const field of ['assignment_received_at','acknowledgment_received_at','assignment_ended_at'])
   assert.match(source,new RegExp(field));
 const workspace=fs.readFileSync(require.resolve('../../dashboard/job-workspace.js'),'utf8');
 assert.match(workspace,/Accepted by contractor/);
 assert.match(workspace,/Assignment received/);
 assert.match(workspace,/formatTimestamp\(row\.assignment_received_at\)/);
 assert.match(source,/JobOperationalFacts\.currentAssignment\(row\)\?\.acknowledgment_received_at/);
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


test('Phase 6A previous/next stays in result order across bounded server pages',()=>{
 const rows=Array.from({length:25},(_,i)=>({id:'job-'+(i+26)}));
 rows.page={offset:25,total:75};
 const step=rules.JobResultNavigation.step;
 assert.deepEqual(step(rows,'job-27',1,25),{kind:'job',id:'job-28'});
 assert.deepEqual(step(rows,'job-26',-1,25),{kind:'page',offset:0,delta:-1});
 assert.deepEqual(step(rows,'job-50',1,25),{kind:'page',offset:50,delta:1});
 assert.equal(step(rows,'job-missing',1,25),null);
 assert.equal(step(rows,'job-50',1,100),null);
 const last=rows.slice();last.page={offset:50,total:75};
 assert.equal(step(last,'job-50',1,25),null);
 const unknown=rows.slice();unknown.page={offset:25,total:null};
 assert.equal(step(unknown,'job-50',1,25),null,'Unknown total cannot guess a new job');
 const partial=rows.slice(0,12);partial.page={offset:25,total:75};
 assert.equal(step(partial,'job-37',1,25),null,'Do not invent a neighboring job after a partial page');
});

test('Phase 6A cross-page job movement uses saved filters, current account and unsaved guard',()=>{
 const source=fs.readFileSync(require.resolve('../../dashboard/job-workspace.js'),'utf8');
 const move=source.split('  function move(delta) {')[1]?.split('  function init() {')[0];
 assert.ok(move,'Keep one job-to-job navigation owner');
 for(const pattern of [/JobResultNavigation\.step/,/guard\(async\(\)=>/,/change\(target.offset,true\)/,
   /accessToken!==token/,/currentUser\?\.id!==actor/,/selectedRow\?\.id!==selected/,
   /workOrderRows\.page\?\.offset!==target.offset/,/await load\(candidate.id\)/,
   /if\(editedAgain\)guard\(\(\)=>load\(candidate.id\)\)/])
  assert.match(move,pattern);
 assert.match(source,/const previous=state;/);
 assert.match(source,/state=previous;revision\+\+;/);
 assert.doesNotMatch(move,/admin_create_work_order|admin_update_work_order|admin_send/);
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
  assert.match(html, /styles\.css\?v=modern-premium-stage9-recovery-20261017/);
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
  assert.match(html, /navigation\.js\?v=modern-premium-stage2b-20261017/);
  assert.match(html, /styles\.css\?v=modern-premium-stage9-recovery-20261017/);
  assert.match(css, /#results-card\[data-fwh-view\]:not\(\[data-fwh-view="work"\]\) > #fwh-work-page/);
  assert.match(nav, /new MutationObserver\(syncTeam\)/);
  assert.match(nav, /button\.hidden = !available/);
  assert.match(nav, /ownerConsole\(\) \|\| contractorConsole\(\)/);
  assert.match(css, /#contractor-management-section/);
  assert.match(nav, /if \(view === 'create'\) create\.open = true/);
  assert.match(nav, /if \(view === 'alerts'\) alerts\.open = true/);
  assert.match(nav, /create\.addEventListener\('toggle'/);
  assert.doesNotMatch(nav, /fetch\(|localStorage|sessionStorage|accessToken|adminFetch|showModal|innerHTML/);
  assert.equal((html.match(/data-job-tab="/g) || []).length, 6,
    'Selected-job tabs remain unchanged');
});

test('Modern Premium Stage 3 visually prioritizes actual job status without changing any actions', () => {
  const html = fs.readFileSync(require.resolve('../../dashboard/index.html'), 'utf8');
  const css = fs.readFileSync(require.resolve('../../dashboard/styles.css'), 'utf8');
  const js = fs.readFileSync(require.resolve('../../dashboard/job-workspace.js'), 'utf8');
  const stage = css.split('/* Modern Premium Stage 3:')[1];
  assert.ok(stage, 'Stage 3 overrides must be isolated');
  assert.match(html, /styles\.css\?v=modern-premium-stage9-recovery-20261017/);
  assert.match(html, /class="fwh-job-identity"/);
  assert.match(html, /class="workspace-navigation fwh-job-guidance"/);
  assert.match(html, /id="job-next-action"/);
  assert.match(html, /id="job-next-action-open"/);
  assert.match(html, /id="job-unsaved"/);
  assert.match(stage, /#edit-work-order-section #job-next-action-open/);
  assert.match(stage, /@media \(max-width: 620px\)/);
  assert.doesNotMatch(stage, /(?:display:\s*none|visibility:\s*hidden|pointer-events:\s*none)/i);
  for (const id of ['job-previous','job-next','job-reload','prepare-repeat-work',
    'prepare-custom-work','job-address-load','job-address-previous',
    'job-address-next','save-edit','cancel-edit','job-save-continue','job-stay','job-discard']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'Missing operational control: ' + id);
  }
  for (const panel of ['details','assignment','requirements','photos','delivery','history']) {
    assert.match(html, new RegExp('data-job-tab="' + panel + '"'), 'Missing tab: ' + panel);
    assert.match(html, new RegExp('data-job-panel="' + panel + '"'), 'Missing panel: ' + panel);
  }
  assert.equal((html.match(/data-job-tab="/g) || []).length, 6);
  assert.ok(html.indexOf('id="job-address-context"') > html.indexOf('id="cancel-edit"'),
    'The unchanged secondary exact-address controls follow primary job details and actions');
  assert.match(stage, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
    'Mobile tabs must stay readable and visible');
  assert.match(js, /el\('job-next-action-open'\)\.addEventListener\('click'/);
  assert.match(js, /editSection\.addEventListener\('cancel'/);
});


test('Modern Premium Stage 4 keeps the original Create & Assign controls usable', () => {
  const html = fs.readFileSync(require.resolve('../../dashboard/index.html'), 'utf8');
  const css = fs.readFileSync(require.resolve('../../dashboard/styles.css'), 'utf8');
  const stage = css.split('/* Modern Premium Stage 4:')[1];
  assert.ok(stage, 'Create & Assign presentation must be independently scoped');
  assert.match(html, /styles\.css\?v=modern-premium-stage9-recovery-20261017/);
  for (const id of ['create-wo-details','create-wo-form','wo-number-mode-auto',
    'wo-number-mode-custom','custom-wo-number-field','wo-number',
    'remember-wo-number-mode','property-address','work-type-choice','work-type',
    'due-date','instructions','assignee','create-photo-requirements',
    'create-wo','create-status']) {
    assert.equal((html.match(new RegExp('id="' + id + '"','g'))||[]).length, 1,
      'Original control must remain exactly once: ' + id);
  }
  assert.match(stage, /#create-wo-form > #create-photo-requirements/);
  assert.match(stage, /@media \(max-width: 680px\)/);
  assert.doesNotMatch(stage, /(?:display:\s*none|visibility:\s*hidden|pointer-events:\s*none)/i);
  const js = fs.readFileSync(require.resolve('../../dashboard/app.js'), 'utf8');
  assert.match(js, /createForm\.addEventListener\('submit'/);
});


test('Modern Premium Stage 5 preserves original alert actions, preferences and provider controls', () => {
  const html=fs.readFileSync(require.resolve('../../dashboard/index.html'),'utf8');
  const css=fs.readFileSync(require.resolve('../../dashboard/styles.css'),'utf8');
  const js=fs.readFileSync(require.resolve('../../dashboard/notifications.js'),'utf8');
  const stage=css.split('/* Modern Premium Stage 5:')[1];
  assert.ok(stage,'Alerts styling must be isolated');
  assert.match(html,/styles\.css\?v=modern-premium-stage9-recovery-20261017/);
  for (const id of ['notification-center','notification-refresh','notification-count',
    'notification-status','notification-list','notification-org-timezone',
    'notification-timezone-save','notification-push-status',
    'notification-device-class','notification-push-enable',
    'notification-push-disable','notification-settings']) {
    assert.equal((html.match(new RegExp('id="' + id + '"','g'))||[]).length,1,
      'Original alert control must remain once: '+id);
  }
  assert.match(js,/el\('notification-settings'\)/);
  assert.match(js,/const row=document\.createElement\('div'\);row\.className='notification-preference'/);
  assert.match(js,/const li=document\.createElement\('li'\);li\.className='notification-item'/);
  for(const label of ['Open work order','Acknowledge','Snooze 4 hours']){
    assert.ok(js.includes(label),'Existing alert operation must be retained: '+label);
  }
  assert.match(stage, /#notification-center #notification-list > ol/);
  assert.match(stage, /#notification-center \.notification-preference/);
  assert.match(stage, /@media \(max-width: 620px\)/);
  assert.doesNotMatch(stage, /(?:display:\s*none|visibility:\s*hidden|pointer-events:\s*none)/i);
});


test('Modern Premium Stage 6 keeps Team & Access owner and Admin controls intact', () => {
  const html=fs.readFileSync(require.resolve('../../dashboard/index.html'),'utf8');
  const css=fs.readFileSync(require.resolve('../../dashboard/styles.css'),'utf8');
  const nav=fs.readFileSync(require.resolve('../../dashboard/navigation.js'),'utf8');
  const contractors=fs.readFileSync(require.resolve('../../dashboard/contractors.js'),'utf8');
  const owner=fs.readFileSync(require.resolve('../../dashboard/owner-management.js'),'utf8');
  const stage=css.split('/* Modern Premium Stage 6')[1];
  assert.ok(stage, 'Team styling must remain isolated to the existing panels');
  assert.match(html, /styles\.css\?v=modern-premium-stage9-recovery-20261017/);
  assert.match(nav, /ownerConsole\(\) \|\| contractorConsole\(\)/);
  assert.match(nav, /button\.hidden = !available/);
  assert.match(stage, /#contractor-management-section/);
  assert.match(stage, /#owner-office-console/);
  assert.match(stage, /@media \(max-width: 680px\)/);
  assert.doesNotMatch(stage, /(?:display:\s*none|visibility:\s*hidden|pointer-events:\s*none)/i);
  assert.match(contractors, /section\.id = 'contractor-management-section'/);
  for (const id of ['contractor-invite-form',
    'contractor-seat-summary','contractor-invite-name','contractor-invite-email',
    'contractor-invite-button','contractor-refresh-button','contractor-invite-status',
    'contractor-setup-link-result','contractor-setup-link',
    'contractor-copy-setup-link','pending-contractor-invitations'])
    assert.match(contractors, new RegExp('id="' + id + '"'), 'Missing original Admin control: '+id);
  assert.match(owner, /section\.id = 'owner-office-console'/);
  for (const id of ['owner-office-limit-form',
    'owner-office-reason','owner-admin-limit','owner-supervisor-limit',
    'owner-office-limit-save','owner-enrollment','owner-enrollment-form',
    'owner-supervisor-list','owner-admin-invite-form','owner-admin-invite-submit',
    'owner-contractor-roster','owner-office-people','owner-access-review-panel'])
    assert.match(owner, new RegExp('id="' + id + '"'), 'Missing original Owner control: '+id);
  assert.match(owner, /'owner-office-console'/);
  assert.match(html, /data-fwh-go="team" hidden/);
});


test('Modern Premium Stage 7 preserves Supervisor-only controls and scope', () => {
 const html=fs.readFileSync(require.resolve('../../dashboard/index.html'),'utf8');
 const css=fs.readFileSync(require.resolve('../../dashboard/styles.css'),'utf8');
 const js=fs.readFileSync(require.resolve('../../dashboard/staffing.js'),'utf8');
 const stage=css.split('/* Modern Premium Stage 7')[1];
 assert.ok(stage,'Supervisor styling must be isolated');
 assert.match(html,/styles\.css\?v=modern-premium-stage9-recovery-20261017/);
 assert.match(js,/card\.id = 'staffing-card'/);
 assert.match(js,/currentUser\?\.app_metadata\?\.role === 'SUPERVISOR'/);
 for(const id of ['staffing-invite-form','staffing-operation','staffing-team-choice',
  'staffing-team-new','staffing-name','staffing-email','staffing-reason','staffing-submit',
  'staffing-roster-area','staffing-roster-person','staffing-roster-team',
  'staffing-roster-submit','staffing-work-area','staffing-work-rows','staffing-work-detail',
  'staffing-work-edit-form','staffing-handoff-area','staffing-handoff-preview',
  'staffing-handoff-confirm','staffing-link-result','staffing-copy']) {
   assert.match(js,new RegExp('id="' + id + '"'),'Supervisor control missing: '+id);
 }
 assert.match(stage,/#staffing-card \.table-scroll/);
 assert.match(stage,/@media \(max-width:680px\)/);
 assert.doesNotMatch(stage,/(?:display:\s*none|visibility:\s*hidden|pointer-events:\s*none)/i);
});


test('Modern Premium Stage 8 preserves real invite setup controls and role-bound handlers',()=>{
 const css=fs.readFileSync(require.resolve('../../dashboard/styles.css'),'utf8');
 const main=fs.readFileSync(require.resolve('../../dashboard/index.html'),'utf8');
 const stage=css.split('/* Modern Premium Stage 8:')[1];
 assert.ok(stage,'Setup styling must be scoped');
 assert.match(main,/styles\.css\?v=modern-premium-stage9-recovery-20261017/);
 assert.match(stage,/body\.fwh-setup-page #invite-check/);
 assert.match(stage,/body\.fwh-setup-page #password-form/);
 assert.match(stage,/@media \(max-width:620px\)/);
 for(const [file,jsFile] of [['admin-invite.html','admin-invite.js'],['contractor-invite.html','contractor-invite.js']]){
  const html=fs.readFileSync(require.resolve('../../dashboard/'+file),'utf8');
  const js=fs.readFileSync(require.resolve('../../dashboard/'+jsFile),'utf8');
  assert.match(html,/<body class="fwh-setup-page">/);
  assert.match(html,/styles\.css\?v=modern-premium-stage8-setup-20261017/);
  for(const id of ['invite-check','password-form','invite-identity','new-password',
   'confirm-password','set-password','setup-status']){
   assert.equal((html.match(new RegExp('id="' + id + '"','g'))||[]).length,1,
    file+' must preserve original control: '+id);
  }
  assert.ok(html.includes('src="'+jsFile+'?v='),'Original Auth owner must remain');
  assert.equal((html.match(/minlength="10"/g)||[]).length,2);
  assert.match(js,/history\.replaceState/);
  assert.match(js,/password/);
  if(file==='contractor-invite.html'){
   assert.ok(html.includes('contractor-invite.js?v=modern-premium-stage10-copy-20261017'));
   assert.match(js,/Open the Field Work Hub app and sign in/);
   assert.match(js,/not a valid Field Work Hub Contractor setup link/);
   assert.doesNotMatch(js,/Field Photo Prep Team/);
  }
 }
});


test('Modern Premium Stage 9 visually isolates restricted photo recovery without changing access',()=>{
 const html=fs.readFileSync(require.resolve('../../dashboard/index.html'),'utf8');
 const css=fs.readFileSync(require.resolve('../../dashboard/styles.css'),'utf8');
 const js=fs.readFileSync(require.resolve('../../dashboard/recovery.js'),'utf8');
 const stage=css.split('/* Modern Premium Stage 9:')[1];
 assert.ok(stage,'Recovery styling must be isolated from the work dashboard');
 assert.match(html,/styles\.css\?v=modern-premium-stage9-recovery-20261017/);
 assert.match(js,/card\.id = 'recovery-card'/);
 assert.match(js,/card\.className = 'card hidden'/);
 assert.match(js,/photo_recovery_page/);
 assert.match(js,/recovery-private-photo/);
 assert.match(js,/SHA-256/);
 assert.match(js,/adminFetch/);
 assert.match(js,/new URL\(answer\?\.url/);
 assert.match(js,/more\.hidden = !next/);
 assert.match(js,/download\.disabled = true/);
 assert.match(js,/document\.createElement\('button'\)/);
 assert.match(js,/download\.textContent = 'Download selected JPEG'/);
 assert.match(js,/signOut\.textContent = 'Sign Out'/);
 assert.match(stage,/#recovery-card > div:first-of-type/);
 assert.match(stage,/#recovery-card > \.workspace-navigation/);
 assert.match(stage,/@media \(max-width:680px\)/);
 assert.doesNotMatch(stage,/#recovery-card\s*\{[^}]*display\s*:/);
 assert.doesNotMatch(stage,/(?:display:\s*none|visibility:\s*hidden|pointer-events:\s*none)/i);
});


test('Phase 6A paging discards unsafe offsets rather than issuing invalid page requests', () => {
  for (const offset of [-1, -25, 1.25, NaN, Infinity, 'not-an-offset', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(rules.parameters({size:50,offset}).get('offset'), '0', String(offset));
  }
  assert.equal(rules.parameters({size:50,offset:50}).get('offset'), '50');
  assert.equal(rules.parameters({size:25,offset:0}).get('offset'), '0');
});

test('Phase 6A due-date filter only accepts real calendar days, including leap years', () => {
  for (const dueDate of ['2026-02-29', '2026-02-30', '2026-02-31', '2026-04-31',
    '1900-02-29', '2026-13-01', '2026-00-10', '2026-10-00', '2026-01-01,or.true']) {
    assert.equal(rules.parameters({dueDate}).has('due_date'), false, dueDate);
  }
  for (const dueDate of ['2000-02-29', '2024-02-29', '2026-10-26']) {
    assert.equal(rules.parameters({dueDate}).get('due_date'), 'eq.'+dueDate, dueDate);
  }
});

test('Phase 6A unknown or unsafe content-range totals stay unknown', () => {
  for (const header of ['0-24/9007199254740992', '0-24/99999999999999999999999',
    '0-24/*', 'malformed', null]) {
    assert.equal(rules.total(header), null, String(header));
  }
  assert.equal(rules.total('0-24/100'), 100);
  assert.equal(rules.total('*/0'), 0);
});


test('Phase 6A job navigation identifies page boundaries without selecting a different work order', () => {
  const source=fs.readFileSync(require.resolve('../../dashboard/job-workspace.js'),'utf8');
  const navigation=source.match(/  function navigation\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(navigation);
  function run(ids,selected,offset,total){
    const elements={};
    const workOrderRows=ids.map(id=>({id}));
    workOrderRows.page={offset,total};
    let contexts=0;
    vm.runInNewContext(navigation+'\nnavigation();',{
      workOrderRows,selectedRow:selected?{id:selected}:null,state:{offset,size:25},
      JobResultNavigation:rules.JobResultNavigation,
      el:id=>(elements[id]??={disabled:false,textContent:''}),
      addressContext:()=>{contexts++;}
    });
    assert.equal(contexts,1);
    return elements;
  }
  assert.equal(run(['job-a'],'job-a',0,1)['job-context'].textContent,'End of current results.');
  assert.match(run(['job-a','job-b'],'job-b',0,5)['job-context'].textContent,/Next page in the job list/);
  const first=run(['job-c','job-d'],'job-c',2,5);
  assert.match(first['job-context'].textContent,/Previous opens the preceding result page/);
  assert.equal(first['job-previous'].disabled,false);
  assert.equal(first['job-next'].disabled,false);
  assert.match(run(['job-a','job-b'],'job-outside',0,2)['job-context'].textContent,/outside the current page/);
  assert.equal(run(['job-a','job-b','job-c'],'job-b',0,3)['job-context'].textContent,'');
  assert.equal(run(['job-a'],'job-a',0,null)['job-context'].textContent,
    'End of this page. Use Next page in the job list for more results.');
});
