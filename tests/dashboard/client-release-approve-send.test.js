'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../dashboard/client-release.js'),'utf8');
const helper=source.slice(source.indexOf('  function canApprove()'),source.indexOf('  function buttons()'));
const handler=source.slice(source.indexOf('  async function approveAndSend(){'),source.indexOf('  async function loadNextPhotos(){'));
assert.ok(handler.includes('admin_queue_package'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,hash='a'.repeat(64);
function rig(options={}){
 const calls=[],messages=[],confirmations=[];
 let nonce=10;
 const approved={package_id:id(2),status:'APPROVED',revision:id(4),manifest_sha256:hash};
 const context={loaded:true,busy:false,wo:id(1),seq:1,accessToken:'fixture-token',
  previewedHash:hash,pkg:{id:id(2),revision:id(3),status:'DRAFT',manifest_sha256:hash,ready_to_approve:true},
  UUID:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  dirty:()=>!!options.dirty,crypto:{randomUUID:()=>id(nonce++)},
  valid:(n,wo,token)=>context.seq===n&&context.wo===wo&&context.accessToken===token,
  confirm:message=>{confirmations.push(message);options.onConfirm?.(context);return options.confirm!==false;},
  setBusy:value=>{context.busy=value;},status:(where,message)=>messages.push(message),
  load:async wo=>{calls.push({name:'load',wo});context.seq++;},
  rpc:async(name,body,token)=>{
   calls.push({name,body:structuredClone(body),token});assert.equal(context.busy,true);
   await options.beforeReply?.(name,context);
   if(options.fail===name)throw Error('Simulated lost response');
   if(name==='admin_approve_package')return options.approval?.(structuredClone(approved))||approved;
   if(name==='admin_package_state'){
    const result={work_order_id:id(1),package:{id:id(2),status:'APPROVED',revision:id(4),manifest_sha256:hash,can_send:true}};
    return options.state?.(result)||result;
   }
   if(name==='admin_queue_package')return options.queue?.({package_id:id(2),status:'QUEUED',revision:id(5),manifest_sha256:hash})
    ||{package_id:id(2),status:'QUEUED',revision:id(5),manifest_sha256:hash};
   throw Error('Unexpected RPC');
  }};
 vm.createContext(context);vm.runInContext(helper+'\n'+handler+'\nthis.run=approveAndSend;',context);
 return {context,calls,messages,confirmations,run:()=>context.run()};
}
test('one confirmation approves then queues the same checked package with its fresh approved revision',async()=>{
 const x=rig();await x.run();
 assert.deepEqual(x.calls.map(c=>c.name),['admin_approve_package','admin_package_state','admin_queue_package','load']);
 assert.equal(x.confirmations.length,1);
 const [approve,,send]=x.calls;
 assert.equal(approve.body.p_expected_revision,id(3));assert.equal(send.body.p_expected_revision,id(4));
 for(const request of [approve,send]){
  assert.equal(request.body.p_wo,id(1));assert.equal(request.body.p_package,id(2));
  assert.equal(request.body.p_manifest_sha256,hash);assert.equal(request.token,'fixture-token');
 }
 assert.notEqual(approve.body.p_action,send.body.p_action);assert.equal(x.context.busy,false);
 assert.equal(x.calls.some(c=>c.name==='admin_preview_package'),false,'The human does not preview twice');
});
test('unsaved, unpreviewed, ineligible and already approved packages cannot use the combined action',async()=>{
 for(const change of [x=>x.context.previewedHash=null,x=>x.context.pkg.ready_to_approve=false,
  x=>x.context.loaded=false,x=>x.context.pkg.status='APPROVED',x=>x.context.previewedHash='b'.repeat(64)]){
  const x=rig();change(x);await x.run();assert.equal(x.calls.length,0);assert.equal(x.confirmations.length,0);
 }
 const x=rig({dirty:true});await x.run();assert.equal(x.calls.length,0);
});
test('declining the confirmation performs no approval or Send',async()=>{
 const x=rig({confirm:false});await x.run();assert.equal(x.calls.length,0);assert.equal(x.context.busy,false);
});
test('a changed context during confirmation prevents any mutation',async()=>{
 const x=rig({onConfirm:ctx=>{ctx.seq++;}});await x.run();assert.equal(x.calls.length,0);
});
test('double click cannot overlap approval or queue a second request',async()=>{
 let resume;const pending=new Promise(resolve=>resume=resolve);
 const x=rig({beforeReply:async name=>{if(name==='admin_approve_package')await pending;}});
 const first=x.run();await x.run();assert.equal(x.calls.length,1);resume();await first;
 assert.equal(x.calls.filter(c=>c.name==='admin_approve_package').length,1);
 assert.equal(x.calls.filter(c=>c.name==='admin_queue_package').length,1);
});
test('wrong approval identity, hash, revision or status cannot lead to Send',async()=>{
 for(const patch of [{package_id:id(9)},{manifest_sha256:'b'.repeat(64)},{revision:'invalid'},{status:'DRAFT'}]){
  const x=rig({approval:a=>Object.assign(a,patch)});await x.run();assert.equal(x.calls.length,1);
  assert.equal(x.context.loaded,false);assert.match(x.messages.at(-1),/not confirmed/);
 }
});
test('fresh server authorization and exact approved readback are required before queuing',async()=>{
 for(const patch of [{id:id(9)},{revision:id(9)},{manifest_sha256:'b'.repeat(64)},
  {status:'QUEUED'},{can_send:false,send_blocked_reason:'Delivery paused'}]){
  const x=rig({state:s=>{Object.assign(s.package,patch);return s;}});await x.run();
  assert.equal(x.calls.length,2);assert.equal(x.context.loaded,false);
  assert.match(x.messages.at(-1),/Approval saved; delivery not confirmed/);
 }
 const x=rig({state:s=>({...s,work_order_id:id(9)})});await x.run();assert.equal(x.calls.length,2);
});
test('lost responses stop without automatic mutation retry and require reload',async()=>{
 for(const fail of ['admin_approve_package','admin_package_state','admin_queue_package']){
  const x=rig({fail});await x.run();const count=x.calls.length;await x.run();
  assert.equal(x.calls.length,count);assert.equal(x.context.loaded,false);assert.equal(x.context.busy,false);
  assert.match(x.messages.at(-1),/Reload the current job/);
  assert.equal(x.calls.filter(c=>c.name==='admin_queue_package').length,fail==='admin_queue_package'?1:0);
 }
});
test('late responses after job, account or generation changes cannot continue into Send or paint the new context',async()=>{
 for(const after of ['admin_approve_package','admin_package_state'])for(const change of [
  ctx=>{ctx.wo=id(99);},ctx=>{ctx.accessToken='another-fixture-token';},ctx=>{ctx.seq++;}]){
  const x=rig({beforeReply:async(name,ctx)=>{if(name===after)change(ctx);}});await x.run();
  assert.equal(x.calls.some(c=>c.name==='admin_queue_package'),false);
  assert.equal(x.messages.some(m=>m.includes('not confirmed')),false);
 }
});
test('an unconfirmed queue result never claims success or starts a retry',async()=>{
 const x=rig({queue:q=>({...q,package_id:id(99)})});await x.run();
 assert.equal(x.calls.length,3);assert.equal(x.context.loaded,false);
 assert.match(x.messages.at(-1),/Send result could not be confirmed/);
});
test('the one package summary explains requirements, destination and selected visits without JSON identifiers',()=>{
 const start=source.indexOf('  function packageSummary(manifest)');
 const end=source.indexOf('  function canApprove()',start);
 assert.ok(start>0&&end>start);
 const ctx={config:{companies:[{id:id(6),name:'Disposable Client'}]},
  photoFacts:[{photo_id:id(7),run_sequence:2,decision:'APPROVED'}]};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end)+'\nthis.summary=packageSummary;',ctx);
 const manifest={client_company_id:id(6),client_wo_number:'TEST-RETURN',destination_provider:'GOOGLE_DRIVE',
  destination_root:'OPAQUE-FOLDER-ID',client_notes:'Ready for client review',
  requirements:{items:[{id:id(8),label:'Front',enabled:true,minimum:1},
   {id:id(9),label:'Back',enabled:false,minimum:8}],total:{enabled:false,minimum:8}},
  correction_obligations:[{obligation_id:id(10)}],
  selected_photos:[{photo_id:id(7),release_item_id:id(8),review_decision:'APPROVED'}]};
 const text=ctx.summary(manifest);
 for(const value of ['Work order: TEST-RETURN','Client: Disposable Client','Google Drive',
  'Photos included: 1','1. Front · Visit 2 · Approved','Front: at least 1',
  'No additional total-photo minimum.','Follow-up photo requirements: Passed','Ready for client review'])assert.ok(text.includes(value),value);
 for(const hidden of [id(7),id(8),'OPAQUE-FOLDER-ID','"selected_photos"','Back: at least 8'])assert.equal(text.includes(hidden),false);
 manifest.requirements.total={enabled:true,minimum:8};assert.match(ctx.summary(manifest),/Minimum total photos: 8/);
 manifest.requirements.items=[];manifest.selected_photos=[];manifest.correction_obligations=[];
 assert.match(ctx.summary(manifest),/Required photos: None/);assert.match(ctx.summary(manifest),/Photos included: 0/);
 assert.equal(ctx.summary(manifest).includes('Follow-up photo requirements:'),false);
});
