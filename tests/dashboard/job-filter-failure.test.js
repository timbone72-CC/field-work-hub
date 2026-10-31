'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const JobViewRules = require('../../dashboard/job-workspace.js');
const source = fs.readFileSync(require.resolve('../../dashboard/job-workspace.js'),'utf8');
const a = source.indexOf('  function setPageControls(rows) {');
const b = source.indexOf('  function guard(action) {',a);
assert.ok(a>0 && b>a);
const code = source.slice(a,b);
function rig() {
 const names=['job-page-info','job-page-previous','job-page-next','job-list-status',
 'job-page-size','job-sort','job-status','job-search','job-search-field','job-contractor','job-due-date'];
 const fields=Object.fromEntries(names.map(n=>[n,{value:'',disabled:false,textContent:''}]));
 Object.assign(fields['job-page-size'],{value:'50'});
 fields['job-sort'].value='due_date.asc';
 fields['job-status'].value='FIELD_COMPLETE';
 fields['job-search'].value='other address';
 fields['job-search-field'].value='property_address';
 const rows=Array.from({length:25},(_,i)=>({id:'WO-'+i}));
 rows.page={offset:25,total:75,revision:0};
 const writes=[];
 const ctx={JobViewRules,workOrderRows:rows,el:id=>fields[id],
   accessToken:'synthetic',adminWritesPending:false,saveEditButton:{disabled:false},
   localStorage:{setItem:(k,v)=>writes.push([k,v])},navigation(){},accept(){},
   refreshWorkOrders:async()=>{throw Error('offline');}};
 vm.createContext(ctx);
 vm.runInContext([
 'let state={size:25,sort:"created_at.desc",status:"ASSIGNED",offset:25,search:"old",searchField:"property_address",contractor:"",dueDate:""};',
 'let revision=0,filterReadFailed=false;',
 'const JOB_VIEW_STORAGE_KEY=()=>"fixture";',
 code,
 'globalThis.apply=change;globalThis.refreshPage=page;',
 'globalThis.info=()=>({state:{...state},filterReadFailed});'
 ].join('\n'),ctx);
 return {ctx,fields,writes,rows};
}
test('failed filter restores last confirmed results/pager, not saved preferences',async()=>{
 const f=rig();
 assert.equal(await f.ctx.apply(0),false);
 assert.equal(f.ctx.info().state.offset,25);
 assert.equal(f.ctx.info().state.status,'ASSIGNED');
 assert.equal(f.ctx.info().filterReadFailed,true);
 assert.equal(f.fields['job-status'].value,'FIELD_COMPLETE');
 assert.equal(f.fields['job-page-previous'].disabled,false);
 assert.equal(f.fields['job-page-next'].disabled,false);
 assert.equal(f.writes.length,0);
 assert.match(f.fields['job-list-status'].textContent,/Filters were not applied/);
});
test('old-page auto refresh preserves pending failure notice',async()=>{
 const f=rig();await f.ctx.apply(0);
 const message=f.fields['job-list-status'].textContent;
 f.ctx.refreshPage(f.rows);
 assert.equal(f.fields['job-list-status'].textContent,message);
});
test('explicit successful retry persists the now-confirmed preferences only',async()=>{
 const f=rig();await f.ctx.apply(0);
 f.ctx.refreshWorkOrders=async()=>f.ctx.refreshPage(f.rows);
 assert.equal(await f.ctx.apply(0),true);
 assert.equal(f.ctx.info().filterReadFailed,false);
 assert.equal(f.fields['job-list-status'].textContent,'');
 assert.equal(f.ctx.info().state.status,'FIELD_COMPLETE');
 assert.equal(f.writes.length,1);
 const saved=JSON.parse(f.writes[0][1]);
 assert.deepEqual(Object.keys(saved).sort(),['size','sort','status']);
 assert.equal(saved.size,50);
 assert.equal(saved.sort,'due_date.asc');
 assert.equal(saved.status,'FIELD_COMPLETE');
});
