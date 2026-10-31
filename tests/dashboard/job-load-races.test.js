'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source=fs.readFileSync(require.resolve('../../dashboard/job-workspace.js'),'utf8');
function section(begin,end) {
 const a=source.indexOf(begin),b=source.indexOf(end,a);
 assert.ok(a>=0 && b>a,'Existing Phase 6A workspace owner is required');
 return source.slice(a,b);
}
const loadSource=section('  async function load(id) {','  function addressContext() {');
const reconSource=section('  async function reconcileSaved(id) {','  function refreshed(rows) {');
function rig({initiallyDirty=false}={}) {
 let resolveRead, rejectRead, dirtyFlag=initiallyDirty, fingerprint='original';
 let selection=0, actor='admin-one', org='org-one', token='token-one', epoch=2;
 const actions=[], guards=[], listeners=new Map();
 const pending=new Promise((resolve,reject)=>{resolveRead=resolve;rejectRead=reject;});
 const controls={'job-list-status':{textContent:''}};
 const context={
   editSection:{
     addEventListener(type,fn){listeners.set(type,fn);},
     removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);}
   },
   saveEditButton:{disabled:false},
   el:id=>controls[id]||(controls[id]={textContent:''}),
   fingerprint:()=>fingerprint,dirty:()=>dirtyFlag,
   guard:fn=>guards.push(fn),
   fetchWorkOrder:async()=>pending,
   openEditor:(id,row)=>actions.push({id,row}),
   pendingFiltersMessage:()=> 'Unapplied filters',
   filterDraftPending:false
 };
 vm.createContext(context);
 vm.runInContext([
   'let selection=0;',
   'let adminSessionEpoch=2, accessToken="token-one";',
   'let currentUser={id:"admin-one",app_metadata:{organization_id:"org-one"}};',
   'let selectedRow={id:"job-original"};',
   loadSource,reconSource,
   'globalThis.loadJob=load;globalThis.reconcileJob=reconcileSaved;',
   'globalThis.setSelection=v=>selection=v;',
   'globalThis.setSession=(epoch,tok,user,tenant)=>{adminSessionEpoch=epoch;accessToken=tok;currentUser={id:user,app_metadata:{organization_id:tenant}};};',
   'globalThis.setSelected=id=>{selectedRow={id};};'
 ].join('\n'),context);
 return {
   ctx:context,actions,guards,listeners,controls,
   finish:(value={id:'job-next'})=>resolveRead(value),
   fail:error=>rejectRead(error),setDirty:v=>{dirtyFlag=v;},
   editDraft:()=>{dirtyFlag=true;listeners.get('input')?.();},
   setFingerprint:v=>{fingerprint=v;}
 };
}

test('same-account clean job read opens only the intended work order and cleans listeners',async()=>{
 const h=rig();
 const task=h.ctx.loadJob('job-next');h.finish();
 await task;
 assert.deepEqual(h.actions.map(x=>x.id),['job-next']);
 assert.equal(h.guards.length,0);
 assert.equal(h.listeners.size,0);
});

test('editing correction/delivery draft during load must prompt, not erase unsaved work',async()=>{
 const h=rig();
 const task=h.ctx.loadJob('job-next');
 h.editDraft();
 h.finish();
 await task;
 assert.equal(h.actions.length,0);
 assert.equal(h.guards.length,1);
 h.guards[0]();
 assert.deepEqual(h.actions.map(x=>x.id),['job-next']);
 assert.equal(h.listeners.size,0);
});

test('previous Discard is not prompted twice unless there are fresh edits',async()=>{
 const h=rig({initiallyDirty:true});
 const task=h.ctx.loadJob('job-next');h.finish();
 await task;
 assert.deepEqual(h.actions.map(x=>x.id),['job-next']);
 assert.equal(h.guards.length,0);
 const again=rig({initiallyDirty:true});
 const second=again.ctx.loadJob('job-next');again.editDraft();again.finish();
 await second;
 assert.equal(again.actions.length,0);
 assert.equal(again.guards.length,1);
});

test('detail edit made while loading is never silently lost',async()=>{
 const h=rig();const task=h.ctx.loadJob('job-next');
 h.setFingerprint('edited-details');h.setDirty(true);
 h.finish();await task;
 assert.equal(h.actions.length,0);assert.equal(h.guards.length,1);
});

test('stale account, token, epoch or selection cannot open or prompt old work order',async()=>{
 for (const mode of ['epoch','token','user','org','selection']) {
   const h=rig();const task=h.ctx.loadJob('job-next');
   if(mode==='selection')h.ctx.setSelection(12);
   else if(mode==='epoch')h.ctx.setSession(3,'token-one','admin-one','org-one');
   else if(mode==='token')h.ctx.setSession(2,'token-two','admin-one','org-one');
   else if(mode==='user')h.ctx.setSession(2,'token-one','admin-two','org-one');
   else h.ctx.setSession(2,'token-one','admin-one','org-two');
   h.finish();await task;
   assert.equal(h.actions.length,0,mode);
   assert.equal(h.guards.length,0,mode);
   assert.equal(h.listeners.size,0,mode);
 }
});

test('late failed read from prior account does not overwrite current status',async()=>{
 const h=rig();const task=h.ctx.loadJob('job-next');
 h.ctx.setSession(3,'token-two','admin-two','org-two');
 h.controls['job-list-status'].textContent='New account';
 h.fail(Error('Old account error'));await task;
 assert.equal(h.controls['job-list-status'].textContent,'New account');
 assert.equal(h.listeners.size,0);
});

test('post-save reread cannot reopen a job after account or selected UUID changes',async()=>{
 for (const mode of ['account','selected','selection']) {
   const h=rig();const task=h.ctx.reconcileJob('job-original');
   if(mode==='account')h.ctx.setSession(3,'token-two','admin-two','org-two');
   if(mode==='selected')h.ctx.setSelected('job-other');
   if(mode==='selection')h.ctx.setSelection(42);
   h.finish({id:'job-original'});const result=await task;
   assert.equal(result,null);
   assert.equal(h.actions.length,0,mode);
 }
});

test('existing opened workspace and saved-reload use one selection owner',()=>{
 assert.match(source,/function opened\(row\) \{\s*\/\/ A direct editor open\/save reload invalidates older in-flight job reads\.\s*selection\+\+;/);
 assert.match(reconSource,/selectedRow\?\.id !== id/);
});
