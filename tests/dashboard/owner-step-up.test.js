const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = name => fs.readFileSync(require.resolve('../../dashboard/'+name), 'utf8');
function segment(file,start,end) {
  const text=source(file), a=text.indexOf(start),b=text.indexOf(end,a);
  assert.ok(a>=0&&b>a);return text.slice(a,b);
}
const session=segment('session.js','async function reauthenticateCurrentAdmin(password)','function expireAdminSession(');
const step=segment('owner-management.js','async function ownerRequireRecentAuthentication(check)','function ownerFinishFreshPrompt(');
function authRig() {
  const user={id:'owner',email:'owner@example.invalid',app_metadata:{organization_id:'org',role:'ADMIN'}};
  let stored, result={user,access_token:'new-token',refresh_token:'new-refresh'};
  const ctx={currentUser:user,accessToken:'old-token',adminSessionEpoch:5,adminWritesPending:0,
    pendingAdminSession:null,adminRefreshPromise:null,
    originalSignInWithPassword:async(email,password)=>{assert.equal(email,user.email);assert.equal(password,'current-password');return result;},
    storeAdminSession:value=>{stored=value;}};
  vm.runInNewContext(session+';globalThis.verify=reauthenticateCurrentAdmin',ctx);
  return {ctx,setResult:v=>result=v,stored:()=>stored,user};
}
test('same identity password step-up adopts one fresh session without navigation or epoch reset',async()=>{
  const h=authRig();await h.ctx.verify('current-password');
  assert.equal(h.ctx.accessToken,'new-token');assert.equal(h.ctx.adminSessionEpoch,5);
  assert.equal(h.stored().refresh_token,'new-refresh');assert.equal(h.ctx.adminRefreshPromise,null);
});
test('different identity, wrong password, or changed session does not replace the current session',async()=>{
  const h=authRig();
  h.setResult({user:{...h.user,id:'another'},access_token:'bad',refresh_token:'bad'});
  await assert.rejects(h.ctx.verify('current-password'),/Identity or session changed/);
  assert.equal(h.ctx.accessToken,'old-token');assert.equal(h.stored(),undefined);
  h.ctx.originalSignInWithPassword=async()=>{throw Error('invalid credentials');};
  await assert.rejects(h.ctx.verify('current-password'),/invalid credentials/);
  assert.equal(h.ctx.accessToken,'old-token');assert.equal(h.ctx.adminRefreshPromise,null);
  h.ctx.originalSignInWithPassword=async()=>{h.ctx.adminSessionEpoch++;return {user:h.user,access_token:'late',refresh_token:'late'};};
  await assert.rejects(h.ctx.verify('current-password'),/Identity or session changed/);
  assert.equal(h.ctx.accessToken,'old-token');
});
function gateRig(statuses, accepted=true) {
  let prompts=0,reads=0,current=true;
  const identity={organization:'org'};
  const ctx={OWNER_CONSOLE_ENVIRONMENT:'TEST',ownerStillCurrent:check=>check===identity&&current,
    ownerRpc:async(name,params)=>{assert.equal(name,'owner_office_capacity_status');assert.equal(params.p_org,'org');return statuses[reads++];},
    ownerPromptFreshAuthentication:async()=>{prompts++;return accepted;}};
  vm.runInNewContext(step+';globalThis.requireFresh=ownerRequireRecentAuthentication',ctx);
  return {run:()=>ctx.requireFresh(identity),prompts:()=>prompts,reads:()=>reads,revoke:()=>{current=false;}};
}
const status=recent_authentication=>({organization_id:'org',recent_authentication});
test('fresh server authorization needs no prompt, stale authorization prompts once and rechecks the server',async()=>{
  const fresh=gateRig([status(true)]);await fresh.run();assert.equal(fresh.prompts(),0);assert.equal(fresh.reads(),1);
  const stale=gateRig([status(false),status(true)]);await stale.run();assert.equal(stale.prompts(),1);assert.equal(stale.reads(),2);
});
test('cancel, changed identity and missing/failing server verification cannot authorize changes',async()=>{
  const cancel=gateRig([status(false)],false);await assert.rejects(cancel.run(),/cancelled/);assert.equal(cancel.reads(),1);
  const notFresh=gateRig([status(false),status(false)]);await assert.rejects(notFresh.run(),/did not confirm/);
  const invalid=gateRig([{organization_id:'other',recent_authentication:true}]);await assert.rejects(invalid.run(),/could not be verified/);assert.equal(invalid.prompts(),0);
  const revoked=gateRig([status(true)]);revoked.revoke();await assert.rejects(revoked.run(),/session changed/);
});
