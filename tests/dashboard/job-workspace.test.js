const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const rules = require('../../dashboard/job-workspace.js');
const app = fs.readFileSync(require.resolve('../../dashboard/app.js'), 'utf8');

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

test('Phase 6B repeat work is a new, explicit draft without copying old WO/assignment/due date',()=>{
 const html=fs.readFileSync(require.resolve('../../dashboard/index.html'),'utf8');
 const text=fs.readFileSync(require.resolve('../../dashboard/app.js'),'utf8');
 const handler=text.split("document.getElementById('prepare-repeat-work').addEventListener")[1]?.split('function fillWorkTypes()')[0];
 assert.ok(handler);
 assert.match(html,/id="prepare-repeat-work"/);
 assert.match(html,/id="create-wo-details"/);
 for (const name of ['JobWorkspace.guard','fetchWorkOrder(oldId)','currentUser?.id!==actor',
  'editWorkOrderIdInput.value!==oldId','PhotoRules.copyPriorSnapshot','createForm.reset()',
  "applyWoNumberMode('auto')","propertyAddressInput.value=old.property_address",
  'workTypeInput.value=old.work_type','createPhotos.load(snapshot)'])
   assert.ok(handler.includes(name),name);
 assert.doesNotMatch(handler,/woNumberInput\.value\s*=|assigneeSelect\.value\s*=|dueDateInput\.value\s*=|createWorkOrder\(/);
});
