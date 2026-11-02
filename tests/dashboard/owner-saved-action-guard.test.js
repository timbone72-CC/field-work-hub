const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const text = fs.readFileSync(require.resolve('../../dashboard/owner-management.js'), 'utf8');
const begin = text.indexOf('async function ownerChange(action, onSuccess) {');
const end = text.indexOf('async function ownerSaveLimits()', begin);
assert.ok(begin >= 0 && end > begin, 'Use the existing Phase 6F owner change/busy owner');

function rig() {
  const statuses = [];
  const identity = {user:'test-owner',organization:'test-office'};
  const ctx = {
    ownerConsoleBusy:false,
    ownerConsoleData:{organization:'test-office'},
    ownerIdentity:()=>identity,
    ownerStillCurrent:check=>check === identity && ctx.current,
    current:true,
    ownerStatus:(msg,error=false)=>statuses.push({
      msg,error,busyAtDisplay:ctx.ownerConsoleBusy
    })
  };
  vm.runInNewContext(text.slice(begin,end) + '\nthis.callOwnerChange=ownerChange;',ctx);
  return {ctx,statuses,change:(action,success)=>ctx.callOwnerChange(action,success)};
}
function deferred() {
  let resolve,reject;
  const promise = new Promise((ok,fail)=>{resolve=ok;reject=fail;});
  return {promise,resolve,reject};
}

test('Saved is displayed only AFTER owner controls unlock, never in the busy gap',async()=>{
  const x=rig(), mutation=deferred(), refresh=deferred();
  let writes=0;
  const saving=x.change(async()=>{writes++;await mutation.promise;},
    async()=>await refresh.promise);
  assert.equal(x.ctx.ownerConsoleBusy,true);
  await x.change(async()=>{writes++;});
  assert.equal(writes,1,'The second click while saving must not duplicate a mutation');
  mutation.resolve();
  await Promise.resolve();await Promise.resolve();
  assert.equal(x.ctx.ownerConsoleBusy,true,
    'Refresh remains part of one guarded owner change');
  refresh.resolve();
  await saving;
  const last=x.statuses.at(-1);
  assert.match(last.msg,/Saved\. Server permissions and revisions verified/);
  assert.equal(last.busyAtDisplay,false,
    'A click immediately after Saved must not be silently dropped');
  assert.equal(x.ctx.ownerConsoleBusy,false);
});

test('a displayed owner error also permits the next deliberate action immediately',async()=>{
  const x=rig();
  await x.change(async()=>{throw new Error('Revision conflict: reload');});
  assert.equal(x.statuses.at(-1).msg,'Revision conflict: reload');
  assert.equal(x.statuses.at(-1).error,true);
  assert.equal(x.statuses.at(-1).busyAtDisplay,false);
  let invoked=false;
  await x.change(async()=>{invoked=true;});
  assert.equal(invoked,true,'A new owner action may be attempted after the error');
});

test('a stale owner session does not report Saved and always releases the busy guard',async()=>{
  const x=rig(), pending=deferred();
  const action=x.change(async()=>await pending.promise);
  assert.equal(x.ctx.ownerConsoleBusy,true);
  x.ctx.current=false;
  pending.resolve();
  await action;
  assert.equal(x.ctx.ownerConsoleBusy,false);
  assert.equal(x.statuses.some(entry=>entry.msg.startsWith('Saved.')),false);
});
