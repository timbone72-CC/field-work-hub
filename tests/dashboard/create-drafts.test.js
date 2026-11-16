'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');const PhotoRules=require('../../dashboard/photo-requirements.js');
const core=fs.readFileSync(require.resolve('../../dashboard/job-drafts.js'),'utf8');
const source=fs.readFileSync(require.resolve('../../dashboard/create-drafts.js'),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function rig(){
 const nodes=new Map(),saved=new Map(),calls=[],receipts=new Map();let fail=false,delay=null,mode='auto',failCreateAfter=false,createdCount=0;
 const node=name=>{if(!nodes.has(name))nodes.set(name,{value:'',checked:false,hidden:true,disabled:false,textContent:'',events:new Map(),
   classList:{toggle(){}},addEventListener(t,fn){this.events.set(t,fn);},focus(){}});return nodes.get(name);};
 const cfg={schema:1,revision:id(7),total:{enabled:false,minimum:0},items:[]};
 const ctx={crypto:webcrypto,structuredClone,JSON,PhotoRules,Error,Object,Map,console,
  currentUser:{id:id(1),app_metadata:{role:'ADMIN',organization_id:id(2)}},adminSessionEpoch:1,accessToken:'token-a',
  document:{getElementById:node,querySelectorAll:()=>[]},window:{confirm:()=>true,addEventListener(){}},
  createPhotos:{value:structuredClone(cfg),selectedId:'',expectedRevision:null,load(p){this.value=p?structuredClone(p):structuredClone(cfg);this.selectedId='';}},
  createForm:{addEventListener(){},reset(){for(const name of ['wo-number','property-address','work-type','instructions','due-date','assignee'])node(name).value='';}},
  currentWoNumberMode:()=>mode,applyWoNumberMode:v=>{mode=v;},restoreWoNumberModePreference:()=>{mode='auto';},
  rememberWoNumberMode:node('remember-wo-number-mode'),woNumberInput:node('wo-number'),propertyAddressInput:node('property-address'),
  workTypeInput:node('work-type'),instructionsInput:node('instructions'),dueDateInput:node('due-date'),assigneeSelect:node('assignee'),
  fillWorkTypes(){},fillAssigneeSelect(){},assignableUsers:[],authHeaders:()=>({}),SUPABASE_URL:'https://example.invalid',
  readableError:async r=>r.message,
  adminFetch:async(url,options)=>{const p=JSON.parse(options.body),actor=ctx.currentUser.id;calls.push({url,p,actor});
   if(delay){const wait=delay;delay=null;await wait;}
   let d=saved.get(actor)||null;
   if(url.endsWith('admin_create_work_order_from_draft')){
    let result=receipts.get(p.p_revision);
    if(!result){
     if(!d||d.revision!==p.p_revision)return {ok:false,message:'Draft changed'};
     result=[{work_order_id:id(50),wo_number:'CREATED'}];createdCount++;receipts.set(p.p_revision,result);saved.delete(actor);
    }
    if(failCreateAfter){failCreateAfter=false;throw Error('response lost after commit');}
    return {ok:true,json:async()=>result};
   }
   if(url.endsWith('admin_save_job_draft')){
    if(fail)throw Error('offline');
    assert.equal(p.p_wo,null);assert.equal(p.p_base_updated_at,null);
    if(d?.write_id!==p.p_write_id){
     if((d?.revision||null)!==p.p_expected_revision)return {ok:false,message:'conflict'};
     d={id:id(5),revision:webcrypto.randomUUID(),payload:p.p_payload,write_id:p.p_write_id,stale:false};saved.set(actor,d);
    }
   }
   if(url.endsWith('admin_discard_job_draft')){if(d&&d.revision!==p.p_expected_revision)return {ok:false,message:'conflict'};saved.delete(actor);d=null;}
   return {ok:true,json:async()=>({work_order_id:null,organization_id:id(2),owner_user_id:actor,draft:d})};
  }};
 vm.createContext(ctx);vm.runInContext(core+'\n'+source+'\nthis.drafts=CreateJobDrafts;',ctx);ctx.drafts.init();
 return {ctx,node,calls,saved,drafts:ctx.drafts,click:name=>node(name).events.get('click')(),mode:()=>mode,setMode:v=>{mode=v;},
  setFail:v=>{fail=v;},setDelay:v=>{delay=v;},loseCreateResponse:()=>{failCreateAfter=true;},createdCount:()=>createdCount};
}
test('unfinished Create entry survives reload/resume without creating or assigning work',async()=>{
 const h=rig();await h.drafts.ensure();h.node('property-address').value='Unfinished draft';h.node('wo-number').value='MY-NEW-WO';
 h.setMode('custom');h.node('remember-wo-number-mode').checked=true;
 await h.click('create-draft-save');assert.equal(h.drafts.isSaved(),true);
 assert.match(h.node('create-draft-status').textContent,/No work order created/);
 h.drafts.reset();h.ctx.createForm.reset();h.setMode('auto');await h.drafts.ensure();
 assert.equal(h.node('property-address').value,'','Draft read does not overwrite a newly prepared form');
 h.click('create-draft-resume');assert.equal(h.node('property-address').value,'Unfinished draft');
 assert.equal(h.node('wo-number').value,'MY-NEW-WO');assert.equal(h.mode(),'custom');assert.equal(h.drafts.isSaved(),true);
 assert.ok(h.calls.every(c=>!c.url.includes('create_work_order')));
});
test('failed Save draft and continue stays on Create with all input retained',async()=>{
 const h=rig();await h.drafts.ensure();h.node('instructions').value='Retain me';h.setFail(true);
 let moved=0;h.drafts.guard(()=>{moved++;});assert.equal(h.node('create-draft-unsaved').hidden,false);
 await h.click('create-draft-save-continue');assert.equal(moved,0);assert.equal(h.node('instructions').value,'Retain me');
 h.setFail(false);await h.click('create-draft-save-continue');assert.equal(moved,1);assert.equal(h.drafts.isSaved(),true);
});
test('new typing during save prevents navigation and stays unsaved',async()=>{
 const h=rig();await h.drafts.ensure();h.node('instructions').value='Before';let release;
 h.setDelay(new Promise(r=>{release=r;}));let moved=0;h.drafts.guard(()=>{moved++;});
 const work=h.click('create-draft-save-continue');h.node('instructions').value='After';release();await work;
 assert.equal(moved,0);assert.equal(h.node('instructions').value,'After');assert.equal(h.drafts.isSaved(),false);
});
test('account reset blocks late reads and does not resume another user draft',async()=>{
 const h=rig();await h.drafts.ensure();h.node('instructions').value='User A';await h.click('create-draft-save');
 h.drafts.reset();h.ctx.createForm.reset();let release;h.setDelay(new Promise(r=>{release=r;}));const read=h.drafts.ensure();
 h.drafts.reset();h.ctx.currentUser={id:id(8),app_metadata:{role:'ADMIN',organization_id:id(2)}};release();await read;
 assert.equal(h.node('instructions').value,'');await h.drafts.ensure();assert.equal(h.drafts.isSaved(),false);
 assert.equal(h.node('create-draft-resume').hidden,true);
});
test('template snapshot and provenance survive resume after template is unavailable',async()=>{
 const h=rig();await h.drafts.ensure();h.ctx.createPhotos.selectedId=id(9);h.node('instructions').value='Copied';
 await h.click('create-draft-save');h.drafts.reset();h.ctx.createForm.reset();h.ctx.createPhotos.selectedId='';await h.drafts.ensure();
 h.click('create-draft-resume');assert.equal(h.ctx.createPhotos.selectedId,'');assert.equal(h.drafts.isSaved(),true);
 await h.click('create-draft-save');assert.equal(h.saved.get(id(1)).payload.sourceTemplateId,id(9));
});
test('discard unsaved input restores saved draft without deleting the server copy',async()=>{
 const h=rig();await h.drafts.ensure();h.node('instructions').value='Saved';await h.click('create-draft-save');
 h.node('instructions').value='Unsaved';let moved=0;h.drafts.guard(()=>{moved++;});h.click('create-draft-discard-local');
 assert.equal(moved,1);assert.equal(h.node('instructions').value,'Saved');assert.equal(h.saved.get(id(1)).payload.instructions,'Saved');
});

test('lost creation response retries one saved revision and consumes its draft once',async()=>{
 const h=rig();await h.drafts.ensure();h.node('property-address').value='Create me';h.node('work-type').value='Inspection';
 h.node('due-date').value='2026-11-20';h.node('assignee').value=id(6);h.loseCreateResponse();
 await assert.rejects(h.drafts.submit(),/response lost/);assert.equal(h.createdCount(),1);assert.equal(h.saved.size,0);
 const result=await h.drafts.submit();assert.equal(result[0].work_order_id,id(50));assert.equal(h.createdCount(),1);
 const attempts=h.calls.filter(c=>c.url.endsWith('admin_create_work_order_from_draft'));
 assert.equal(attempts[0].p.p_revision,attempts[1].p.p_revision);
 h.drafts.created();await h.drafts.refreshed();assert.equal(h.node('create-draft-resume').hidden,true);
});
test('changing input after uncertain creation cannot start a different duplicate',async()=>{
 const h=rig();await h.drafts.ensure();h.node('instructions').value='Original';h.loseCreateResponse();
 await assert.rejects(h.drafts.submit());h.node('instructions').value='New input';
 await assert.rejects(h.drafts.submit(),/Earlier creation is unconfirmed/);
 assert.equal(h.createdCount(),1);assert.equal(h.node('instructions').value,'New input');
});
