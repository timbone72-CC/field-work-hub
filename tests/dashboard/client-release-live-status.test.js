'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../dashboard/client-release.js'),'utf8');
const message=source.slice(source.indexOf('  function packageStatusText(pkg)'),source.indexOf('  function canApprove()'));
const handler=source.slice(source.indexOf('  async function refreshStatus(){'),source.indexOf('  async function loadNextPhotos(){'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function rig(options={}){
 const calls=[],messages=[],panel={hidden:false};
 const ctx={loaded:true,busy:false,statusRead:null,wo:id(1),seq:1,accessToken:'fixture-token',
  pkg:{id:id(2),status:'QUEUED',revision:id(3),notes:'Saved client notes',photos:[{photo_id:id(8)}],can_send:false},
  dirty:()=>!!options.dirty,editSection:{open:true},document:{hidden:false},navigator:{onLine:true},
  UUID:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  el:name=>{assert.equal(name,'job-delivery');return panel;},buttons(){},status:(_id,message)=>messages.push(message),
  valid:(n,wo,token)=>ctx.seq===n&&ctx.wo===wo&&ctx.accessToken===token,
  rpc:async(name,body,token)=>{calls.push({name,body:structuredClone(body),token});
   await options.beforeReply?.(ctx);if(options.fail)throw Error('Offline');
   const response={work_order_id:id(1),package:{id:id(2),status:options.status||'DELIVERED',revision:id(4),can_send:true}};
   return options.response?.(response)||response;}};
 vm.createContext(ctx);vm.runInContext(message+'\n'+handler+'\nthis.refresh=refreshStatus;',ctx);
 return {ctx,calls,messages,panel,run:()=>ctx.refresh()};
}
test('an open queued package refreshes delivery status in place without reloading inputs or sending',async()=>{
 const x=rig();await x.run();
 assert.deepEqual(x.calls.map(c=>c.name),['admin_package_state']);
 assert.equal(x.calls[0].body.p_wo,id(1));assert.equal(x.ctx.pkg.status,'DELIVERED');
 assert.equal(x.ctx.pkg.notes,'Saved client notes');assert.equal(x.ctx.pkg.photos[0].photo_id,id(8));
 assert.equal(x.ctx.pkg.can_send,false);assert.equal(x.ctx.editSection.open,true);
 assert.match(x.messages.at(-1),/Package DELIVERED.*receipt confirmed/);
 await x.run();assert.equal(x.calls.length,1,'Delivered packages stop requesting status');
});
test('current draft edits, hidden tab, closed job, offline page and mutation activity suppress status reads',async()=>{
 const changes=[x=>x.ctx.loaded=false,x=>x.ctx.busy=true,x=>x.panel.hidden=true,
  x=>x.ctx.editSection.open=false,x=>x.ctx.document.hidden=true,x=>x.ctx.navigator.onLine=false,
  x=>x.ctx.pkg.status='DRAFT',x=>x.ctx.pkg.status='APPROVED'];
 for(const change of changes){const x=rig();change(x);await x.run();assert.equal(x.calls.length,0);}
 const x=rig({dirty:true});await x.run();assert.equal(x.calls.length,0);
});
test('overlapping refresh ticks share one in-flight read',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);
 const x=rig({beforeReply:()=>pending});const first=x.run();await x.run();
 assert.equal(x.calls.length,1);release();await first;assert.equal(x.ctx.statusRead,null);
});
test('late read cannot paint another job, account, tab or edit session',async()=>{
 for(const change of [ctx=>ctx.seq++,ctx=>ctx.wo=id(9),ctx=>ctx.accessToken='new-fixture-token',
  ctx=>ctx.editSection.open=false,ctx=>ctx.busy=true]){
  const x=rig({beforeReply:change});await x.run();assert.equal(x.ctx.pkg.status,'QUEUED');assert.equal(x.messages.length,0);
 }
 const x=rig({beforeReply:()=>{x.panel.hidden=true;}});await x.run();assert.equal(x.messages.length,0);
});
test('failed or mismatched status reads retain last confirmed state and only retry a read',async()=>{
 for(const options of [{fail:true},{response:s=>({...s,work_order_id:id(9)})},
  {response:s=>{s.package.id=id(9);return s;}},{status:'DRAFT'}]){
  const x=rig(options);await x.run();assert.equal(x.ctx.pkg.status,'QUEUED');
  assert.match(x.messages.at(-1),/Last confirmed status: QUEUED/);
  await x.run();assert.equal(x.calls.length,2);
  assert.equal(x.calls.every(c=>c.name==='admin_package_state'),true);
 }
});
test('delivering and protected terminal problems render their actual state without a new Send',async()=>{
 for(const status of ['DELIVERING','FAILED','UNCERTAIN']){
  const x=rig({status});await x.run();assert.equal(x.ctx.pkg.status,status);
  assert.match(x.messages.at(-1),new RegExp('Package '+status));
  if(status!=='DELIVERING'){await x.run();assert.equal(x.calls.length,1);}
 }
});
