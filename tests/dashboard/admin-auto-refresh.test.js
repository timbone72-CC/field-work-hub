const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '..', '..', 'dashboard', name), 'utf8').replace(/\r\n/g, '\n');
const rows = receipt => [
  { id: 'control-one', wo_number: 'TEST-0001', organization_id: 'test-org' },
  { id: 'control-two', wo_number: 'TEST-0002-ADMIN-ONLY', organization_id: 'test-org' },
  { id: 'disposable-wo', wo_number: 'FWH-TEST', organization_id: 'test-org', assignment_received_at: receipt }
];
const user = { id: 'test-admin', email: 'admin@example.invalid', app_metadata: { role: 'ADMIN', organization_id: 'test-org' } };
const contractors = [{ user_id: 'test-contractor', email: 'contractor@example.invalid', role: 'CONTRACTOR' }];
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fixture({ actualSignIn = false } = {}) {
  const elements = new Map();
  class Element {
    constructor(id = '') {
      this.id = id; this.value = ''; this.textContent = ''; this.disabled = false;
      this.options = []; this.events = {}; this.classes = new Set();
      this.classList = { contains: x => this.classes.has(x), add: x => this.classes.add(x), remove: x => this.classes.delete(x) };
    }
    addEventListener(event, callback) { (this.events[event] ||= []).push(callback); }
    click() { for (const callback of this.events.click || []) callback(); }
    setAttribute() {}
    after(element) { elements.set(element.id, element); }
    replaceChildren(...options) { this.options = options; this.value = ''; }
    add(option) { this.options.push(option); }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const timers = new Map(); let timerId = 0;
  const calls = { list: 0, render: 0, summary: 0, requests: [], messages: [] };
  const storage = new Map();
  const context = vm.createContext({
    console, AbortSignal, Option: function(text, value) { this.text = text; this.value = value; },
    navigator: { onLine: true },
    document: { hidden: false, events: {}, getElementById: get, createElement: () => new Element(),
      addEventListener(event, callback) { this.events[event] = callback; } },
    window: { scrollX: 5, scrollY: 250, events: {}, addEventListener(event, callback) { this.events[event] = callback; },
      scrollTo(x, y) { this.scrollX = x; this.scrollY = y; } },
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    SUPABASE_URL: 'https://example.invalid', SUPABASE_PUBLISHABLE_KEY: 'test-public-key',
    accessToken: 'test-old-access', currentUser: structuredClone(user), workOrderRows: rows(''), assignableUsers: structuredClone(contractors),
    signOutButton: get('sign-out'), createButton: get('create'), saveEditButton: get('save'),
    assigneeSelect: get('assignee'), editAssigneeSelect: get('edit-assignee'), editSection: get('editor'),
    editWorkOrderIdInput: get('edit-id'), rlsResult: get('rls-result'),
    signInWithPassword: async () => ({ access_token: 'test-login-access', refresh_token: 'test-login-refresh', expires_in: 3600 }),
    renderSignedIn() {}, openEditor(id) { get('editor').classes.delete('hidden'); get('edit-id').value = id; },
    setLoginStatus: message => calls.messages.push(message), setEditStatus: message => calls.messages.push(message),
    requireAccessToken() { if (!context.accessToken) throw Error('No session'); },
    readableError: async () => 'Refresh rejected',
    fillAssigneeSelect(select, users, placeholder, selected) {
      select.replaceChildren({ text: placeholder, value: '' });
      for (const u of users) select.add({ text: u.email, value: u.user_id });
      select.value = users.some(u => u.user_id === selected) ? selected : '';
    },
    fetchCurrentUser: async () => structuredClone(user),
    fetchWorkOrders: async () => { calls.list++; return structuredClone(context.workOrderRows); },
    fetchAssignableUsers: async () => structuredClone(context.assignableUsers),
    fetchContractorSeatSummary: async () => ({ available_seats: 0 }),
    fetchPendingContractorInvitations: async () => [],
    renderRlsSummary() {}, renderWorkOrders() { calls.render++; }, renderContractorManagement() { calls.summary++; }, setContractorInviteStatus() {},
    fetch: async (url, options) => { calls.requests.push({ url, options }); throw Error('Unexpected test request'); }
  });
  context.signOutButton.addEventListener('click', () => { context.accessToken = null; context.currentUser = null; context.workOrderRows = []; });
  get('editor').classes.add('hidden'); get('assignee').value = 'test-contractor'; get('edit-assignee').value = 'test-contractor';
  if (actualSignIn) vm.runInContext(source('app.js').match(/async function signInWithPassword[\s\S]*?\n}\n/)[0], context);
  vm.runInContext(source('session.js'), context);
  vm.runInContext(source('app.js').match(/function verifyAdminRls[\s\S]*?\n}\n/)[0], context);
  vm.runInContext(source('auto-refresh.js'), context);
  const run = code => vm.runInContext(code, context);
  run("storeAdminSession({ access_token: accessToken, refresh_token: 'test-old-refresh', expires_in: 3600 })");
  return { context, calls, get, timers, storage, run };
}

test('updates every 15 seconds only while the signed-in page is visible and online', () => {
  const f = fixture(); f.run('renderSignedIn(workOrderRows, assignableUsers, "test-org")');
  assert.equal([...f.timers.values()][0].delay, 15000);
  f.context.document.hidden = true; f.context.document.events.visibilitychange(); assert.equal(f.timers.size, 0);
  f.context.document.hidden = false; f.context.document.events.visibilitychange(); assert.equal([...f.timers.values()][0].delay, 0);
  f.context.navigator.onLine = false; f.context.window.events.offline(); assert.equal(f.timers.size, 0);
  f.context.navigator.onLine = true; f.context.window.events.online(); assert.equal([...f.timers.values()][0].delay, 0);
  f.context.signOutButton.click(); assert.equal(f.timers.size, 0);
});

test('an unchanged snapshot does not rebuild the list', async () => {
  const f = fixture(); await f.run('refreshAdminViewAutomatically()'); assert.equal(f.calls.render, 0);
});

test('receipt changes appear without resetting inputs, selections or scroll', async () => {
  const f = fixture(); f.get('address').value = 'Unsaved address'; f.get('instructions').value = 'Unsaved instructions';
  f.run('openEditor("disposable-wo")'); f.context.fetchWorkOrders = async () => rows('confirmed');
  await f.run('refreshAdminViewAutomatically()');
  assert.equal(f.calls.render, 1); assert.equal(f.context.workOrderRows[2].assignment_received_at, 'confirmed');
  assert.equal(f.get('address').value, 'Unsaved address'); assert.equal(f.get('instructions').value, 'Unsaved instructions');
  assert.equal(f.get('assignee').value, 'test-contractor'); assert.equal(f.get('edit-assignee').value, 'test-contractor');
  assert.equal(f.context.window.scrollY, 250); assert.ok(f.calls.messages.some(x => x.includes('unsaved edits')));
});

test('keeps the selected Contractor when options change, including an unavailable selection', async () => {
  const f = fixture(); f.context.fetchAssignableUsers = async () => [];
  await f.run('refreshAdminViewAutomatically()');
  assert.equal(f.get('assignee').value, 'test-contractor'); assert.equal(f.get('assignee').disabled, true);
  assert.equal(f.get('assignee').options.at(-1).disabled, true);
});

test('does not overlap automatic polls', async () => {
  const f = fixture(); const pending = deferred(); f.context.fetchWorkOrders = () => { f.calls.list++; return pending.promise; };
  const first = f.run('refreshAdminViewAutomatically()'); await f.run('refreshAdminViewAutomatically()');
  assert.equal(f.calls.list, 1); pending.resolve(rows('')); await first;
});

test('discards a snapshot raced by a write rather than replacing newer dispatch data', async () => {
  const f = fixture(); const pending = deferred(); f.context.fetchWorkOrders = () => pending.promise;
  const first = f.run('refreshAdminViewAutomatically()'); f.run('adminWriteRevision++');
  pending.resolve(rows('old-receipt')); await first; assert.equal(f.calls.render, 0);
});

test('discards a response from a previous login', async () => {
  const f = fixture(); const pending = deferred(); f.context.fetchWorkOrders = () => pending.promise;
  const first = f.run('refreshAdminViewAutomatically()'); f.context.signOutButton.click();
  f.context.accessToken = 'test-other-access'; f.context.currentUser = { ...user, id: 'other-admin' };
  pending.resolve(rows('old-user-receipt')); await first; assert.equal(f.calls.render, 0); assert.equal(f.context.workOrderRows.length, 0);
});

test('a temporary read failure keeps the last received view and schedules a retry', async () => {
  const f = fixture(); f.context.fetchWorkOrders = async () => { throw Error('Network unavailable'); };
  await f.run('refreshAdminViewAutomatically()'); assert.equal(f.context.workOrderRows.length, 3);
  assert.match(f.get('admin-auto-refresh-status').textContent, /last received data/); assert.equal(f.timers.size, 1);
});

test('rejects wrong-organization data before it can replace the view', async () => {
  const f = fixture(); f.context.fetchWorkOrders = async () => [...rows(''), { organization_id: 'other-org' }];
  await f.run('refreshAdminViewAutomatically()'); assert.equal(f.calls.render, 0); assert.equal(f.context.workOrderRows.length, 3);
});

test('concurrent requests rotate an expired token once and both use the new token', async () => {
  const f = fixture(); const pending = deferred(); let refreshes = 0; const authorization = [];
  f.run("storeAdminSession({access_token: accessToken, refresh_token:'test-old-refresh', expires_at: 1})");
  f.context.fetch = async (url, options) => {
    if (url.includes('grant_type=refresh_token')) { refreshes++; return pending.promise; }
    authorization.push(options.headers.Authorization); return response([]);
  };
  const first = f.run('adminFetch("https://example.invalid/rest/v1/work_orders")');
  const second = f.run('adminFetch("https://example.invalid/rest/v1/rpc/admin_list_assignable_users")');
  pending.resolve(response({ access_token: 'test-new-access', refresh_token: 'test-new-refresh', expires_in: 3600, user }));
  await Promise.all([first, second]); assert.equal(refreshes, 1); assert.deepEqual(authorization, ['Bearer test-new-access', 'Bearer test-new-access']);
  assert.match([...f.storage.values()][0], /test-new-refresh/);
});

test('a delayed token refresh cannot restore a signed-out session', async () => {
  const f = fixture(); const pending = deferred(); f.run("storeAdminSession({access_token:accessToken, refresh_token:'test-refresh', expires_at:1})");
  f.context.fetch = () => pending.promise;
  const first = f.run('ensureFreshAdminSession()'); f.context.signOutButton.click();
  pending.resolve(response({ access_token: 'test-late-access', refresh_token: 'test-late-refresh', expires_in: 3600, user }));
  await assert.rejects(first, /session changed/); assert.equal(f.context.accessToken, null); assert.equal(f.storage.size, 0);
});

test('a temporary token-refresh failure preserves the session for a later retry', async () => {
  const f = fixture(); f.run("storeAdminSession({access_token:accessToken, refresh_token:'test-refresh', expires_at:1})");
  f.context.fetch = async () => { throw Error('Network unavailable'); };
  await assert.rejects(f.run('ensureFreshAdminSession()'), /connection failed/); assert.equal(f.context.accessToken, 'test-old-access'); assert.equal(f.storage.size, 1);
});

test('rejected refresh and changed Admin authority fail closed', async () => {
  for (const payload of [response({}, 400), response({ access_token: 'test-new-access', refresh_token: 'test-new-refresh', expires_in: 3600,
    user: { ...user, app_metadata: { role: 'CONTRACTOR', organization_id: 'test-org' } } })]) {
    const f = fixture(); f.run("storeAdminSession({access_token:accessToken, refresh_token:'test-refresh', expires_at:1})");
    f.context.fetch = async () => payload;
    await assert.rejects(f.run('ensureFreshAdminSession()')); assert.equal(f.context.accessToken, null); assert.equal(f.storage.size, 0);
  }
});

test('an unauthorized mutation is never automatically repeated', async () => {
  const f = fixture(); let requests = 0; f.context.fetch = async () => { requests++; return response({}, 401); };
  await assert.rejects(f.run('adminFetch("https://example.invalid/rest/v1/rpc/admin_create_work_order", {method:"POST"})'));
  assert.equal(requests, 1); assert.equal(f.context.accessToken, null); assert.equal(f.run('adminWritesPending'), 0);
});

test('a body arriving after sign-out cannot expose or apply the previous login data', async () => {
  const f = fixture(); const body = deferred();
  f.context.fetch = async () => ({ ok: true, status: 200, json: () => body.promise });
  const apiResponse = await f.run('adminFetch("https://example.invalid/auth/v1/user")');
  const payload = apiResponse.json(); f.context.signOutButton.click(); body.resolve(user);
  await assert.rejects(payload, /session changed/); assert.equal(f.context.currentUser, null);
});

test('fresh-token data denial retains its code and stage, clears access and never retries', async () => {
  const f = fixture(); let requests = 0;
  f.context.fetch = async () => {
    requests++;
    return response({code:'PGRST303',message:'JWT issued at future',details:'PRIVATE-TOKEN',hint:'PRIVATE-EMAIL'},401);
  };
  await assert.rejects(f.run('adminFetch(SUPABASE_URL+"/rest/v1/work_orders?address=PRIVATE-ADDRESS")'),error=>{
    assert.equal(error.status,401);assert.equal(error.code,'PGRST303');
    assert.equal(error.requestStage,'loading work orders');assert.ok(error.elapsedMs>=0);
    assert.match(error.message,/token time validation/);
    assert.doesNotMatch(error.message,/expired|PRIVATE|https:/);
    return true;
  });
  assert.equal(requests,1);assert.equal(f.storage.size,0);assert.equal(f.context.accessToken,null);
  assert.equal(f.context.currentUser,null);assert.equal(f.context.workOrderRows.length,0);
  assert.match(f.calls.messages.at(-1),/PGRST303/);
});

test('an old denial body cannot sign out a newer authenticated session',async()=>{
  const f=fixture(),body=deferred();
  f.context.fetch=async()=>({ok:false,status:401,json:()=>body.promise});
  const request=f.run('adminFetch(SUPABASE_URL+"/rest/v1/work_orders")');
  await new Promise(resolve=>setImmediate(resolve));
  f.context.signOutButton.click();
  f.context.accessToken='test-other-access';f.context.currentUser={...user,id:'other-admin'};
  f.run("storeAdminSession({access_token:accessToken,refresh_token:'other-refresh',expires_in:3600})");
  body.resolve({code:'PGRST303'});
  await assert.rejects(request,/session changed/);
  assert.equal(f.context.accessToken,'test-other-access');assert.equal(f.storage.size,1);
  assert.equal(f.calls.messages.some(message=>message.includes('PGRST303')),false);
});

test('fetch and body timeouts identify the request without retaining transport text',async()=>{
  for(const bodyTimeout of [false,true]){
    const f=fixture();
    const issue=new Error('PRIVATE-TRANSPORT');issue.name='TimeoutError';
    f.context.fetch=async()=>{
      if(!bodyTimeout)throw issue;
      return {ok:true,status:200,json:async()=>{throw issue;}};
    };
    await assert.rejects((async()=>{
      const result=await f.run('adminFetch(SUPABASE_URL+"/rest/v1/rpc/admin_list_assignable_users")');
      return result.json();
    })(),error=>{
      assert.equal(error.name,'TimeoutError');assert.equal(error.requestStage,'loading contractors');
      assert.doesNotMatch(JSON.stringify(error),/PRIVATE/);return true;
    });
  }
});

function loginFixture() {
  const f=fixture({actualSignIn:true});let submit;
  Object.assign(f.context,{
    loginForm:{addEventListener:(_event,callback)=>{submit=callback;}},
    emailInput:{value:'fixture@example.invalid'},passwordInput:{value:'SYNTHETIC-PASSWORD'},
    RecoveryGallery:{reset(){},async show(){throw Error('no recovery grant');}},
    authHeaders:()=>({})
  });
  f.context.currentUser=null;f.context.accessToken=null;f.context.workOrderRows=[];
  vm.runInContext(source('app.js').match(/async function fetchCurrentUser[\s\S]*?\n}\n/)[0],f.context);
  vm.runInContext(source('app.js').match(/loginForm\.addEventListener\('submit',[\s\S]*?\n}\);/)[0],f.context);
  return {...f,submit:()=>submit({preventDefault(){}})};
}

test('login separates successful password Auth from failed initial work access',async()=>{
  const f=loginFixture();let tokenCalls=0;
  f.context.fetch=async url=>{
    if(url.includes('/token')){tokenCalls++;return response({access_token:'new-access',refresh_token:'new-refresh',expires_in:3600});}
    if(url.endsWith('/user'))return response(user);
    return response({code:'PGRST303',message:'JWT issued at future'},401);
  };
  f.context.fetchWorkOrders=async()=>f.run('adminFetch(SUPABASE_URL+"/rest/v1/work_orders")');
  await f.submit();
  assert.equal(tokenCalls,1);assert.equal(f.context.passwordInput.value,'');
  assert.equal(f.context.currentUser,null);assert.equal(f.context.accessToken,null);assert.equal(f.storage.size,0);
  assert.match(f.calls.messages.at(-1),/loading work orders.*PGRST303/);
  assert.doesNotMatch(f.calls.messages.at(-1),/session expired/);
});

test('login work timeout preserves only verified tab credentials and reports the data stage',async()=>{
  const f=loginFixture();
  f.context.fetch=async url=>{
    if(url.includes('/token'))return response({access_token:'new-access',refresh_token:'new-refresh',expires_in:3600});
    if(url.endsWith('/user'))return response(user);
    const issue=new Error('PRIVATE-TRANSPORT');issue.name='TimeoutError';throw issue;
  };
  f.context.fetchWorkOrders=async()=>f.run('adminFetch(SUPABASE_URL+"/rest/v1/work_orders")');
  await f.submit();
  assert.equal(f.storage.size,1);assert.match([...f.storage.values()][0],/new-refresh/);
  assert.equal(f.context.currentUser,null);assert.equal(f.context.accessToken,null);assert.equal(f.context.workOrderRows.length,0);
  assert.match(f.calls.messages.at(-1),/timed out while loading work orders/);
  assert.doesNotMatch(f.calls.messages.at(-1),/PRIVATE|new-refresh|SYNTHETIC-PASSWORD/);
});

test('password rejection and user-verification timeout have distinct safe login stages',async()=>{
  for(const passwordDenied of [true,false]){
    const f=loginFixture();f.storage.clear();
    f.context.fetch=async url=>{
      if(url.includes('/token'))return passwordDenied
        ?response({error_code:'invalid_credentials',message:'PRIVATE-ACCOUNT'},400)
        :response({access_token:'new-access',refresh_token:'new-refresh',expires_in:3600});
      const issue=new Error('PRIVATE-URL');issue.name='TimeoutError';throw issue;
    };
    await f.submit();
    assert.match(f.calls.messages.at(-1),passwordDenied?/signing in.*HTTP 400.*invalid_credentials/:/verifying your account/);
    assert.doesNotMatch(f.calls.messages.at(-1),/PRIVATE/);assert.equal(f.storage.size,0);
    assert.equal(f.context.accessToken,null);assert.equal(f.context.currentUser,null);
  }
});

test('malicious HTTP error fields never reach diagnostic messages',async()=>{
  const f=fixture();
  f.context.fetch=async()=>response({code:'PRIVATE-CODE',message:'PRIVATE-MESSAGE',error_code:'PRIVATE-EMAIL'},401);
  await assert.rejects(f.run('adminFetch(SUPABASE_URL+"/rest/v1/work_orders")'),error=>{
    assert.equal(error.code,undefined);assert.doesNotMatch(error.message,/PRIVATE/);return true;
  });
});

test('restore of a rejected user request reports its code without rotating or reopening access',async()=>{
  const f=fixture();let requests=0;
  f.context.authHeaders=()=>({});f.context.RecoveryGallery={reset(){}};
  vm.runInContext(source('app.js').match(/async function fetchCurrentUser[\s\S]*?\n}\n/)[0],f.context);
  f.context.fetch=async()=>{requests++;return response({code:'PGRST303'},401);};
  await f.run('restoreAdminSession()');
  assert.equal(requests,1);assert.equal(f.storage.size,0);assert.equal(f.context.accessToken,null);
  assert.match(f.calls.messages.at(-1),/verifying your account.*PGRST303/);
});

test('superseded password login failure cannot clear a newer verified login',async()=>{
  const f=loginFixture(),body=deferred();let workRequests=0;
  f.context.fetch=async url=>{
    if(url.includes('/token'))return response({access_token:'new-access',refresh_token:'new-refresh',expires_in:3600});
    if(url.endsWith('/user'))return response(user);
    workRequests++;
    return workRequests===1?{ok:false,status:401,json:()=>body.promise}:response([]);
  };
  f.context.fetchWorkOrders=async()=>{
    const result=await f.run('adminFetch(SUPABASE_URL+"/rest/v1/work_orders")');return result.json();
  };
  const previous=f.submit();await new Promise(resolve=>setImmediate(resolve));
  await f.submit();
  body.resolve({code:'PGRST303'});await previous;
  assert.equal(f.context.accessToken,'new-access');assert.equal(f.context.currentUser.id,user.id);
  assert.equal(f.storage.size,1);assert.equal(f.calls.messages.some(message=>message.includes('PGRST303')),false);
});
