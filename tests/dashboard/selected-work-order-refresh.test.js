'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../../dashboard/job-workspace.js'),'utf8');
const start=source.indexOf('  // Exact selected identity is captured before a background read.');
const end=source.indexOf('  let moving=false;',start);
assert.ok(start>0 && end>start,'Expected existing selected-workspace refresh owner');

function rig() {
 const id='selected-job';
 const old={id,organization_id:'org-a',instructions:'original',field_status:'ASSIGNED'};
 const status=[],fields={'job-reload':{hidden:true}};
 const context={
   editSection:{open:true},selectedRow:old,selection:10,needsReload:false,
   page(){},setEditStatus:(msg,error)=>status.push({msg,error}),
   el:key=>fields[key]??={hidden:true}
 };
 vm.createContext(context);
 vm.runInContext(source.slice(start,end)+
   '\\nglobalThis.refresh=refreshed;globalThis.snapshot=selectionSnapshot;'+
   'globalThis.readState=()=>({needsReload,selectedRow});',context);
 return {context,old,status,fields};
}

test('off-page selected job change is flagged but its editor row/drafts are untouched',()=>{
 const f=rig(),newRow={...f.old,instructions:'changed on server'};
 f.context.refresh([],{...f.context.snapshot(),row:newRow});
 assert.equal(f.context.readState().needsReload,true);
 assert.equal(f.fields['job-reload'].hidden,false);
 assert.equal(f.context.readState().selectedRow.instructions,'original');
 assert.match(f.status.at(-1).msg,/changed on the server/);
});
test('off-page unchanged job does not falsely block a save',()=>{
 const f=rig();
 f.context.refresh([],{...f.context.snapshot(),row:{...f.old}});
 assert.equal(f.context.readState().needsReload,false);
 assert.equal(f.status.length,0);
});
test('temporary or revoked selected-job read fails closed without inventing deletion',()=>{
 const f=rig();
 f.context.refresh([],{...f.context.snapshot(),unavailable:true});
 assert.equal(f.context.readState().needsReload,true);
 assert.match(f.status.at(-1).msg,/Unable to verify/);
 assert.doesNotMatch(f.status.at(-1).msg,/deleted/);
 assert.equal(f.context.readState().selectedRow.instructions,'original');
});
test('stale result from a replaced selection cannot flag a different open job',()=>{
 const f=rig(),original=f.context.snapshot();
 f.context.selection=11;
 f.context.selectedRow={...f.old,id:'different-job'};
 f.context.refresh([],{...original,unavailable:true});
 assert.equal(f.context.readState().needsReload,false);
 assert.equal(f.status.length,0);
});
test('visible selected job uses refreshed page facts even without a separate read',()=>{
 const f=rig(),newRow={...f.old,field_status:'IN_PROGRESS'};
 f.context.refresh([newRow],null);
 assert.equal(f.context.readState().needsReload,true);
 assert.equal(f.context.readState().selectedRow.field_status,'ASSIGNED');
});
test('closed workspace cannot be reclassified by a background selected read',()=>{
 const f=rig(),original=f.context.snapshot();
 f.context.editSection.open=false;
 f.context.refresh([],{...original,unavailable:true});
 assert.equal(f.context.readState().needsReload,false);
 assert.equal(f.status.length,0);
});
