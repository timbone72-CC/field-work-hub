const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../../dashboard/push-device.js'), 'utf8');
const helper = source.indexOf('  function sameSession(');
const helperEnd = source.indexOf('  const base64=', helper);
const first = source.indexOf('  async function enroll(');
const last = source.indexOf('  async function localEnabled(', first);
assert.ok(helper >= 0 && helperEnd > helper && first > helperEnd && last > first,
  'Retain the real session fence and original enroll/disable/recovery owners');

function rig({old = false, saved = null, failRpc = false, onRead = null,
  onPermission = null} = {}) {
  const operations = [], stored = new Map();
  if(saved) stored.set('user-a:org-a', {...saved});
  const subscription = {
    toJSON() { return {endpoint: 'https://push.invalid/test',
      keys:{p256dh:'fixture-p256dh',auth:'fixture-auth'}}; },
    async unsubscribe() { operations.push('unsubscribe');return true; }
  };
  const worker = {
    scope: 'https://fwh.example/dashboard/',
    pushManager: {
      async getSubscription(){operations.push('getSubscription');return old?subscription:null;},
      async subscribe(){operations.push('subscribe');return subscription;}
    }
  };
  const ctx = {
    accessToken:'token-a',
    currentUser:{id:'user-a',app_metadata:{organization_id:'org-a'}},
    supported:()=>true, scope:()=>new URL('https://fwh.example/dashboard/'),
    navigator:{userAgent:'Chrome/130.0',serviceWorker:{
      async register(){operations.push('register');return worker;},
      async getRegistration(){operations.push('getRegistration');return worker;}
    }},
    Notification:{async requestPermission(){
      operations.push('permission');
      if(onPermission)onPermission(ctx);
      return 'granted';
    }},
    crypto:{randomUUID:()=> 'new-device'},
    key:(u,o)=>u+':'+o,
    vapidBytes:()=>new Uint8Array([1,2,3]),
    URL,
    async record(key,write=null) {
      if(write) {
        operations.push('write:'+(write.pending_revoke===true?'pending':write.pending_revoke===false?'confirmed':'other'));
        stored.set(key,{...write});return write;
      }
      operations.push('read');
      const value=stored.get(key)||null;
      if(onRead)onRead(ctx);
      return value;
    },
    async rpc(name) {
      operations.push('rpc:'+name);
      if(failRpc)throw Error('Provider response unavailable');
      return {revision:'rev-new'};
    }
  };
  vm.runInNewContext(source.slice(helper,helperEnd) + '\n' +
    source.slice(first,last) + '\nthis.actions={enroll,disable,reconcilePending};',ctx);
  return {ctx,actions:ctx.actions,operations,stored,subscription};
}

test('failed reenrollment preserves a previously working browser subscription and durable device record',async()=>{
  const x=rig({old:true,saved:{device_id:'device-a',revision:'rev-a',pending_revoke:false},
    failRpc:true});
  await assert.rejects(x.actions.enroll('COMPUTER',{
    push_ready:true,vapid_public_key:'public',organization_id:'org-a'
  }),/Provider response unavailable/);
  assert.equal(x.operations.includes('unsubscribe'),false);
  assert.equal(x.operations.includes('subscribe'),false);
  assert.deepEqual(x.stored.get('user-a:org-a'),
    {device_id:'device-a',revision:'rev-a',pending_revoke:false});
});

test('another account cannot silently reuse an unknown existing browser subscription',async()=>{
  const x=rig({old:true});
  await assert.rejects(x.actions.enroll('COMPUTER',{
    push_ready:true,vapid_public_key:'public',organization_id:'org-a'
  }),/not owned by this office account/);
  assert.equal(x.operations.includes('unsubscribe'),false);
  assert.equal(x.operations.some(op=>op.startsWith('rpc:')),false);
});

test('failed first subscription enroll cleans up only its new subscription and records pending revoke',async()=>{
  const x=rig({failRpc:true});
  await assert.rejects(x.actions.enroll('COMPUTER',{
    push_ready:true,vapid_public_key:'public',organization_id:'org-a'
  }),/Provider response unavailable/);
  assert.equal(x.operations.filter(op=>op==='unsubscribe').length,1);
  assert.equal(x.stored.get('user-a:org-a').pending_revoke,true);
  assert.equal(x.stored.get('user-a:org-a').device_id,'new-device');
});

test('account switch during permission cannot create or unsubscribe a subscription',async()=>{
  const x=rig({onPermission:ctx=>{ctx.currentUser={
    id:'user-b',app_metadata:{organization_id:'org-b'}};}});
  await assert.rejects(x.actions.enroll('COMPUTER',{
    push_ready:true,vapid_public_key:'public',organization_id:'org-a'
  }),/Session switched/);
  assert.equal(x.operations.includes('register'),false);
  assert.equal(x.operations.includes('unsubscribe'),false);
  assert.equal(x.operations.some(op=>op.startsWith('rpc:')),false);
});

test('Disable without this account browser identity never unsubscribes someone else',async()=>{
  const x=rig({old:true});
  await assert.rejects(x.actions.disable(),/No push enrollment belongs/);
  assert.equal(x.operations.includes('getRegistration'),false);
  assert.equal(x.operations.includes('unsubscribe'),false);
  assert.equal(x.operations.some(op=>op.startsWith('rpc:')),false);
});

test('Disable records revocation first and keeps it pending when the server fails',async()=>{
  const x=rig({old:true,failRpc:true,saved:{
    device_id:'device-a',revision:'rev-a',pending_revoke:false
  }});
  await assert.rejects(x.actions.disable(),/Provider response unavailable/);
  assert.ok(x.operations.indexOf('write:pending')<x.operations.indexOf('unsubscribe'));
  assert.equal(x.operations.filter(op=>op==='unsubscribe').length,1);
  assert.equal(x.stored.get('user-a:org-a').pending_revoke,true);
});

test('stale account after IndexedDB read cannot disable current browser push',async()=>{
  const x=rig({old:true,saved:{device_id:'device-a',revision:'rev-a'},
    onRead:ctx=>{ctx.currentUser={id:'user-b',
      app_metadata:{organization_id:'org-b'}};}});
  await assert.rejects(x.actions.disable(),/Session changed/);
  assert.equal(x.operations.includes('unsubscribe'),false);
  assert.equal(x.operations.some(op=>op.startsWith('rpc:')),false);
});

test('pending revoke from old actor does not unsubscribe or submit with a new actor token',async()=>{
  const x=rig({old:true,saved:{device_id:'device-a',revision:'rev-a',pending_revoke:true},
    onRead:ctx=>{ctx.currentUser={id:'user-b',
      app_metadata:{organization_id:'org-b'}};ctx.accessToken='token-b';}});
  await x.actions.reconcilePending();
  assert.equal(x.operations.includes('unsubscribe'),false);
  assert.equal(x.operations.some(op=>op.startsWith('rpc:')),false);
  assert.equal(x.stored.get('user-a:org-a').pending_revoke,true);
});

function signoutRig({saved=null,switchOnRead=false,offline=false}={}) {
  const actions = [], values = new Map();
  if(saved) values.set('user-a:org-a',{...saved});
  const ctx = {
    currentUser:{id:'user-a',app_metadata:{organization_id:'org-a'}},
    accessToken:'token-a', SUPABASE_URL:'https://fwh.example',
    SUPABASE_PUBLISHABLE_KEY:'public-test',
    crypto:{randomUUID:()=> 'action-a'},
    AbortSignal:{timeout:()=>undefined},
    key:(user,org)=>user+':'+org,
    async record(k,write=null){
      if(write){actions.push('save-pending');values.set(k,{...write});return write;}
      actions.push('read');
      if(switchOnRead)ctx.currentUser={id:'user-b',app_metadata:{organization_id:'org-b'}};
      return values.get(k)||null;
    },
    async disableLocal(){actions.push('unsubscribe');},
    async fetch(_url,options){
      actions.push('server-revoke');
      assert.equal(options.headers.Authorization,'Bearer token-a');
      if(offline)throw Error('Offline');
      return {ok:true,async json(){return {revision:'rev-closed'};}};
    }
  };
  const start=source.indexOf('  function signedOut(){');
  const end=source.indexOf('  return {supported,enroll,disable',start);
  assert.ok(start>=0&&end>start,'Original sign-out push owner remains present');
  vm.runInNewContext(source.slice(start,end)+'\nthis.signout=signedOut;',ctx);
  return {ctx,actions,values,async run(){
    ctx.signout();
    // The sign-out handler intentionally cannot block the page's session reset.
    await new Promise(resolve=>setImmediate(resolve));
  }};
}

test('sign-out without a saved identity never unsubscribes another office account',async()=>{
  const x=signoutRig();
  await x.run();
  assert.deepEqual(x.actions,['read']);
});

test('signed-out old actor revokes with captured token but never unsubscribes new actor',async()=>{
  const x=signoutRig({saved:{device_id:'device-a',revision:'rev-a'},
    switchOnRead:true});
  await x.run();
  assert.equal(x.actions.includes('unsubscribe'),false);
  assert.ok(x.actions.indexOf('save-pending')<x.actions.indexOf('server-revoke'));
  assert.equal(x.values.get('user-a:org-a').pending_revoke,false);
  assert.equal(x.values.get('user-a:org-a').revision,'rev-closed');
});

test('offline sign-out unsubscribes saved local device and keeps revocation pending',async()=>{
  const x=signoutRig({saved:{device_id:'device-a',revision:'rev-a'},offline:true});
  await x.run();
  assert.ok(x.actions.indexOf('save-pending')<x.actions.indexOf('unsubscribe'));
  assert.ok(x.actions.indexOf('unsubscribe')<x.actions.indexOf('server-revoke'));
  assert.equal(x.values.get('user-a:org-a').pending_revoke,true);
});
