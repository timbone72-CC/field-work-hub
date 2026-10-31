'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../dashboard/app.js'),'utf8');
const start=source.indexOf("editForm.addEventListener('submit', async (event) => {");
const end=source.indexOf("\n});\n\ncancelEditButton.addEventListener",start);
assert.ok(start>=0&&end>start,'Use actual edit submit owner');
const handler=source.slice(start,end+4);
const a=source.indexOf('async function updateWorkOrder(');
const b=source.indexOf('\nasync function refreshWorkOrders()',a);
assert.ok(a>=0&&b>a);
const rpc=source.slice(a,b);

function rig(result) {
 let callback,calls=0,reloads=0,refreshes=0,uncertain=0,continued=0;
 const notices=[],writes=[];
 const saveButton={disabled:false},editForm={inert:false,addEventListener(type,fn){assert.equal(type,'submit');callback=fn;}};
 const currentUser={id:'admin-a',app_metadata:{organization_id:'org-a'}};
 const job={stale:false,needsReload(){return this.stale;},saveUnverified(){this.stale=true;uncertain++;},
   saved(){this.stale=true;},selectedUpdatedAt(){return '2026-10-01T12:00:00Z';},async reconcileSaved(){reloads++;return ()=>{continued++;};}};
 const ctx={editForm,saveEditButton:saveButton,JobWorkspace:job,adminSessionEpoch:1,
  currentUser,accessToken:'token-a',editWorkOrderIdInput:{value:'job-a'},
  editWoNumberInput:{value:' WO '},editPropertyAddressInput:{value:' ROAD '},
  editWorkTypeInput:{value:' Site '},editInstructionsInput:{value:'DRAFT'},
  editDueDateInput:{value:'2026-11-12'},editAssigneeSelect:{value:'contractor-a'},
  editPhotos:{snapshot:()=>[{label:'Roof'}],expectedRevision:'old-revision'},
  updateWorkOrder:async payload=>{writes.push(payload);calls++;
    if(result instanceof Error)throw result;
    return typeof result==='function'?result():result;},
  refreshWorkOrders:async()=>{refreshes++;},
  setEditStatus:(message,error)=>notices.push({message,error})
 };
 vm.createContext(ctx);vm.runInContext(handler,ctx);
 const run=()=>callback({preventDefault(){}});
 return {ctx,run,job,saveButton,editForm,notices,writes,
    get calls(){return {calls,reloads,refreshes,uncertain,continued};}};
}
function conflict(){const err=new Error('409 revision changed');err.workOrderConflict=true;return err;}
test('409 conflict preserves unsaved edit and blocks duplicate submit until reload',async()=>{
 const h=rig(conflict());await h.run();
 assert.equal(h.calls.calls,1);assert.equal(h.job.stale,true);
 assert.equal(h.ctx.editInstructionsInput.value,'DRAFT');
 assert.equal(h.writes[0].expectedWorkOrderUpdatedAt,'2026-10-01T12:00:00Z');
 assert.match(h.notices.at(-1).message,/server rejected.*conflict/i);
 assert.match(h.notices.at(-1).message,/do not resubmit/);
 await h.run();assert.equal(h.calls.calls,1);
});
test('network failure or missing receipt remains unconfirmed and never auto-repeats',async()=>{
 for(const outcome of [Error('connection lost'),[]]){
  const h=rig(outcome);await h.run();
  assert.equal(h.calls.calls,1);assert.equal(h.job.stale,true);
  assert.match(h.notices.at(-1).message,/not confirmed/);
  assert.match(h.notices.at(-1).message,/may have received/);
  await h.run();assert.equal(h.calls.calls,1);
 }
});
test('overlapping submit is single-flight while write is in progress',async()=>{
 let resolve;
 const pending=new Promise(r=>{resolve=r;});
 const h=rig(()=>pending);
 const first=h.run();await h.run();
 assert.equal(h.calls.calls,1);assert.equal(h.saveButton.disabled,true);
 resolve([{work_order_id:'job-a',wo_number:'WO'}]);await first;
 assert.deepEqual(h.calls,{calls:1,reloads:1,refreshes:1,uncertain:0,continued:1});
});
test('confirmed edit remains a confirmed edit',async()=>{
 const h=rig([{work_order_id:'job-a',wo_number:'WO'}]);await h.run();
 assert.deepEqual(h.calls,{calls:1,reloads:1,refreshes:1,uncertain:0,continued:1});
 assert.match(h.notices.at(-1).message,/Saved WO/);
});
test('late previous-account failure never marks another selected job stale',async()=>{
 let reject;
 const pending=new Promise((_,rej)=>{reject=rej;});
 const h=rig(()=>pending);const first=h.run();
 h.ctx.adminSessionEpoch=2;h.ctx.currentUser={id:'other-admin',app_metadata:{organization_id:'other-org'}};
 h.ctx.editWorkOrderIdInput.value='other-job';
 reject(Error('old session error'));await first;
 assert.equal(h.calls.uncertain,0);
 assert.deepEqual(h.notices.map(x=>x.message),['Saving changes…']);
});
test('409 HTTP error becomes explicit conflict; 503 remains uncertain',async()=>{
 const ctx={requireAccessToken(){},SUPABASE_URL:'https://example.invalid',authHeaders(){return {};},
  readableError:async()=>'revision changed',adminFetch:async()=>({ok:false,status:409})};
 vm.createContext(ctx);vm.runInContext(rpc,ctx);
 await assert.rejects(ctx.updateWorkOrder({}),e=>e.workOrderConflict===true);
 ctx.adminFetch=async()=>({ok:false,status:503});
 await assert.rejects(ctx.updateWorkOrder({}),e=>e.workOrderConflict===false);
});
