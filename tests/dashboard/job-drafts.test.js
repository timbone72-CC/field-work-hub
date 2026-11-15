'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(require.resolve('../../dashboard/job-drafts.js'),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function rig(){
 const nodes=new Map(),calls=[],notices=[];let data=null,nextFailure=null,delay=null;
 const row={id:id(1),organization_id:id(2),updated_at:'2026-11-15T00:00:00Z',field_status:'ASSIGNED'};
 const ctx={crypto:webcrypto,structuredClone,JSON,Map,Object,Error,console,
  document:{getElementById(id){if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,textContent:'',classList:{toggle(){}},addEventListener(){}});return nodes.get(id);}},
  editPhotos:{value:{schema:1,revision:id(3),total:{enabled:false,minimum:0},items:[]},expectedRevision:id(3),load(v){this.value=structuredClone(v);}},
  PhotoRules:{validate(v){if(!v?.items)throw Error('Invalid requirements');}},
  editForm:{addEventListener(){}},editWorkOrderIdInput:{value:row.id},
  currentUser:{id:id(4),app_metadata:{organization_id:row.organization_id}},adminSessionEpoch:1,accessToken:'TOKEN',
  SUPABASE_URL:'https://example.invalid',authHeaders:()=>({}),readableError:async r=>r.message,
  JobWorkspace:{saveUnverified(){notices.push('stale');}},window:{confirm:()=>true},
  adminFetch:async(url,options)=>{const request=JSON.parse(options.body);calls.push({url,request});
   if(delay){const d=delay;delay=null;await d;}
   if(nextFailure==='BEFORE'){nextFailure=null;throw Error('offline');}
   if(url.endsWith('admin_save_job_draft')){
    if(data&&request.p_write_id===data.write_id){assert.deepEqual(data.payload,request.p_payload);}
    else if((data?.revision||null)!==request.p_expected_revision)return {ok:false,message:'conflict'};
    else data={id:id(5),revision:webcrypto.randomUUID(),payload:request.p_payload,write_id:request.p_write_id,stale:false,base_updated_at:row.updated_at};
   }
   if(url.endsWith('admin_discard_job_draft')){
    if(data&&data.revision!==request.p_expected_revision)return {ok:false,message:'conflict'};
    data=null;
   }
   if(nextFailure==='AFTER'){nextFailure=null;throw Error('response lost');}
   const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,reorder(v[k])])):v;
   return {ok:true,json:async()=>reorder({work_order_id:row.id,organization_id:row.organization_id,owner_user_id:ctx.currentUser.id,draft:data})};
  }
 };
 vm.createContext(ctx);vm.runInContext(source+'\nthis.drafts=JobDrafts;',ctx);
 const drafts=ctx.drafts;
 const node=id=>ctx.document.getElementById(id);
 return {ctx,row,drafts,nodes,calls,notices,node,
  setFail:value=>{nextFailure=value;},setDelay:value=>{delay=value;},
  get data(){return data;},set data(v){data=v;}};
}
test('server draft survives close/reopen without applying current work',async()=>{
 const h=rig();await h.drafts.open(h.row);h.node('edit-instructions').value='Draft only';
 assert.equal(await h.drafts.save(),true);assert.equal(h.drafts.isSaved(),true);
 assert.ok(h.calls.every(c=>!c.url.includes('update_work_order')));
 h.drafts.reset();h.node('edit-instructions').value='Active job';await h.drafts.open(h.row);
 assert.equal(h.node('edit-instructions').value,'Draft only');assert.equal(h.drafts.isSaved(),true);
});
test('failed save retains edits and exact lost-response retry is idempotent',async()=>{
 const h=rig();await h.drafts.open(h.row);h.node('edit-instructions').value='Retain me';h.setFail('AFTER');
 assert.equal(await h.drafts.save(),false);assert.equal(h.drafts.isSaved(),false);
 const revision=h.data.revision,writeId=h.data.write_id;
 assert.equal(h.node('edit-instructions').value,'Retain me');
 assert.equal(await h.drafts.save(),true);assert.equal(h.data.revision,revision);assert.equal(h.data.write_id,writeId);
});
test('new typing during a save remains unsaved',async()=>{
 const h=rig();await h.drafts.open(h.row);h.node('edit-instructions').value='Before';
 let release;h.setDelay(new Promise(r=>{release=r;}));const work=h.drafts.save();
 h.node('edit-instructions').value='After';release();assert.equal(await work,false);
 assert.equal(h.data.payload.instructions,'Before');assert.equal(h.drafts.isSaved(),false);
});
test('late account response cannot populate another account',async()=>{
 const h=rig();let release;h.setDelay(new Promise(r=>{release=r;}));const work=h.drafts.open(h.row);
 h.drafts.reset();h.ctx.currentUser={id:id(99),app_metadata:{organization_id:id(98)}};release();await work;
 assert.equal(h.drafts.isSaved(),false);assert.equal(h.node('job-draft-status').textContent,'');
});
test('draft read cannot overwrite typing while opening',async()=>{
 const h=rig();await h.drafts.open(h.row);h.node('edit-instructions').value='Saved';await h.drafts.save();
 let release;h.setDelay(new Promise(r=>{release=r;}));const work=h.drafts.open(h.row);
 h.node('edit-instructions').value='New typing';release();await work;
 assert.equal(h.node('edit-instructions').value,'New typing');assert.equal(h.drafts.isSaved(),false);
});
test('stale draft stays available without silently replacing current job',async()=>{
 const h=rig();await h.drafts.open(h.row);h.node('edit-instructions').value='Old draft';await h.drafts.save();
 h.data.stale=true;h.node('edit-instructions').value='Latest';await h.drafts.open(h.row);
 assert.equal(h.node('edit-instructions').value,'Latest');assert.equal(h.drafts.isSaved(),false);
 assert.equal(h.drafts.resume(),true);assert.equal(h.node('edit-instructions').value,'Old draft');
 assert.deepEqual(h.notices,['stale']);
});
test('conflicting saved revision is retained and cannot overwrite another tab',async()=>{
 const h=rig();await h.drafts.open(h.row);h.node('edit-instructions').value='Saved';await h.drafts.save();
 h.data={...h.data,revision:webcrypto.randomUUID()};h.node('edit-instructions').value='Local';
 assert.equal(await h.drafts.save(),false);assert.equal(h.data.payload.instructions,'Saved');assert.equal(h.drafts.isSaved(),false);
 assert.equal(await h.drafts.discard(),false);assert.equal(h.node('edit-instructions').value,'Local');
});
test('checking a confirmed lost response recognizes saved content',async()=>{
 const h=rig();await h.drafts.open(h.row);h.setFail('AFTER');assert.equal(await h.drafts.save(),false);
 await h.drafts.check();assert.equal(h.drafts.isSaved(),true);
});

test('resumed legacy requirements keep ordinary active edits from rewriting field requirements',async()=>{
 const h=rig();h.ctx.editPhotos.legacy=true;h.ctx.editPhotos.expectedRevision=null;
 await h.drafts.open(h.row);await h.drafts.save();h.ctx.editPhotos.legacy=false;
 await h.drafts.open(h.row);assert.equal(h.ctx.editPhotos.legacy,true);
 assert.equal(h.ctx.editPhotos.expectedRevision,null);assert.equal(h.drafts.isSaved(),true);
});

test('applying unrelated editor contents preserves the unapplied saved draft',async()=>{
 const h=rig();await h.drafts.open(h.row);h.node('edit-instructions').value='Saved';await h.drafts.save();
 h.node('edit-instructions').value='Different active edit';await h.drafts.applied();
 assert.equal(h.data.payload.instructions,'Saved');
 h.node('edit-instructions').value='Saved';await h.drafts.applied();assert.equal(h.data,null);
});

test('fresh check invalidates Saved when another tab changed or removed the server draft',async()=>{
 const h=rig();await h.drafts.open(h.row);h.node('edit-instructions').value='My draft';await h.drafts.save();
 h.data={...h.data,payload:{...h.data.payload,instructions:'Other tab'}};
 await h.drafts.check();assert.equal(h.drafts.isSaved(),false);assert.equal(h.node('edit-instructions').value,'My draft');
 h.data=null;await h.drafts.check();assert.equal(h.drafts.isSaved(),false);
});
test('failed save or uncertain discard cannot keep claiming the input is saved',async()=>{
 const h=rig();await h.drafts.open(h.row);await h.drafts.save();h.setFail('BEFORE');
 assert.equal(await h.drafts.save(),false);assert.equal(h.drafts.isSaved(),false);
 await h.drafts.check();assert.equal(h.drafts.isSaved(),true);h.setFail('AFTER');
 assert.equal(await h.drafts.discard(),false);assert.equal(h.drafts.isSaved(),false);
});
